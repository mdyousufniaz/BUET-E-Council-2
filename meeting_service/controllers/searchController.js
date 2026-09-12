const crypto = require('crypto');
const axios = require('axios');
const CustomError = require('../errors/CustomError');
const db = require('../db');
const { normalizeQueryTokens, resolveMatchedEntity } = require('../lib/searchUtils');

const EMBEDDING_SERVICE_URL = process.env.EMBEDDING_SERVICE_URL || 'http://embedding_service:8002';
const SNIPPET_OPTS = 'StartSel=<mark>, StopSel=</mark>, MaxWords=35, MinWords=15';

const viewerTypeRestriction = (user) => {
    if (user?.role !== 'viewer') return null;
    if (user?.member_type === 'syndicate' || user?.member_type === 'none' || !user?.member_type) return null;
    return 'academic';
};

const cacheSearchResults = async (cacheKey, query, filters, results) => {
    try {
        await db.query(
            `INSERT INTO search_cache (cache_key, query, filters, results)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (cache_key) DO UPDATE SET results = EXCLUDED.results, created_at = CURRENT_TIMESTAMP`,
            [cacheKey, query, JSON.stringify(filters), JSON.stringify(results)]
        );
    } catch (err) {
        console.error('Failed to cache search results:', err.message);
    }
};

const search = async (req, res, next) => {
    try {
        const {
            q = '',
            scope = 'both',
            type = 'all',
            tags = '',
            dateFrom = '',
            dateTo = '',
            serialFrom = '',
            serialTo = '',
            limit = 25
        } = req.query;

        const trimmedQuery = (q || '').trim();
        const tagIds = tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [];
        const serialFromVal = serialFrom ? parseInt(serialFrom, 10) : null;
        const serialToVal = serialTo ? parseInt(serialTo, 10) : null;
        const serialFromNum = Number.isNaN(serialFromVal) ? null : serialFromVal;
        const serialToNum = Number.isNaN(serialToVal) ? null : serialToVal;

        const userRestriction = viewerTypeRestriction(req.user);
        const requestedType = (type === 'syndicate' || type === 'academic') ? type : 'all';
        const meetingType = userRestriction || requestedType;

        if (!trimmedQuery && tagIds.length === 0 && !serialFromNum && !serialToNum && meetingType === 'all' && !dateFrom && !dateTo) {
            return res.status(200).json({ success: true, data: [] });
        }

        // Cleanup old search cache periodically
        db.query("DELETE FROM search_cache WHERE created_at < NOW() - INTERVAL '24 hours'").catch(() => {});

        const filters = {
            q: trimmedQuery,
            scope,
            type: meetingType,
            tags: tagIds,
            dateFrom: dateFrom || null,
            dateTo: dateTo || null,
            serialFrom: serialFromNum,
            serialTo: serialToNum,
            limit: parseInt(limit, 10) || 25
        };

        const cacheKey = crypto.createHash('sha256').update(JSON.stringify(filters)).digest('hex');
        const cached = await db.query('SELECT results FROM search_cache WHERE cache_key = $1', [cacheKey]);
        if (cached.rows.length > 0) {
            return res.status(200).json({ success: true, data: cached.rows[0].results, cached: true });
        }

        // Filter-only search (no query text, but tags / dates / serial numbers are passed)
        if (!trimmedQuery) {
            const filterOnlyQuery = `
                SELECT 
                    a.id AS agenda_id,
                    a.meeting_id,
                    a.content,
                    a.resolution,
                    m.title,
                    m.meeting_title,
                    m.type,
                    m.meeting_date,
                    m.status,
                    'agenda' AS matched_in,
                    'tag' AS match_type,
                    1.0 AS final_rank,
                    coalesce(nullif(regexp_replace(coalesce(a.content_plain, a.content, ''), '<[^>]+>', ' ', 'g'), ''), ' ') AS snippet
                FROM agenda a
                JOIN meetings m ON a.meeting_id = m.id
                WHERE 
                    m.status != 'draft'
                    AND ($1::text = 'all' OR m.type::text = $1::text)
                    AND ($2::date IS NULL OR m.meeting_date >= $2::date)
                    AND ($3::date IS NULL OR m.meeting_date <= $3::date)
                    AND ($4::uuid[] IS NULL OR EXISTS (SELECT 1 FROM agenda_tags at2 WHERE at2.agenda_id = a.id AND at2.tag_id = ANY($4::uuid[])))
                    AND ($5::numeric IS NULL OR (CASE WHEN translate(trim(m.title), '০১২৩৪৫৬৭৮৯', '0123456789') ~ '^\\s*[0-9]+\\s*$' THEN translate(trim(m.title), '০১২৩৪৫৬৭৮৯', '0123456789')::numeric ELSE NULL END) >= $5::numeric)
                    AND ($6::numeric IS NULL OR (CASE WHEN translate(trim(m.title), '০১২৩৪৫৬৭৮৯', '0123456789') ~ '^\\s*[0-9]+\\s*$' THEN translate(trim(m.title), '০১২৩৪৫৬৭৮৯', '0123456789')::numeric ELSE NULL END) <= $6::numeric)
                ORDER BY m.meeting_date DESC
                LIMIT $7;
            `;

            const filterParams = [
                meetingType,
                dateFrom || null,
                dateTo || null,
                tagIds.length ? tagIds : null,
                serialFromNum,
                serialToNum,
                filters.limit
            ];

            const result = await db.query(filterOnlyQuery, filterParams);
            await cacheSearchResults(cacheKey, '', filters, result.rows);
            return res.status(200).json({ success: true, data: result.rows, cached: false });
        }

        // 1. Morphological Normalization (0ms)
        const { tokens: queryTokens, normalizedString } = normalizeQueryTokens(trimmedQuery);

        // 2. Fetch known offices and departments to check token coverage against DB entities
        const entityRows = await db.query(
            `SELECT id, name_bangla FROM departments WHERE name_bangla IS NOT NULL
             UNION ALL
             SELECT id, name_bangla FROM offices WHERE name_bangla IS NOT NULL`
        );
        const matchedEntityId = resolveMatchedEntity(queryTokens, entityRows.rows);

        // 3. Get Query Vector from FastAPI (hits LRU Cache on repeated terms)
        let queryEmbedding = null;
        try {
            const embedRes = await axios.post(`${EMBEDDING_SERVICE_URL}/embed`, {
                texts: [trimmedQuery]
            }, { timeout: 10000 });
            queryEmbedding = embedRes.data?.embeddings?.[0] || null;
        } catch (embedErr) {
            console.warn('[searchController] Embedding service unavailable, falling back to lexical search:', embedErr.message);
            queryEmbedding = null;
        }

        // 4. Single-Pass PostgreSQL Hybrid Query
        const searchQuery = `
            WITH vector_candidates AS (
                SELECT c.agenda_id, 'agenda' AS chunk_type, (1 - (c.embedding <=> $1::vector)) AS dense_score
                FROM agenda_chunks c
                WHERE $1::vector IS NOT NULL
                ORDER BY c.embedding <=> $1::vector ASC
                LIMIT 100
                UNION ALL
                SELECT rc.agenda_id, 'resolution' AS chunk_type, (1 - (rc.embedding <=> $1::vector)) AS dense_score
                FROM resolution_chunks rc
                WHERE $1::vector IS NOT NULL AND $8::text = 'both'
                ORDER BY rc.embedding <=> $1::vector ASC
                LIMIT 100
            ),
            best_vector AS (
                SELECT agenda_id, MAX(dense_score) AS dense_score,
                       (ARRAY_AGG(chunk_type ORDER BY dense_score DESC))[1] AS vec_matched_in
                FROM vector_candidates
                GROUP BY agenda_id
            ),
            scored_items AS (
                SELECT 
                    a.id AS agenda_id,
                    a.meeting_id,
                    a.content,
                    a.resolution,
                    m.title,
                    m.meeting_title,
                    m.type,
                    m.meeting_date,
                    -- Dense cosine similarity from BGE-M3 (0.0 to 1.0)
                    COALESCE(bv.dense_score, 0.0) AS dense_score,
                    -- Lexical similarity via pg_trgm (0.0 to 1.0)
                    CASE 
                        WHEN $8::text = 'agenda' THEN similarity(COALESCE(a.content_plain, a.content, ''), $2)
                        ELSE GREATEST(
                            similarity(COALESCE(a.content_plain, a.content, ''), $2),
                            similarity(COALESCE(a.resolution_plain, a.resolution, ''), $2)
                        )
                    END AS lexical_score,
                    -- Soft Entity Alignment: capped at +0.10 max, never hard-filters
                    CASE 
                        WHEN $3::uuid IS NOT NULL AND EXISTS (
                            SELECT 1 FROM agenda_entities ae WHERE ae.agenda_id = a.id AND ae.entity_id = $3::uuid
                        ) THEN 0.10
                        ELSE 0.00
                    END AS entity_boost,
                    -- Match location flag
                    CASE 
                        WHEN $8::text != 'agenda' AND (COALESCE(a.resolution_plain, a.resolution, '') ILIKE '%' || $2 || '%' OR bv.vec_matched_in = 'resolution') THEN 'resolution'
                        ELSE 'agenda'
                    END AS matched_in
                FROM agenda a
                JOIN meetings m ON a.meeting_id = m.id
                LEFT JOIN best_vector bv ON bv.agenda_id = a.id
                WHERE 
                    m.status != 'draft'
                    AND ($4::text = 'all' OR m.type::text = $4::text)
                    AND ($5::date IS NULL OR m.meeting_date >= $5::date)
                    AND ($6::date IS NULL OR m.meeting_date <= $6::date)
                    AND ($7::uuid[] IS NULL OR EXISTS (SELECT 1 FROM agenda_tags at2 WHERE at2.agenda_id = a.id AND at2.tag_id = ANY($7::uuid[])))
                    AND ($9::numeric IS NULL OR (CASE WHEN translate(trim(m.title), '০১২৩৪৫৬৭৮৯', '0123456789') ~ '^\\s*[0-9]+\\s*$' THEN translate(trim(m.title), '০১২৩৪৫৬৭৮৯', '0123456789')::numeric ELSE NULL END) >= $9::numeric)
                    AND ($10::numeric IS NULL OR (CASE WHEN translate(trim(m.title), '০১২৩৪৫৬৭৮৯', '0123456789') ~ '^\\s*[0-9]+\\s*$' THEN translate(trim(m.title), '০১২৩৪৫৬৭৮৯', '0123456789')::numeric ELSE NULL END) <= $10::numeric)
                    AND (
                        ($1::vector IS NOT NULL AND bv.dense_score >= 0.38)
                        OR COALESCE(a.content_plain, a.content, '') % $2
                        OR ($8::text != 'agenda' AND COALESCE(a.resolution_plain, a.resolution, '') % $2)
                        OR a.content_tsv @@ plainto_tsquery('simple', $2)
                        OR ($8::text != 'agenda' AND a.resolution_tsv @@ plainto_tsquery('simple', $2))
                        OR ($3::uuid IS NOT NULL AND EXISTS (SELECT 1 FROM agenda_entities ae WHERE ae.agenda_id = a.id AND ae.entity_id = $3::uuid))
                    )
            )
            SELECT 
                agenda_id,
                meeting_id,
                content,
                resolution,
                title,
                meeting_title,
                type,
                meeting_date,
                matched_in,
                dense_score,
                lexical_score,
                entity_boost,
                -- Combined Ranking Score
                ((dense_score * 0.70) + (lexical_score * 0.20) + entity_boost) AS final_rank,
                -- Truthful Match Badging matching frontend expectation
                CASE 
                    WHEN dense_score > 0.65 AND lexical_score > 0.25 AND entity_boost > 0 THEN 'hybrid (all)'
                    WHEN dense_score > 0.65 AND lexical_score > 0.25 THEN 'hybrid (keyword + semantic)'
                    WHEN dense_score > 0.65 AND entity_boost > 0 THEN 'hybrid (semantic + entity)'
                    WHEN lexical_score > 0.25 AND entity_boost > 0 THEN 'hybrid (keyword + entity)'
                    WHEN dense_score > 0.60 THEN 'semantic'
                    WHEN lexical_score > 0.25 THEN 'keyword'
                    WHEN entity_boost > 0 THEN 'entity'
                    ELSE 'semantic'
                END AS match_type,
                -- Snippet generation with highlighted keyword matches
                ts_headline(
                    'simple',
                    COALESCE(NULLIF(regexp_replace(CASE WHEN matched_in = 'resolution' THEN coalesce(resolution, '') ELSE coalesce(content, '') END, '<[^>]+>', ' ', 'g'), ''), ' '),
                    plainto_tsquery('simple', $2),
                    'StartSel=<mark>, StopSel=</mark>, MaxWords=35, MinWords=15'
                ) AS snippet
            FROM scored_items
            ORDER BY final_rank DESC
            LIMIT $11;
        `;

        const params = [
            queryEmbedding ? JSON.stringify(queryEmbedding) : null, // $1
            normalizedString || trimmedQuery,                        // $2
            matchedEntityId,                                         // $3
            meetingType,                                             // $4
            filters.dateFrom,                                        // $5
            filters.dateTo,                                          // $6
            tagIds.length ? tagIds : null,                           // $7
            scope,                                                   // $8
            filters.serialFrom,                                      // $9
            filters.serialTo,                                        // $10
            filters.limit                                            // $11
        ];

        const result = await db.query(searchQuery, params);

        await cacheSearchResults(cacheKey, trimmedQuery, filters, result.rows);

        res.status(200).json({
            success: true,
            data: result.rows
        });
    } catch (err) {
        console.error('Search query error:', err);
        next(err);
    }
};

module.exports = { search };


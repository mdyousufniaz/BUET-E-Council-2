const crypto = require('crypto');
const CustomError = require('../errors/CustomError');
const db = require('../db');
const { embedTexts } = require('../utils/embeddingClient');
const { normalizeBanglaText } = require('../utils/searchIndexer');

const RESULT_LIMIT = 30;
const SNIPPET_OPTS = 'StartSel=<mark>, StopSel=</mark>, MaxWords=40, MinWords=15, MaxFragments=1';

const parseFilters = (req) => {
    const q = normalizeBanglaText(req.query.q || '');
    const scope = req.query.scope === 'agenda' ? 'agenda' : 'both';
    const tags = req.query.tags
        ? req.query.tags.split(',').map(t => t.trim()).filter(Boolean)
        : null;
    const dateFrom = req.query.dateFrom || null;
    const dateTo = req.query.dateTo || null;
    const serialFromVal = req.query.serialFrom ? parseInt(req.query.serialFrom, 10) : null;
    const serialToVal = req.query.serialTo ? parseInt(req.query.serialTo, 10) : null;
    const serialFrom = Number.isNaN(serialFromVal) ? null : serialFromVal;
    const serialTo = Number.isNaN(serialToVal) ? null : serialToVal;
    return { q, scope, tags, dateFrom, dateTo, serialFrom, serialTo };
};

// -------------------------------------------------------------
// TIER 0: KEYWORD MATCHING (Highest Priority)
// -------------------------------------------------------------
const runKeywordSearchRaw = async (queryText, filters, excludedKeys = []) => {
    const excludedAgendaIds = excludedKeys.map(k => k.split(':')[0]);

    const filterSql = `
        AND m.status = 'past'
        AND ($2::uuid[] IS NULL OR EXISTS (SELECT 1 FROM agenda_tags at2 WHERE at2.agenda_id = a.id AND at2.tag_id = ANY($2::uuid[])))
        AND ($3::date IS NULL OR m.meeting_date >= $3::date)
        AND ($4::date IS NULL OR m.meeting_date <= $4::date)
        AND ($5::numeric IS NULL OR (CASE WHEN m.title ~ '^\\s*[0-9]+\\s*$' THEN trim(m.title)::numeric ELSE NULL END) >= $5::numeric)
        AND ($6::numeric IS NULL OR (CASE WHEN m.title ~ '^\\s*[0-9]+\\s*$' THEN trim(m.title)::numeric ELSE NULL END) <= $6::numeric)
        AND ($7::uuid[] IS NULL OR a.id <> ALL($7::uuid[]))
    `;

    const agendaParams = [queryText, filters.tags, filters.dateFrom, filters.dateTo, filters.serialFrom, filters.serialTo, excludedAgendaIds.length ? excludedAgendaIds : null];
    const agendaQuery = `
        SELECT a.id as agenda_id, a.meeting_id, m.title, m.meeting_title, m.type, m.meeting_date, m.status,
               'agenda' as matched_in,
               ts_rank(a.content_tsv, websearch_to_tsquery('simple', $1)) as rank,
               ts_headline('simple', coalesce(a.content_plain, ''), websearch_to_tsquery('simple', $1), '${SNIPPET_OPTS}') as snippet
        FROM agenda a
        JOIN meetings m ON m.id = a.meeting_id
        WHERE (a.content_tsv @@ websearch_to_tsquery('simple', $1) OR a.content_plain ILIKE '%' || $1 || '%')
        ${filterSql}
        ORDER BY rank DESC
        LIMIT ${RESULT_LIMIT}
    `;

    const queries = [db.query(agendaQuery, agendaParams)];

    if (filters.scope === 'both') {
        const resolutionQuery = `
            SELECT a.id as agenda_id, a.meeting_id, m.title, m.meeting_title, m.type, m.meeting_date, m.status,
                   'resolution' as matched_in,
                   ts_rank(a.resolution_tsv, websearch_to_tsquery('simple', $1)) as rank,
                   ts_headline('simple', coalesce(a.resolution_plain, ''), websearch_to_tsquery('simple', $1), '${SNIPPET_OPTS}') as snippet
            FROM agenda a
            JOIN meetings m ON m.id = a.meeting_id
            WHERE (a.resolution_tsv @@ websearch_to_tsquery('simple', $1) OR a.resolution_plain ILIKE '%' || $1 || '%')
            ${filterSql}
            ORDER BY rank DESC
            LIMIT ${RESULT_LIMIT}
        `;
        queries.push(db.query(resolutionQuery, agendaParams));
    }

    const results = await Promise.all(queries);
    return results.flatMap(r => r.rows).sort((a, b) => b.rank - a.rank);
};

// -------------------------------------------------------------
// TIER 1: ENTITY MATCHING (Medium Priority)
// -------------------------------------------------------------
const findMatchingEntityTerms = async (queryText) => {
    if (!queryText || !queryText.trim()) return [];
    const tokens = queryText.split(/\s+/).filter(w => w.length > 1);
    if (tokens.length === 0) return [];

    const ngrams = [...tokens];
    for (let i = 0; i < tokens.length - 1; i++) {
        ngrams.push(`${tokens[i]} ${tokens[i + 1]}`);
    }

    const patternArray = ngrams.map(t => `%${t}%`);

    const [departments, offices, members, faculties, presentees, aeRes] = await Promise.all([
        db.query(
            `SELECT DISTINCT name_bangla, name_english, alias_bangla, alias_english
             FROM departments
             WHERE name_bangla ILIKE ANY($1) OR name_english ILIKE ANY($1)
                OR alias_bangla ILIKE ANY($1) OR alias_english ILIKE ANY($1)`,
            [patternArray]
        ).catch(() => ({ rows: [] })),
        db.query(
            `SELECT DISTINCT name_bangla, name_english
             FROM offices
             WHERE name_bangla ILIKE ANY($1) OR name_english ILIKE ANY($1)`,
            [patternArray]
        ).catch(() => ({ rows: [] })),
        db.query(
            `SELECT DISTINCT name FROM members WHERE name ILIKE ANY($1)`,
            [patternArray]
        ).catch(() => ({ rows: [] })),
        db.query(
            `SELECT DISTINCT name_bangla, name_english FROM faculties
             WHERE name_bangla ILIKE ANY($1) OR name_english ILIKE ANY($1)`,
            [patternArray]
        ).catch(() => ({ rows: [] })),
        db.query(
            `SELECT DISTINCT name FROM presentees WHERE name ILIKE ANY($1)`,
            [patternArray]
        ).catch(() => ({ rows: [] })),
        db.query(
            `SELECT DISTINCT entity_name_bangla, entity_name_english FROM agenda_entities
             WHERE entity_name_bangla ILIKE ANY($1) OR entity_name_english ILIKE ANY($1)`,
            [patternArray]
        ).catch(() => ({ rows: [] }))
    ]);

    const terms = new Set();
    for (const r of departments.rows) {
        [r.name_bangla, r.name_english, r.alias_bangla, r.alias_english].filter(Boolean).forEach(t => terms.add(t));
    }
    for (const r of offices.rows) {
        [r.name_bangla, r.name_english].filter(Boolean).forEach(t => terms.add(t));
    }
    for (const r of members.rows) {
        if (r.name) terms.add(r.name);
    }
    for (const r of faculties.rows) {
        [r.name_bangla, r.name_english].filter(Boolean).forEach(t => terms.add(t));
    }
    for (const r of presentees.rows) {
        if (r.name) terms.add(r.name);
    }
    for (const r of aeRes.rows) {
        [r.entity_name_bangla, r.entity_name_english].filter(Boolean).forEach(t => terms.add(t));
    }

    return Array.from(terms);
};

const runEntitySearchFast = async (queryText, filters, excludedKeys = []) => {
    const excludedAgendaIds = excludedKeys.map(k => k.split(':')[0]);
    const entityTerms = await findMatchingEntityTerms(queryText);

    const tokens = queryText.split(/\s+/).filter(w => w.length > 2);
    const searchTerms = [...new Set([...entityTerms, ...tokens])];
    if (searchTerms.length === 0) return [];

    const patternArray = searchTerms.map(t => `%${t}%`);

    const filterSql = `
        AND m.status = 'past'
        AND ($2::uuid[] IS NULL OR EXISTS (SELECT 1 FROM agenda_tags at2 WHERE at2.agenda_id = a.id AND at2.tag_id = ANY($2::uuid[])))
        AND ($3::date IS NULL OR m.meeting_date >= $3::date)
        AND ($4::date IS NULL OR m.meeting_date <= $4::date)
        AND ($5::numeric IS NULL OR (CASE WHEN m.title ~ '^\\s*[0-9]+\\s*$' THEN trim(m.title)::numeric ELSE NULL END) >= $5::numeric)
        AND ($6::numeric IS NULL OR (CASE WHEN m.title ~ '^\\s*[0-9]+\\s*$' THEN trim(m.title)::numeric ELSE NULL END) <= $6::numeric)
        AND ($7::uuid[] IS NULL OR a.id <> ALL($7::uuid[]))
    `;

    const agendaParams = [patternArray, filters.tags, filters.dateFrom, filters.dateTo, filters.serialFrom, filters.serialTo, excludedAgendaIds.length ? excludedAgendaIds : null];
    const agendaQuery = `
        SELECT DISTINCT ON (a.id)
               a.id as agenda_id, a.meeting_id, m.title, m.meeting_title, m.type, m.meeting_date, m.status,
               'agenda' as matched_in,
               coalesce(substring(a.content_plain from 1 for 200), '') as snippet
        FROM agenda a
        JOIN meetings m ON m.id = a.meeting_id
        LEFT JOIN agenda_entities ae ON ae.agenda_id = a.id
        WHERE (a.content_plain ILIKE ANY($1)
               OR ae.entity_name_bangla ILIKE ANY($1)
               OR ae.entity_name_english ILIKE ANY($1))
        ${filterSql}
        LIMIT ${RESULT_LIMIT}
    `;

    const result = await db.query(agendaQuery, agendaParams);
    return result.rows;
};

// -------------------------------------------------------------
// TIER 2: SEMANTIC MATCHING (HNSW Vector Index)
// -------------------------------------------------------------
const runSemanticSearchHNSW = async (queryVector, filters, excludedKeys = []) => {
    if (!queryVector || !Array.isArray(queryVector) || queryVector.length === 0) return [];
    const vectorLiteral = JSON.stringify(queryVector);
    const excludedAgendaIds = excludedKeys.map(k => k.split(':')[0]);

    const buildQuery = (chunkTable, matchedIn) => `
        SELECT c.agenda_id, a.meeting_id, m.title, m.meeting_title, m.type, m.meeting_date, m.status,
               '${matchedIn}' as matched_in,
               c.chunk_text as snippet,
               (c.embedding <=> $1::vector) as distance
        FROM ${chunkTable} c
        JOIN agenda a ON a.id = c.agenda_id
        JOIN meetings m ON m.id = a.meeting_id
        WHERE m.status = 'past'
          AND c.embedding IS NOT NULL
          AND ($2::uuid[] IS NULL OR a.id <> ALL($2::uuid[]))
          AND ($3::uuid[] IS NULL OR EXISTS (SELECT 1 FROM agenda_tags at2 WHERE at2.agenda_id = a.id AND at2.tag_id = ANY($3::uuid[])))
          AND ($4::date IS NULL OR m.meeting_date >= $4::date)
          AND ($5::date IS NULL OR m.meeting_date <= $5::date)
          AND ($6::numeric IS NULL OR (CASE WHEN m.title ~ '^\\s*[0-9]+\\s*$' THEN trim(m.title)::numeric ELSE NULL END) >= $6::numeric)
          AND ($7::numeric IS NULL OR (CASE WHEN m.title ~ '^\\s*[0-9]+\\s*$' THEN trim(m.title)::numeric ELSE NULL END) <= $7::numeric)
        ORDER BY c.embedding <=> $1::vector ASC
        LIMIT ${RESULT_LIMIT}
    `;

    const agendaParams = [vectorLiteral, excludedAgendaIds.length ? excludedAgendaIds : null, filters.tags, filters.dateFrom, filters.dateTo, filters.serialFrom, filters.serialTo];
    const queries = [db.query(buildQuery('agenda_chunks', 'agenda'), agendaParams)];

    if (filters.scope === 'both') {
        queries.push(
            db.query(buildQuery('resolution_chunks', 'resolution'), agendaParams)
        );
    }

    const results = await Promise.all(queries);
    return results.flatMap(r => r.rows).sort((a, b) => a.distance - b.distance);
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
        const filters = parseFilters(req);

        // Filter-only search (tags, serial, date range)
        if (!filters.q) {
            if ((filters.tags && filters.tags.length > 0) || filters.serialFrom || filters.serialTo) {
                db.query("DELETE FROM search_cache WHERE created_at < NOW() - INTERVAL '24 hours'").catch(() => {});

                const cacheKey = crypto.createHash('sha256').update(JSON.stringify(filters)).digest('hex');
                const cached = await db.query('SELECT results FROM search_cache WHERE cache_key = $1', [cacheKey]);
                if (cached.rows.length > 0) {
                    return res.status(200).json({ success: true, data: cached.rows[0].results, cached: true });
                }

                const filterSql = `
                    AND m.status = 'past'
                    AND ($1::uuid[] IS NULL OR EXISTS (SELECT 1 FROM agenda_tags at2 WHERE at2.agenda_id = a.id AND at2.tag_id = ANY($1::uuid[])))
                    AND ($2::date IS NULL OR m.meeting_date >= $2::date)
                    AND ($3::date IS NULL OR m.meeting_date <= $3::date)
                    AND ($4::numeric IS NULL OR (CASE WHEN m.title ~ '^\\s*[0-9]+\\s*$' THEN trim(m.title)::numeric ELSE NULL END) >= $4::numeric)
                    AND ($5::numeric IS NULL OR (CASE WHEN m.title ~ '^\\s*[0-9]+\\s*$' THEN trim(m.title)::numeric ELSE NULL END) <= $5::numeric)
                `;

                const agendaParams = [filters.tags, filters.dateFrom, filters.dateTo, filters.serialFrom, filters.serialTo];
                const agendaQuery = `
                    SELECT a.id as agenda_id, a.meeting_id, m.title, m.meeting_title, m.type, m.meeting_date, m.status,
                           'agenda' as matched_in,
                           'tag' as match_type,
                           0 as tier,
                           coalesce(substring(a.content_plain from 1 for 200), '') as snippet
                    FROM agenda a
                    JOIN meetings m ON m.id = a.meeting_id
                    WHERE 1=1
                    ${filterSql}
                    ORDER BY m.meeting_date DESC
                    LIMIT ${RESULT_LIMIT}
                `;
                
                const queries = [db.query(agendaQuery, agendaParams)];
                
                if (filters.scope === 'both') {
                    const resolutionQuery = `
                        SELECT a.id as agenda_id, a.meeting_id, m.title, m.meeting_title, m.type, m.meeting_date, m.status,
                               'resolution' as matched_in,
                               'tag' as match_type,
                               0 as tier,
                               coalesce(substring(a.resolution_plain from 1 for 200), '') as snippet
                        FROM agenda a
                        JOIN meetings m ON m.id = a.meeting_id
                        WHERE 1=1
                        ${filterSql}
                        ORDER BY m.meeting_date DESC
                        LIMIT ${RESULT_LIMIT}
                    `;
                    queries.push(db.query(resolutionQuery, agendaParams));
                }

                const queryResults = await Promise.all(queries);
                const results = queryResults.flatMap(r => r.rows);
                results.sort((a, b) => new Date(b.meeting_date).getTime() - new Date(a.meeting_date).getTime());

                await cacheSearchResults(cacheKey, '', filters, results);
                return res.status(200).json({ success: true, data: results, cached: false });
            } else {
                return next(new CustomError('Search query (q) is required', 400));
            }
        }

        // Cleanup search cache periodically
        db.query("DELETE FROM search_cache WHERE created_at < NOW() - INTERVAL '24 hours'").catch(() => {});

        const cacheKey = crypto.createHash('sha256').update(JSON.stringify(filters)).digest('hex');
        const cached = await db.query('SELECT results FROM search_cache WHERE cache_key = $1', [cacheKey]);
        if (cached.rows.length > 0) {
            return res.status(200).json({ success: true, data: cached.rows[0].results, cached: true });
        }

        const seenKeys = new Set();
        const finalResults = [];

        // -------------------------------------------------------------
        // TIER 0: KEYWORD MATCHING (Highest Priority)
        // -------------------------------------------------------------
        try {
            const keywordRows = await runKeywordSearchRaw(filters.q, filters);
            for (const row of keywordRows) {
                const key = `${row.agenda_id}:${row.matched_in}`;
                if (!seenKeys.has(key)) {
                    seenKeys.add(key);
                    finalResults.push({
                        ...row,
                        match_type: 'keyword',
                        tier: 0
                    });
                }
                if (finalResults.length >= RESULT_LIMIT) break;
            }
        } catch (err) {
            console.error('[searchController] Keyword search error:', err.message);
        }

        // EARLY EXIT: If Keyword search satisfies RESULT_LIMIT, skip Entity & Semantic calls
        if (finalResults.length >= RESULT_LIMIT) {
            await cacheSearchResults(cacheKey, filters.q, filters, finalResults);
            return res.status(200).json({ success: true, data: finalResults, cached: false });
        }

        // -------------------------------------------------------------
        // TIER 1: ENTITY MATCHING (Medium Priority)
        // -------------------------------------------------------------
        try {
            const entityRows = await runEntitySearchFast(filters.q, filters, Array.from(seenKeys));
            for (const row of entityRows) {
                const key = `${row.agenda_id}:${row.matched_in}`;
                if (!seenKeys.has(key)) {
                    seenKeys.add(key);
                    finalResults.push({
                        agenda_id: row.agenda_id,
                        meeting_id: row.meeting_id,
                        title: row.title,
                        meeting_title: row.meeting_title,
                        type: row.type,
                        meeting_date: row.meeting_date,
                        status: row.status,
                        matched_in: row.matched_in,
                        snippet: row.snippet,
                        match_type: 'entity',
                        tier: 1
                    });
                }
                if (finalResults.length >= RESULT_LIMIT) break;
            }
        } catch (err) {
            console.error('[searchController] Entity search fallback error:', err.message);
        }

        // EARLY EXIT: If Keyword + Entity satisfy RESULT_LIMIT, skip Semantic call
        if (finalResults.length >= RESULT_LIMIT) {
            await cacheSearchResults(cacheKey, filters.q, filters, finalResults);
            return res.status(200).json({ success: true, data: finalResults, cached: false });
        }

        // -------------------------------------------------------------
        // TIER 2: SEMANTIC MATCHING (Lowest Priority - Heavy Compute)
        // -------------------------------------------------------------
        try {
            const vectors = await embedTexts([filters.q]);
            if (vectors && vectors.length > 0) {
                const semanticRows = await runSemanticSearchHNSW(vectors[0], filters, Array.from(seenKeys));
                for (const row of semanticRows) {
                    const key = `${row.agenda_id}:${row.matched_in}`;
                    if (!seenKeys.has(key)) {
                        seenKeys.add(key);
                        finalResults.push({
                            agenda_id: row.agenda_id,
                            meeting_id: row.meeting_id,
                            title: row.title,
                            meeting_title: row.meeting_title,
                            type: row.type,
                            meeting_date: row.meeting_date,
                            status: row.status,
                            matched_in: row.matched_in,
                            snippet: row.snippet,
                            match_type: 'semantic',
                            tier: 2
                        });
                    }
                    if (finalResults.length >= RESULT_LIMIT) break;
                }
            }
        } catch (err) {
            console.error('[searchController] Semantic search service fallback:', err.message);
        }

        await cacheSearchResults(cacheKey, filters.q, filters, finalResults);
        return res.status(200).json({ success: true, data: finalResults, cached: false });

    } catch (error) {
        next(error);
    }
};

module.exports = { search };

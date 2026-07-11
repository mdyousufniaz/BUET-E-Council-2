const crypto = require('crypto');
const CustomError = require('../errors/CustomError');
const db = require('../db');
const { embedTexts } = require('../utils/embeddingClient');

const RESULT_LIMIT = 30;
const SNIPPET_OPTS = 'StartSel=<mark>, StopSel=</mark>, MaxWords=40, MinWords=15, MaxFragments=1';

const parseFilters = (req) => {
    const q = (req.query.q || '').trim();
    const scope = req.query.scope === 'agenda' ? 'agenda' : 'both';
    const tags = req.query.tags
        ? req.query.tags.split(',').map(t => t.trim()).filter(Boolean)
        : null;
    const dateFrom = req.query.dateFrom || null;
    const dateTo = req.query.dateTo || null;
    return { q, scope, tags, dateFrom, dateTo };
};

const resultRow = (row, matchType) => ({
    agenda_id: row.agenda_id,
    meeting_id: row.meeting_id,
    title: row.title,
    meeting_title: row.meeting_title,
    type: row.type,
    meeting_date: row.meeting_date,
    status: row.status,
    matched_in: row.matched_in,
    match_type: matchType,
    snippet: row.snippet
});

// `seen` tracks (agenda_id, matched_in) pairs already surfaced by an earlier
// (higher-priority) bucket, so e.g. an agenda's resolution can still surface
// via semantic search even though its agenda content already matched by
// keyword - they're different links/snippets on the results page.
const idsFor = (seen, matchedIn) => [...seen]
    .filter(k => k.endsWith(`:${matchedIn}`))
    .map(k => k.slice(0, k.lastIndexOf(':')));

const seenKey = (row) => `${row.agenda_id}:${row.matched_in}`;

// Keyword bucket: Postgres full-text search over the plain-text mirrors,
// with an ILIKE fallback for short/partial tokens that tsquery misses.
const runKeywordSearch = async (tsqueryText, { scope, tags, dateFrom, dateTo }, seen) => {
    const filterSql = `
        AND ($2::uuid[] IS NULL OR EXISTS (SELECT 1 FROM agenda_tags at2 WHERE at2.agenda_id = a.id AND at2.tag_id = ANY($2::uuid[])))
        AND ($3::date IS NULL OR m.meeting_date >= $3::date)
        AND ($4::date IS NULL OR m.meeting_date <= $4::date)
        AND a.id <> ALL($5::uuid[])
    `;

    const agendaParams = [tsqueryText, tags, dateFrom, dateTo, idsFor(seen, 'agenda')];
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

    if (scope === 'both') {
        const resolutionParams = [tsqueryText, tags, dateFrom, dateTo, idsFor(seen, 'resolution')];
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
        queries.push(db.query(resolutionQuery, resolutionParams));
    }

    const results = await Promise.all(queries);
    return results.flatMap(r => r.rows).sort((a, b) => b.rank - a.rank);
};

// Entity bucket: fuzzy-match the query against department/office/member
// names & aliases, then re-run the keyword search using their canonical
// terms. Entities are looked up live against their own tables, so matching
// is always current with no separate sync step.
const findMatchingEntityTerms = async (q) => {
    const [departments, offices, members, faculties, presentees] = await Promise.all([
        db.query(
            `SELECT name_bangla, name_english, alias_bangla, alias_english FROM departments
             WHERE similarity(name_bangla || ' ' || coalesce(name_english,'') || ' ' || coalesce(alias_bangla,'') || ' ' || coalesce(alias_english,''), $1) > 0.2
                OR name_bangla ILIKE '%' || $1 || '%' OR name_english ILIKE '%' || $1 || '%'
                OR alias_bangla ILIKE '%' || $1 || '%' OR alias_english ILIKE '%' || $1 || '%'
             LIMIT 5`,
            [q]
        ),
        db.query(
            `SELECT name_bangla, name_english FROM offices
             WHERE similarity(name_bangla || ' ' || coalesce(name_english,''), $1) > 0.2
                OR name_bangla ILIKE '%' || $1 || '%' OR name_english ILIKE '%' || $1 || '%'
             LIMIT 5`,
            [q]
        ),
        db.query(
            `SELECT name FROM members
             WHERE similarity(name, $1) > 0.2 OR name ILIKE '%' || $1 || '%'
             LIMIT 5`,
            [q]
        ),
        db.query(
            `SELECT name_bangla, name_english FROM faculties
             WHERE similarity(name_bangla || ' ' || coalesce(name_english,''), $1) > 0.2
                OR name_bangla ILIKE '%' || $1 || '%' OR name_english ILIKE '%' || $1 || '%'
             LIMIT 5`,
            [q]
        ),
        db.query(
            `SELECT name FROM presentees
             WHERE similarity(name, $1) > 0.2 OR name ILIKE '%' || $1 || '%'
             LIMIT 5`,
            [q]
        )
    ]);

    const terms = new Set();
    for (const row of departments.rows) {
        [row.name_bangla, row.name_english, row.alias_bangla, row.alias_english].filter(Boolean).forEach(t => terms.add(t));
    }
    for (const row of offices.rows) {
        [row.name_bangla, row.name_english].filter(Boolean).forEach(t => terms.add(t));
    }
    for (const row of members.rows) {
        if (row.name) terms.add(row.name);
    }
    for (const row of faculties.rows) {
        [row.name_bangla, row.name_english].filter(Boolean).forEach(t => terms.add(t));
    }
    for (const row of presentees.rows) {
        if (row.name) terms.add(row.name);
    }
    return [...terms];
};

// Helpers for escaping regex and parsing the hybrid query
const escapeRegExp = (string) => {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

const analyzeQuery = async (q) => {
    const entityTerms = await findMatchingEntityTerms(q);
    let remainingQuery = q;
    if (entityTerms.length > 0) {
        const sortedEntities = [...entityTerms].sort((a, b) => b.length - a.length);
        for (const entity of sortedEntities) {
            const regex = new RegExp(escapeRegExp(entity), 'gi');
            remainingQuery = remainingQuery.replace(regex, '');
        }
        remainingQuery = remainingQuery.replace(/\s+/g, ' ').trim();
    }
    return {
        originalQuery: q,
        entityTerms,
        remainingQuery: remainingQuery || q
    };
};

const runKeywordSearchRaw = async (queryText, filters) => {
    const filterSql = `
        AND ($2::uuid[] IS NULL OR EXISTS (SELECT 1 FROM agenda_tags at2 WHERE at2.agenda_id = a.id AND at2.tag_id = ANY($2::uuid[])))
        AND ($3::date IS NULL OR m.meeting_date >= $3::date)
        AND ($4::date IS NULL OR m.meeting_date <= $4::date)
    `;

    const agendaParams = [queryText, filters.tags, filters.dateFrom, filters.dateTo];
    const agendaQuery = `
        SELECT a.id as agenda_id, a.meeting_id, m.title, m.meeting_title, m.type, m.meeting_date, m.status,
               'agenda' as matched_in,
               ts_rank(a.content_tsv, websearch_to_tsquery('simple', $1)) as rank,
               ts_headline('simple', coalesce(a.content_plain, ''), websearch_to_tsquery('simple', $1), '${SNIPPET_OPTS}') as snippet
        FROM agenda a
        JOIN meetings m ON m.id = a.meeting_id
        WHERE (a.content_tsv @@ websearch_to_tsquery('simple', $1) OR a.content_plain ILIKE '%' || $1 || '%')
        ${filterSql}
        LIMIT 100
    `;

    const queries = [db.query(agendaQuery, agendaParams)];

    if (filters.scope === 'both') {
        const resolutionParams = [queryText, filters.tags, filters.dateFrom, filters.dateTo];
        const resolutionQuery = `
            SELECT a.id as agenda_id, a.meeting_id, m.title, m.meeting_title, m.type, m.meeting_date, m.status,
                   'resolution' as matched_in,
                   ts_rank(a.resolution_tsv, websearch_to_tsquery('simple', $1)) as rank,
                   ts_headline('simple', coalesce(a.resolution_plain, ''), websearch_to_tsquery('simple', $1), '${SNIPPET_OPTS}') as snippet
            FROM agenda a
            JOIN meetings m ON m.id = a.meeting_id
            WHERE (a.resolution_tsv @@ websearch_to_tsquery('simple', $1) OR a.resolution_plain ILIKE '%' || $1 || '%')
            ${filterSql}
            LIMIT 100
        `;
        queries.push(db.query(resolutionQuery, resolutionParams));
    }

    const results = await Promise.all(queries);
    return results.flatMap(r => r.rows);
};

const runSemanticSearchRaw = async (queryVector, filters) => {
    const vectorLiteral = JSON.stringify(queryVector);
    const filterSql = `
        AND ($2::uuid[] IS NULL OR EXISTS (SELECT 1 FROM agenda_tags at2 WHERE at2.agenda_id = a.id AND at2.tag_id = ANY($2::uuid[])))
        AND ($3::date IS NULL OR m.meeting_date >= $3::date)
        AND ($4::date IS NULL OR m.meeting_date <= $4::date)
    `;

    const buildQuery = (chunkTable, matchedIn) => `
        SELECT * FROM (
            SELECT DISTINCT ON (c.agenda_id)
                c.agenda_id, a.meeting_id, m.title, m.meeting_title, m.type, m.meeting_date, m.status,
                '${matchedIn}' as matched_in,
                c.chunk_text as snippet,
                (c.embedding <=> $1::vector) as distance
            FROM ${chunkTable} c
            JOIN agenda a ON a.id = c.agenda_id
            JOIN meetings m ON m.id = a.meeting_id
            WHERE c.embedding IS NOT NULL
            ${filterSql}
            ORDER BY c.agenda_id, distance ASC
        ) sub
        LIMIT 100
    `;

    const queries = [
        db.query(buildQuery('agenda_chunks', 'agenda'), [vectorLiteral, filters.tags, filters.dateFrom, filters.dateTo])
    ];
    if (filters.scope === 'both') {
        queries.push(
            db.query(buildQuery('resolution_chunks', 'resolution'), [vectorLiteral, filters.tags, filters.dateFrom, filters.dateTo])
        );
    }

    const results = await Promise.all(queries);
    return results.flatMap(r => r.rows);
};

const search = async (req, res, next) => {
    try {
        const filters = parseFilters(req);
        if (!filters.q) {
            if (filters.tags && filters.tags.length > 0) {
                // Cleanup search cache periodically
                db.query("DELETE FROM search_cache WHERE created_at < NOW() - INTERVAL '24 hours'").catch(() => {});

                const cacheKey = crypto.createHash('sha256').update(JSON.stringify(filters)).digest('hex');
                const cached = await db.query('SELECT results FROM search_cache WHERE cache_key = $1', [cacheKey]);
                if (cached.rows.length > 0) {
                    return res.status(200).json({ success: true, data: cached.rows[0].results, cached: true });
                }

                const filterSql = `
                    AND ($1::uuid[] IS NULL OR EXISTS (SELECT 1 FROM agenda_tags at2 WHERE at2.agenda_id = a.id AND at2.tag_id = ANY($1::uuid[])))
                    AND ($2::date IS NULL OR m.meeting_date >= $2::date)
                    AND ($3::date IS NULL OR m.meeting_date <= $3::date)
                `;

                const agendaParams = [filters.tags, filters.dateFrom, filters.dateTo];
                const agendaQuery = `
                    SELECT a.id as agenda_id, a.meeting_id, m.title, m.meeting_title, m.type, m.meeting_date, m.status,
                           'agenda' as matched_in,
                           'tag' as match_type,
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
                const results = queryResults.flatMap(r => r.rows).map(row => ({
                    ...row,
                    score: 1.0
                }));

                // Sort results by date desc
                results.sort((a, b) => new Date(b.meeting_date).getTime() - new Date(a.meeting_date).getTime());

                await db.query(
                    `INSERT INTO search_cache (cache_key, query, filters, results)
                     VALUES ($1, $2, $3, $4)
                     ON CONFLICT (cache_key) DO UPDATE SET results = EXCLUDED.results, created_at = CURRENT_TIMESTAMP`,
                    [cacheKey, '', JSON.stringify(filters), JSON.stringify(results)]
                );

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

        const queryAnalysis = await analyzeQuery(filters.q);
        const { entityTerms, remainingQuery } = queryAnalysis;

        // Generate embeddings for q and remainingQuery
        let qVector = null;
        let remainingVector = null;
        try {
            const textsToEmbed = [filters.q];
            if (remainingQuery && remainingQuery !== filters.q) {
                textsToEmbed.push(remainingQuery);
            }
            const vectors = await embedTexts(textsToEmbed);
            if (vectors) {
                qVector = vectors[0];
                if (textsToEmbed.length > 1) {
                    remainingVector = vectors[1];
                }
            }
        } catch (err) {
            console.error('Embedding service unavailable for hybrid search:', err.message);
        }

        const tasks = [];
        
        // 1. Keyword search on full query q
        tasks.push(runKeywordSearchRaw(filters.q, filters));

        // 2. Keyword search on remainingQuery (if different)
        if (remainingQuery && remainingQuery !== filters.q) {
            tasks.push(runKeywordSearchRaw(remainingQuery, filters));
        } else {
            tasks.push(Promise.resolve([]));
        }

        // 3. Keyword search on entity query (if any)
        if (entityTerms.length > 0) {
            const entityQuery = entityTerms.map(t => `"${t.replace(/"/g, '')}"`).join(' OR ');
            tasks.push(runKeywordSearchRaw(entityQuery, filters));
        } else {
            tasks.push(Promise.resolve([]));
        }

        // 4. Semantic search on full query q
        if (qVector) {
            tasks.push(runSemanticSearchRaw(qVector, filters));
        } else {
            tasks.push(Promise.resolve([]));
        }

        // 5. Semantic search on remainingQuery (if different)
        if (remainingVector) {
            tasks.push(runSemanticSearchRaw(remainingVector, filters));
        } else {
            tasks.push(Promise.resolve([]));
        }

        const [
            keywordFullResults,
            keywordRemainingResults,
            entityResults,
            semanticFullResults,
            semanticRemainingResults
        ] = await Promise.all(tasks);

        const candidates = new Map();
        const getOrSetCandidate = (row) => {
            const key = `${row.agenda_id}:${row.matched_in}`;
            if (!candidates.has(key)) {
                candidates.set(key, {
                    ...row,
                    isKeywordMatch: false,
                    keywordRank: 0.0,
                    isSemanticMatch: false,
                    semanticDistance: 1.0,
                    isEntityMatch: false,
                    matchTypes: []
                });
            }
            return candidates.get(key);
        };

        // Populate keyword matches
        const processKeywordRow = (row) => {
            const cand = getOrSetCandidate(row);
            cand.isKeywordMatch = true;
            cand.keywordRank = Math.max(cand.keywordRank, row.rank || 0.0);
            if (!cand.matchTypes.includes('keyword')) {
                cand.matchTypes.push('keyword');
            }
            if (row.snippet && !cand.snippet) {
                cand.snippet = row.snippet;
            }
        };

        keywordFullResults.forEach(processKeywordRow);
        keywordRemainingResults.forEach(processKeywordRow);

        // Populate entity matches
        entityResults.forEach((row) => {
            const cand = getOrSetCandidate(row);
            cand.isEntityMatch = true;
            if (!cand.matchTypes.includes('entity')) {
                cand.matchTypes.push('entity');
            }
            if (row.snippet && !cand.snippet) {
                cand.snippet = row.snippet;
            }
        });

        // Populate semantic matches
        const processSemanticRow = (row) => {
            const cand = getOrSetCandidate(row);
            cand.isSemanticMatch = true;
            cand.semanticDistance = Math.min(cand.semanticDistance, row.distance);
            if (!cand.matchTypes.includes('semantic')) {
                cand.matchTypes.push('semantic');
            }
            if (row.snippet && !cand.snippet) {
                cand.snippet = row.snippet;
            }
        };

        semanticFullResults.forEach(processSemanticRow);
        semanticRemainingResults.forEach(processSemanticRow);

        // Fetch plain text content for candidates to do entity containment checks
        const agendaIds = [...new Set(Array.from(candidates.values()).map(c => c.agenda_id))];
        let plainTexts = {};
        if (agendaIds.length > 0 && entityTerms.length > 0) {
            const textRes = await db.query(
                `SELECT id, content_plain, resolution_plain FROM agenda WHERE id = ANY($1)`,
                [agendaIds]
            );
            for (const row of textRes.rows) {
                plainTexts[row.id] = {
                    content_plain: row.content_plain || '',
                    resolution_plain: row.resolution_plain || ''
                };
            }
        }

        const scoredResults = [];
        for (const cand of candidates.values()) {
            let score = 0.0;

            // 1. Entity Match determination
            let isEntity = cand.isEntityMatch;
            if (!isEntity && entityTerms.length > 0) {
                const textObj = plainTexts[cand.agenda_id];
                if (textObj) {
                    const combinedText = (textObj.content_plain + ' ' + textObj.resolution_plain).toLowerCase();
                    const hasEntity = entityTerms.some(term => combinedText.includes(term.toLowerCase()));
                    if (hasEntity) {
                        isEntity = true;
                        cand.isEntityMatch = true;
                        if (!cand.matchTypes.includes('entity')) {
                            cand.matchTypes.push('entity');
                        }
                    }
                }
            }

            // 2. Score Calculation
            if (cand.isKeywordMatch) {
                score += cand.keywordRank > 0 ? (cand.keywordRank * 10) : 2.0;
            }

            if (cand.isSemanticMatch) {
                const similarity = 1.0 - cand.semanticDistance;
                score += similarity * 10;
            }

            if (isEntity) {
                score += 5.0;
            }

            // Hybrid bonuses
            if (cand.isKeywordMatch && isEntity && cand.isSemanticMatch) {
                score += 30.0;
                cand.match_type = 'hybrid (all)';
            } else if (cand.isKeywordMatch && isEntity) {
                score += 15.0;
                cand.match_type = 'hybrid (keyword + entity)';
            } else if (cand.isSemanticMatch && isEntity) {
                score += 15.0;
                cand.match_type = 'hybrid (semantic + entity)';
            } else if (cand.isKeywordMatch && cand.isSemanticMatch) {
                score += 10.0;
                cand.match_type = 'hybrid (keyword + semantic)';
            } else {
                if (cand.isKeywordMatch) cand.match_type = 'keyword';
                else if (isEntity) cand.match_type = 'entity';
                else if (cand.isSemanticMatch) cand.match_type = 'semantic';
            }

            scoredResults.push({
                agenda_id: cand.agenda_id,
                meeting_id: cand.meeting_id,
                title: cand.title,
                meeting_title: cand.meeting_title,
                type: cand.type,
                meeting_date: cand.meeting_date,
                status: cand.status,
                matched_in: cand.matched_in,
                match_type: cand.match_type,
                snippet: cand.snippet,
                score: score
            });
        }

        scoredResults.sort((a, b) => b.score - a.score);
        const finalResults = scoredResults.slice(0, RESULT_LIMIT);

        await db.query(
            `INSERT INTO search_cache (cache_key, query, filters, results)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (cache_key) DO UPDATE SET results = EXCLUDED.results, created_at = CURRENT_TIMESTAMP`,
            [cacheKey, filters.q, JSON.stringify(filters), JSON.stringify(finalResults)]
        );

        res.status(200).json({ success: true, data: finalResults, cached: false });
    } catch (error) {
        next(error);
    }
};

module.exports = { search };

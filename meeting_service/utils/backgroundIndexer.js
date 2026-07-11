const db = require('../db');
const { indexAgendaContent, indexResolutionContent } = require('./searchIndexer');

const reconcileIndex = async () => {
    try {
        const query = `
            SELECT a.id, a.content, a.resolution, a.content_plain, a.resolution_plain,
                   (SELECT COUNT(*) FROM agenda_chunks ac WHERE ac.agenda_id = a.id)::int as agenda_chunks_count,
                   (SELECT COUNT(*) FROM resolution_chunks rc WHERE rc.agenda_id = a.id)::int as resolution_chunks_count
            FROM agenda a
            WHERE 
              (a.content IS NOT NULL AND a.content != '' AND (a.content_plain IS NULL OR NOT EXISTS (SELECT 1 FROM agenda_chunks ac WHERE ac.agenda_id = a.id)))
              OR
              (a.resolution IS NOT NULL AND a.resolution != '' AND (a.resolution_plain IS NULL OR NOT EXISTS (SELECT 1 FROM resolution_chunks rc WHERE rc.agenda_id = a.id)))
            LIMIT 100
        `;
        const result = await db.query(query);
        if (result.rows.length === 0) return;
        
        console.log(`[Background Indexer] Found ${result.rows.length} agendas requiring indexing/embedding.`);
        
        for (const row of result.rows) {
            const needsAgenda = row.content && (!row.content_plain || row.agenda_chunks_count === 0);
            const needsResolution = row.resolution && (!row.resolution_plain || row.resolution_chunks_count === 0);
            
            if (needsAgenda) {
                console.log(`[Background Indexer] Indexing agenda content for ${row.id}`);
                await indexAgendaContent(row.id, row.content);
            }
            if (needsResolution) {
                console.log(`[Background Indexer] Indexing resolution content for ${row.id}`);
                await indexResolutionContent(row.id, row.resolution);
            }
        }
    } catch (err) {
        console.error('[Background Indexer] Error in reconciliation task:', err.message);
    }
};

const startBackgroundIndexer = (intervalMs = 5 * 60 * 1000) => {
    console.log(`[Background Indexer] Starting indexer worker with interval of ${intervalMs}ms`);
    // Run once after a short delay on startup to process any pending items
    setTimeout(() => {
        reconcileIndex().catch(err => {
            console.error('[Background Indexer] Startup reconciliation run failed:', err.message);
        });
    }, 10000);
    
    return setInterval(async () => {
        await reconcileIndex();
    }, intervalMs);
};

module.exports = {
    startBackgroundIndexer,
    reconcileIndex
};

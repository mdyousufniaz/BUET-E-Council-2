const db = require('../db');
const { htmlToText } = require('./htmlToText');
const { embedTexts } = require('./embeddingClient');
const { embeddingQueue } = require('../queue');

const MAX_CHUNK_WORDS = 180; // LaBSE's effective limit is ~256 wordpieces; this keeps chunks well under that.

// Splits a sentence-ending token so long paragraphs can be broken up without
// cutting mid-sentence. Handles both '.'/'?'/'!' and the Bangla '।' danda.
const splitIntoSentences = (text) => text.split(/(?<=[।.!?])\s+/).filter(Boolean);

const splitLongParagraph = (paragraph) => {
    const sentences = splitIntoSentences(paragraph);
    const chunks = [];
    let current = [];
    let wordCount = 0;

    for (const sentence of sentences) {
        const words = sentence.split(/\s+/).filter(Boolean).length;
        if (wordCount + words > MAX_CHUNK_WORDS && current.length > 0) {
            chunks.push(current.join(' '));
            current = [];
            wordCount = 0;
        }
        current.push(sentence);
        wordCount += words;
    }
    if (current.length > 0) chunks.push(current.join(' '));
    return chunks;
};

// Paragraph-aware chunker: merges short paragraphs together, splits long
// ones on sentence boundaries, so each chunk stays near MAX_CHUNK_WORDS.
const chunkText = (text) => {
    if (!text || !text.trim()) return [];

    const paragraphs = text.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
    const chunks = [];
    let current = [];
    let wordCount = 0;

    for (const paragraph of paragraphs) {
        const words = paragraph.split(/\s+/).filter(Boolean).length;

        if (words > MAX_CHUNK_WORDS) {
            if (current.length > 0) {
                chunks.push(current.join('\n\n'));
                current = [];
                wordCount = 0;
            }
            chunks.push(...splitLongParagraph(paragraph));
            continue;
        }

        if (wordCount + words > MAX_CHUNK_WORDS && current.length > 0) {
            chunks.push(current.join('\n\n'));
            current = [];
            wordCount = 0;
        }
        current.push(paragraph);
        wordCount += words;
    }
    if (current.length > 0) chunks.push(current.join('\n\n'));

    return chunks;
};

const clearSearchCache = async () => {
    await db.query('DELETE FROM search_cache');
};

// Cheap part: strip HTML and update the plain-text mirror column, which is
// all keyword search (content_tsv/resolution_tsv) depends on. Runs
// synchronously in the API process - there's no reason keyword search
// freshness should wait on the embedding queue.
const updatePlainText = async (agendaId, html, plainColumn) => {
    const plainText = htmlToText(html);
    await db.query(`UPDATE agenda SET ${plainColumn} = $1 WHERE id = $2`, [plainText, agendaId]);
    await clearSearchCache();
    return plainText;
};

// Heavy part: chunk + embed + store. This is the CPU/RAM-intensive step
// (calls out to the embedding_service and does N inserts), so it's the part
// deferred to the embedding-jobs queue and run by the resource-aware worker
// (see worker.js), never inline in an Express request handler.
const embedAndStoreChunks = async (agendaId, plainText, tableName) => {
    await db.query(`DELETE FROM ${tableName} WHERE agenda_id = $1`, [agendaId]);

    const chunks = chunkText(plainText);
    if (chunks.length > 0) {
        const embeddings = await embedTexts(chunks);
        for (let i = 0; i < chunks.length; i++) {
            await db.query(
                `INSERT INTO ${tableName} (agenda_id, chunk_index, chunk_text, embedding) VALUES ($1, $2, $3, $4)`,
                [agendaId, i, chunks[i], JSON.stringify(embeddings[i])]
            );
        }
    }

    await clearSearchCache();
};

// Fire-and-forget from controllers: never let embedding-queue latency or
// downtime block saving an agenda/resolution. The plain-text/keyword-search
// update happens immediately; the embedding rebuild is queued for the
// worker.
const indexAgendaContent = async (agendaId, html) => {
    try {
        const plainText = await updatePlainText(agendaId, html, 'content_plain');
        await embeddingQueue.add('embed', { kind: 'agenda', agendaId, plainText, tableName: 'agenda_chunks' });
    } catch (err) {
        console.error(`Failed to index agenda content for ${agendaId}:`, err.message);
    }
};

const indexResolutionContent = async (agendaId, html) => {
    try {
        const plainText = await updatePlainText(agendaId, html, 'resolution_plain');
        await embeddingQueue.add('embed', { kind: 'resolution', agendaId, plainText, tableName: 'resolution_chunks' });
    } catch (err) {
        console.error(`Failed to index resolution content for ${agendaId}:`, err.message);
    }
};

module.exports = { chunkText, embedAndStoreChunks, indexAgendaContent, indexResolutionContent, clearSearchCache };

const db = require('../db');
const { htmlToText } = require('./htmlToText');
const { embedTexts } = require('./embeddingClient');
const { embeddingQueue } = require('../queue');

const MAX_CHUNK_WORDS = 500; // BAAI/bge-m3's context window is 8,192 tokens.

// Removes zero-width spaces/joiners and standardizes digits
const normalizeBanglaText = (text) => {
    if (!text) return '';
    return text
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .replace(/[\u09E6-\u09EF]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0x09E6 + 0x0030))
        .replace(/\s+/g, ' ')
        .trim();
};

const populateAgendaEntities = async (agendaId, plainText) => {
    if (!plainText || !plainText.trim()) return;
    try {
        await db.query('DELETE FROM agenda_entities WHERE agenda_id = $1', [agendaId]);
        const lowerText = plainText.toLowerCase();

        const [departments, offices, members, faculties] = await Promise.all([
            db.query('SELECT id, name_bangla, name_english FROM departments'),
            db.query('SELECT id, name_bangla, name_english FROM offices'),
            db.query('SELECT id, name FROM members'),
            db.query('SELECT id, name_bangla, name_english FROM faculties')
        ]);

        const entitiesToInsert = [];

        for (const d of departments.rows) {
            if ((d.name_bangla && lowerText.includes(d.name_bangla.toLowerCase())) ||
                (d.name_english && lowerText.includes(d.name_english.toLowerCase()))) {
                entitiesToInsert.push([agendaId, 'department', d.id, d.name_bangla, d.name_english]);
            }
        }
        for (const o of offices.rows) {
            if ((o.name_bangla && lowerText.includes(o.name_bangla.toLowerCase())) ||
                (o.name_english && lowerText.includes(o.name_english.toLowerCase()))) {
                entitiesToInsert.push([agendaId, 'office', o.id, o.name_bangla, o.name_english]);
            }
        }
        for (const m of members.rows) {
            if (m.name && lowerText.includes(m.name.toLowerCase())) {
                entitiesToInsert.push([agendaId, 'member', m.id, m.name, null]);
            }
        }
        for (const f of faculties.rows) {
            if ((f.name_bangla && lowerText.includes(f.name_bangla.toLowerCase())) ||
                (f.name_english && lowerText.includes(f.name_english.toLowerCase()))) {
                entitiesToInsert.push([agendaId, 'faculty', f.id, f.name_bangla, f.name_english]);
            }
        }

        for (const ent of entitiesToInsert) {
            await db.query(
                `INSERT INTO agenda_entities (agenda_id, entity_type, entity_id, entity_name_bangla, entity_name_english)
                 VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
                ent
            );
        }
    } catch (err) {
        console.error(`Failed to populate agenda entities for ${agendaId}:`, err.message);
    }
};

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

const updatePlainText = async (agendaId, html, plainColumn) => {
    const plainText = normalizeBanglaText(htmlToText(html));
    await db.query(`UPDATE agenda SET ${plainColumn} = $1 WHERE id = $2`, [plainText, agendaId]);
    await populateAgendaEntities(agendaId, plainText);
    await clearSearchCache();
    return plainText;
};

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

module.exports = { 
    chunkText, 
    embedAndStoreChunks, 
    indexAgendaContent, 
    indexResolutionContent, 
    clearSearchCache,
    normalizeBanglaText,
    populateAgendaEntities
};

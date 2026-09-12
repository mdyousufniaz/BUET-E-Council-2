const axios = require('axios');

const EMBEDDING_SERVICE_URL = process.env.EMBEDDING_SERVICE_URL || 'http://embedding_service:8002';
const DEFAULT_TIMEOUT_MS = parseInt(process.env.EMBEDDING_TIMEOUT_MS || '120000', 10);

// Returns an array of 1024-dim embedding vectors, one per input text, in order.
const embedTexts = async (texts, customTimeoutMs) => {
    if (!texts || texts.length === 0) return [];
    // Allow ample time for CPU-based multi-chunk document embedding (default 120s or ~25s per chunk)
    const timeout = customTimeoutMs || Math.max(DEFAULT_TIMEOUT_MS, texts.length * 25000);
    const { data } = await axios.post(`${EMBEDDING_SERVICE_URL}/embed`, { texts }, { timeout });
    return data.embeddings;
};

module.exports = { embedTexts, EMBEDDING_SERVICE_URL };


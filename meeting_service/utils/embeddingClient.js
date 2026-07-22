const axios = require('axios');

const EMBEDDING_SERVICE_URL = process.env.EMBEDDING_SERVICE_URL || 'http://embedding_service:8002';

// Returns an array of 1024-dim embedding vectors, one per input text, in order.
const embedTexts = async (texts) => {
    if (!texts || texts.length === 0) return [];
    const { data } = await axios.post(`${EMBEDDING_SERVICE_URL}/embed`, { texts }, { timeout: 15000 });
    return data.embeddings;
};

module.exports = { embedTexts };

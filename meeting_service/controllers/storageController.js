const storageService = require('../utils/storageService');

// Streams a stored file through our own authenticated server instead of exposing
// the bucket directly, so only logged-in users (via authMiddleware) can fetch it.
const streamFile = async (req, res, next) => {
    try {
        const keyParts = req.params.key;
        const key = Array.isArray(keyParts) ? keyParts.join('/') : keyParts;
        if (!key) return res.status(400).json({ success: false, message: 'File key is required' });

        const { stream, contentType, contentLength } = await storageService.getFileStream(key);

        res.setHeader('Content-Type', contentType);
        if (contentLength) res.setHeader('Content-Length', contentLength);

        stream.pipe(res);
        stream.on('error', (err) => next(err));
    } catch (error) {
        const status = error.$metadata && error.$metadata.httpStatusCode;
        if (error.name === 'NoSuchKey' || error.name === 'NotFound' || status === 404) {
            return res.status(404).json({ success: false, message: 'File not found' });
        }
        next(error);
    }
};

module.exports = { streamFile };

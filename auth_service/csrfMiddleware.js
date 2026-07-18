// Origin/Referer allowlist check - a standard, OWASP-endorsed CSRF defense
// for cookie-authenticated JSON APIs. Unlike a double-submit token, this
// needs no bootstrap request and no frontend changes: browsers already set
// Origin on every cross-origin request (and on same-origin unsafe-method
// requests in all current browsers), so a forged request from another site
// simply won't carry an origin this server trusts.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:9001')
    .split(',').map(o => o.trim()).filter(Boolean);

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const verifyOrigin = (req, res, next) => {
    if (SAFE_METHODS.has(req.method.toUpperCase())) return next();

    let origin = req.headers.origin;
    if (!origin && req.headers.referer) {
        try {
            origin = new URL(req.headers.referer).origin;
        } catch {
            origin = null;
        }
    }

    if (!origin || !ALLOWED_ORIGINS.includes(origin)) {
        return res.status(403).json({ success: false, message: 'Request blocked: origin not allowed.' });
    }
    next();
};

module.exports = { verifyOrigin, ALLOWED_ORIGINS };

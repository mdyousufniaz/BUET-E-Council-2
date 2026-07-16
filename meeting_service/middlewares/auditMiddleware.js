const db = require('../db');

const ACTIONS_BY_METHOD = { POST: 'create', PUT: 'update', DELETE: 'delete' };

// Generic "who did what" logger for a router: mount with router.use(auditLog('meeting'))
// after authMiddleware. Skips GETs and failed requests, and never blocks the
// response - logging failures are swallowed (a broken audit insert must not
// break the actual action).
const auditLog = (entityType) => (req, res, next) => {
    res.on('finish', () => {
        const action = ACTIONS_BY_METHOD[req.method];
        if (!action || res.statusCode >= 400) return;

        const entityId = req.params.id || req.params.annexureId || req.params.resId
            || req.params.inviteeId || req.params.presenteeId || null;

        db.query(
            `INSERT INTO audit_logs (user_id, username, action, entity_type, entity_id, details, ip_address)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
                req.user?.id || null,
                req.user?.username || null,
                action,
                entityType,
                entityId,
                JSON.stringify({ method: req.method, path: req.originalUrl }),
                req.ip
            ]
        ).catch(err => console.error('[audit] failed to log action:', err.message));
    });
    next();
};

module.exports = { auditLog };

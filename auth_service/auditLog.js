const db = require('./db');

// Fire-and-forget "who did what" logger for auth/user-management events.
// Never throws - a broken audit insert must not break signin/signup/etc.
const logAudit = async ({ userId, username, action, entityType, entityId, details, ip }) => {
    try {
        await db.query(
            `INSERT INTO audit_logs (user_id, username, action, entity_type, entity_id, details, ip_address)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [userId || null, username || null, action, entityType, entityId || null, details ? JSON.stringify(details) : null, ip || null]
        );
    } catch (err) {
        console.error('[audit] failed to log action:', err.message);
    }
};

module.exports = { logAudit };

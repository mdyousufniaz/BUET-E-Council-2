const db = require('../db');
const storageService = require('../utils/storageService');
const { ARCHIVE_PREFIX } = require('../utils/auditArchiver');

const getAuditLogs = async (req, res, next) => {
    try {
        const { user, action, entity_type, from, to } = req.query;
        const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
        const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
        const offset = (page - 1) * limit;

        const conditions = [];
        const params = [];

        if (user) {
            params.push(`%${user}%`);
            conditions.push(`username ILIKE $${params.length}`);
        }
        if (action) {
            params.push(action);
            conditions.push(`action = $${params.length}`);
        }
        if (entity_type) {
            params.push(entity_type);
            conditions.push(`entity_type = $${params.length}`);
        }
        if (from) {
            params.push(from);
            conditions.push(`created_at >= $${params.length}`);
        }
        if (to) {
            params.push(to);
            conditions.push(`created_at <= $${params.length}`);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        const countResult = await db.query(`SELECT COUNT(*) FROM audit_logs ${whereClause}`, params);
        const total = parseInt(countResult.rows[0].count, 10);

        params.push(limit);
        params.push(offset);
        const result = await db.query(
            `SELECT id, user_id, username, action, entity_type, entity_id, details, ip_address, created_at
             FROM audit_logs ${whereClause}
             ORDER BY created_at DESC
             LIMIT $${params.length - 1} OFFSET $${params.length}`,
            params
        );

        res.status(200).json({
            success: true,
            data: result.rows,
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
        });
    } catch (error) {
        next(error);
    }
};

// Weekly JSON exports produced by utils/auditArchiver.js, listed newest first.
const getAuditLogArchives = async (req, res, next) => {
    try {
        const files = await storageService.listFiles(ARCHIVE_PREFIX);
        const data = files.map(f => ({
            week: f.key.replace(ARCHIVE_PREFIX, '').replace('.json', ''),
            size: f.size,
            lastModified: f.lastModified,
            url: `/storage/${f.key}`
        }));
        res.status(200).json({ success: true, data });
    } catch (error) {
        next(error);
    }
};

module.exports = { getAuditLogs, getAuditLogArchives };

const CustomError = require('../errors/CustomError');
const db = require('../db');

const getTemplates = async (req, res, next) => {
    try {
        const userId = req.user ? req.user.id : null;
        const { type, scope } = req.query; // scope: 'all' or 'mine'
        
        let query = `SELECT * FROM templates WHERE 1=1`;
        let params = [];
        let paramCount = 1;

        if (scope === 'mine') {
            query += ` AND created_by = $${paramCount++}`;
            params.push(userId);
        } else {
            query += ` AND (visibility = 'public' OR created_by = $${paramCount++})`;
            params.push(userId);
        }

        if (type) {
            query += ` AND type = $${paramCount++}`;
            params.push(type);
        }

        query += ` ORDER BY used_count DESC, created_at DESC`;
        
        const result = await db.query(query, params);
        
        res.status(200).json({ success: true, data: result.rows });
    } catch (error) {
        next(error);
    }
};

const searchTemplates = async (req, res, next) => {
    try {
        const { q, type, scope } = req.query;
        const userId = req.user ? req.user.id : null;

        if (!q) {
            return next(new CustomError('Search query (q) is required', 400));
        }

        let query = `SELECT * FROM templates WHERE text_content ILIKE $1`;
        let params = [`%${q}%`];
        let paramCount = 2;

        if (scope === 'mine') {
            query += ` AND created_by = $${paramCount++}`;
            params.push(userId);
        } else {
            query += ` AND (visibility = 'public' OR created_by = $${paramCount++})`;
            params.push(userId);
        }

        if (type) {
            query += ` AND type = $${paramCount++}`;
            params.push(type);
        }

        query += ` ORDER BY used_count DESC, created_at DESC`;

        const result = await db.query(query, params);
        
        res.status(200).json({ success: true, data: result.rows });
    } catch (error) {
        next(error);
    }
};

const createTemplate = async (req, res, next) => {
    try {
        const { text_content, visibility = 'private', type } = req.body;
        const created_by = req.user ? req.user.id : null;

        if (!text_content || !type) {
            return next(new CustomError('Text content and type are required', 400));
        }

        const result = await db.query(
            'INSERT INTO templates (text_content, visibility, created_by, type) VALUES ($1, $2, $3, $4) RETURNING *',
            [text_content, visibility, created_by, type]
        );

        res.status(201).json({ success: true, message: 'Template created', data: result.rows[0] });
    } catch (error) {
        next(error);
    }
};

const updateTemplate = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { text_content, visibility, type } = req.body;
        const userId = req.user ? req.user.id : null;

        // Check ownership
        const check = await db.query('SELECT created_by FROM templates WHERE id = $1', [id]);
        if (check.rows.length === 0) return next(new CustomError('Template not found', 404));
        if (check.rows[0].created_by !== userId) return next(new CustomError('Not authorized to update this template', 403));

        const result = await db.query(
            `UPDATE templates 
             SET text_content = COALESCE($1, text_content), 
                 visibility = COALESCE($2, visibility),
                 type = COALESCE($3, type)
             WHERE id = $4 RETURNING *`,
            [text_content, visibility, type, id]
        );

        res.status(200).json({ success: true, message: 'Template updated', data: result.rows[0] });
    } catch (error) {
        next(error);
    }
};

const deleteTemplate = async (req, res, next) => {
    try {
        const { id } = req.params;
        const userId = req.user ? req.user.id : null;

        // Check ownership
        const check = await db.query('SELECT created_by FROM templates WHERE id = $1', [id]);
        if (check.rows.length === 0) return next(new CustomError('Template not found', 404));
        if (check.rows[0].created_by !== userId) return next(new CustomError('Not authorized to delete this template', 403));

        await db.query('DELETE FROM templates WHERE id = $1', [id]);
        res.status(200).json({ success: true, message: 'Template deleted' });
    } catch (error) {
        next(error);
    }
};

const updateVisibility = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { visibility } = req.body;
        const userId = req.user ? req.user.id : null;

        if (!visibility) return next(new CustomError('Visibility is required', 400));

        // Check ownership
        const check = await db.query('SELECT created_by FROM templates WHERE id = $1', [id]);
        if (check.rows.length === 0) return next(new CustomError('Template not found', 404));
        if (check.rows[0].created_by !== userId) return next(new CustomError('Not authorized to update this template', 403));

        const result = await db.query(
            'UPDATE templates SET visibility = $1 WHERE id = $2 RETURNING *',
            [visibility, id]
        );

        res.status(200).json({ success: true, message: 'Template visibility updated', data: result.rows[0] });
    } catch (error) {
        next(error);
    }
};

const incrementUseCount = async (req, res, next) => {
    try {
        const { id } = req.params;
        const result = await db.query(
            'UPDATE templates SET used_count = used_count + 1 WHERE id = $1 RETURNING *',
            [id]
        );
        if (result.rows.length === 0) return next(new CustomError('Template not found', 404));
        res.status(200).json({ success: true, data: result.rows[0] });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getTemplates,
    searchTemplates,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    updateVisibility,
    incrementUseCount
};

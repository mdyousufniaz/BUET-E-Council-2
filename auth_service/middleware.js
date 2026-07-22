const db = require('./db');

const requireAuth = async (req, res, next) => {
    try {
        const token = req.cookies.session_token || (req.header('Authorization') ? req.header('Authorization').replace('Bearer ', '') : null);

        if (!token) {
            return res.status(401).json({
                success: false,
                message: 'Access denied. No token provided.',
                error_code: 'UNAUTHORIZED'
            });
        }

        const query = `
            SELECT s.*, u.username, u.role, u.role_id, u.email, r.level as role_level, r.level_title 
            FROM sessions s
            JOIN users u ON s.user_id = u.id
            LEFT JOIN roles r ON u.role_id = r.id
            WHERE s.session_token = $1 AND s.is_active = TRUE AND s.expires_at > NOW()
        `;
        const { rows } = await db.query(query, [token]);

        if (rows.length === 0) {
            return res.status(401).json({
                success: false,
                message: 'Invalid or expired session.',
                error_code: 'UNAUTHORIZED'
            });
        }

        const session = rows[0];

        // Attach user and session to request
        req.user = {
            id: session.user_id,
            username: session.username,
            role: session.role,
            role_id: session.role_id,
            role_level: session.role_level !== null && session.role_level !== undefined ? parseInt(session.role_level, 10) : null,
            level_title: session.level_title || null,
            email: session.email
        };
        req.session = {
            id: session.id,
            token: session.session_token
        };

        next();
    } catch (err) {
        console.error('Auth middleware error:', err);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};

const requireAdmin = (req, res, next) => {
    if (req.user && (req.user.role === 'admin' || req.user.role === 'superadmin')) {
        next();
    } else {
        return res.status(403).json({ success: false, message: 'Forbidden. Admin access required.' });
    }
};

module.exports = { requireAuth, requireAdmin };

const db = require('../db');
const CustomError = require('../errors/CustomError');

const checkMeetingLock = async (req, res, next) => {
    // Only block mutating endpoints.
    // Also explicitly do not block the lock toggle route itself, nor the
    // online meeting link (editable any time regardless of lock state)!
    if (req.method === 'GET' || req.path.endsWith('/lock') || req.path.endsWith('/online-link')) {
        return next();
    }

    try {
        let meeting_id = null;
        let pathParts = req.path.split('/').filter(Boolean);
        let potentialId = pathParts[0];

        // Route: /api/meetings
        if (req.baseUrl.includes('/meetings') && potentialId && potentialId !== 'materials' && potentialId !== 'bulk-import') {
            meeting_id = potentialId;
        } 
        // Route: /api/agendas
        else if (req.baseUrl.includes('/agendas')) {
            if (req.method === 'POST' && req.path === '/' && req.body.meeting_id) {
                // creating an agenda
                meeting_id = req.body.meeting_id;
            } else if (potentialId && potentialId !== 'annexures' && potentialId !== 'resolutions') {
                // req.path is like /123 or /123/resolutions or /123/annexures
                // where 123 is the agenda id
                const agendaResult = await db.query('SELECT meeting_id FROM agenda WHERE id = $1', [potentialId]);
                if (agendaResult.rows.length > 0) {
                    meeting_id = agendaResult.rows[0].meeting_id;
                }
            } else if (req.path.startsWith('/resolutions/') && pathParts.length >= 2) {
                // specific resolution routes, e.g. /resolutions/123
                const resId = pathParts[1];
                const agendaResult = await db.query('SELECT meeting_id FROM agenda WHERE id = $1', [resId]);
                if (agendaResult.rows.length > 0) {
                    meeting_id = agendaResult.rows[0].meeting_id;
                }
            } else if (req.path.startsWith('/annexures/') && pathParts.length >= 2 && pathParts[1] !== 'reorder') {
                // specific annexure routes, e.g. /annexures/123
                const annexId = pathParts[1];
                const annexResult = await db.query(`
                    SELECT a.meeting_id 
                    FROM annexures an 
                    JOIN agenda a ON an.content_id = a.id 
                    WHERE an.id = $1
                `, [annexId]);
                if (annexResult.rows.length > 0) {
                    meeting_id = annexResult.rows[0].meeting_id;
                }
            } else if (req.path === '/annexures/reorder' && req.body.items && req.body.items.length > 0) {
                // annexure reorder route
                const annexResult = await db.query(`
                    SELECT a.meeting_id 
                    FROM annexures an 
                    JOIN agenda a ON an.content_id = a.id 
                    WHERE an.id = $1
                `, [req.body.items[0].id]);
                if (annexResult.rows.length > 0) {
                    meeting_id = annexResult.rows[0].meeting_id;
                }
            }
        }

        if (meeting_id) {
            const result = await db.query('SELECT is_locked FROM meetings WHERE id = $1', [meeting_id]);
            if (result.rows.length > 0 && result.rows[0].is_locked) {
                return next(new CustomError('Meeting is locked. Modifications are not allowed.', 403));
            }
        }
        
        next();
    } catch (err) {
        next(err);
    }
};

module.exports = { checkMeetingLock };

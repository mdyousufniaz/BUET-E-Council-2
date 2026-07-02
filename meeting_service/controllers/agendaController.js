const CustomError = require('../errors/CustomError');
const db = require('../db');

const getAgendams = async (req, res, next) => {
    try {
        const meeting_id = req.query.meeting_id;
        
        let query = 'SELECT * FROM agenda';
        let params = [];
        
        if (meeting_id) {
            query += ' WHERE meeting_id = $1 ORDER BY agenda_serial ASC';
            params.push(meeting_id);
        } else {
            query += ' ORDER BY created_at DESC';
        }

        const result = await db.query(query, params);
        res.status(200).json({ success: true, data: result.rows });
    } catch (error) {
        next(error);
    }
};

const createAgendam = async (req, res, next) => {
    try {
        const { meeting_id, agenda_serial, is_executed, execution_status } = req.body;
        
        if (!meeting_id) {
            return next(new CustomError('meeting_id is required', 400));
        }

        const result = await db.query(
            'INSERT INTO agenda (meeting_id, agenda_serial, is_executed, execution_status) VALUES ($1, $2, $3, $4) RETURNING *',
            [meeting_id, agenda_serial, is_executed || 'no', execution_status]
        );

        res.status(201).json({ success: true, message: 'Agendam created', data: result.rows[0] });
    } catch (error) {
        next(error);
    }
};

const updateAgendam = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { agenda_serial, is_executed, execution_status } = req.body;

        const result = await db.query(
            `UPDATE agenda 
             SET agenda_serial = COALESCE($1, agenda_serial),
                 is_executed = COALESCE($2, is_executed),
                 execution_status = COALESCE($3, execution_status)
             WHERE id = $4 RETURNING *`,
            [agenda_serial, is_executed, execution_status, id]
        );

        if (result.rows.length === 0) {
            return next(new CustomError('Agendam not found', 404));
        }

        res.status(200).json({ success: true, message: 'Agendam updated', data: result.rows[0] });
    } catch (error) {
        next(error);
    }
};

const deleteAgendam = async (req, res, next) => {
    try {
        const { id } = req.params;
        const result = await db.query('DELETE FROM agenda WHERE id = $1 RETURNING *', [id]);

        if (result.rows.length === 0) {
            return next(new CustomError('Agendam not found', 404));
        }

        res.status(200).json({ success: true, message: 'Agendam deleted' });
    } catch (error) {
        next(error);
    }
};

const getResolutions = async (req, res, next) => {
    try {
        // According to schema, resolution is just a column in the agenda table.
        // We fetch agendas that have a resolution.
        const meeting_id = req.query.meeting_id;
        
        let query = 'SELECT id, meeting_id, agenda_serial, resolution, resolution_embedding, is_executed, execution_status FROM agenda WHERE resolution IS NOT NULL';
        let params = [];
        
        if (meeting_id) {
            query += ' AND meeting_id = $1 ORDER BY agenda_serial ASC';
            params.push(meeting_id);
        }

        const result = await db.query(query, params);
        res.status(200).json({ success: true, data: result.rows });
    } catch (error) {
        next(error);
    }
};

const createResolution = async (req, res, next) => {
    try {
        // Since resolution is on the agenda table, we just update the resolution column
        const agendamId = req.params.id; // Expecting the URL to be POST /:id/resolutions where id is agenda_id
        const { resolution } = req.body;

        if (!resolution) return next(new CustomError('Resolution text is required', 400));

        const result = await db.query(
            'UPDATE agenda SET resolution = $1 WHERE id = $2 RETURNING *',
            [resolution, agendamId]
        );

        if (result.rows.length === 0) return next(new CustomError('Agendam not found', 404));

        res.status(201).json({ success: true, message: 'Resolution created', data: result.rows[0] });
    } catch (error) {
        next(error);
    }
};

const updateResolution = async (req, res, next) => {
    try {
        // Similar to create, we just update the resolution text
        const agendamId = req.params.resId; // from PUT /resolutions/:resId
        const { resolution } = req.body;

        if (!resolution) return next(new CustomError('Resolution text is required', 400));

        const result = await db.query(
            'UPDATE agenda SET resolution = $1 WHERE id = $2 RETURNING *',
            [resolution, agendamId]
        );

        if (result.rows.length === 0) return next(new CustomError('Resolution/Agendam not found', 404));

        res.status(200).json({ success: true, message: 'Resolution updated', data: result.rows[0] });
    } catch (error) {
        next(error);
    }
};

const deleteResolution = async (req, res, next) => {
    try {
        // Just nullify the resolution column
        const agendamId = req.params.resId;

        const result = await db.query(
            'UPDATE agenda SET resolution = NULL, resolution_embedding = NULL WHERE id = $1 RETURNING *',
            [agendamId]
        );

        if (result.rows.length === 0) return next(new CustomError('Resolution/Agendam not found', 404));

        res.status(200).json({ success: true, message: 'Resolution deleted' });
    } catch (error) {
        next(error);
    }
};

const addAnnexures = async (req, res, next) => {
    try {
        // We will assume files are uploaded and we just insert metadata here.
        // Actual file processing would involve `multer` and `s3Client`.
        const content_id = req.params.id || req.params.resId;
        const { annexure_type, file_name, file_path, summary } = req.body;

        if (!content_id || !annexure_type) {
            return next(new CustomError('content_id and annexure_type are required', 400));
        }

        const result = await db.query(
            'INSERT INTO annexures (content_id, annexure_type, file_name, file_path, summary) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [content_id, annexure_type, file_name, file_path, summary]
        );

        res.status(201).json({ success: true, message: 'Annexure added', data: result.rows[0] });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getAgendams,
    createAgendam,
    updateAgendam,
    deleteAgendam,
    getResolutions,
    createResolution,
    updateResolution,
    deleteResolution,
    addAnnexures
};

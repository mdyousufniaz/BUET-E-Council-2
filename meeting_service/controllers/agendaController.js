const CustomError = require('../errors/CustomError');
const db = require('../db');
const storageService = require('../utils/storageService');
const crypto = require('crypto');

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
        const { meeting_id, agenda_serial, content, is_executed, execution_status } = req.body;
        
        if (!meeting_id) {
            return next(new CustomError('meeting_id is required', 400));
        }

        const result = await db.query(
            'INSERT INTO agenda (meeting_id, agenda_serial, content, is_executed, execution_status) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [meeting_id, agenda_serial, content || '', is_executed || 'no', execution_status]
        );

        res.status(201).json({ success: true, message: 'Agendam created', data: result.rows[0] });
    } catch (error) {
        next(error);
    }
};

const updateAgendam = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { agenda_serial, content, is_executed, execution_status } = req.body;

        const result = await db.query(
            `UPDATE agenda 
             SET agenda_serial = COALESCE($1, agenda_serial),
                 content = COALESCE($2, content),
                 is_executed = COALESCE($3, is_executed),
                 execution_status = COALESCE($4, execution_status)
             WHERE id = $5 RETURNING *`,
            [agenda_serial, content, is_executed, execution_status, id]
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

const getAnnexures = async (req, res, next) => {
    try {
        const { id } = req.params;
        const result = await db.query(
            'SELECT * FROM annexures WHERE content_id = $1 ORDER BY annexure_serial ASC',
            [id]
        );
        
        // Generate presigned URLs for each file
        const annexures = await Promise.all(result.rows.map(async (annexure) => {
            if (annexure.file_path) {
                try {
                    // Since MinIO bucket is public and proxied via NGINX, we can directly link it!
                    // Removing 'annexures/' prefix if file_path includes it since the bucket name is the root
                    annexure.url = `/storage/${annexure.file_path}`;
                } catch (err) {
                    annexure.url = null;
                }
            }
            return annexure;
        }));

        res.status(200).json({ success: true, data: annexures });
    } catch (error) {
        next(error);
    }
};

const uploadAnnexure = async (req, res, next) => {
    try {
        const { id } = req.params; // content_id (agenda id)
        const { summary } = req.body;
        let { annexure_type } = req.body;
        const file = req.file;

        // Map 'agenda' to 'agendaItem' for the Postgres enum
        if (annexure_type === 'agenda') {
            annexure_type = 'agendaItem';
        }

        if (!id || !annexure_type || !file) {
            return next(new CustomError('content_id, annexure_type, and file are required', 400));
        }

        // Generate a unique file key
        const ext = file.originalname.split('.').pop();
        const fileKey = `annexures/${id}/${crypto.randomBytes(8).toString('hex')}.${ext}`;

        // Upload to S3/MinIO
        await storageService.uploadFile(file.buffer, fileKey, file.mimetype);

        // Get max serial
        const maxSerialResult = await db.query(
            'SELECT COALESCE(MAX(annexure_serial), 0) as max_serial FROM annexures WHERE content_id = $1',
            [id]
        );
        const nextSerial = parseInt(maxSerialResult.rows[0].max_serial, 10) + 1;

        // Save to DB
        const result = await db.query(
            'INSERT INTO annexures (content_id, annexure_type, file_name, file_path, summary, annexure_serial) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
            [id, annexure_type, file.originalname, fileKey, summary || '', nextSerial]
        );

        res.status(201).json({ success: true, message: 'Annexure added successfully', data: result.rows[0] });
    } catch (error) {
        next(error);
    }
};

const deleteAnnexure = async (req, res, next) => {
    try {
        const { annexureId } = req.params;

        const result = await db.query('DELETE FROM annexures WHERE id = $1 RETURNING *', [annexureId]);
        
        if (result.rows.length === 0) return next(new CustomError('Annexure not found', 404));

        const deletedAnnexure = result.rows[0];
        if (deletedAnnexure.file_path) {
            try {
                await storageService.deleteFile(deletedAnnexure.file_path);
            } catch (err) {
                console.error("Failed to delete file from storage:", err);
            }
        }

        res.status(200).json({ success: true, message: 'Annexure deleted' });
    } catch (error) {
        next(error);
    }
};

const reorderAnnexures = async (req, res, next) => {
    try {
        const { items } = req.body; // array of { id, annexure_serial }
        
        if (!items || !Array.isArray(items)) {
            return next(new CustomError('Invalid input', 400));
        }

        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');
            for (const item of items) {
                await client.query(
                    'UPDATE annexures SET annexure_serial = $1 WHERE id = $2',
                    [item.annexure_serial, item.id]
                );
            }
            await client.query('COMMIT');
            res.status(200).json({ success: true, message: 'Reordered successfully' });
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
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
    getAnnexures,
    uploadAnnexure,
    deleteAnnexure,
    reorderAnnexures
};

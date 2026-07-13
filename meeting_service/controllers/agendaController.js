const CustomError = require('../errors/CustomError');
const db = require('../db');
const storageService = require('../utils/storageService');
const crypto = require('crypto');
const { indexAgendaContent, indexResolutionContent } = require('../utils/searchIndexer');

const setAgendaTags = async (agendaId, tagIds) => {
    if (!Array.isArray(tagIds)) return;
    await db.query('DELETE FROM agenda_tags WHERE agenda_id = $1', [agendaId]);
    for (const tagId of tagIds) {
        await db.query(
            'INSERT INTO agenda_tags (agenda_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [agendaId, tagId]
        );
    }
};

const getAgendams = async (req, res, next) => {
    try {
        const meeting_id = req.query.meeting_id;
        const is_suppli = req.query.is_suppli;

        let query = `
            SELECT a.*, COALESCE(
                (SELECT json_agg(json_build_object('id', t.id, 'name', t.name) ORDER BY t.name)
                 FROM agenda_tags at2 JOIN tags t ON t.id = at2.tag_id WHERE at2.agenda_id = a.id),
                '[]'
            ) as tags
            FROM agenda a`;
        let params = [];

        if (meeting_id) {
            query += ' WHERE meeting_id = $1';
            params.push(meeting_id);

            if (is_suppli !== undefined) {
                query += ' AND is_suppli = $2';
                params.push(is_suppli === 'true');
            }

            query += ' ORDER BY agenda_serial ASC';
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
        const { meeting_id, agenda_serial, content, is_executed, execution_status, is_suppli, tag_ids } = req.body;

        if (!meeting_id) {
            return next(new CustomError('meeting_id is required', 400));
        }

        const result = await db.query(
            'INSERT INTO agenda (meeting_id, agenda_serial, content, is_executed, execution_status, is_suppli) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
            [meeting_id, agenda_serial, content || '', is_executed || 'no', execution_status, is_suppli || false]
        );
        const agendam = result.rows[0];

        await setAgendaTags(agendam.id, tag_ids);

        res.status(201).json({ success: true, message: 'Agendam created', data: agendam });

        if (content) indexAgendaContent(agendam.id, content).catch(() => {});
    } catch (error) {
        next(error);
    }
};

const updateAgendam = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { agenda_serial, content, is_executed, execution_status, tag_ids } = req.body;

        if (content !== undefined) {
            const existing = await db.query('SELECT content FROM agenda WHERE id = $1', [id]);
            const oldContent = existing.rows[0]?.content;
            if (oldContent && oldContent.trim()) {
                await db.query(
                    'INSERT INTO revisions (text_content, content_id, content_type, modified_by) VALUES ($1, $2, $3, $4)',
                    [oldContent, id, 'agendaItem', req.user?.id || null]
                );
            }
        }

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
        const agendam = result.rows[0];

        await setAgendaTags(id, tag_ids);

        res.status(200).json({ success: true, message: 'Agendam updated', data: agendam });

        if (content !== undefined) indexAgendaContent(id, content).catch(() => {});
    } catch (error) {
        next(error);
    }
};

const getRevisions = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { content_type } = req.query;

        if (!content_type) {
            return next(new CustomError('content_type is required', 400));
        }

        const result = await db.query(
            `SELECT r.*, u.username as modified_by_username
             FROM revisions r
             LEFT JOIN users u ON u.id = r.modified_by
             WHERE r.content_id = $1 AND r.content_type = $2
             ORDER BY r.modified_at DESC`,
            [id, content_type]
        );

        res.status(200).json({ success: true, data: result.rows });
    } catch (error) {
        next(error);
    }
};

const restoreRevision = async (req, res, next) => {
    try {
        const { id, revisionId } = req.params;
        const { content_type } = req.query;

        if (!content_type || !['agendaItem', 'resolutionItem'].includes(content_type)) {
            return next(new CustomError('A valid content_type (agendaItem or resolutionItem) is required', 400));
        }
        const column = content_type === 'agendaItem' ? 'content' : 'resolution';

        const revisionResult = await db.query(
            'SELECT text_content FROM revisions WHERE id = $1 AND content_id = $2 AND content_type = $3',
            [revisionId, id, content_type]
        );
        if (revisionResult.rows.length === 0) {
            return next(new CustomError('Revision not found', 404));
        }
        const restoredText = revisionResult.rows[0].text_content;

        const current = await db.query(`SELECT ${column} FROM agenda WHERE id = $1`, [id]);
        if (current.rows.length === 0) {
            return next(new CustomError('Agendam not found', 404));
        }
        const currentText = current.rows[0][column];
        if (currentText && currentText.trim()) {
            await db.query(
                'INSERT INTO revisions (text_content, content_id, content_type, modified_by) VALUES ($1, $2, $3, $4)',
                [currentText, id, content_type, req.user?.id || null]
            );
        }

        const result = await db.query(
            `UPDATE agenda SET ${column} = $1 WHERE id = $2 RETURNING *`,
            [restoredText, id]
        );

        res.status(200).json({ success: true, message: 'Revision restored', data: result.rows[0] });

        if (content_type === 'agendaItem') {
            indexAgendaContent(id, restoredText).catch(() => {});
        } else {
            indexResolutionContent(id, restoredText).catch(() => {});
        }
    } catch (error) {
        next(error);
    }
};

const deleteAgendam = async (req, res, next) => {
    try {
        const { id } = req.params;
        const findAgenda = await db.query('SELECT meeting_id FROM agenda WHERE id = $1', [id]);
        
        if (findAgenda.rows.length === 0) {
            return next(new CustomError('Agendam not found', 404));
        }
        
        const meeting_id = findAgenda.rows[0].meeting_id;

        await db.query('BEGIN');
        await db.query('DELETE FROM agenda WHERE id = $1', [id]);

        // Re-serialize agendas to prevent gaps
        const mainAgendas = await db.query('SELECT id FROM agenda WHERE meeting_id = $1 AND is_suppli = false ORDER BY agenda_serial ASC, created_at ASC', [meeting_id]);
        for (let i = 0; i < mainAgendas.rows.length; i++) {
            await db.query('UPDATE agenda SET agenda_serial = $1 WHERE id = $2', [i + 1, mainAgendas.rows[i].id]);
        }
        
        const suppliAgendas = await db.query('SELECT id FROM agenda WHERE meeting_id = $1 AND is_suppli = true ORDER BY agenda_serial ASC, created_at ASC', [meeting_id]);
        let nextSerial = mainAgendas.rows.length + 1;
        for (let i = 0; i < suppliAgendas.rows.length; i++) {
            await db.query('UPDATE agenda SET agenda_serial = $1 WHERE id = $2', [nextSerial + i, suppliAgendas.rows[i].id]);
        }

        await db.query('COMMIT');
        await db.query('DELETE FROM search_cache');
        res.status(200).json({ success: true, message: 'Agendam deleted' });
    } catch (error) {
        await db.query('ROLLBACK');
        next(error);
    }
};

const getResolutions = async (req, res, next) => {
    try {
        // According to schema, resolution is just a column in the agenda table.
        // We fetch agendas that have a resolution.
        const meeting_id = req.query.meeting_id;
        
        let query = 'SELECT id, meeting_id, agenda_serial, resolution, is_executed, execution_status FROM agenda WHERE resolution IS NOT NULL';
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

const snapshotResolutionRevision = async (agendamId, userId) => {
    const existing = await db.query('SELECT resolution FROM agenda WHERE id = $1', [agendamId]);
    const oldResolution = existing.rows[0]?.resolution;
    if (oldResolution && oldResolution.trim()) {
        await db.query(
            'INSERT INTO revisions (text_content, content_id, content_type, modified_by) VALUES ($1, $2, $3, $4)',
            [oldResolution, agendamId, 'resolutionItem', userId || null]
        );
    }
};

const createResolution = async (req, res, next) => {
    try {
        // Since resolution is on the agenda table, we just update the resolution column
        const agendamId = req.params.id; // Expecting the URL to be POST /:id/resolutions where id is agenda_id
        const { resolution, tag_ids } = req.body;

        if (!resolution) return next(new CustomError('Resolution text is required', 400));

        await snapshotResolutionRevision(agendamId, req.user?.id);

        const result = await db.query(
            'UPDATE agenda SET resolution = $1 WHERE id = $2 RETURNING *',
            [resolution, agendamId]
        );

        if (result.rows.length === 0) return next(new CustomError('Agendam not found', 404));

        await setAgendaTags(agendamId, tag_ids);

        res.status(201).json({ success: true, message: 'Resolution created', data: result.rows[0] });

        indexResolutionContent(agendamId, resolution).catch(() => {});
    } catch (error) {
        next(error);
    }
};

const updateResolution = async (req, res, next) => {
    try {
        // Similar to create, we just update the resolution text
        const agendamId = req.params.resId; // from PUT /resolutions/:resId
        const { resolution, tag_ids } = req.body;

        if (!resolution) return next(new CustomError('Resolution text is required', 400));

        await snapshotResolutionRevision(agendamId, req.user?.id);

        const result = await db.query(
            'UPDATE agenda SET resolution = $1 WHERE id = $2 RETURNING *',
            [resolution, agendamId]
        );

        if (result.rows.length === 0) return next(new CustomError('Resolution/Agendam not found', 404));

        await setAgendaTags(agendamId, tag_ids);

        res.status(200).json({ success: true, message: 'Resolution updated', data: result.rows[0] });

        indexResolutionContent(agendamId, resolution).catch(() => {});
    } catch (error) {
        next(error);
    }
};

const updateExecutionStatus = async (req, res, next) => {
    try {
        const agendamId = req.params.resId;
        const { is_executed, execution_status } = req.body;

        const result = await db.query(
            'UPDATE agenda SET is_executed = $1, execution_status = $2 WHERE id = $3 RETURNING *',
            [is_executed, execution_status, agendamId]
        );

        if (result.rows.length === 0) return next(new CustomError('Resolution/Agenda not found', 404));

        res.status(200).json({ success: true, message: 'Execution status updated', data: result.rows[0] });
    } catch (error) {
        next(error);
    }
};

const deleteResolution = async (req, res, next) => {
    try {
        // Just nullify the resolution column
        const agendamId = req.params.resId;

        const result = await db.query(
            'UPDATE agenda SET resolution = NULL, resolution_plain = NULL WHERE id = $1 RETURNING *',
            [agendamId]
        );

        if (result.rows.length === 0) return next(new CustomError('Resolution/Agendam not found', 404));

        // Nulling the column doesn't cascade like deleting the agenda row would.
        await db.query('DELETE FROM resolution_chunks WHERE agenda_id = $1', [agendamId]);
        await db.query('DELETE FROM search_cache');

        res.status(200).json({ success: true, message: 'Resolution deleted' });
    } catch (error) {
        next(error);
    }
};

const getAnnexures = async (req, res, next) => {
    try {
        const { id } = req.params;
        let { type } = req.query; // 'agenda' or 'resolution'
        
        if (type === 'agenda') type = 'agendaItem';

        let query = 'SELECT * FROM annexures WHERE content_id = $1';
        let params = [id];

        if (type) {
            query += ' AND annexure_type = $2';
            params.push(type);
        }

        query += ' ORDER BY annexure_serial ASC';

        const result = await db.query(query, params);
        
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
    updateExecutionStatus,
    deleteResolution,
    getAnnexures,
    uploadAnnexure,
    deleteAnnexure,
    reorderAnnexures,
    getRevisions,
    restoreRevision
};

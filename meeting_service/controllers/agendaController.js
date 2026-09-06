const CustomError = require('../errors/CustomError');
const db = require('../db');
const storageService = require('../utils/storageService');
const meetingFileSystem = require('../utils/meetingFileSystem');
const crypto = require('crypto');
const { indexAgendaContent, indexResolutionContent } = require('../utils/searchIndexer');
const { toBanglaDigits, stripProposalPrefix, stripResolutionPrefix } = require('../utils/agendaSerial');

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

const ensureBibidhaAgenda = async (meetingId) => {
    if (!meetingId) return;

    const meetingRes = await db.query('SELECT is_regular FROM meetings WHERE id = $1', [meetingId]);
    if (meetingRes.rows.length === 0) return;

    if (meetingRes.rows[0].is_regular === false) {
        await db.query(
            "DELETE FROM agenda WHERE meeting_id = $1 AND is_suppli = false AND (content = 'বিবিধ :' OR content = 'বিবিধ' OR TRIM(content) = 'বিবিধ :')",
            [meetingId]
        );
        return;
    }

    const res = await db.query(
        'SELECT id, agenda_serial, content FROM agenda WHERE meeting_id = $1 AND is_suppli = false AND (is_archived = false OR is_archived IS NULL) ORDER BY agenda_serial ASC',
        [meetingId]
    );
    const mainAgendas = res.rows;
    let bibidhaIndex = mainAgendas.findIndex(a => {
        if (!a.content) return false;
        const clean = a.content.replace(/<[^>]*>/g, '').trim();
        return clean.startsWith('বিবিধ');
    });

    if (bibidhaIndex === -1) {
        const nextSerial = mainAgendas.length + 1;
        await db.query(
            'INSERT INTO agenda (meeting_id, agenda_serial, content, is_suppli) VALUES ($1, $2, $3, false)',
            [meetingId, nextSerial, 'বিবিধ :']
        );
    } else {
        const bibidha = mainAgendas[bibidhaIndex];
        const lastSerial = mainAgendas.length;

        if (bibidha.agenda_serial !== lastSerial || bibidhaIndex !== mainAgendas.length - 1) {
            mainAgendas.splice(bibidhaIndex, 1);
            mainAgendas.push(bibidha);
            for (let i = 0; i < mainAgendas.length; i++) {
                const serial = i + 1;
                await db.query(
                    'UPDATE agenda SET agenda_serial = $1 WHERE id = $2',
                    [serial, mainAgendas[i].id]
                );
            }
        }
    }
};

const viewerTypeRestriction = (user) => {
    if (user?.role !== 'viewer') return null;
    if (user?.member_type === 'syndicate' || user?.member_type === 'none' || !user?.member_type) return null;
    return 'academic';
};

const reindexAgendas = async (meetingId, isSuppli) => {
    if (!meetingId) return;
    const targetSuppli = isSuppli === true || isSuppli === 'true';
    const res = await db.query(
        `SELECT id, content FROM agenda 
         WHERE meeting_id = $1 AND is_suppli = $2 AND (is_archived = false OR is_archived IS NULL) 
         ORDER BY agenda_serial ASC, created_at ASC`,
        [meetingId, targetSuppli]
    );
    const activeAgendas = res.rows;

    if (!targetSuppli) {
        const bibidhaIndex = activeAgendas.findIndex(a => {
            if (!a.content) return false;
            const clean = a.content.replace(/<[^>]*>/g, '').trim();
            return clean.startsWith('বিবিধ');
        });
        let bibidha = null;
        if (bibidhaIndex !== -1) {
            bibidha = activeAgendas.splice(bibidhaIndex, 1)[0];
        }
        for (let i = 0; i < activeAgendas.length; i++) {
            await db.query('UPDATE agenda SET agenda_serial = $1 WHERE id = $2', [i + 1, activeAgendas[i].id]);
        }
        if (bibidha) {
            await db.query('UPDATE agenda SET agenda_serial = $1 WHERE id = $2', [activeAgendas.length + 1, bibidha.id]);
        }
    } else {
        for (let i = 0; i < activeAgendas.length; i++) {
            await db.query('UPDATE agenda SET agenda_serial = $1 WHERE id = $2', [i + 1, activeAgendas[i].id]);
        }
    }
};

const getAgendams = async (req, res, next) => {
    try {
        const meeting_id = req.query.meeting_id;
        const is_suppli = req.query.is_suppli;
        const isOperator = req.user?.role !== 'viewer';
        let meeting = null;

        if (meeting_id) {
            await ensureBibidhaAgenda(meeting_id);
            const meetingRes = await db.query('SELECT status, type, is_suppli_visible_to_viewers FROM meetings WHERE id = $1', [meeting_id]);
            if (meetingRes.rows.length === 0) return next(new CustomError('Meeting not found', 404));
            meeting = meetingRes.rows[0];

            if (!isOperator) {
                if (meeting.status === 'draft') {
                    return next(new CustomError('Meeting not found', 404));
                }
                const restrictedType = viewerTypeRestriction(req.user);
                if (restrictedType && meeting.type !== restrictedType) {
                    return next(new CustomError('Meeting not found', 404));
                }
                if ((is_suppli === 'true' || is_suppli === true) && !meeting.is_suppli_visible_to_viewers) {
                    return res.status(200).json({ success: true, data: [] });
                }
            }
        }

        let query = `
            SELECT a.*, c.name AS category_name, c.serial AS category_serial, COALESCE(
                (SELECT json_agg(json_build_object('id', t.id, 'name', t.name) ORDER BY t.name)
                 FROM agenda_tags at2 JOIN tags t ON t.id = at2.tag_id WHERE at2.agenda_id = a.id),
                '[]'
            ) as tags
            FROM agenda a
            LEFT JOIN categories c ON c.id = a.category_id`;
        let params = [];

        if (meeting_id) {
            query += ' WHERE a.meeting_id = $1 AND (a.is_archived = false OR a.is_archived IS NULL)';
            params.push(meeting_id);

            if (is_suppli !== undefined) {
                query += ' AND a.is_suppli = $2';
                params.push(is_suppli === 'true');
            } else if (!isOperator && !meeting.is_suppli_visible_to_viewers) {
                query += ' AND a.is_suppli = false';
            }

            query += ' ORDER BY a.is_suppli ASC, a.agenda_serial ASC';
        } else if (req.user?.role === 'viewer') {
            const restrictedType = viewerTypeRestriction(req.user);
            query += ' JOIN meetings m ON m.id = a.meeting_id WHERE m.status != \'draft\' AND (a.is_archived = false OR a.is_archived IS NULL)';
            if (restrictedType) {
                params.push(restrictedType);
                query += ` AND m.type = $${params.length}`;
            }
            query += ' ORDER BY a.created_at DESC';
        } else {
            query += ' WHERE (a.is_archived = false OR a.is_archived IS NULL) ORDER BY a.created_at DESC';
        }

        const result = await db.query(query, params);
        res.status(200).json({ success: true, data: result.rows });
    } catch (error) {
        next(error);
    }
};

const createAgendam = async (req, res, next) => {
    try {
        const { meeting_id, agenda_serial, content, is_executed, execution_status, is_suppli, tag_ids, meeting_criteria, category_id } = req.body;

        if (!meeting_id) {
            return next(new CustomError('meeting_id is required', 400));
        }

        const meetingCheck = await db.query('SELECT is_regular FROM meetings WHERE id = $1', [meeting_id]);
        const isImmediateMeeting = meetingCheck.rows.length > 0 && meetingCheck.rows[0].is_regular === false;

        if ((meeting_criteria === 'emergency' || isImmediateMeeting) && !is_suppli) {
            const existing = await db.query(
                'SELECT COUNT(*) FROM agenda WHERE meeting_id = $1 AND is_suppli = false',
                [meeting_id]
            );
            if (parseInt(existing.rows[0].count, 10) >= 1) {
                return next(new CustomError('Emergency meetings can only have 1 agendum.', 400));
            }
        }

        const requestedSerial = parseInt(agenda_serial, 10);
        const targetSuppli = is_suppli === true || is_suppli === 'true';

        if (isImmediateMeeting && targetSuppli) {
            return next(new CustomError('Immediate meetings cannot have supplementary agendas.', 400));
        }

        if (!Number.isNaN(requestedSerial)) {
            await db.query(
                'UPDATE agenda SET agenda_serial = agenda_serial + 1 WHERE meeting_id = $1 AND is_suppli = $2 AND agenda_serial >= $3',
                [meeting_id, targetSuppli, requestedSerial]
            );
        }

        const cleanedContent = stripProposalPrefix(content || '');
        const result = await db.query(
            'INSERT INTO agenda (meeting_id, agenda_serial, content, is_executed, execution_status, is_suppli, category_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
            [meeting_id, requestedSerial || 1, cleanedContent, is_executed || 'no', execution_status, targetSuppli, category_id || null]
        );
        const agendam = result.rows[0];

        if (!targetSuppli) {
            await ensureBibidhaAgenda(meeting_id);
        }

        await setAgendaTags(agendam.id, tag_ids);

        res.status(201).json({ success: true, message: 'Agendam created', data: agendam });

        if (cleanedContent) indexAgendaContent(agendam.id, cleanedContent).catch(() => { });
    } catch (error) {
        next(error);
    }
};

const updateAgendam = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { agenda_serial, content, is_executed, execution_status, tag_ids, category_id } = req.body;

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

        const hasCategory = category_id !== undefined;
        const catVal = category_id || null;
        const cleanedUpdatedContent = content !== undefined ? stripProposalPrefix(content) : undefined;

        const result = await db.query(
            `UPDATE agenda
             SET agenda_serial = COALESCE($1, agenda_serial),
                 content = COALESCE($2, content),
                 is_executed = COALESCE($3, is_executed),
                 execution_status = COALESCE($4, execution_status),
                 category_id = CASE WHEN $5::boolean THEN $6::uuid ELSE category_id END
             WHERE id = $7 RETURNING *`,
            [agenda_serial, cleanedUpdatedContent, is_executed, execution_status, hasCategory, catVal, id]
        );

        if (result.rows.length === 0) {
            return next(new CustomError('Agendam not found', 404));
        }
        const agendam = result.rows[0];

        if (!agendam.is_suppli) {
            await ensureBibidhaAgenda(agendam.meeting_id);
        }

        await setAgendaTags(id, tag_ids);

        res.status(200).json({ success: true, message: 'Agendam updated', data: agendam });

        if (content !== undefined) indexAgendaContent(id, content).catch(() => { });
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

        const agendaRes = await db.query('SELECT meeting_id FROM agenda WHERE id = $1', [id]);
        if (agendaRes.rows.length === 0) return next(new CustomError('Agenda not found', 404));
        const meetingId = agendaRes.rows[0].meeting_id;

        const meetingRes = await db.query('SELECT status, type FROM meetings WHERE id = $1', [meetingId]);
        if (meetingRes.rows.length === 0) return next(new CustomError('Meeting not found', 404));
        const meeting = meetingRes.rows[0];

        if (req.user?.role === 'viewer') {
            if (meeting.status === 'draft') {
                return next(new CustomError('Meeting not found', 404));
            }
            const restrictedType = viewerTypeRestriction(req.user);
            if (restrictedType && meeting.type !== restrictedType) {
                return next(new CustomError('Meeting not found', 404));
            }
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
            indexAgendaContent(id, restoredText).catch(() => { });
        } else {
            indexResolutionContent(id, restoredText).catch(() => { });
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

        const annexuresRes = await db.query('SELECT file_path FROM annexures WHERE content_id = $1', [id]);
        const filePaths = annexuresRes.rows.map(r => r.file_path).filter(Boolean);

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

        await ensureBibidhaAgenda(meeting_id);

        await db.query('COMMIT');

        for (const filePath of filePaths) {
            try {
                await storageService.deleteFile(filePath);
            } catch (err) {
                console.error("Failed to delete annexure file from storage on agenda delete:", err);
            }
        }

        await db.query('DELETE FROM search_cache');
        res.status(200).json({ success: true, message: 'Agendam deleted' });
    } catch (error) {
        await db.query('ROLLBACK');
        next(error);
    }
};

const getResolutions = async (req, res, next) => {
    try {
        const meeting_id = req.query.meeting_id;

        if (meeting_id) {
            const meetingRes = await db.query('SELECT status, type FROM meetings WHERE id = $1', [meeting_id]);
            if (meetingRes.rows.length === 0) return next(new CustomError('Meeting not found', 404));
            const meeting = meetingRes.rows[0];

            if (req.user?.role === 'viewer') {
                if (meeting.status === 'draft') {
                    return next(new CustomError('Meeting not found', 404));
                }
                const restrictedType = viewerTypeRestriction(req.user);
                if (restrictedType && meeting.type !== restrictedType) {
                    return next(new CustomError('Meeting not found', 404));
                }
            }
        }

        let query = 'SELECT a.id, a.meeting_id, a.agenda_serial, a.resolution, a.is_executed, a.execution_status, a.is_submitted_for_next_meeting, a.resolution_status FROM agenda a WHERE a.resolution IS NOT NULL';
        let params = [];

        if (meeting_id) {
            query += ' AND a.meeting_id = $1 ORDER BY a.agenda_serial ASC';
            params.push(meeting_id);
        } else if (req.user?.role === 'viewer') {
            const restrictedType = viewerTypeRestriction(req.user);
            query += ' JOIN meetings m ON m.id = a.meeting_id WHERE m.status != \'draft\'';
            if (restrictedType) {
                params.push(restrictedType);
                query += ` AND m.type = $${params.length}`;
            }
            query += ' ORDER BY a.agenda_serial ASC';
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

        const cleanedResolution = stripResolutionPrefix(resolution);

        await snapshotResolutionRevision(agendamId, req.user?.id);

        const result = await db.query(
            'UPDATE agenda SET resolution = $1 WHERE id = $2 RETURNING *',
            [cleanedResolution, agendamId]
        );

        if (result.rows.length === 0) return next(new CustomError('Agendam not found', 404));

        await setAgendaTags(agendamId, tag_ids);

        res.status(201).json({ success: true, message: 'Resolution created', data: result.rows[0] });

        indexResolutionContent(agendamId, cleanedResolution).catch(() => { });
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

        const cleanedResolution = stripResolutionPrefix(resolution);

        await snapshotResolutionRevision(agendamId, req.user?.id);

        const result = await db.query(
            'UPDATE agenda SET resolution = $1 WHERE id = $2 RETURNING *',
            [cleanedResolution, agendamId]
        );

        if (result.rows.length === 0) return next(new CustomError('Resolution/Agendam not found', 404));

        await setAgendaTags(agendamId, tag_ids);

        res.status(200).json({ success: true, message: 'Resolution updated', data: result.rows[0] });

        indexResolutionContent(agendamId, resolution).catch(() => { });
    } catch (error) {
        next(error);
    }
};

// Single-select resolution status: exactly one of
// 'not_executed' | 'executed' | 'submitted' | 'custom' may be active.
// Every status carries its own display text in `execution_status` (prefilled
// with the default below, editable in UI, rendered as-is in the
// resolution-status PDF). Flags stay the source of truth for which radio is
// selected: submitted=(false,text,true + archive copy),
// executed=(true,text,false), not_executed/custom=(false,text,false).
const STATUS_DEFAULTS = {
    not_executed: 'অবাস্তবায়িত',
    executed: 'বাস্তবায়িত',
    submitted: 'পরবর্তী মিটিং এ উপস্থাপনের জন্য আবেদন করা হল',
    custom: ''
};
const hasCustomText = (val) => {
    if (!val) return false;
    const plain = String(val).replace(/<[^>]*>/g, '').trim();
    return plain.length > 0;
};

const deleteArchiveCopies = async (client, agenda) => {
    await client.query(
        `DELETE FROM agenda WHERE meeting_id = $1 AND is_suppli = $2 AND is_archived = true AND content IS NOT DISTINCT FROM (SELECT content FROM agenda WHERE id = $3) AND resolution IS NOT DISTINCT FROM (SELECT resolution FROM agenda WHERE id = $3)`,
        [agenda.meeting_id, agenda.is_suppli, agenda.id]
    );
};

const deriveStatusFromBody = (body) => {
    if (body.status) {
        const s = String(body.status).toLowerCase();
        if (['not_executed', 'not-executed', 'notexecuted', 'no'].includes(s)) return 'not_executed';
        if (['executed', 'yes'].includes(s)) return 'executed';
        if (['submitted', 'submit_for_next_meeting', 'submit-for-next-meeting', 'next'].includes(s)) return 'submitted';
        if (['custom'].includes(s)) return 'custom';
    }
    // Legacy shape: { is_executed, execution_status, is_submitted_for_next_meeting }
    if (body.is_submitted_for_next_meeting === true || body.is_submitted_for_next_meeting === 'true') return 'submitted';
    if (hasCustomText(body.execution_status)) return 'custom';
    if (body.is_executed === true || body.is_executed === 'yes' || body.is_executed === 't' || body.is_executed === 'true' || body.is_executed === 1) return 'executed';
    if (body.is_executed === false || body.is_executed === 'no' || body.is_executed === 'false' || body.is_executed === 0) return 'not_executed';
    return null;
};

const updateExecutionStatus = async (req, res, next) => {
    try {
        const agendamId = req.params.resId;
        const derived = deriveStatusFromBody(req.body || {});
        if (!derived) return next(new CustomError('status is required (not_executed | executed | submitted | custom)', 400));

        const existingRes = await db.query('SELECT * FROM agenda WHERE id = $1', [agendamId]);
        if (existingRes.rows.length === 0) return next(new CustomError('Resolution/Agenda not found', 404));
        const agenda = existingRes.rows[0];

        // Every status must carry non-blank display text. If the caller sends
        // an explicit (but blank) execution_status, reject; if it sends none
        // at all (legacy caller), fall back to the status default.
        const sentText = req.body.execution_status;
        const sentBlank = sentText !== undefined && !hasCustomText(sentText);
        if (derived === 'custom' && !hasCustomText(sentText)) {
            return next(new CustomError('execution_status text is required for custom status', 400));
        }
        if (derived !== 'custom' && sentBlank) {
            return next(new CustomError('status text cannot be blank', 400));
        }
        const resolvedText = hasCustomText(sentText) ? sentText : STATUS_DEFAULTS[derived];

        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');

            if (derived === 'submitted') {
                if (!agenda.is_submitted_for_next_meeting) {
                    await client.query(
                        `INSERT INTO agenda (content, content_plain, resolution, resolution_plain,
                            is_executed, execution_status, agenda_serial, meeting_id,
                            is_suppli, is_archived, category_id)
                         VALUES ($1, $2, $3, $4, false, NULL, $5, $6, $7, true, $8)`,
                        [
                            agenda.content, agenda.content_plain,
                            agenda.resolution, agenda.resolution_plain,
                            0, agenda.meeting_id,
                            agenda.is_suppli, agenda.category_id
                        ]
                    );
                }
                await client.query(
                    "UPDATE agenda SET is_executed = false, execution_status = $1, is_submitted_for_next_meeting = true, resolution_status = 'submitted' WHERE id = $2",
                    [resolvedText, agendamId]
                );
            } else {
                // Leaving submitted state removes the corresponding archive
                // copy (best-effort: if it was already removed from the
                // archive list, the DELETE matches 0 rows and we just unmark).
                if (agenda.is_submitted_for_next_meeting) {
                    await deleteArchiveCopies(client, agenda);
                }
                if (derived === 'executed') {
                    await client.query(
                        "UPDATE agenda SET is_executed = true, execution_status = $1, is_submitted_for_next_meeting = false, resolution_status = 'executed' WHERE id = $2",
                        [resolvedText, agendamId]
                    );
                } else if (derived === 'custom') {
                    await client.query(
                        "UPDATE agenda SET is_executed = false, execution_status = $1, is_submitted_for_next_meeting = false, resolution_status = 'custom' WHERE id = $2",
                        [resolvedText, agendamId]
                    );
                } else {
                    await client.query(
                        "UPDATE agenda SET is_executed = false, execution_status = $1, is_submitted_for_next_meeting = false, resolution_status = 'not_executed' WHERE id = $2",
                        [resolvedText, agendamId]
                    );
                }
            }

            await client.query('COMMIT');
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }

        const result = await db.query('SELECT * FROM agenda WHERE id = $1', [agendamId]);
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

        const agendaRes = await db.query('SELECT meeting_id FROM agenda WHERE id = $1', [id]);
        if (agendaRes.rows.length === 0) return next(new CustomError('Agenda not found', 404));
        const meetingId = agendaRes.rows[0].meeting_id;

        const meetingRes = await db.query('SELECT status, type FROM meetings WHERE id = $1', [meetingId]);
        if (meetingRes.rows.length === 0) return next(new CustomError('Meeting not found', 404));
        const meeting = meetingRes.rows[0];

        if (req.user?.role === 'viewer') {
            if (meeting.status === 'draft') {
                return next(new CustomError('Meeting not found', 404));
            }
            const restrictedType = viewerTypeRestriction(req.user);
            if (restrictedType && meeting.type !== restrictedType) {
                return next(new CustomError('Meeting not found', 404));
            }
        }

        const isResolutionType = req.query.type === 'resolution' || type === 'resolution';
        const resolutionFilter = isResolutionType
            ? ' AND prev_an.is_excluded_in_resolution = false'
            : " AND (prev_an.annexure_type IS NULL OR prev_an.annexure_type != 'resolution')";
        const isSuppliFilter = isResolutionType
            ? ''
            : ' AND prev_a.is_suppli = a.is_suppli';

        if (type === 'agenda') type = 'agendaItem';

        let query = `SELECT an.*, a.is_suppli, u.username AS uploaded_by_username,
                            (
                               SELECT COUNT(*)::int
                               FROM annexures prev_an
                               JOIN agenda prev_a ON prev_a.id = prev_an.content_id
                               WHERE prev_a.meeting_id = a.meeting_id
                                 ${isSuppliFilter}
                                 ${resolutionFilter}
                                 AND (
                                   (prev_a.is_suppli, prev_a.agenda_serial, prev_an.annexure_serial) <
                                   (a.is_suppli, a.agenda_serial, an.annexure_serial)
                                 )
                             ) + 1 AS global_serial
                      FROM annexures an
                      JOIN agenda a ON a.id = an.content_id
                      LEFT JOIN users u ON u.id = an.uploaded_by
                      WHERE an.content_id = $1`;
        let params = [id];

        query += ' ORDER BY an.annexure_serial ASC';

        const result = await db.query(query, [id]);

        // Generate presigned URLs for each file
        const annexures = await Promise.all(result.rows.map(async (annexure) => {
            if (annexure.file_path) {
                try {
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

        if (annexure_type === 'agenda') {
            annexure_type = 'agendaItem';
        }

        if (!id || !annexure_type || !file) {
            return next(new CustomError('content_id, annexure_type, and file are required', 400));
        }

        // Fetch meeting's configured max annexure size limit
        const meetingRes = await db.query(
            'SELECT m.max_annexure_size_mb FROM agenda a JOIN meetings m ON a.meeting_id = m.id WHERE a.id = $1',
            [id]
        );
        const limitMb = (meetingRes.rows.length > 0 && meetingRes.rows[0].max_annexure_size_mb)
            ? parseInt(meetingRes.rows[0].max_annexure_size_mb, 10)
            : 50;

        const maxSizeBytes = limitMb * 1024 * 1024;
        if (file.size > maxSizeBytes) {
            const formattedLimit = limitMb >= 1024
                ? (limitMb / 1024).toFixed(limitMb % 1024 === 0 ? 0 : 1) + ' GB'
                : `${limitMb} MB`;
            return next(new CustomError(`Failed: Annexure size limit (${formattedLimit}) exceeded`, 400));
        }

        // Derive extension — fall back to MIME type if originalname has no real ext (e.g. 'blob')
        let ext = (file.originalname.split('.').pop() || '').toLowerCase();
        if (!ext || ext === 'blob' || file.originalname === 'blob') {
            const mime = (file.mimetype || '').toLowerCase();
            if (mime === 'application/zip' || mime === 'application/x-zip-compressed') ext = 'zip';
            else if (mime === 'application/pdf') ext = 'pdf';
            else ext = 'bin';
        }
        // Use a meaningful stored filename: prefer originalname unless it's the raw 'blob' default
        const storedName = (file.originalname && file.originalname !== 'blob')
            ? file.originalname
            : `upload.${ext}`;
        const fileKey = `annexures/${id}/${crypto.randomBytes(8).toString('hex')}.${ext}`;

        await storageService.uploadFile(file.buffer, fileKey, file.mimetype);

        const maxSerialResult = await db.query(
            'SELECT COALESCE(MAX(annexure_serial), 0) as max_serial FROM annexures WHERE content_id = $1',
            [id]
        );
        const nextSerial = parseInt(maxSerialResult.rows[0].max_serial, 10) + 1;

        const isExcludedDefault = annexure_type === 'resolution' ? false : true;

        const result = await db.query(
            'INSERT INTO annexures (content_id, annexure_type, file_name, file_path, summary, annexure_serial, uploaded_by, is_excluded_in_resolution) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *',
            [id, annexure_type, storedName, fileKey, summary || '', nextSerial, req.user?.id || null, isExcludedDefault]
        );

        // Sync annexure to filesystem
        const agendaRes = await db.query('SELECT meeting_id FROM agenda WHERE id = $1', [id]);
        if (agendaRes.rows.length > 0) {
            await meetingFileSystem.syncMeetingAnnexures(agendaRes.rows[0].meeting_id);
        }

        res.status(201).json({ success: true, message: 'Annexure added successfully', data: result.rows[0] });
    } catch (error) {
        next(error);
    }
};

const deleteAnnexure = async (req, res, next) => {
    try {
        const { annexureId } = req.params;
        const { mode } = req.query;

        if (mode === 'resolution') {
            const { action } = req.query;
            let excludeVal;
            if (action === 'revoke' || action === 'include') {
                excludeVal = false;
            } else if (action === 'exclude') {
                excludeVal = true;
            } else {
                const curr = await db.query('SELECT is_excluded_in_resolution FROM annexures WHERE id = $1', [annexureId]);
                if (curr.rows.length === 0) return next(new CustomError('Annexure not found', 404));
                excludeVal = !curr.rows[0].is_excluded_in_resolution;
            }

            const updateResult = await db.query(
                'UPDATE annexures SET is_excluded_in_resolution = $1 WHERE id = $2 RETURNING *',
                [excludeVal, annexureId]
            );
            if (updateResult.rows.length === 0) return next(new CustomError('Annexure not found', 404));

            return res.status(200).json({
                success: true,
                message: excludeVal ? 'Annexure excluded from resolution' : 'Annexure restored in resolution',
                data: updateResult.rows[0]
            });
        }

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

        // Re-sequence remaining annexures for the content_id to close serial gaps
        await db.query(`
            WITH ranked AS (
                SELECT id, ROW_NUMBER() OVER (ORDER BY annexure_serial ASC) as new_serial
                FROM annexures
                WHERE content_id = $1
            )
            UPDATE annexures
            SET annexure_serial = ranked.new_serial
            FROM ranked
            WHERE annexures.id = ranked.id
        `, [deletedAnnexure.content_id]);

        // Sync filesystem meeting directory
        const agendaRes = await db.query('SELECT meeting_id FROM agenda WHERE id = $1', [deletedAnnexure.content_id]);
        if (agendaRes.rows.length > 0) {
            await meetingFileSystem.syncMeetingAnnexures(agendaRes.rows[0].meeting_id);
        }

        res.status(200).json({ success: true, message: 'Annexure deleted' });
    } catch (error) {
        next(error);
    }
};

const toggleAnnexureExclusion = async (req, res, next) => {
    try {
        const { annexureId } = req.params;
        const { action } = req.body || {};

        const curr = await db.query('SELECT is_excluded_in_resolution, content_id FROM annexures WHERE id = $1', [annexureId]);
        if (curr.rows.length === 0) return next(new CustomError('Annexure not found', 404));

        let excludeVal;
        if (action === 'revoke' || action === 'include') {
            excludeVal = false;
        } else if (action === 'exclude') {
            excludeVal = true;
        } else {
            excludeVal = !curr.rows[0].is_excluded_in_resolution;
        }

        const updateResult = await db.query(
            'UPDATE annexures SET is_excluded_in_resolution = $1 WHERE id = $2 RETURNING *',
            [excludeVal, annexureId]
        );

        const agendaRes = await db.query('SELECT meeting_id FROM agenda WHERE id = $1', [curr.rows[0].content_id]);
        if (agendaRes.rows.length > 0) {
            await meetingFileSystem.syncMeetingAnnexures(agendaRes.rows[0].meeting_id);
        }

        return res.status(200).json({
            success: true,
            message: excludeVal ? 'Annexure excluded from resolution' : 'Annexure restored in resolution',
            data: updateResult.rows[0]
        });
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
        let meetingIdToSync = null;
        try {
            await client.query('BEGIN');
            for (const item of items) {
                await client.query(
                    'UPDATE annexures SET annexure_serial = $1 WHERE id = $2',
                    [item.annexure_serial, item.id]
                );
            }
            await client.query('COMMIT');

            if (items.length > 0) {
                const checkRes = await db.query(
                    'SELECT a.meeting_id FROM annexures an JOIN agenda a ON a.id = an.content_id WHERE an.id = $1',
                    [items[0].id]
                );
                if (checkRes.rows.length > 0) {
                    meetingIdToSync = checkRes.rows[0].meeting_id;
                }
            }
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }

        if (meetingIdToSync) {
            await meetingFileSystem.syncMeetingAnnexures(meetingIdToSync);
        }

        res.status(200).json({ success: true, message: 'Reordered successfully' });
    } catch (error) {
        next(error);
    }
};

const getArchivedAgendams = async (req, res, next) => {
    try {
        const query = `
            SELECT a.*, 
                   m.title AS meeting_title, 
                   m.meeting_title AS meeting_display_title,
                   m.legacy_meeting_no AS meeting_number,
                   c.name AS category_name,
                   COALESCE(
                       (SELECT json_agg(json_build_object('id', t.id, 'name', t.name) ORDER BY t.name)
                        FROM agenda_tags at2 JOIN tags t ON t.id = at2.tag_id WHERE at2.agenda_id = a.id),
                       '[]'
                   ) as tags
            FROM agenda a
            LEFT JOIN meetings m ON m.id = a.meeting_id
            LEFT JOIN categories c ON c.id = a.category_id
            WHERE a.is_archived = true
            ORDER BY a.created_at DESC`;
        
        const result = await db.query(query);
        res.status(200).json({ success: true, data: result.rows });
    } catch (error) {
        next(error);
    }
};

const archiveAgendam = async (req, res, next) => {
    try {
        const { id } = req.params;
        const agendaRes = await db.query(
            'SELECT a.id, a.meeting_id, a.is_suppli, m.status, m.archive_locked_level FROM agenda a JOIN meetings m ON m.id = a.meeting_id WHERE a.id = $1',
            [id]
        );
        if (agendaRes.rows.length === 0) {
            return next(new CustomError('Agenda not found', 404));
        }
        const { meeting_id, is_suppli, status, archive_locked_level } = agendaRes.rows[0];

        if (archive_locked_level !== null && archive_locked_level !== undefined) {
            const userRoleLevel = req.user?.role_level ?? 99;
            const isSuperOrAdmin = req.user?.role === 'admin' || req.user?.role === 'superadmin';
            if (!isSuperOrAdmin && userRoleLevel > archive_locked_level) {
                return next(new CustomError('You do not have permission to archive agendas for this meeting.', 403));
            }
        }

        await db.query('UPDATE agenda SET is_archived = true WHERE id = $1', [id]);

        res.status(200).json({ success: true, message: 'Agendam archived successfully' });
    } catch (error) {
        next(error);
    }
};

const copyToArchive = async (req, res, next) => {
    try {
        const { id } = req.params;
        const agendaRes = await db.query(
            `SELECT a.*, m.status
             FROM agenda a JOIN meetings m ON m.id = a.meeting_id
             WHERE a.id = $1`,
            [id]
        );
        if (agendaRes.rows.length === 0) {
            return next(new CustomError('Agenda not found', 404));
        }
        const agenda = agendaRes.rows[0];

        if (agenda.is_submitted_for_next_meeting) {
            return next(new CustomError('This resolution has already been submitted for next meeting.', 400));
        }

        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');

            // 1. Create a copy of the agenda in the archive (fresh status: not executed)
            await client.query(
                `INSERT INTO agenda (content, content_plain, resolution, resolution_plain,
                    is_executed, execution_status, agenda_serial, meeting_id,
                    is_suppli, is_archived, category_id)
                 VALUES ($1, $2, $3, $4, false, NULL, $5, $6, $7, true, $8)`,
                [
                    agenda.content, agenda.content_plain,
                    agenda.resolution, agenda.resolution_plain,
                    0, agenda.meeting_id,
                    agenda.is_suppli, agenda.category_id
                ]
            );

            // 2. Mark the original as submitted — exclusive: store submitted default text
            await client.query(
                "UPDATE agenda SET is_executed = false, execution_status = $1, is_submitted_for_next_meeting = true, resolution_status = 'submitted' WHERE id = $2",
                [STATUS_DEFAULTS.submitted, id]
            );

            await client.query('COMMIT');
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }

        res.status(200).json({ success: true, message: 'Resolution submitted for next meeting' });
    } catch (error) {
        next(error);
    }
};

const removeFromArchive = async (req, res, next) => {
    try {
        const { id } = req.params;
        const agendaRes = await db.query(
            'SELECT a.id, a.is_submitted_for_next_meeting, a.meeting_id, a.is_suppli FROM agenda a WHERE a.id = $1',
            [id]
        );
        if (agendaRes.rows.length === 0) {
            return next(new CustomError('Agenda not found', 404));
        }
        const agenda = agendaRes.rows[0];

        if (!agenda.is_submitted_for_next_meeting) {
            return next(new CustomError('This resolution is not submitted for next meeting.', 400));
        }

        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');

            // 1. Delete the archived copy (is_archived=true, same meeting_id)
            await client.query(
                `DELETE FROM agenda WHERE meeting_id = $1 AND is_suppli = $2 AND is_archived = true AND content IS NOT DISTINCT FROM (SELECT content FROM agenda WHERE id = $3) AND resolution IS NOT DISTINCT FROM (SELECT resolution FROM agenda WHERE id = $3)`,
                [agenda.meeting_id, agenda.is_suppli, id]
            );

            // 2. Unmark the original — undo submit, fall back to Not executed default text
            await client.query(
                "UPDATE agenda SET is_executed = false, execution_status = $1, is_submitted_for_next_meeting = false, resolution_status = 'not_executed' WHERE id = $2",
                [STATUS_DEFAULTS.not_executed, id]
            );

            await client.query('COMMIT');
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }

        res.status(200).json({ success: true, message: 'Removed from archive for next meeting' });
    } catch (error) {
        next(error);
    }
};

const restoreArchivedAgendams = async (req, res, next) => {
    try {
        const { meetingId } = req.params;
        const { agenda_ids, is_suppli } = req.body;

        if (!Array.isArray(agenda_ids) || agenda_ids.length === 0) {
            return next(new CustomError('No agenda IDs provided for restoration', 400));
        }

        const meetingRes = await db.query(
            'SELECT status, archive_locked_level FROM meetings WHERE id = $1',
            [meetingId]
        );
        if (meetingRes.rows.length === 0) {
            return next(new CustomError('Target meeting not found', 404));
        }
        const { status, archive_locked_level } = meetingRes.rows[0];

        if (status !== 'draft') {
            return next(new CustomError('Agendas can only be added/restored to draft meetings.', 400));
        }

        if (archive_locked_level !== null && archive_locked_level !== undefined) {
            const userRoleLevel = req.user?.role_level ?? 99;
            const isSuperOrAdmin = req.user?.role === 'admin' || req.user?.role === 'superadmin';
            if (!isSuperOrAdmin && userRoleLevel > archive_locked_level) {
                return next(new CustomError('You do not have permission to restore agendas into this meeting.', 403));
            }
        }

        const targetSuppli = is_suppli === true || is_suppli === 'true';

        for (const agendaId of agenda_ids) {
            await db.query(
                'UPDATE agenda SET meeting_id = $1, is_archived = false, is_suppli = $2 WHERE id = $3',
                [meetingId, targetSuppli, agendaId]
            );
        }

        await reindexAgendas(meetingId, targetSuppli);
        await ensureBibidhaAgenda(meetingId);

        res.status(200).json({ success: true, message: `${agenda_ids.length} agenda(s) added from archive box successfully` });
    } catch (error) {
        next(error);
    }
};

const deleteArchivedAgendam = async (req, res, next) => {
    try {
        const { id } = req.params;
        const agendaRes = await db.query('SELECT id, is_archived FROM agenda WHERE id = $1', [id]);
        if (agendaRes.rows.length === 0) {
            return next(new CustomError('Archived agenda not found', 404));
        }
        if (!agendaRes.rows[0].is_archived) {
            return next(new CustomError('Agenda is not archived', 400));
        }

        const annexuresRes = await db.query('SELECT file_url FROM annexures WHERE content_id = $1', [id]);
        for (const row of annexuresRes.rows) {
            if (row.file_url) {
                await storageService.deleteFile(row.file_url).catch(() => {});
            }
        }

        await db.query('DELETE FROM agenda WHERE id = $1', [id]);
        res.status(200).json({ success: true, message: 'Archived agenda deleted permanently' });
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
    toggleAnnexureExclusion,
    reorderAnnexures,
    getRevisions,
    restoreRevision,
    getArchivedAgendams,
    archiveAgendam,
    copyToArchive,
    removeFromArchive,
    restoreArchivedAgendams,
    deleteArchivedAgendam
};

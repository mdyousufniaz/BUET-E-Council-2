const CustomError = require('../errors/CustomError');
const db = require('../db');
const bcrypt = require('bcryptjs');
const axios = require('axios');
const { generatePdf: generateMeetingPdf, generateMeetingDocx, generateAttendanceSheet, generateAttendanceDocxSheet } = require('../utils/pdfGenerator');
const storageService = require('../utils/storageService');
const meetingFileSystem = require('../utils/meetingFileSystem');
const { sendMail } = require('../utils/mailer');
const crypto = require('crypto');
const { indexAgendaContent, indexResolutionContent } = require('../utils/searchIndexer');
const { extractAgendaPrefix, parseAgendumBody } = require('../utils/agendaSerial');
const { loadMeeting, calculateMeetingAccess } = require('../middlewares/meetingWorkflowMiddleware');

// A viewer whose account is scoped to a specific member_type (academic/syndicate)
// only sees meetings of that type; 'none' (and every non-viewer role) sees both.
const viewerTypeRestriction = (user) => {
    if (user?.role !== 'viewer') return null;
    if (user?.member_type === 'syndicate' || user?.member_type === 'none' || !user?.member_type) return null;
    return 'academic';
};

const displayStageFor = (user, stage) => stage;

const meetingListFilter = (user) => {
    const conditions = [];
    const params = [];

    if (user?.role === 'viewer') {
        conditions.push("m.status != 'draft'");
    }

    const restrictedType = viewerTypeRestriction(user);
    if (restrictedType) {
        params.push(restrictedType);
        conditions.push(`m.type = $${params.length}`);
    }

    return {
        clause: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
        params,
    };
};

const getMeetings = async (req, res, next) => {
    try {
        const { clause, params } = meetingListFilter(req.user);
        const result = await db.query(`
            SELECT m.*,
                   u.username AS creator_username,
                   ROW_NUMBER() OVER (ORDER BY m.legacy_meeting_no DESC NULLS FIRST) as serial
            FROM meetings m
            LEFT JOIN users u ON u.id = m.created_by
            ${clause}
            ORDER BY m.legacy_meeting_no DESC NULLS FIRST
        `, params);

        const data = result.rows.map(meeting => ({
            ...meeting,
            date: new Date(meeting.meeting_date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
        }));

        res.status(200).json({ success: true, data });
    } catch (error) {
        next(error);
    }
};

const getMeetingById = async (req, res, next) => {
    try {
        const { id } = req.params;
        const result = await db.query(`
            SELECT m.*,
            u.username AS creator_username,
            (SELECT COUNT(*) FROM meetings m2
             WHERE m2.legacy_meeting_no IS NOT NULL AND m.legacy_meeting_no IS NOT NULL
               AND m2.legacy_meeting_no <= m.legacy_meeting_no) as serial
            FROM meetings m
            LEFT JOIN users u ON u.id = m.created_by
            WHERE m.id = $1
        `, [id]);

        if (result.rows.length === 0) {
            return next(new CustomError('Meeting not found', 404));
        }

        const meeting = result.rows[0];

        if (req.user?.role === 'viewer') {
            if (meeting.status === 'draft') {
                return next(new CustomError('Meeting not found', 404));
            }
            const restrictedType = viewerTypeRestriction(req.user);
            if (restrictedType && meeting.type !== restrictedType) {
                return next(new CustomError('Meeting not found', 404));
            }
        }

        meeting.date = new Date(meeting.meeting_date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
        meeting.access = calculateMeetingAccess(meeting, req.user);

        res.status(200).json({ success: true, data: meeting });
    } catch (error) {
        next(error);
    }
};

// Consolidated, chronological "who did what" history for a single meeting file
// (admin/superadmin only, enforced at the route). Merges the creation event,
// meeting-level audit logs (workflow + meeting-info edits), agenda/resolution
// content revisions, and annexure uploads.
const getMeetingHistory = async (req, res, next) => {
    try {
        const { id } = req.params;

        const meetingRes = await db.query(
            `SELECT m.created_at, u.username AS creator_username
             FROM meetings m LEFT JOIN users u ON u.id = m.created_by WHERE m.id = $1`,
            [id]
        );
        if (meetingRes.rows.length === 0) return next(new CustomError('Meeting not found', 404));

        const [auditRes, revisionRes, annexRes] = await Promise.all([
            db.query(
                `SELECT username, action, details, created_at FROM audit_logs
                 WHERE (entity_type = 'meeting' AND entity_id = $1::uuid)
                    OR (entity_type = 'agenda' AND entity_id IN (
                          SELECT id FROM agenda WHERE meeting_id = $1::uuid
                    ))
                 ORDER BY created_at DESC`,
                [id]
            ),
            db.query(
                `SELECT r.content_type, r.modified_at, u.username, a.agenda_serial, a.is_suppli
                 FROM revisions r
                 JOIN agenda a ON a.id = r.content_id
                 LEFT JOIN users u ON u.id = r.modified_by
                 WHERE a.meeting_id = $1`,
                [id]
            ),
            db.query(
                `SELECT an.file_name, an.upload_date, u.username, a.agenda_serial, a.is_suppli
                 FROM annexures an
                 JOIN agenda a ON a.id = an.content_id
                 LEFT JOIN users u ON u.id = an.uploaded_by
                 WHERE a.meeting_id = $1`,
                [id]
            ),
        ]);

        const agRef = (serial, suppli) => `${suppli ? 'Suppli Ag-' : 'Ag-'}${serial ?? '?'}`;

        const labelForAudit = (log) => {
            const path = log.details?.path || '';
            const fields = log.details?.fields;

            // Annexure actions
            if (path.includes('/annexures')) {
                if (path.includes('mode=resolution')) {
                    if (path.includes('action=revoke') || path.includes('action=include')) {
                        return 'Restored annexure in resolution';
                    }
                    return 'Excluded annexure from resolution';
                }
                if (path.includes('reorder')) return 'Reordered annexures';
                if (log.action === 'delete') return 'Deleted an annexure';
                if (log.action === 'create' || log.action === 'upload') return 'Uploaded an annexure';
            }

            // Handover actions
            if (path.includes('/handover-agenda')) return 'Handed over Main Agenda to upper levels';
            if (path.includes('/handover-suppli-agenda')) return 'Handed over Supplementary Agenda to upper levels';
            if (path.includes('/handover-resolution-status')) return 'Handed over Resolution Status to upper levels';
            if (path.includes('/handover-resolution')) return 'Handed over Resolution to upper levels';

            // Send back actions
            if (path.includes('/send-back-agenda')) return 'Sent back Main Agenda to lower level';
            if (path.includes('/send-back-suppli-agenda')) return 'Sent back Supplementary Agenda to lower level';
            if (path.includes('/send-back-resolution-status')) return 'Sent back Resolution Status to lower level';
            if (path.includes('/send-back-resolution')) return 'Sent back Resolution to lower level';

            // Lock actions
            if (path.includes('/lock-agenda')) return 'Locked Main Agenda';
            if (path.includes('/lock-suppli-agenda')) return 'Locked Supplementary Agenda';
            if (path.includes('/lock-resolution-status')) return 'Locked Resolution Status';
            if (path.includes('/lock-resolution')) return 'Locked Resolution';
            if (path.includes('/lock-meeting')) return 'Locked Meeting Info';
            if (path.includes('/lock-invitees')) return 'Locked Invitees';
            if (path.includes('/lock-presentees')) return 'Locked Presentees';
            if (path.includes('/lock-conclusion')) return 'Locked Conclusion';

            // Unlock actions
            if (path.includes('/unlock-agenda')) return 'Unlocked Main Agenda';
            if (path.includes('/unlock-suppli-agenda')) return 'Unlocked Supplementary Agenda';
            if (path.includes('/unlock-resolution-status')) return 'Unlocked Resolution Status';
            if (path.includes('/unlock-resolution')) return 'Unlocked Resolution';
            if (path.includes('/unlock-meeting')) return 'Unlocked Meeting Info';
            if (path.includes('/unlock-invitees')) return 'Unlocked Invitees';
            if (path.includes('/unlock-presentees')) return 'Unlocked Presentees';
            if (path.includes('/unlock-conclusion')) return 'Unlocked Conclusion';

            // Legacy & workflow actions
            if (path.includes('/submit-resolution')) return 'Submitted the resolution up the chain';
            if (path.includes('/return-resolution')) return 'Sent the resolution back';
            if (path.includes('/approve-resolution')) return 'Approved the resolution';
            if (path.includes('/reopen-resolution')) return 'Reopened the resolution';
            if (path.includes('/submit')) return 'Submitted the file up the chain';
            if (path.includes('/approve')) return 'Approved the agenda';
            if (path.includes('/return')) return 'Sent the file back';
            if (path.includes('/complete')) return 'Marked the meeting completed';
            if (path.includes('/materials')) return 'Uploaded a material PDF';
            if (path.includes('/attendance')) return 'Saved attendance';
            if (path.includes('/invitees')) return `${log.action} invitee`;
            if (path.includes('/presentees')) return `${log.action} presentee`;
            if (log.action === 'update') {
                return fields && fields.length ? `Edited meeting info (${fields.join(', ')})` : 'Edited meeting info';
            }
            if (log.action === 'delete') return 'Deleted the meeting';
            return `${log.action} meeting`;
        };

        const events = [{
            at: meetingRes.rows[0].created_at,
            username: meetingRes.rows[0].creator_username || 'Unknown',
            kind: 'created',
            label: 'Created the meeting file',
        }];

        for (const log of auditRes.rows) {
            events.push({ at: log.created_at, username: log.username || 'Unknown', kind: 'workflow', label: labelForAudit(log) });
        }
        for (const r of revisionRes.rows) {
            const what = r.content_type === 'resolutionItem' ? 'resolution' : 'agenda content';
            events.push({ at: r.modified_at, username: r.username || 'Unknown', kind: 'content', label: `Edited ${what} of ${agRef(r.agenda_serial, r.is_suppli)}` });
        }
        for (const an of annexRes.rows) {
            events.push({ at: an.upload_date, username: an.username || 'Unknown', kind: 'annexure', label: `Uploaded annexure "${an.file_name}" to ${agRef(an.agenda_serial, an.is_suppli)}` });
        }

        events.sort((a, b) => new Date(b.at) - new Date(a.at));
        res.status(200).json({ success: true, data: events });
    } catch (error) {
        next(error);
    }
};

const createMeeting = async (req, res, next) => {
    try {
        const { title, meeting_title, meeting_date, type, status, is_regular } = req.body;
        if (!title || !meeting_date || !type) {
            return next(new CustomError('Title (serial), date, and type are required', 400));
        }

        // Syndicate meetings must always be regular (not emergency)
        const effectiveIsRegular = type === 'syndicate' ? true : (is_regular !== undefined ? is_regular : true);

        const result = await db.query(
            `INSERT INTO meetings (title, meeting_title, meeting_date, type, status, is_regular, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [title, meeting_title || null, meeting_date, type, status || 'draft', effectiveIsRegular, req.user?.id || null]
        );

        const newMeeting = result.rows[0];
        meetingFileSystem.createMeetingDir(newMeeting);

        // Insert default main agenda "বিবিধ :" only for regular meetings
        if (effectiveIsRegular) {
            await db.query(
                `INSERT INTO agenda (meeting_id, agenda_serial, content, is_suppli) VALUES ($1, 1, 'বিবিধ :', false)`,
                [newMeeting.id]
            );
        }

        res.status(201).json({ success: true, message: 'Meeting created', data: newMeeting });
    } catch (error) {
        next(error);
    }
};

const updateMeeting = async (req, res, next) => {
    const client = await db.pool.connect();
    try {
        const { id } = req.params;
        let { title, meeting_title, description, conclusion, meeting_date, type, status, meeting_link, agenda_pdf_link, resolution_pdf_link, transcript, agenda_prefix, max_annexure_size_mb, is_suppli_visible_to_viewers, is_regular, archive_locked_level } = req.body;

        const meeting = await loadMeeting(req);
        if (!meeting) return next(new CustomError('Meeting not found', 404));

        const isUserAdmin = isAdminRole(req.user);
        let isUserDeputyOrAbove = isUserAdmin;
        if (!isUserDeputyOrAbove && req.user?.role_level !== null && req.user?.role_level !== undefined) {
            const depRoleRes = await client.query("SELECT level FROM roles WHERE LOWER(level_title) LIKE '%deputy registrar%' LIMIT 1");
            const minLevel = depRoleRes.rows.length > 0 ? depRoleRes.rows[0].level : 2;
            if (Number(req.user.role_level) >= minLevel) {
                isUserDeputyOrAbove = true;
            }
        }

        const access = calculateMeetingAccess(meeting, req.user);
        if (!access.canEditMeeting) {
            return next(new CustomError('You do not have permission to edit Meeting Info.', 403));
        }

        await client.query('BEGIN');

        // Syndicate meetings must always be regular (not emergency)
        const effectiveType = type || meeting.type;
        if (effectiveType === 'syndicate') {
            is_regular = true;
        }

        if (is_suppli_visible_to_viewers !== undefined && is_suppli_visible_to_viewers !== null && !isUserDeputyOrAbove) {
            await client.query('ROLLBACK');
            return next(new CustomError('Only Deputy Registrar & Above can change supplementary agenda viewer visibility.', 403));
        }

        if (status && status !== meeting.status && (status === 'ongoing' || status === 'past')) {
            const settingRes = await client.query("SELECT value FROM system_settings WHERE key = 'min_completed_level'");
            const minLevel = settingRes.rows.length > 0 ? parseInt(settingRes.rows[0].value, 10) : 1;
            const userLevel = req.user?.role_level !== null && req.user?.role_level !== undefined ? parseInt(req.user.role_level, 10) : 0;
            if (!isUserAdmin && userLevel < minLevel) {
                await client.query('ROLLBACK');
                return next(new CustomError('You are not eligible to change meeting status.', 403));
            }
        }

        if (status && status === 'past') {
            await client.query(
                `UPDATE meetings SET is_completed = TRUE, completed_at = COALESCE(completed_at, NOW()), completed_by = COALESCE(completed_by, $1) WHERE id = $2`,
                [req.user?.id || null, id]
            );
        } else if (status && (status === 'draft' || status === 'ongoing')) {
            await client.query(
                `UPDATE meetings SET is_completed = FALSE WHERE id = $1`,
                [id]
            );
        }

        // Validate max_annexure_size_mb if provided (range 2 MB to 10240 MB)
        let validMaxAnnexureSize = null;
        if (max_annexure_size_mb !== undefined && max_annexure_size_mb !== null) {
            const parsedMb = parseInt(max_annexure_size_mb, 10);
            if (!isNaN(parsedMb) && parsedMb >= 2 && parsedMb <= 10240) {
                validMaxAnnexureSize = parsedMb;
            }
        }

        let parsedArchiveLockLevel = null;
        let isArchiveLockExplicitNull = false;
        if (archive_locked_level === null || archive_locked_level === 'null' || archive_locked_level === '') {
            isArchiveLockExplicitNull = true;
        } else if (archive_locked_level !== undefined) {
            parsedArchiveLockLevel = parseInt(archive_locked_level, 10);
        }

        const result = await client.query(
            `UPDATE meetings SET
                title = COALESCE($1, title),
                meeting_title = COALESCE($2, meeting_title),
                description = COALESCE($3, description),
                conclusion = COALESCE($4, conclusion),
                meeting_date = COALESCE($5, meeting_date),
                type = COALESCE($6, type),
                status = COALESCE($7, status),
                meeting_link = COALESCE($8, meeting_link),
                agenda_pdf_link = COALESCE($9, agenda_pdf_link),
                resolution_pdf_link = COALESCE($10, resolution_pdf_link),
                transcript = COALESCE($11, transcript),
                agenda_prefix = COALESCE($12, agenda_prefix),
                max_annexure_size_mb = COALESCE($13, max_annexure_size_mb),
                is_suppli_visible_to_viewers = COALESCE($14, is_suppli_visible_to_viewers),
                is_regular = COALESCE($15, is_regular),
                archive_locked_level = CASE WHEN $17 = true THEN NULL ELSE COALESCE($16, archive_locked_level) END
             WHERE id = $18 RETURNING *`,
            [title, meeting_title, description, conclusion, meeting_date, type, status, meeting_link, agenda_pdf_link, resolution_pdf_link, transcript, agenda_prefix, validMaxAnnexureSize, is_suppli_visible_to_viewers !== undefined ? !!is_suppli_visible_to_viewers : null, is_regular !== undefined ? !!is_regular : null, parsedArchiveLockLevel, isArchiveLockExplicitNull, id]
        );

        if (is_regular === false) {
            await client.query(
                "DELETE FROM agenda WHERE meeting_id = $1 AND is_suppli = false AND (content = 'বিবিধ :' OR content = 'বিবিধ' OR TRIM(content) = 'বিবিধ :')",
                [id]
            );
            await client.query(
                "DELETE FROM agenda WHERE meeting_id = $1 AND is_suppli = true",
                [id]
            );
        }

        await client.query('COMMIT');

        // Sync filesystem directory & status PDFs
        await meetingFileSystem.syncMeetingStatusPdfs(id, { generatePdf: generateMeetingPdf });

        res.status(200).json({ success: true, message: 'Meeting updated successfully', data: result.rows[0] });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        next(error);
    } finally {
        client.release();
    }
};

const updateOnlineMeetingLink = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { online_meeting_link } = req.body;

        const meeting = await loadMeeting(req);
        if (!meeting) return next(new CustomError('Meeting not found', 404));

        const access = calculateMeetingAccess(meeting, req.user);
        if (!access.canEditMeeting) {
            return next(new CustomError('Meeting info is locked. Online meeting link cannot be modified.', 403));
        }

        const result = await db.query(
            'UPDATE meetings SET online_meeting_link = $1 WHERE id = $2 RETURNING *',
            [online_meeting_link || null, id]
        );

        res.status(200).json({ success: true, message: 'Online meeting link updated', data: result.rows[0] });
    } catch (error) {
        next(error);
    }
};

const deleteMeeting = async (req, res, next) => {
    try {
        const { id } = req.params;

        const annexuresRes = await db.query(
            `SELECT an.file_path
             FROM annexures an
             JOIN agenda a ON a.id = an.content_id
             WHERE a.meeting_id = $1`,
            [id]
        );
        const filePaths = annexuresRes.rows.map(r => r.file_path).filter(Boolean);

        const result = await db.query('DELETE FROM meetings WHERE id = $1 RETURNING *', [id]);
        if (result.rows.length === 0) return next(new CustomError('Meeting not found', 404));

        const deletedMeeting = result.rows[0];

        // Remove meeting folder from filesystem
        meetingFileSystem.deleteMeetingDir(deletedMeeting);

        for (const filePath of filePaths) {
            try {
                await storageService.deleteFile(filePath);
            } catch (err) {
                console.error("Failed to delete annexure file from storage on meeting delete:", err);
            }
        }

        res.status(200).json({ success: true, message: 'Meeting deleted' });
    } catch (error) {
        next(error);
    }
};

// --- File approval workflow --------------------------------------------------

const isMeetingOwner = (meeting, user) =>
    meeting.created_by && user && String(meeting.created_by) === String(user.id);

const isAdminRole = (user) => user && (user.role === 'admin' || user.role === 'superadmin');

// Forward the file one step UP the escalation chain. From the initiator it goes
// to whoever last granted edit access (return_source): the moderator by default,
// or straight back to the admin if an admin handed it down. From the moderator it
// escalates to the admin. Submitting up clears the pending send-back notes.
//
// admin/superadmin never submit: they sit at the top of the chain and approve
// directly, so there is nobody above them to send a file to.
const submitMeeting = async (req, res, next) => {
    try {
        const { id } = req.params;

        if (isAdminRole(req.user)) {
            return next(new CustomError(
                'Admins and superadmins approve files directly — there is nobody above them to submit to.', 403));
        }

        const check = await db.query('SELECT created_by, stage, return_source FROM meetings WHERE id = $1', [id]);
        if (check.rows.length === 0) return next(new CustomError('Meeting not found', 404));

        const meeting = check.rows[0];
        let nextStage;

        if (meeting.stage === 'initiator') {
            if (!isMeetingOwner(meeting, req.user)) {
                return next(new CustomError('Only the initiator who created this file can submit it.', 403));
            }
            // Re-submit to whoever granted access; a fresh file goes to the moderator.
            nextStage = meeting.return_source === 'admin' ? 'admin' : 'moderator';
        } else if (meeting.stage === 'moderator') {
            if (req.user?.role !== 'moderator') {
                return next(new CustomError('Only a moderator can escalate this file to the admin.', 403));
            }
            nextStage = 'admin';
        } else {
            return next(new CustomError(`This file cannot be submitted while it is at the "${meeting.stage}" stage.`, 409));
        }

        const result = await db.query(
            `UPDATE meetings
             SET stage = $2, return_source = NULL, moderator_note = NULL, admin_note = NULL,
                 submitted_at = NOW(), reviewed_by = $3, reviewed_at = NOW()
             WHERE id = $1 RETURNING *`,
            [id, nextStage, req.user?.id || null]
        );
        res.status(200).json({ success: true, message: `Meeting file submitted to the ${nextStage}`, data: result.rows[0] });
    } catch (error) {
        next(error);
    }
};

// admin/superadmin gives final approval. They are the approving authority, so
// they can approve a file at ANY stage — normally one the moderator escalated to
// them, but also one they authored themselves (which never leaves the initiator
// stage, since admins have no one to submit to). Once approved only
// admin/superadmin can edit it (enforced in the workflow gate).
const approveMeeting = async (req, res, next) => {
    try {
        const { id } = req.params;
        const check = await db.query('SELECT stage FROM meetings WHERE id = $1', [id]);
        if (check.rows.length === 0) return next(new CustomError('Meeting not found', 404));
        if (check.rows[0].stage === 'approved') {
            return next(new CustomError('This file has already been approved.', 409));
        }

        // Approving the agenda is what starts the meeting: the status flips to
        // 'ongoing' on its own (nobody picks it by hand any more) and the
        // resolution chain opens at its first stage.
        const result = await db.query(
            `UPDATE meetings
             SET stage = 'approved', return_source = NULL, moderator_note = NULL, admin_note = NULL,
                 status = CASE WHEN status = 'past' THEN status ELSE 'ongoing' END,
                 resolution_stage = 'initiator', resolution_return_source = NULL,
                 resolution_moderator_note = NULL, resolution_admin_note = NULL,
                 reviewed_by = $2, reviewed_at = NOW()
             WHERE id = $1 RETURNING *`,
            [id, req.user?.id || null]
        );
        res.status(200).json({ success: true, message: 'Agenda approved — the meeting is now ongoing', data: result.rows[0] });
    } catch (error) {
        next(error);
    }
};

// Hand the file back DOWN the chain, with an optional note explaining what to fix.
//   - admin/superadmin: may return from any stage to 'moderator' or 'initiator'.
//   - moderator: may return to 'initiator' whenever the file is at the moderator stage.
// The note is stored per returner-role (moderator_note / admin_note) so a file
// bounced by both shows both notes. return_source records who returned it to the
// initiator, so the initiator re-submits to that same party.
const returnMeeting = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { note } = req.body;
        const target = req.body?.target;
        if (!['initiator', 'moderator'].includes(target)) {
            return next(new CustomError("A valid target ('initiator' or 'moderator') is required.", 400));
        }

        const check = await db.query('SELECT stage FROM meetings WHERE id = $1', [id]);
        if (check.rows.length === 0) return next(new CustomError('Meeting not found', 404));
        const meeting = check.rows[0];

        const admin = isAdminRole(req.user);
        if (admin) {
            // Admins may grant edit access from any stage — including an already
            // approved file — as long as it isn't already sitting with that party.
            if (meeting.stage === target) {
                return next(new CustomError(`This file is already with the ${target}.`, 409));
            }
        } else if (req.user?.role === 'moderator') {
            if (target !== 'initiator' || meeting.stage !== 'moderator') {
                return next(new CustomError('You can only return this file to the initiator while it is with you for review.', 403));
            }
        } else {
            return next(new CustomError('You do not have permission to return this file.', 403));
        }

        // Tier of whoever is sending it back, and the note column that records it.
        const tier = admin ? 'admin' : 'moderator';
        const noteColumn = tier === 'admin' ? 'admin_note' : 'moderator_note';
        // Only a return that lands on the initiator sets where they re-submit.
        const returnSource = target === 'initiator' ? tier : null;

        // Sending an approved agenda back down reopens it, so the meeting drops
        // out of 'ongoing' and back to 'draft' — status follows the workflow.
        // A completed meeting keeps its 'past' status.
        const result = await db.query(
            `UPDATE meetings
             SET stage = $2, return_source = $3, ${noteColumn} = $4,
                 status = CASE WHEN status = 'ongoing' THEN 'draft' ELSE status END,
                 reviewed_by = $5, reviewed_at = NOW()
             WHERE id = $1 RETURNING *`,
            [id, target, returnSource, note || null, req.user?.id || null]
        );
        res.status(200).json({ success: true, message: `Meeting file returned to the ${target}`, data: result.rows[0] });
    } catch (error) {
        next(error);
    }
};

// --- Resolution approval chain ----------------------------------------------
// The same initiator -> moderator -> admin escalation as the agenda, run on
// resolution_stage. It only opens once the agenda is approved (status 'ongoing').

// Guard shared by every resolution transition.
const loadResolutionMeeting = async (id) => {
    const check = await db.query(
        `SELECT created_by, stage, status, resolution_stage, resolution_return_source
         FROM meetings WHERE id = $1`,
        [id]
    );
    return check.rows[0] || null;
};

// Forward the resolution one step up the chain.
const submitResolution = async (req, res, next) => {
    try {
        const { id } = req.params;

        if (isAdminRole(req.user)) {
            return next(new CustomError(
                'Admins and superadmins approve the resolution directly — there is nobody above them to submit to.', 403));
        }

        const meeting = await loadResolutionMeeting(id);
        if (!meeting) return next(new CustomError('Meeting not found', 404));
        if (meeting.status === 'past') return next(new CustomError('This meeting has been marked completed.', 409));
        if (meeting.stage !== 'approved') {
            return next(new CustomError('The agenda must be approved before the resolution can be submitted.', 409));
        }

        let nextStage;
        if (meeting.resolution_stage === 'initiator') {
            if (!isMeetingOwner(meeting, req.user)) {
                return next(new CustomError('Only the initiator who created this file can submit its resolution.', 403));
            }
            nextStage = meeting.resolution_return_source === 'admin' ? 'admin' : 'moderator';
        } else if (meeting.resolution_stage === 'moderator') {
            if (req.user?.role !== 'moderator') {
                return next(new CustomError('Only a moderator can escalate the resolution to the admin.', 403));
            }
            nextStage = 'admin';
        } else {
            return next(new CustomError(`The resolution cannot be submitted while it is at the "${meeting.resolution_stage}" stage.`, 409));
        }

        const result = await db.query(
            `UPDATE meetings
             SET resolution_stage = $2, resolution_return_source = NULL,
                 resolution_moderator_note = NULL, resolution_admin_note = NULL,
                 reviewed_by = $3, reviewed_at = NOW()
             WHERE id = $1 RETURNING *`,
            [id, nextStage, req.user?.id || null]
        );
        res.status(200).json({ success: true, message: `Resolution submitted to the ${nextStage}`, data: result.rows[0] });
    } catch (error) {
        next(error);
    }
};

// Hand the resolution back down with an optional note, granting that party
// edit access again. Mirrors returnMeeting.
const returnResolution = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { note } = req.body;
        const target = req.body?.target;
        if (!['initiator', 'moderator'].includes(target)) {
            return next(new CustomError("A valid target ('initiator' or 'moderator') is required.", 400));
        }

        const meeting = await loadResolutionMeeting(id);
        if (!meeting) return next(new CustomError('Meeting not found', 404));
        if (meeting.status === 'past') return next(new CustomError('This meeting has been marked completed.', 409));

        const admin = isAdminRole(req.user);
        if (admin) {
            if (meeting.resolution_stage === target) {
                return next(new CustomError(`The resolution is already with the ${target}.`, 409));
            }
        } else if (req.user?.role === 'moderator') {
            if (target !== 'initiator' || meeting.resolution_stage !== 'moderator') {
                return next(new CustomError('You can only return the resolution to the initiator while it is with you for review.', 403));
            }
        } else {
            return next(new CustomError('You do not have permission to return this resolution.', 403));
        }

        const tier = admin ? 'admin' : 'moderator';
        const noteColumn = tier === 'admin' ? 'resolution_admin_note' : 'resolution_moderator_note';
        const returnSource = target === 'initiator' ? tier : null;

        const result = await db.query(
            `UPDATE meetings
             SET resolution_stage = $2, resolution_return_source = $3, ${noteColumn} = $4,
                 reviewed_by = $5, reviewed_at = NOW()
             WHERE id = $1 RETURNING *`,
            [id, target, returnSource, note || null, req.user?.id || null]
        );
        res.status(200).json({ success: true, message: `Resolution returned to the ${target}`, data: result.rows[0] });
    } catch (error) {
        next(error);
    }
};

// admin/superadmin gives final approval, freezing the resolution. As with the
// agenda they can approve from any stage, including one they authored.
const approveResolution = async (req, res, next) => {
    try {
        const { id } = req.params;
        const meeting = await loadResolutionMeeting(id);
        if (!meeting) return next(new CustomError('Meeting not found', 404));
        if (meeting.status === 'past') return next(new CustomError('This meeting has been marked completed.', 409));
        if (meeting.stage !== 'approved') return next(new CustomError('The agenda must be approved before the resolution.', 409));
        if (meeting.resolution_stage === 'approved') return next(new CustomError('The resolution has already been approved.', 409));

        const result = await db.query(
            `UPDATE meetings
             SET resolution_stage = 'approved', resolution_return_source = NULL,
                 resolution_moderator_note = NULL, resolution_admin_note = NULL,
                 reviewed_by = $2, reviewed_at = NOW()
             WHERE id = $1 RETURNING *`,
            [id, req.user?.id || null]
        );
        res.status(200).json({ success: true, message: 'Resolution approved', data: result.rows[0] });
    } catch (error) {
        next(error);
    }
};

// admin/superadmin reopens an approved resolution, handing it back to the
// initiator so the chain can run again.
const reopenResolution = async (req, res, next) => {
    try {
        const { id } = req.params;
        const result = await db.query(
            `UPDATE meetings
             SET resolution_stage = 'initiator', resolution_return_source = 'admin',
                 reviewed_by = $2, reviewed_at = NOW()
             WHERE id = $1 AND status <> 'past' RETURNING *`,
            [id, req.user?.id || null]
        );
        if (result.rows.length === 0) {
            return next(new CustomError('Meeting not found, or it has been marked completed.', 404));
        }
        res.status(200).json({ success: true, message: 'Resolution reopened for editing', data: result.rows[0] });
    } catch (error) {
        next(error);
    }
};



const addInvitees = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { invitees } = req.body; // array of invitee objects
        if (!invitees || !Array.isArray(invitees)) return next(new CustomError('Invitees array is required', 400));

        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');

            // Custom (non-member) invitees are appended after whatever is
            // already in the meeting's invitee list.
            const maxSerialResult = await client.query('SELECT MAX(serial) as max_serial FROM invitees WHERE meeting_id = $1', [id]);
            let nextSerial = (maxSerialResult.rows[0].max_serial || 0) + 1;

            for (const invitee of invitees) {
                let serial = null;
                if (invitee.member_id) {
                    // Trust the DB, not the client, for the linked member's serial.
                    const memberRes = await client.query('SELECT serial FROM members WHERE id = $1', [invitee.member_id]);
                    serial = memberRes.rows[0]?.serial ?? null;
                } else if (invitee.serial !== undefined && invitee.serial !== null && invitee.serial !== '') {
                    const requestedSerial = parseInt(invitee.serial, 10);
                    if (!Number.isNaN(requestedSerial)) {
                        // Only push down other custom invitees — member-linked ones must
                        // keep the serial their member owns, so leave them in place even
                        // if that means sharing a serial with the new row.
                        await client.query(
                            'UPDATE invitees SET serial = serial + 1 WHERE meeting_id = $1 AND member_id IS NULL AND serial >= $2',
                            [id, requestedSerial]
                        );
                        serial = requestedSerial;
                        nextSerial = Math.max(nextSerial + 1, requestedSerial + 1);
                    }
                }
                if (serial === null) {
                    serial = nextSerial++;
                }

                await client.query(
                    'INSERT INTO invitees (name, email, designation, department_id, office_id, meeting_id, member_id, serial) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
                    [invitee.name, invitee.email, invitee.designation, invitee.department_id || null, invitee.office_id || null, id, invitee.member_id || null, serial]
                );
            }
            await client.query('COMMIT');
            res.status(201).json({ success: true, message: 'Invitees added' });
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

const bulkFetchInvitees = async (req, res, next) => {
    try {
        const { id } = req.params;

        const meetingRes = await db.query('SELECT type FROM meetings WHERE id = $1', [id]);
        if (meetingRes.rows.length === 0) return next(new CustomError('Meeting not found', 404));

        const meetingType = meetingRes.rows[0].type;

        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');

            const insertQuery = `
                INSERT INTO invitees (name, email, designation, department_id, office_id, meeting_id, member_id, serial)
                SELECT m.name, m.email, m.designation, m.department_id, m.office_id, $1, m.id, m.serial
                FROM members m
                WHERE m.member_type = $2
                  AND NOT EXISTS (
                      SELECT 1 FROM invitees i
                      WHERE i.meeting_id = $1 AND (i.email = m.email OR (i.name = m.name AND m.email IS NULL))
                  )
            `;
            const result = await client.query(insertQuery, [id, meetingType]);

            await client.query('COMMIT');
            res.status(201).json({ success: true, message: `Fetched and added ${result.rowCount} members.` });
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

const getInvitees = async (req, res, next) => {
    try {
        const { id } = req.params;
        const meetingRes = await db.query('SELECT status, type FROM meetings WHERE id = $1', [id]);
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

        const result = await db.query(`
            SELECT i.*, d.name_bangla as department_name, d.serial as department_serial, o.name_bangla as office_name
            FROM invitees i
            LEFT JOIN departments d ON i.department_id = d.id
            LEFT JOIN offices o ON i.office_id = o.id
            WHERE i.meeting_id = $1
            ORDER BY i.serial ASC NULLS LAST, i.created_at ASC
        `, [id]);

        res.status(200).json({ success: true, data: result.rows });
    } catch (error) {
        next(error);
    }
};

const getInviteesEmails = async (req, res, next) => {
    try {
        const { id } = req.params;
        const meetingRes = await db.query('SELECT status, type FROM meetings WHERE id = $1', [id]);
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

        const result = await db.query(`
            SELECT i.id, i.name, i.email, i.designation, i.serial, i.notice_mail_sent, i.agenda_mail_sent, i.resolution_mail_sent,
                   d.name_bangla as department_name, d.serial as department_serial, o.name_bangla as office_name
            FROM invitees i
            LEFT JOIN departments d ON i.department_id = d.id
            LEFT JOIN offices o ON i.office_id = o.id
            WHERE i.meeting_id = $1
            ORDER BY i.serial ASC NULLS LAST, i.created_at ASC
        `, [id]);
        res.status(200).json({ success: true, data: result.rows });
    } catch (error) {
        next(error);
    }
};


const removeInvitee = async (req, res, next) => {
    try {
        const { id, inviteeId } = req.params;
        const meeting = await loadMeeting(req);
        if (meeting) {
            const access = calculateMeetingAccess(meeting, req.user);
            if (!access.canEditPresentees) {
                const targetRes = await db.query('SELECT is_present FROM invitees WHERE id = $1 AND meeting_id = $2', [inviteeId, id]);
                if (targetRes.rows[0]?.is_present) {
                    return next(new CustomError('Access denied. Presentee data is locked for your level.', 403));
                }
            }
        }

        const result = await db.query(
            'DELETE FROM invitees WHERE id = $1 AND meeting_id = $2 RETURNING *',
            [inviteeId, id]
        );

        if (result.rows.length === 0) {
            return next(new CustomError('Invitee not found', 404));
        }

        res.status(200).json({ success: true, message: 'Invitee removed' });
    } catch (error) {
        next(error);
    }
};

const updateInvitee = async (req, res, next) => {
    const client = await db.pool.connect();
    try {
        const { id, inviteeId } = req.params;
        const { name, email, designation, department_id, office_id, is_present, serial } = req.body;

        const meeting = await loadMeeting(req);
        if (meeting) {
            const access = calculateMeetingAccess(meeting, req.user);
            if (!access.canEditInvitees) {
                return next(new CustomError('Access denied. Invitees are locked for your level.', 403));
            }
            if (!access.canEditPresentees) {
                const targetRes = await db.query('SELECT is_present FROM invitees WHERE id = $1 AND meeting_id = $2', [inviteeId, id]);
                const isTargetPresent = targetRes.rows[0]?.is_present;
                if (isTargetPresent || (is_present !== undefined && is_present !== isTargetPresent)) {
                    return next(new CustomError('Access denied. Presentee data / attendance is locked for your level.', 403));
                }
            }
        }

        await client.query('BEGIN');

        const currentRes = await client.query('SELECT serial, is_present FROM invitees WHERE id = $1 AND meeting_id = $2', [inviteeId, id]);
        if (currentRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return next(new CustomError('Invitee not found', 404));
        }

        const currentInvitee = currentRes.rows[0];
        const oldSerial = currentInvitee.serial;
        let finalSerial = oldSerial;

        if (serial !== undefined && serial !== null && !Number.isNaN(parseInt(serial, 10))) {
            const requestedSerial = parseInt(serial, 10);
            if (requestedSerial !== oldSerial) {
                if (meeting) {
                    const access = calculateMeetingAccess(meeting, req.user);
                    if (!access.canEditInvitees) {
                        await client.query('ROLLBACK');
                        return next(new CustomError('Access denied. Invitees are locked for your level.', 403));
                    }
                }

                if (requestedSerial > oldSerial) {
                    await client.query(
                        'UPDATE invitees SET serial = serial - 1 WHERE meeting_id = $1 AND serial > $2 AND serial <= $3 AND id != $4',
                        [id, oldSerial, requestedSerial, inviteeId]
                    );
                } else if (requestedSerial < oldSerial) {
                    await client.query(
                        'UPDATE invitees SET serial = serial + 1 WHERE meeting_id = $1 AND serial >= $2 AND serial < $3 AND id != $4',
                        [id, requestedSerial, oldSerial, inviteeId]
                    );
                }
                finalSerial = requestedSerial;
            }
        }

        const result = await client.query(
            `UPDATE invitees SET 
                name = COALESCE($1, name), 
                email = COALESCE($2, email), 
                designation = COALESCE($3, designation), 
                department_id = $4, 
                office_id = $5,
                is_present = COALESCE($6, is_present),
                serial = $7
            WHERE id = $8 AND meeting_id = $9 RETURNING *`,
            [name, email, designation, department_id || null, office_id || null, is_present !== undefined ? is_present : null, finalSerial, inviteeId, id]
        );

        await client.query('COMMIT');
        await db.query('DELETE FROM search_cache').catch(() => {});
        res.status(200).json({ success: true, message: 'Invitee updated', data: result.rows[0] });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        next(error);
    } finally {
        client.release();
    }
};

const reorderInvitee = async (req, res, next) => {
    try {
        const { id, inviteeId } = req.params;
        const requestedSerial = parseInt(req.body.serial, 10);
        if (Number.isNaN(requestedSerial)) return next(new CustomError('serial is required', 400));

        const meeting = await loadMeeting(req);

        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');

            const inviteeRes = await client.query(
                'SELECT serial, is_present FROM invitees WHERE id = $1 AND meeting_id = $2',
                [inviteeId, id]
            );
            if (inviteeRes.rows.length === 0) {
                await client.query('ROLLBACK');
                client.release();
                return next(new CustomError('Invitee not found', 404));
            }

            const targetInvitee = inviteeRes.rows[0];
            const oldSerial = targetInvitee.serial ?? requestedSerial;

            if (meeting) {
                const access = calculateMeetingAccess(meeting, req.user);
                if (!access.canEditInvitees) {
                    await client.query('ROLLBACK');
                    client.release();
                    return next(new CustomError('Access denied. Invitees are locked for your level.', 403));
                }

                if (!access.canEditPresentees) {
                    if (targetInvitee.is_present) {
                        await client.query('ROLLBACK');
                        client.release();
                        return next(new CustomError('Access denied. Presentees are locked and cannot be reordered.', 403));
                    }

                    const minSerial = Math.min(oldSerial, requestedSerial);
                    const maxSerial = Math.max(oldSerial, requestedSerial);

                    const presenteeCheck = await client.query(
                        `SELECT COUNT(*)::int as count
                         FROM invitees
                         WHERE meeting_id = $1 AND is_present = true AND serial >= $2 AND serial <= $3 AND id != $4`,
                        [id, minSerial, maxSerial, inviteeId]
                    );

                    if (presenteeCheck.rows[0].count > 0) {
                        await client.query('ROLLBACK');
                        client.release();
                        return next(new CustomError('Access denied. Order of presentees is locked.', 403));
                    }
                }
            }

            // Meeting-local move only — never touches members.serial, even for
            // member-linked invitees. This is intentionally decoupled from the
            // global member order: the sync_invitee_serial trigger still seeds
            // (and re-syncs) a member-linked invitee's serial whenever that
            // member's own serial changes elsewhere, but a drag here never
            // reaches back out to move the member.
            if (requestedSerial > oldSerial) {
                await client.query(
                    'UPDATE invitees SET serial = serial - 1 WHERE meeting_id = $1 AND serial > $2 AND serial <= $3 AND id != $4',
                    [id, oldSerial, requestedSerial, inviteeId]
                );
            } else if (requestedSerial < oldSerial) {
                await client.query(
                    'UPDATE invitees SET serial = serial + 1 WHERE meeting_id = $1 AND serial >= $2 AND serial < $3 AND id != $4',
                    [id, requestedSerial, oldSerial, inviteeId]
                );
            }
            await client.query('UPDATE invitees SET serial = $1 WHERE id = $2', [requestedSerial, inviteeId]);

            await client.query('COMMIT');
            res.status(200).json({ success: true, message: 'Invitee reordered successfully' });
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

const getPresentees = async (req, res, next) => {
    try {
        const { id } = req.params;
        const meetingRes = await db.query('SELECT status, type FROM meetings WHERE id = $1', [id]);
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

        const result = await db.query(`
            SELECT i.*, d.name_bangla as department_name, d.serial as department_serial, o.name_bangla as office_name
            FROM invitees i
            LEFT JOIN departments d ON i.department_id = d.id
            LEFT JOIN offices o ON i.office_id = o.id
            WHERE i.meeting_id = $1 AND i.is_present = true
            ORDER BY i.serial ASC NULLS LAST
        `, [id]);

        res.status(200).json({ success: true, data: result.rows });
    } catch (error) {
        next(error);
    }
};

const addPresentees = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { invitee_ids, presentees } = req.body;

        const meeting = await loadMeeting(req);
        if (meeting) {
            const access = calculateMeetingAccess(meeting, req.user);
            if (!access.canEditPresentees) {
                return next(new CustomError('Access denied. Presentee data is locked for your level.', 403));
            }
            if (presentees && Array.isArray(presentees) && presentees.length > 0 && !access.canEditInvitees) {
                return next(new CustomError('Access denied. Invitees are locked for your level. Custom presentees cannot be added.', 403));
            }
        }

        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');

            // Option 1: Mark existing invitees of this meeting as present
            if (invitee_ids && Array.isArray(invitee_ids) && invitee_ids.length > 0) {
                await client.query(
                    'UPDATE invitees SET is_present = true WHERE meeting_id = $1 AND id = ANY($2)',
                    [id, invitee_ids]
                );
            }

            // Option 2: Add new custom presentees into invitees table with is_present = true
            if (presentees && Array.isArray(presentees) && presentees.length > 0) {
                const maxSerialResult = await client.query('SELECT MAX(serial) as max_serial FROM invitees WHERE meeting_id = $1', [id]);
                let nextSerial = (maxSerialResult.rows[0].max_serial || 0) + 1;

                for (const presentee of presentees) {
                    let serial = null;
                    if (presentee.member_id) {
                        const memberRes = await client.query('SELECT serial FROM members WHERE id = $1', [presentee.member_id]);
                        serial = memberRes.rows[0]?.serial ?? null;
                    } else if (presentee.serial !== undefined && presentee.serial !== null && presentee.serial !== '') {
                        const requestedSerial = parseInt(presentee.serial, 10);
                        if (!Number.isNaN(requestedSerial)) {
                            await client.query(
                                'UPDATE invitees SET serial = serial + 1 WHERE meeting_id = $1 AND serial >= $2',
                                [id, requestedSerial]
                            );
                            serial = requestedSerial;
                            nextSerial = Math.max(nextSerial + 1, requestedSerial + 1);
                        }
                    }
                    if (serial === null) {
                        serial = nextSerial++;
                    }

                    await client.query(
                        `INSERT INTO invitees (name, email, designation, department_id, office_id, meeting_id, serial, is_present, member_id)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8)`,
                        [
                            presentee.name || null,
                            presentee.email || null,
                            presentee.designation || null,
                            presentee.department_id || null,
                            presentee.office_id || null,
                            id,
                            serial,
                            presentee.member_id || null
                        ]
                    );
                }
            }
            await client.query('COMMIT');
            res.status(201).json({ success: true, message: 'Presentees added' });
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

const updatePresentee = async (req, res, next) => {
    const client = await db.pool.connect();
    try {
        const { id, presenteeId } = req.params;
        const { name, email, designation, department_id, office_id, is_present, serial } = req.body;

        const meeting = await loadMeeting(req);
        if (meeting) {
            const access = calculateMeetingAccess(meeting, req.user);
            if (!access.canEditPresentees) {
                return next(new CustomError('Access denied. Presentee data is locked for your level.', 403));
            }
            if (!access.canEditInvitees) {
                return next(new CustomError('Access denied. Presentees cannot be edited when invitees are locked.', 403));
            }
        }

        await client.query('BEGIN');

        const currentRes = await client.query('SELECT serial FROM invitees WHERE id = $1 AND meeting_id = $2', [presenteeId, id]);
        if (currentRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return next(new CustomError('Presentee not found', 404));
        }

        const oldSerial = currentRes.rows[0].serial;
        let finalSerial = oldSerial;

        if (serial !== undefined && serial !== null && !Number.isNaN(parseInt(serial, 10))) {
            const requestedSerial = parseInt(serial, 10);
            if (requestedSerial !== oldSerial) {
                if (requestedSerial > oldSerial) {
                    await client.query(
                        'UPDATE invitees SET serial = serial - 1 WHERE meeting_id = $1 AND serial > $2 AND serial <= $3 AND id != $4',
                        [id, oldSerial, requestedSerial, presenteeId]
                    );
                } else if (requestedSerial < oldSerial) {
                    await client.query(
                        'UPDATE invitees SET serial = serial + 1 WHERE meeting_id = $1 AND serial >= $2 AND serial < $3 AND id != $4',
                        [id, requestedSerial, oldSerial, presenteeId]
                    );
                }
                finalSerial = requestedSerial;
            }
        }

        const result = await client.query(
            `UPDATE invitees SET 
                name = COALESCE($1, name), 
                email = COALESCE($2, email), 
                designation = COALESCE($3, designation), 
                department_id = $4, 
                office_id = $5,
                is_present = COALESCE($6, is_present),
                serial = $7
            WHERE id = $8 AND meeting_id = $9 RETURNING *`,
            [name, email, designation, department_id || null, office_id || null, is_present !== undefined ? is_present : null, finalSerial, presenteeId, id]
        );

        await client.query('COMMIT');
        await db.query('DELETE FROM search_cache').catch(() => {});
        res.status(200).json({ success: true, message: 'Presentee updated', data: result.rows[0] });
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        next(error);
    } finally {
        client.release();
    }
};

const removePresentee = async (req, res, next) => {
    try {
        const { id, presenteeId } = req.params;
        const meeting = await loadMeeting(req);
        if (meeting) {
            const access = calculateMeetingAccess(meeting, req.user);
            if (!access.canEditPresentees) {
                return next(new CustomError('Access denied. Presentee data is locked for your level.', 403));
            }
        }

        const result = await db.query(
            'UPDATE invitees SET is_present = false WHERE id = $1 AND meeting_id = $2 RETURNING *',
            [presenteeId, id]
        );

        if (result.rows.length === 0) {
            return next(new CustomError('Presentee not found', 404));
        }

        res.status(200).json({ success: true, message: 'Presentee removed' });
    } catch (error) {
        next(error);
    }
};

const saveAttendance = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { present_invitee_ids } = req.body;

        if (!Array.isArray(present_invitee_ids)) {
            return next(new CustomError('present_invitee_ids must be an array', 400));
        }

        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');
            await client.query('UPDATE invitees SET is_present = false WHERE meeting_id = $1', [id]);
            
            if (present_invitee_ids.length > 0) {
                await client.query('UPDATE invitees SET is_present = true WHERE meeting_id = $1 AND id = ANY($2)', [id, present_invitee_ids]);
            }
            
            await client.query('COMMIT');
            res.status(200).json({ success: true, message: 'Attendance saved successfully' });
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

const getAttendanceGroups = async (req, res, next) => {
    try {
        const { id } = req.params;

        const meetingCheck = await db.query('SELECT id FROM meetings WHERE id = $1', [id]);
        if (meetingCheck.rows.length === 0) return next(new CustomError('Meeting not found', 404));

        const presenteesQuery = `
            SELECT p.id, p.name, p.designation, d.name_bangla as department_name, o.name_bangla as office_name
            FROM invitees p
            LEFT JOIN departments d ON p.department_id = d.id
            LEFT JOIN offices o ON p.office_id = o.id
            WHERE p.meeting_id = $1
        `;
        const presenteesResult = await db.query(presenteesQuery, [id]);
        const presentees = presenteesResult.rows;

        const groups = {
            admins: { label: 'প্রশাসন', count: 0 },
            deans: { label: 'সকল ডিন', count: 0 },
            heads: { label: 'সকল বিভাগীয় প্রধান', count: 0 },
            depts: {},
            others: { label: 'অন্যান্য সদস্য', count: 0 }
        };

        presentees.forEach(p => {
            const officeStr = p.office_name || '';
            if (officeStr.includes('উপাচার্য')) {
                groups.admins.count++;
            } else if (officeStr.includes('ডিন')) {
                groups.deans.count++;
            } else if (officeStr.includes('বিভাগীয় প্রধান')) {
                groups.heads.count++;
            } else if (p.department_name) {
                if (!groups.depts[p.department_name]) {
                    groups.depts[p.department_name] = { label: p.department_name, count: 0 };
                }
                groups.depts[p.department_name].count++;
            } else {
                groups.others.count++;
            }
        });

        const result = [
            { key: 'admins', ...groups.admins },
            { key: 'deans', ...groups.deans },
            { key: 'heads', ...groups.heads },
            ...Object.entries(groups.depts)
                .sort(([, a], [, b]) => b.count - a.count)
                .map(([deptKey, dept]) => ({
                    key: `dept:${deptKey}`,
                    ...dept
                })),
            { key: 'others', ...groups.others }
        ].filter(g => g.count > 0);

        res.json({ data: result });
    } catch (error) {
        next(error);
    }
};

const generatePdf = async (req, res, next) => {
    try {
        const { id, type } = req.params; // type = agenda, resolution, attendance
        const { group } = req.query; // optional group filter for attendance
        let pdfBuffer;

        // Optional page-layout overrides from the PDF Preview page. Absent params
        // leave generation on its historical A4 / 20mm defaults. All values are
        // validated & clamped inside pdfGenerator.normalizePdfLayout().
        const q = req.query;
        const hasLayout = ['pageSize', 'orientation', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'scale', 'lineHeight', 'agendaNumberStyle']
            .some((k) => q[k] !== undefined && q[k] !== '');
        const layout = hasLayout ? {
            pageSize: q.pageSize,
            orientation: q.orientation,
            margin: { top: q.marginTop, right: q.marginRight, bottom: q.marginBottom, left: q.marginLeft },
            scale: q.scale,
            lineHeight: q.lineHeight,
            agendaNumberStyle: q.agendaNumberStyle
        } : undefined;

        const meetingCheck = await db.query('SELECT id, status, type FROM meetings WHERE id = $1', [id]);
        if (meetingCheck.rows.length === 0) return next(new CustomError('Meeting not found', 404));
        const meeting = meetingCheck.rows[0];

        if (req.user?.role === 'viewer') {
            if (meeting.status === 'draft') {
                return next(new CustomError('Meeting not found', 404));
            }
            const restrictedType = viewerTypeRestriction(req.user);
            if (restrictedType && meeting.type !== restrictedType) {
                return next(new CustomError('Meeting not found', 404));
            }
        }

        if (type === 'agenda') {
            pdfBuffer = await generateMeetingPdf(id, false, undefined, layout);
        } else if (type === 'suppli-agenda' || type === 'suppli_agenda') {
            pdfBuffer = await generateMeetingPdf(id, false, 'suppli-agenda', layout);
        } else if (type === 'resolution') {
            pdfBuffer = await generateMeetingPdf(id, true, undefined, layout);
        } else if (type === 'attendance') {
            pdfBuffer = await generateAttendanceSheet(id, group || null);
        } else if (type === 'resolution-status') {
            pdfBuffer = await generateMeetingPdf(id, true, 'resolution-status', layout);
        } else {
            return next(new CustomError('Invalid pdf type requested', 400));
        }

        // Sanitize filename: strip non-ASCII chars for Content-Disposition header
        const sanitize = (str) => str.replace(/[^\x00-\x7F]/g, '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
        const filename = group
            ? `attendance-${sanitize(group)}-${id}.pdf`
            : `attendance-${id}.pdf`;

        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
        res.send(pdfBuffer);
    } catch (error) {
        next(error);
    }
};

const generateDocx = async (req, res, next) => {
    try {
        const { id, type } = req.params; // type = agenda, suppli-agenda, resolution, attendance, resolution-status
        const { group } = req.query;
        let docxBuffer;

        const meetingCheck = await db.query('SELECT id, status, type FROM meetings WHERE id = $1', [id]);
        if (meetingCheck.rows.length === 0) return next(new CustomError('Meeting not found', 404));
        const meeting = meetingCheck.rows[0];

        if (req.user?.role === 'viewer') {
            if (meeting.status === 'draft') {
                return next(new CustomError('Meeting not found', 404));
            }
            const restrictedType = viewerTypeRestriction(req.user);
            if (restrictedType && meeting.type !== restrictedType) {
                return next(new CustomError('Meeting not found', 404));
            }
        }

        if (type === 'agenda') {
            docxBuffer = await generateMeetingDocx(id, false);
        } else if (type === 'suppli-agenda' || type === 'suppli_agenda') {
            docxBuffer = await generateMeetingDocx(id, false, 'suppli-agenda');
        } else if (type === 'resolution') {
            docxBuffer = await generateMeetingDocx(id, true);
        } else if (type === 'attendance') {
            docxBuffer = await generateAttendanceDocxSheet(id, group || null);
        } else if (type === 'resolution-status') {
            docxBuffer = await generateMeetingDocx(id, true, 'resolution-status');
        } else {
            return next(new CustomError('Invalid document type requested', 400));
        }

        const sanitize = (str) => str.replace(/[^\x00-\x7F]/g, '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
        const filename = group
            ? `${type}-${sanitize(group)}-${id}.docx`
            : `${type}-${id}.docx`;

        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
        res.send(docxBuffer);
    } catch (error) {
        next(error);
    }
};

const uploadMaterial = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { type } = req.body; // 'agenda', 'resolution', 'resolution-status'
        const file = req.file;

        if (!id || !type || !file) {
            return next(new CustomError('id, type, and file are required', 400));
        }

        const validTypes = ['agenda', 'suppli-agenda', 'resolution', 'resolution-status'];
        if (!validTypes.includes(type)) {
            return next(new CustomError('Invalid material type', 400));
        }

        // Check if meeting exists
        const meetingCheck = await db.query('SELECT * FROM meetings WHERE id = $1', [id]);
        if (meetingCheck.rows.length === 0) return next(new CustomError('Meeting not found', 404));

        await db.query('ALTER TABLE meetings ADD COLUMN IF NOT EXISTS suppli_agenda_pdf_link VARCHAR(255)');

        const ext = file.originalname.split('.').pop() || 'pdf';
        const fileKey = `materials/${id}/${type}-${crypto.randomBytes(4).toString('hex')}.${ext}`;

        await storageService.uploadFile(file.buffer, fileKey, file.mimetype);

        let column = '';
        if (type === 'agenda') column = 'agenda_pdf_link';
        else if (type === 'suppli-agenda') column = 'suppli_agenda_pdf_link';
        else if (type === 'resolution') column = 'resolution_pdf_link';
        else if (type === 'resolution-status') column = 'resolution_status_pdf_link';

        const result = await db.query(
            `UPDATE meetings SET ${column} = $1 WHERE id = $2 RETURNING *`,
            [fileKey, id]
        );

        res.status(200).json({ success: true, message: 'Material uploaded successfully', data: result.rows[0] });
    } catch (error) {
        next(error);
    }
};

const deleteMaterial = async (req, res, next) => {
    try {
        const { id, type } = req.params;

        const validTypes = ['agenda', 'suppli-agenda', 'resolution', 'resolution-status'];
        if (!validTypes.includes(type)) {
            return next(new CustomError('Invalid material type', 400));
        }

        let column = '';
        if (type === 'agenda') column = 'agenda_pdf_link';
        else if (type === 'suppli-agenda') column = 'suppli_agenda_pdf_link';
        else if (type === 'resolution') column = 'resolution_pdf_link';
        else if (type === 'resolution-status') column = 'resolution_status_pdf_link';

        const meetingRes = await db.query(`SELECT ${column} FROM meetings WHERE id = $1`, [id]);
        if (meetingRes.rows.length === 0) return next(new CustomError('Meeting not found', 404));

        const existingFileKey = meetingRes.rows[0][column];
        if (existingFileKey) {
            try {
                await storageService.deleteFile(existingFileKey);
            } catch (err) {
                console.error(`Failed to delete material file ${existingFileKey} from storage:`, err.message);
            }
        }

        const result = await db.query(
            `UPDATE meetings SET ${column} = NULL WHERE id = $1 RETURNING *`,
            [id]
        );

        res.status(200).json({ success: true, message: 'Material deleted successfully', data: result.rows[0] });
    } catch (error) {
        next(error);
    }
};

const sendAgendaEmail = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { invitee_ids, from, subject, content, attach_agenda = true, attachments = [] } = req.body;

        if (!Array.isArray(invitee_ids) || invitee_ids.length === 0) {
            return next(new CustomError('invitee_ids must be a non-empty array', 400));
        }
        if (!from) return next(new CustomError('from is required', 400));
        if (!subject) return next(new CustomError('subject is required', 400));
        if (!content) return next(new CustomError('content is required', 400));

        const meetingCheck = await db.query('SELECT * FROM meetings WHERE id = $1', [id]);
        if (meetingCheck.rows.length === 0) return next(new CustomError('Meeting not found', 404));

        const inviteesResult = await db.query(
            `SELECT id, name, email FROM invitees WHERE meeting_id = $1 AND id = ANY($2::uuid[])`,
            [id, invitee_ids]
        );
        const foundInvitees = inviteesResult.rows;

        const recipients = foundInvitees.filter(i => !!i.email);
        const failed = foundInvitees
            .filter(i => !i.email)
            .map(i => ({ invitee_id: i.id, name: i.name, reason: 'No email address on file' }));

        const foundIds = new Set(foundInvitees.map(i => i.id));
        invitee_ids
            .filter(iid => !foundIds.has(iid))
            .forEach(iid => failed.push({ invitee_id: iid, reason: 'Invitee not found for this meeting' }));

        if (recipients.length === 0) {
            return next(new CustomError('None of the selected invitees have a valid email address', 400));
        }

        const mailAttachments = [...attachments];
        if (attach_agenda) {
            const pdfBuffer = await generateMeetingPdf(id, false);
            mailAttachments.push({
                filename: `agenda-${id}.pdf`,
                content: pdfBuffer.toString('base64'),
                contentType: 'application/pdf'
            });
        }

        const results = await Promise.allSettled(
            recipients.map(r => sendMail({
                from,
                to: r.email,
                subject,
                html: content,
                attachments: mailAttachments
            }))
        );

        const sent = [];
        results.forEach((r, idx) => {
            const recipient = recipients[idx];
            if (r.status === 'fulfilled') {
                sent.push({ invitee_id: recipient.id, email: recipient.email });
            } else {
                failed.push({ invitee_id: recipient.id, email: recipient.email, reason: r.reason?.message || 'Failed to send' });
            }
        });

        const statusCode = sent.length === 0 ? 502 : (failed.length > 0 ? 207 : 200);
        res.status(statusCode).json({
            success: sent.length > 0,
            message: sent.length === 0
                ? 'Failed to send email to all recipients'
                : failed.length > 0
                    ? `Sent to ${sent.length} recipient(s), ${failed.length} failed`
                    : `Email sent to ${sent.length} recipient(s)`,
            data: { sent, failed }
        });
    } catch (error) {
        next(error);
    }
};

const bulkImportMeeting = async (req, res, next) => {
    const client = await db.pool.connect();
    try {
        const { meeting, presentees, agendas } = req.body;

        // The proposal-code prefix is meeting-wide (same for every agendum),
        // so it's only ever extracted from the first imported agendum.
        const hasAgendas = agendas && Array.isArray(agendas) && agendas.length > 0;
        const firstAgendaExtraction = hasAgendas ? extractAgendaPrefix(agendas[0].content) : { agendaPrefix: null, content: null };

        await client.query('BEGIN');

        // 1. Insert Meeting
        const meetingResult = await client.query(
            `INSERT INTO meetings
            -- No approval_status: that column is gone, replaced by stage, whose
            -- 'initiator' default is the equivalent of the old 'draft'.
            (title, meeting_title, meeting_date, type, status, description, president, conclusion, created_by, agenda_prefix)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING id`,
            [
                meeting.title,
                meeting.meeting_title,
                meeting.meeting_date,
                meeting.type,
                meeting.status || 'past',
                meeting.description,
                meeting.president,
                meeting.conclusion,
                req.user?.id || null,
                firstAgendaExtraction.agendaPrefix
            ]
        );

        const meetingId = meetingResult.rows[0].id;

        // 2. Insert Invitees (with is_present = true for imported presentees)
        if (presentees && Array.isArray(presentees)) {
            // Legacy meetings have no serial data of their own — the JSON array's
            // order *is* the seniority order, so index 0 -> serial 1, etc.
            for (const [index, p] of presentees.entries()) {
                // Combine prefix and name if prefix exists
                const rawName = p.name ? p.name.trim() : null;
                const rawPrefix = p.prefix ? p.prefix.trim() : null;
                const fullName = rawPrefix ? (rawName ? `${rawPrefix} ${rawName}` : rawPrefix) : rawName;

                await client.query(
                    `INSERT INTO invitees
                    (name, email, designation, department_id, office_id, meeting_id, serial, is_present)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)`,
                    [
                        fullName,
                        p.email || null,
                        p.designation || null,
                        p.department_id || null,
                        p.office_id || null,
                        meetingId,
                        index + 1
                    ]
                );
            }
        }

        // 3. Insert Agendas
        if (hasAgendas) {
            for (const [index, a] of agendas.entries()) {
                // Only the first agendum had its marker stripped (if any); the rest use their content as-is.
                const rawContent = index === 0 ? firstAgendaExtraction.content : a.content;
                const explicitSerial = (a.serial !== undefined && a.serial !== null) ? a.serial : ((a.agenda_serial !== undefined && a.agenda_serial !== null) ? a.agenda_serial : null);
                const defaultSerial = explicitSerial !== null ? explicitSerial : index + 1;
                const parsedBody = parseAgendumBody(rawContent, defaultSerial);

                let finalSerial = (a.serial === 0 || a.agenda_serial === 0 || parsedBody.isBibidha)
                    ? 0
                    : (explicitSerial !== null ? explicitSerial : (parsedBody.serial !== null ? parsedBody.serial : defaultSerial));

                const res = await client.query(
                    `INSERT INTO agenda
                    (content, resolution, agenda_serial, meeting_id)
                    VALUES ($1, $2, $3, $4) RETURNING id`,
                    [
                        parsedBody.content,
                        a.resolution,
                        finalSerial,
                        meetingId
                    ]
                );
                const agendaId = res.rows[0].id;

                if (rawContent) {
                    indexAgendaContent(agendaId, rawContent).catch(() => {});
                }
                if (a.resolution) {
                    indexResolutionContent(agendaId, a.resolution).catch(() => {});
                }
            }
        }

        await client.query('COMMIT');
        res.status(201).json({ success: true, message: 'Meeting imported successfully', meetingId });
    } catch (err) {
        await client.query('ROLLBACK');
        next(err);
    } finally {
        client.release();
    }
};

// Send meeting notice email to selected invitees
// Notice can be sent when meeting status is 'draft' or 'ongoing'
const sendNoticeEmail = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { invitee_ids, from, meeting_link } = req.body;

        if (!Array.isArray(invitee_ids) || invitee_ids.length === 0) {
            return next(new CustomError('invitee_ids must be a non-empty array', 400));
        }
        if (!from) {
            return next(new CustomError('from is required', 400));
        }

        const meetingCheck = await db.query('SELECT * FROM meetings WHERE id = $1', [id]);
        if (meetingCheck.rows.length === 0) {
            return next(new CustomError('Meeting not found', 404));
        }

        const meeting = meetingCheck.rows[0];

        // Notice can only be sent for draft or ongoing meetings
        if (meeting.status === 'past') {
            return next(new CustomError('Notice cannot be sent for completed meetings', 400));
        }

        // Filter out invitees who have already received the notice
        const inviteesResult = await db.query(
            `SELECT id, name, email, designation, notice_mail_sent FROM invitees WHERE meeting_id = $1 AND id = ANY($2::uuid[])`,
            [id, invitee_ids]
        );
        const foundInvitees = inviteesResult.rows;

        // Filter out those who already received the notice
        const eligibleInvitees = foundInvitees.filter(i => !i.notice_mail_sent);
        const alreadySent = foundInvitees.filter(i => i.notice_mail_sent).map(i => ({
            invitee_id: i.id, name: i.name, reason: 'Notice already sent'
        }));

        const recipients = eligibleInvitees.filter(i => !!i.email);
        const failed = eligibleInvitees
            .filter(i => !i.email)
            .map(i => ({ invitee_id: i.id, name: i.name, reason: 'No email address on file' }));

        // Add already sent to failed list
        failed.push(...alreadySent);

        const foundIds = new Set(foundInvitees.map(i => i.id));
        invitee_ids
            .filter(iid => !foundIds.has(iid))
            .forEach(iid => failed.push({ invitee_id: iid, reason: 'Invitee not found for this meeting' }));

        if (recipients.length === 0) {
            return next(new CustomError('None of the selected invitees are eligible for notice (already sent or no email)', 400));
        }

        // Format meeting date
        const meetingDate = new Date(meeting.meeting_date).toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });

        // Meeting type in Bangla
        const meetingTypeBangla = meeting.type === 'academic' ? 'একাডেমিক' : 'সিন্ডিকেট';
        const meetingNo = meeting.title || 'N/A';

        // Build subject
        const subject = `সভার সংবাদনা (${meetingTypeBangla} কাউন্সিলের সভা নং ${meetingNo})`;

        // Build HTML body
        const meetingLinkHtml = meeting_link
            ? `\n    <p style="margin-top: 15px;">সভার লিঙ্ক: <a href="${meeting_link}" style="color: #2563eb;">${meeting_link}</a></p>`
            : '';
        const html = `
<div style="font-family: 'Kalpurush', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
    <p>মোঃ <strong>${meetingTypeBangla} কাউন্সিলের সভা নং ${meetingNo}</strong>-এর অংশগ্রহণকারী,</p>
    
    <p style="margin-top: 15px;">আপনাকে জানানো হচ্ছে যে, <strong>${meetingDate}</strong> তারিখে একটি সভা অনুষ্ঠিত হবে।</p>
    ${meetingLinkHtml}
    <p style="margin-top: 15px;">আপনাকে ঐ সভায় উপস্থিত থাকার জন্য আন্তরিকভাবে অনুরোধ করা হচ্ছে।</p>
    
    <p style="margin-top: 25px;">বিনীত,<br/>
    রেজিস্ট্রার অফিস,<br/>
    বাংলাদেশ প্রকৌশল বিশ্ববিদ্যালয় (বুয়েট)</p>
</div>`;

        const results = await Promise.allSettled(
            recipients.map(r => sendMail({
                from,
                to: r.email,
                subject,
                html,
                attachments: []
            }))
        );

        const sent = [];
        const eligibleIds = [];
        const sendFailed = [];
        results.forEach((r, idx) => {
            const recipient = recipients[idx];
            if (r.status === 'fulfilled') {
                sent.push({ invitee_id: recipient.id, email: recipient.email });
                eligibleIds.push(recipient.id);
            } else {
                const reason = r.reason?.message || 'Failed to send';
                sendFailed.push({ invitee_id: recipient.id, email: recipient.email, reason });
                failed.push({ invitee_id: recipient.id, email: recipient.email, reason });
            }
        });

        // Update notice_mail_sent flag for successfully sent emails
        if (eligibleIds.length > 0) {
            await db.query(
                `UPDATE invitees SET notice_mail_sent = true WHERE id = ANY($1::uuid[])`,
                [eligibleIds]
            );
        }

        const statusCode = sent.length === 0 ? 502 : (failed.length > 0 ? 207 : 200);
        res.status(statusCode).json({
            success: sent.length > 0,
            message: sent.length === 0
                ? 'Failed to send notice email'
                : failed.length > 0
                    ? `Notice sent to ${sent.length} recipient(s), ${failed.length} skipped (already sent or no email)`
                    : `Notice sent successfully to ${sent.length} recipient(s)`,
            data: { sent, failed }
        });
    } catch (error) {
        next(error);
    }
};

// Send agenda email with PDF attached to selected invitees
// Agenda can only be sent when meeting status is 'ongoing'
const sendAgendaEmailBulk = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { invitee_ids, from, meeting_link } = req.body;

        if (!Array.isArray(invitee_ids) || invitee_ids.length === 0) {
            return next(new CustomError('invitee_ids must be a non-empty array', 400));
        }
        if (!from) {
            return next(new CustomError('from is required', 400));
        }

        const meetingCheck = await db.query('SELECT * FROM meetings WHERE id = $1', [id]);
        if (meetingCheck.rows.length === 0) {
            return next(new CustomError('Meeting not found', 404));
        }

        const meeting = meetingCheck.rows[0];

        // Agenda can only be sent for ongoing meetings
        if (meeting.status !== 'ongoing') {
            return next(new CustomError('Agenda can only be sent when meeting is ongoing. Current status: ' + meeting.status, 400));
        }

        // Filter out invitees who have already received the agenda
        const inviteesResult = await db.query(
            `SELECT id, name, email, designation, agenda_mail_sent FROM invitees WHERE meeting_id = $1 AND id = ANY($2::uuid[])`,
            [id, invitee_ids]
        );
        const foundInvitees = inviteesResult.rows;

        // Filter out those who already received the agenda
        const eligibleInvitees = foundInvitees.filter(i => !i.agenda_mail_sent);
        const alreadySent = foundInvitees.filter(i => i.agenda_mail_sent).map(i => ({
            invitee_id: i.id, name: i.name, reason: 'Agenda already sent'
        }));

        const recipients = eligibleInvitees.filter(i => !!i.email);
        const failed = eligibleInvitees
            .filter(i => !i.email)
            .map(i => ({ invitee_id: i.id, name: i.name, reason: 'No email address on file' }));

        // Add already sent to failed list
        failed.push(...alreadySent);

        const foundIds = new Set(foundInvitees.map(i => i.id));
        invitee_ids
            .filter(iid => !foundIds.has(iid))
            .forEach(iid => failed.push({ invitee_id: iid, reason: 'Invitee not found for this meeting' }));

        if (recipients.length === 0) {
            return next(new CustomError('None of the selected invitees are eligible for agenda (already sent or no email)', 400));
        }

        // Format meeting date
        const meetingDate = new Date(meeting.meeting_date).toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });

        // Meeting type in Bangla
        const meetingTypeBangla = meeting.type === 'academic' ? 'একাডেমিক' : 'সিন্ডিকেট';
        const meetingNo = meeting.title || 'N/A';

        // Build subject
        const subject = `সভার এজেন্ডা (${meetingTypeBangla} কাউন্সিলের সভা নং ${meetingNo})`;

        // Build HTML body
        const meetingLinkHtml = meeting_link
            ? `\n    <p style="margin-top: 15px;">সভার লিঙ্ক: <a href="${meeting_link}" style="color: #2563eb;">${meeting_link}</a></p>`
            : '';
        const html = `
<div style="font-family: 'Kalpurush', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
    <p>মোঃ <strong>${meetingTypeBangla} কাউন্সিলের সভা নং ${meetingNo}</strong>-এর অংশগ্রহণকারী,</p>
    
    <p style="margin-top: 15px;">আপনাকে জানানো হচ্ছে যে, <strong>${meetingDate}</strong> তারিখে একটি সভা অনুষ্ঠিত হবে।</p>
    ${meetingLinkHtml}
    <p style="margin-top: 15px;">সভার এজেন্ডা নিচে সংযুক্ত করা হলো। অনুগ্রহ করে এজেন্ডাগুলো পর্যালোচনা করুন।</p>
    
    <p style="margin-top: 15px;">আপনাকে ঐ সভায় উপস্থিত থাকার জন্য আন্তরিকভাবে অনুরোধ করা হচ্ছে।</p>
    
    <p style="margin-top: 25px;">বিনীত,<br/>
    রেজিস্ট্রার অফিস,<br/>
    বাংলাদেশ প্রকৌশল বিশ্ববিদ্যালয় (বুয়েট)</p>
</div>`;

        // Generate agenda PDF
        const pdfBuffer = await generateMeetingPdf(id, false);
        const mailAttachments = [{
            filename: `agenda-${meetingNo}.pdf`,
            content: pdfBuffer.toString('base64'),
            contentType: 'application/pdf'
        }];

        const results = await Promise.allSettled(
            recipients.map(r => sendMail({
                from,
                to: r.email,
                subject,
                html,
                attachments: mailAttachments
            }))
        );

        const sent = [];
        const eligibleIds = [];
        const sendFailed = [];
        results.forEach((r, idx) => {
            const recipient = recipients[idx];
            if (r.status === 'fulfilled') {
                sent.push({ invitee_id: recipient.id, email: recipient.email });
                eligibleIds.push(recipient.id);
            } else {
                const reason = r.reason?.message || 'Failed to send';
                sendFailed.push({ invitee_id: recipient.id, email: recipient.email, reason });
                failed.push({ invitee_id: recipient.id, email: recipient.email, reason });
            }
        });

        // Update agenda_mail_sent flag for successfully sent emails
        if (eligibleIds.length > 0) {
            await db.query(
                `UPDATE invitees SET agenda_mail_sent = true WHERE id = ANY($1::uuid[])`,
                [eligibleIds]
            );
        }

        const statusCode = sent.length === 0 ? 502 : (failed.length > 0 ? 207 : 200);
        res.status(statusCode).json({
            success: sent.length > 0,
            message: sent.length === 0
                ? 'Failed to send agenda email'
                : failed.length > 0
                    ? `Agenda sent to ${sent.length} recipient(s), ${failed.length} skipped (already sent or no email)`
                    : `Agenda sent successfully to ${sent.length} recipient(s)`,
            data: { sent, failed }
        });
    } catch (error) {
        next(error);
    }
};

// Send resolution email with PDF attached to selected invitees
// Resolution can only be sent when meeting is completed
const sendResolutionEmail = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { invitee_ids, from, meeting_link } = req.body;

        if (!Array.isArray(invitee_ids) || invitee_ids.length === 0) {
            return next(new CustomError('invitee_ids must be a non-empty array', 400));
        }
        if (!from) {
            return next(new CustomError('from is required', 400));
        }

        const meetingCheck = await db.query('SELECT * FROM meetings WHERE id = $1', [id]);
        if (meetingCheck.rows.length === 0) {
            return next(new CustomError('Meeting not found', 404));
        }

        const meeting = meetingCheck.rows[0];

        // Resolution can only be sent for completed meetings
        if (meeting.is_completed !== true) {
            return next(new CustomError('Resolution can only be sent when meeting is completed.', 400));
        }

        // Filter out invitees who have already received the resolution
        const inviteesResult = await db.query(
            `SELECT id, name, email, designation, resolution_mail_sent FROM invitees WHERE meeting_id = $1 AND id = ANY($2::uuid[])`,
            [id, invitee_ids]
        );
        const foundInvitees = inviteesResult.rows;

        // Filter out those who already received the resolution
        const eligibleInvitees = foundInvitees.filter(i => !i.resolution_mail_sent);
        const alreadySent = foundInvitees.filter(i => i.resolution_mail_sent).map(i => ({
            invitee_id: i.id, name: i.name, reason: 'Resolution already sent'
        }));

        const recipients = eligibleInvitees.filter(i => !!i.email);
        const failed = eligibleInvitees
            .filter(i => !i.email)
            .map(i => ({ invitee_id: i.id, name: i.name, reason: 'No email address on file' }));

        // Add already sent to failed list
        failed.push(...alreadySent);

        const foundIds = new Set(foundInvitees.map(i => i.id));
        invitee_ids
            .filter(iid => !foundIds.has(iid))
            .forEach(iid => failed.push({ invitee_id: iid, reason: 'Invitee not found for this meeting' }));

        if (recipients.length === 0) {
            return next(new CustomError('None of the selected invitees are eligible for resolution (already sent or no email)', 400));
        }

        // Format meeting date
        const meetingDate = new Date(meeting.meeting_date).toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });

        // Meeting type in Bangla
        const meetingTypeBangla = meeting.type === 'academic' ? 'একাডেমিক' : 'সিন্ডিকেট';
        const meetingNo = meeting.title || 'N/A';

        // Build subject
        const subject = `সভার সিদ্ধান্ত (${meetingTypeBangla} কাউন্সিলের সভা নং ${meetingNo})`;

        // Build HTML body
        const meetingLinkHtml = meeting_link
            ? `\n    <p style="margin-top: 15px;">সভার লিঙ্ক: <a href="${meeting_link}" style="color: #2563eb;">${meeting_link}</a></p>`
            : '';
        const html = `
<div style="font-family: 'Kalpurush', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
    <p>মোঃ <strong>${meetingTypeBangla} কাউন্সিলের সভা নং ${meetingNo}</strong>-এর অংশগ্রহণকারী,</p>
    
    <p style="margin-top: 15px;">আপনাকে জানানো হচ্ছে যে, <strong>${meetingDate}</strong> তারিখে অনুষ্ঠিত সভার সিদ্ধান্ত সংযুক্ত করা হলো।</p>
    ${meetingLinkHtml}
    <p style="margin-top: 15px;">অনুগ্রহ করে সিদ্ধান্তগুলো পর্যালোচনা করুন।</p>
    
    <p style="margin-top: 25px;">বিনীত,<br/>
    রেজিস্ট্রার অফিস,<br/>
    বাংলাদেশ প্রকৌশল বিশ্ববিদ্যালয় (বুয়েট)</p>
</div>`;

        // Generate resolution PDF
        const pdfBuffer = await generateMeetingPdf(id, true);
        const mailAttachments = [{
            filename: `resolution-${meetingNo}.pdf`,
            content: pdfBuffer.toString('base64'),
            contentType: 'application/pdf'
        }];

        const results = await Promise.allSettled(
            recipients.map(r => sendMail({
                from,
                to: r.email,
                subject,
                html,
                attachments: mailAttachments
            }))
        );

        const sent = [];
        const eligibleIds = [];
        const sendFailed = [];
        results.forEach((r, idx) => {
            const recipient = recipients[idx];
            if (r.status === 'fulfilled') {
                sent.push({ invitee_id: recipient.id, email: recipient.email });
                eligibleIds.push(recipient.id);
            } else {
                const reason = r.reason?.message || 'Failed to send';
                sendFailed.push({ invitee_id: recipient.id, email: recipient.email, reason });
                failed.push({ invitee_id: recipient.id, email: recipient.email, reason });
            }
        });

        // Update resolution_mail_sent flag for successfully sent emails
        if (eligibleIds.length > 0) {
            await db.query(
                `UPDATE invitees SET resolution_mail_sent = true WHERE id = ANY($1::uuid[])`,
                [eligibleIds]
            );
        }

        const statusCode = sent.length === 0 ? 502 : (failed.length > 0 ? 207 : 200);
        res.status(statusCode).json({
            success: sent.length > 0,
            message: sent.length === 0
                ? 'Failed to send resolution email'
                : failed.length > 0
                    ? `Resolution sent to ${sent.length} recipient(s), ${failed.length} skipped (already sent or no email)`
                    : `Resolution sent successfully to ${sent.length} recipient(s)`,
            data: { sent, failed }
        });
    } catch (error) {
        next(error);
    }
};

// Email drafts: one saved draft per (meeting, mode). A draft stores the
// invitee subset plus everything not derivable from invitee ids
// (from/subject/body/attach flag/extra attachments as base64 JSON).
const DRAFT_MODES = ['notice', 'agenda', 'resolution'];
const MAX_DRAFT_ATTACH_BYTES = 10 * 1024 * 1024;

const getEmailDrafts = async (req, res, next) => {
    try {
        const { id } = req.params;
        const meetingRes = await db.query('SELECT id FROM meetings WHERE id = $1', [id]);
        if (meetingRes.rows.length === 0) return next(new CustomError('Meeting not found', 404));
        const result = await db.query('SELECT * FROM email_drafts WHERE meeting_id = $1', [id]);
        const drafts = { notice: null, agenda: null, resolution: null };
        for (const row of result.rows) {
            if (DRAFT_MODES.includes(row.mode)) drafts[row.mode] = row;
        }
        res.status(200).json({ success: true, data: drafts });
    } catch (error) {
        next(error);
    }
};

const upsertEmailDraft = async (req, res, next) => {
    try {
        const { id, mode } = req.params;
        if (!DRAFT_MODES.includes(mode)) return next(new CustomError('Invalid draft mode', 400));
        const meetingRes = await db.query('SELECT id FROM meetings WHERE id = $1', [id]);
        if (meetingRes.rows.length === 0) return next(new CustomError('Meeting not found', 404));

        const { invitee_ids, from, subject, body, attach_pdf, attachments } = req.body || {};
        // Keep only ids that still belong to this meeting (drops stale/foreign ids).
        const sentIds = Array.isArray(invitee_ids) ? invitee_ids.filter(x => typeof x === 'string') : [];
        let validIds = sentIds;
        if (sentIds.length > 0) {
            const invRes = await db.query('SELECT id FROM invitees WHERE meeting_id = $1 AND id = ANY($2::uuid[])', [id, sentIds]);
            validIds = invRes.rows.map(r => r.id);
        }
        const files = (Array.isArray(attachments) ? attachments : [])
            .filter(a => a && typeof a.filename === 'string' && typeof a.content === 'string')
            .map(a => ({
                filename: a.filename.slice(0, 255),
                content: a.content,
                contentType: a.contentType || 'application/octet-stream'
            }));
        const totalBytes = files.reduce((n, f) => n + Math.ceil((f.content.length * 3) / 4), 0);
        if (totalBytes > MAX_DRAFT_ATTACH_BYTES) return next(new CustomError('Draft attachments exceed 10 MB', 400));

        const result = await db.query(
            `INSERT INTO email_drafts (meeting_id, mode, invitee_ids, from_email, subject, body, attach_pdf, attachments, created_by, updated_at)
             VALUES ($1, $2, $3::uuid[], $4, $5, $6, $7, $8::jsonb, $9, NOW())
             ON CONFLICT (meeting_id, mode)
             DO UPDATE SET invitee_ids = EXCLUDED.invitee_ids, from_email = EXCLUDED.from_email,
                 subject = EXCLUDED.subject, body = EXCLUDED.body, attach_pdf = EXCLUDED.attach_pdf,
                 attachments = EXCLUDED.attachments, created_by = EXCLUDED.created_by, updated_at = NOW()
             RETURNING *`,
            [id, mode, validIds, from || null, subject ?? null, body ?? null, attach_pdf !== false, JSON.stringify(files), req.user?.id || null]
        );
        res.status(200).json({ success: true, message: 'Draft saved', data: result.rows[0] });
    } catch (error) {
        next(error);
    }
};

const deleteEmailDraft = async (req, res, next) => {
    try {
        const { id, mode } = req.params;
        if (!DRAFT_MODES.includes(mode)) return next(new CustomError('Invalid draft mode', 400));
        await db.query('DELETE FROM email_drafts WHERE meeting_id = $1 AND mode = $2', [id, mode]);
        res.status(200).json({ success: true, message: 'Draft discarded' });
    } catch (error) {
        next(error);
    }
};

const verifyHandoverPassword = async (req, password) => {
    if (!password) {
        throw new CustomError('Password is required to confirm handover.', 400);
    }
    const userId = req.user?.id;
    if (!userId) {
        throw new CustomError('User authentication required.', 401);
    }

    try {
        const authServiceUrl = process.env.AUTH_SERVICE_URL || 'http://auth_service:8000';
        const headers = {};
        if (req.headers?.cookie) headers.cookie = req.headers.cookie;
        if (req.headers?.authorization) headers.authorization = req.headers.authorization;

        const authRes = await axios.post(`${authServiceUrl}/verify-password`, { password }, {
            headers,
            timeout: 3000
        });
        if (authRes.data?.success) return true;
    } catch (err) {
        if (err.response?.status === 401) {
            throw new CustomError('Incorrect password. Handover verification failed.', 401);
        }
        const userRes = await db.query('SELECT password FROM users WHERE id = $1', [userId]);
        if (userRes.rows.length === 0) {
            throw new CustomError('User account not found.', 404);
        }
        const isValid = await bcrypt.compare(password, userRes.rows[0].password);
        if (!isValid) {
            throw new CustomError('Incorrect password. Handover verification failed.', 401);
        }
    }
};

const handoverAgenda = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { password } = req.body;
        await verifyHandoverPassword(req, password);

        const meeting = await loadMeeting(req);
        if (!meeting) return next(new CustomError('Meeting not found', 404));

        const access = calculateMeetingAccess(meeting, req.user);
        if (!access.canHandoverAgenda) {
            return next(new CustomError('You do not have permission to handover agenda for this meeting.', 403));
        }

        const levelToSet = (req.user.role === 'admin' || req.user.role === 'superadmin') ? 999999 : req.user.role_level;
        await db.query('UPDATE meetings SET agenda_handover_level = $1 WHERE id = $2', [levelToSet, id]);
        res.status(200).json({ success: true, message: 'Agenda handed over to upper levels successfully.' });
    } catch (err) {
        next(err);
    }
};

const handoverSuppliAgenda = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { password } = req.body;
        await verifyHandoverPassword(req, password);

        const meeting = await loadMeeting(req);
        if (!meeting) return next(new CustomError('Meeting not found', 404));

        const access = calculateMeetingAccess(meeting, req.user);
        if (!access.canHandoverSuppliAgenda) {
            return next(new CustomError('You do not have permission to handover supplementary agenda.', 403));
        }

        const levelToSet = (req.user.role === 'admin' || req.user.role === 'superadmin') ? 999999 : req.user.role_level;
        await db.query('UPDATE meetings SET suppli_agenda_handover_level = $1 WHERE id = $2', [levelToSet, id]);
        res.status(200).json({ success: true, message: 'Supplementary agenda handed over to upper levels.' });
    } catch (err) {
        next(err);
    }
};

const getUserLockInfo = (user) => {
    const roleTitle = (user?.role === 'admin' || user?.role === 'superadmin')
        ? 'Admin'
        : (user?.level_title || user?.role || 'Editor');
    const username = user?.username || user?.name || 'User';
    return { roleTitle, username };
};

const lockSuppliAgenda = async (req, res, next) => {
    try {
        const { id } = req.params;
        const meeting = await loadMeeting(req);
        if (!meeting) return next(new CustomError('Meeting not found', 404));

        const access = calculateMeetingAccess(meeting, req.user);
        if (!access.canLockSuppliAgenda) {
            return next(new CustomError('You do not have permission to lock supplementary agenda.', 403));
        }

        const levelToSet = (req.user.role === 'admin' || req.user.role === 'superadmin') ? 999999 : req.user.role_level;
        const { roleTitle, username } = getUserLockInfo(req.user);
        await db.query(
            'UPDATE meetings SET suppli_agenda_locked_level = $1, suppli_agenda_locked_by_username = $2, suppli_agenda_locked_by_role = $3 WHERE id = $4',
            [levelToSet, username, roleTitle, id]
        );
        res.status(200).json({ success: true, message: 'Supplementary agenda locked successfully.' });
    } catch (err) {
        next(err);
    }
};

const unlockSuppliAgenda = async (req, res, next) => {
    try {
        const { id } = req.params;
        const meeting = await loadMeeting(req);
        if (!meeting) return next(new CustomError('Meeting not found', 404));

        const access = calculateMeetingAccess(meeting, req.user);
        if (!access.canUnlockSuppliAgenda) {
            return next(new CustomError('Lower levels cannot unlock supplementary agenda locked by a higher level.', 403));
        }

        await db.query(
            'UPDATE meetings SET suppli_agenda_locked_level = NULL, suppli_agenda_handover_level = NULL, suppli_agenda_locked_by_username = NULL, suppli_agenda_locked_by_role = NULL WHERE id = $1',
            [id]
        );
        res.status(200).json({ success: true, message: 'Supplementary agenda unlocked successfully.' });
    } catch (err) {
        next(err);
    }
};

const handoverResolution = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { password } = req.body;
        await verifyHandoverPassword(req, password);

        const meeting = await loadMeeting(req);
        if (!meeting) return next(new CustomError('Meeting not found', 404));

        const access = calculateMeetingAccess(meeting, req.user);
        if (!access.canHandoverResolution) {
            return next(new CustomError('You do not have permission to handover resolution for this meeting.', 403));
        }

        const levelToSet = (req.user.role === 'admin' || req.user.role === 'superadmin') ? 999999 : req.user.role_level;
        await db.query('UPDATE meetings SET resolution_handover_level = $1 WHERE id = $2', [levelToSet, id]);
        res.status(200).json({ success: true, message: 'Resolution handed over to upper levels successfully.' });
    } catch (err) {
        next(err);
    }
};

const lockAgenda = async (req, res, next) => {
    try {
        const { id } = req.params;
        const meeting = await loadMeeting(req);
        if (!meeting) return next(new CustomError('Meeting not found', 404));

        const access = calculateMeetingAccess(meeting, req.user);
        if (!access.canLockAgenda) {
            return next(new CustomError('You do not have permission to lock agenda.', 403));
        }

        const levelToSet = (req.user.role === 'admin' || req.user.role === 'superadmin') ? 999999 : req.user.role_level;
        const { roleTitle, username } = getUserLockInfo(req.user);
        await db.query(
            'UPDATE meetings SET agenda_locked_level = $1, agenda_locked_by_username = $2, agenda_locked_by_role = $3 WHERE id = $4',
            [levelToSet, username, roleTitle, id]
        );
        res.status(200).json({ success: true, message: 'Agenda locked successfully.' });
    } catch (err) {
        next(err);
    }
};

const unlockAgenda = async (req, res, next) => {
    try {
        const { id } = req.params;
        const meeting = await loadMeeting(req);
        if (!meeting) return next(new CustomError('Meeting not found', 404));

        const access = calculateMeetingAccess(meeting, req.user);
        if (!access.canUnlockAgenda) {
            return next(new CustomError('Lower levels cannot unlock an agenda locked by a higher level.', 403));
        }

        await db.query(
            'UPDATE meetings SET agenda_locked_level = NULL, agenda_handover_level = NULL, agenda_locked_by_username = NULL, agenda_locked_by_role = NULL WHERE id = $1',
            [id]
        );
        res.status(200).json({ success: true, message: 'Agenda unlocked successfully.' });
    } catch (err) {
        next(err);
    }
};

const lockResolution = async (req, res, next) => {
    try {
        const { id } = req.params;
        const meeting = await loadMeeting(req);
        if (!meeting) return next(new CustomError('Meeting not found', 404));

        const access = calculateMeetingAccess(meeting, req.user);
        if (!access.canLockResolution) {
            return next(new CustomError('You do not have permission to lock resolution.', 403));
        }

        const levelToSet = (req.user.role === 'admin' || req.user.role === 'superadmin') ? 999999 : req.user.role_level;
        const { roleTitle, username } = getUserLockInfo(req.user);
        await db.query(
            'UPDATE meetings SET resolution_locked_level = $1, resolution_locked_by_username = $2, resolution_locked_by_role = $3 WHERE id = $4',
            [levelToSet, username, roleTitle, id]
        );
        res.status(200).json({ success: true, message: 'Resolution locked successfully.' });
    } catch (err) {
        next(err);
    }
};

const unlockResolution = async (req, res, next) => {
    try {
        const { id } = req.params;
        const meeting = await loadMeeting(req);
        if (!meeting) return next(new CustomError('Meeting not found', 404));

        const access = calculateMeetingAccess(meeting, req.user);
        if (!access.canUnlockResolution) {
            return next(new CustomError('Lower levels cannot unlock a resolution locked by a higher level.', 403));
        }

        await db.query(
            'UPDATE meetings SET resolution_locked_level = NULL, resolution_handover_level = NULL, resolution_locked_by_username = NULL, resolution_locked_by_role = NULL WHERE id = $1',
            [id]
        );
        res.status(200).json({ success: true, message: 'Resolution unlocked successfully.' });
    } catch (err) {
        next(err);
    }
};

const lockMeeting = async (req, res, next) => {
    try {
        const { id } = req.params;
        const meeting = await loadMeeting(req);
        if (!meeting) return next(new CustomError('Meeting not found', 404));

        const access = calculateMeetingAccess(meeting, req.user);
        if (!access.canLockMeeting) {
            return next(new CustomError('You do not have permission to lock meeting.', 403));
        }

        const levelToSet = (req.user.role === 'admin' || req.user.role === 'superadmin') ? 999999 : req.user.role_level;
        const { roleTitle, username } = getUserLockInfo(req.user);
        await db.query(
            'UPDATE meetings SET meeting_locked_level = $1, meeting_locked_by_username = $2, meeting_locked_by_role = $3 WHERE id = $4',
            [levelToSet, username, roleTitle, id]
        );
        res.status(200).json({ success: true, message: 'Meeting locked successfully.' });
    } catch (err) {
        next(err);
    }
};

const unlockMeeting = async (req, res, next) => {
    try {
        const { id } = req.params;
        const meeting = await loadMeeting(req);
        if (!meeting) return next(new CustomError('Meeting not found', 404));

        const access = calculateMeetingAccess(meeting, req.user);
        if (!access.canUnlockMeeting) {
            return next(new CustomError('Lower levels cannot unlock a meeting info locked by a higher level.', 403));
        }

        await db.query(
            'UPDATE meetings SET meeting_locked_level = NULL, meeting_locked_by_username = NULL, meeting_locked_by_role = NULL WHERE id = $1',
            [id]
        );
        res.status(200).json({ success: true, message: 'Meeting unlocked successfully.' });
    } catch (err) {
        next(err);
    }
};

const lockInvitees = async (req, res, next) => {
    try {
        const { id } = req.params;
        const meeting = await loadMeeting(req);
        if (!meeting) return next(new CustomError('Meeting not found', 404));

        const access = calculateMeetingAccess(meeting, req.user);
        if (!access.canLockInvitees) {
            return next(new CustomError('You do not have permission to lock invitees.', 403));
        }

        const levelToSet = (req.user.role === 'admin' || req.user.role === 'superadmin') ? 999999 : req.user.role_level;
        const { roleTitle, username } = getUserLockInfo(req.user);
        await db.query(
            'UPDATE meetings SET invitees_locked_level = $1, invitees_locked_by_username = $2, invitees_locked_by_role = $3 WHERE id = $4',
            [levelToSet, username, roleTitle, id]
        );
        res.status(200).json({ success: true, message: 'Invitees locked successfully.' });
    } catch (err) {
        next(err);
    }
};

const lockPermissions = async (req, res, next) => {
    try {
        const { id } = req.params;
        const meeting = await loadMeeting(req);
        if (!meeting) return next(new CustomError('Meeting not found', 404));

        const access = calculateMeetingAccess(meeting, req.user);
        if (!access.canLockPermissions) {
            return next(new CustomError('You do not have permission to lock permissions.', 403));
        }

        const levelToSet = (req.user.role === 'admin' || req.user.role === 'superadmin') ? 999999 : req.user.role_level;
        const { roleTitle, username } = getUserLockInfo(req.user);
        await db.query(
            'UPDATE meetings SET permissions_locked_level = $1, permissions_locked_by_username = $2, permissions_locked_by_role = $3 WHERE id = $4',
            [levelToSet, username, roleTitle, id]
        );
        res.status(200).json({ success: true, message: 'Meeting permissions locked successfully.' });
    } catch (err) {
        next(err);
    }
};

const unlockPermissions = async (req, res, next) => {
    try {
        const { id } = req.params;
        const meeting = await loadMeeting(req);
        if (!meeting) return next(new CustomError('Meeting not found', 404));

        const access = calculateMeetingAccess(meeting, req.user);
        if (!access.canUnlockPermissions) {
            return next(new CustomError('Lower levels cannot unlock permissions locked by a higher level.', 403));
        }

        await db.query(
            'UPDATE meetings SET permissions_locked_level = NULL, permissions_locked_by_username = NULL, permissions_locked_by_role = NULL WHERE id = $1',
            [id]
        );
        res.status(200).json({ success: true, message: 'Meeting permissions unlocked successfully.' });
    } catch (err) {
        next(err);
    }
};

const lockDescription = async (req, res, next) => {
    try {
        const { id } = req.params;
        const meeting = await loadMeeting(req);
        if (!meeting) return next(new CustomError('Meeting not found', 404));

        const access = calculateMeetingAccess(meeting, req.user);
        if (!access.canLockDescription) {
            return next(new CustomError('You do not have permission to lock description.', 403));
        }

        const levelToSet = (req.user.role === 'admin' || req.user.role === 'superadmin') ? 999999 : req.user.role_level;
        const { roleTitle, username } = getUserLockInfo(req.user);
        await db.query(
            'UPDATE meetings SET description_locked_level = $1, description_locked_by_username = $2, description_locked_by_role = $3 WHERE id = $4',
            [levelToSet, username, roleTitle, id]
        );
        res.status(200).json({ success: true, message: 'Meeting description locked successfully.' });
    } catch (err) {
        next(err);
    }
};

const unlockDescription = async (req, res, next) => {
    try {
        const { id } = req.params;
        const meeting = await loadMeeting(req);
        if (!meeting) return next(new CustomError('Meeting not found', 404));

        const access = calculateMeetingAccess(meeting, req.user);
        if (!access.canUnlockDescription) {
            return next(new CustomError('Lower levels cannot unlock description locked by a higher level.', 403));
        }

        await db.query(
            'UPDATE meetings SET description_locked_level = NULL, description_locked_by_username = NULL, description_locked_by_role = NULL WHERE id = $1',
            [id]
        );
        res.status(200).json({ success: true, message: 'Meeting description unlocked successfully.' });
    } catch (err) {
        next(err);
    }
};

const unlockInvitees = async (req, res, next) => {
    try {
        const { id } = req.params;
        const meeting = await loadMeeting(req);
        if (!meeting) return next(new CustomError('Meeting not found', 404));

        const access = calculateMeetingAccess(meeting, req.user);
        if (!access.canUnlockInvitees) {
            return next(new CustomError('Lower levels cannot unlock invitees locked by a higher level.', 403));
        }

        await db.query(
            'UPDATE meetings SET invitees_locked_level = NULL, invitees_locked_by_username = NULL, invitees_locked_by_role = NULL WHERE id = $1',
            [id]
        );
        res.status(200).json({ success: true, message: 'Invitees unlocked successfully.' });
    } catch (err) {
        next(err);
    }
};

const lockPresentees = async (req, res, next) => {
    try {
        const { id } = req.params;
        const meeting = await loadMeeting(req);
        if (!meeting) return next(new CustomError('Meeting not found', 404));

        const access = calculateMeetingAccess(meeting, req.user);
        if (!access.canLockPresentees) {
            return next(new CustomError('You do not have permission to lock presentees.', 403));
        }

        const levelToSet = (req.user.role === 'admin' || req.user.role === 'superadmin') ? 999999 : req.user.role_level;
        const { roleTitle, username } = getUserLockInfo(req.user);
        await db.query(
            'UPDATE meetings SET presentees_locked_level = $1, presentees_locked_by_username = $2, presentees_locked_by_role = $3 WHERE id = $4',
            [levelToSet, username, roleTitle, id]
        );
        res.status(200).json({ success: true, message: 'Presentees locked successfully.' });
    } catch (err) {
        next(err);
    }
};

const unlockPresentees = async (req, res, next) => {
    try {
        const { id } = req.params;
        const meeting = await loadMeeting(req);
        if (!meeting) return next(new CustomError('Meeting not found', 404));

        const access = calculateMeetingAccess(meeting, req.user);
        if (!access.canUnlockPresentees) {
            return next(new CustomError('Lower levels cannot unlock presentees locked by a higher level.', 403));
        }

        await db.query(
            'UPDATE meetings SET presentees_locked_level = NULL, presentees_locked_by_username = NULL, presentees_locked_by_role = NULL WHERE id = $1',
            [id]
        );
        res.status(200).json({ success: true, message: 'Presentees unlocked successfully.' });
    } catch (err) {
        next(err);
    }
};

const lockConclusion = async (req, res, next) => {
    try {
        const { id } = req.params;
        const meeting = await loadMeeting(req);
        if (!meeting) return next(new CustomError('Meeting not found', 404));

        const access = calculateMeetingAccess(meeting, req.user);
        if (!access.canLockConclusion) {
            return next(new CustomError('You do not have permission to lock conclusion.', 403));
        }

        const levelToSet = (req.user.role === 'admin' || req.user.role === 'superadmin') ? 999999 : req.user.role_level;
        const { roleTitle, username } = getUserLockInfo(req.user);
        await db.query(
            'UPDATE meetings SET conclusion_locked_level = $1, conclusion_locked_by_username = $2, conclusion_locked_by_role = $3 WHERE id = $4',
            [levelToSet, username, roleTitle, id]
        );
        res.status(200).json({ success: true, message: 'Conclusion locked successfully.' });
    } catch (err) {
        next(err);
    }
};

const unlockConclusion = async (req, res, next) => {
    try {
        const { id } = req.params;
        const meeting = await loadMeeting(req);
        if (!meeting) return next(new CustomError('Meeting not found', 404));

        const access = calculateMeetingAccess(meeting, req.user);
        if (!access.canUnlockConclusion) {
            return next(new CustomError('Lower levels cannot unlock a conclusion locked by a higher level.', 403));
        }

        await db.query(
            'UPDATE meetings SET conclusion_locked_level = NULL, conclusion_locked_by_username = NULL, conclusion_locked_by_role = NULL WHERE id = $1',
            [id]
        );
        res.status(200).json({ success: true, message: 'Conclusion unlocked successfully.' });
    } catch (err) {
        next(err);
    }
};

const lockEmail = async (req, res, next) => {
    try {
        const { id } = req.params;
        const meeting = await loadMeeting(req);
        if (!meeting) return next(new CustomError('Meeting not found', 404));

        const access = calculateMeetingAccess(meeting, req.user);
        if (!access.canLockEmail) {
            return next(new CustomError('You do not have permission to lock email functionality.', 403));
        }

        const levelToSet = (req.user.role === 'admin' || req.user.role === 'superadmin') ? 999999 : req.user.role_level;
        const { roleTitle, username } = getUserLockInfo(req.user);
        await db.query(
            'UPDATE meetings SET email_locked_level = $1, email_locked_by_username = $2, email_locked_by_role = $3 WHERE id = $4',
            [levelToSet, username, roleTitle, id]
        );
        res.status(200).json({ success: true, message: 'Email functionality locked successfully.' });
    } catch (err) {
        next(err);
    }
};

const unlockEmail = async (req, res, next) => {
    try {
        const { id } = req.params;
        const meeting = await loadMeeting(req);
        if (!meeting) return next(new CustomError('Meeting not found', 404));

        const access = calculateMeetingAccess(meeting, req.user);
        if (!access.canUnlockEmail) {
            return next(new CustomError('Lower levels cannot unlock email functionality locked by a higher level.', 403));
        }

        await db.query(
            'UPDATE meetings SET email_locked_level = NULL, email_locked_by_username = NULL, email_locked_by_role = NULL WHERE id = $1',
            [id]
        );
        res.status(200).json({ success: true, message: 'Email functionality unlocked successfully.' });
    } catch (err) {
        next(err);
    }
};

const completeMeeting = async (req, res, next) => {
    const client = await db.pool.connect();
    try {
        const { id } = req.params;
        const { title } = req.body;
        const meeting = await loadMeeting(req);
        if (!meeting) return next(new CustomError('Meeting not found', 404));

        if (title && meeting.title !== title) {
            return next(new CustomError('Meeting serial number does not match confirmation', 400));
        }

        const isAdmin = req.user.role === 'admin';
        const settingRes = await client.query("SELECT value FROM system_settings WHERE key = 'min_completed_level'");
        const minLevel = settingRes.rows.length > 0 ? parseInt(settingRes.rows[0].value, 10) : 1;

        const userLevel = req.user.role_level !== null ? parseInt(req.user.role_level, 10) : 0;
        if (!isAdmin && userLevel < minLevel) {
            return next(new CustomError(`Forbidden. Minimum level required to mark meeting completed.`, 403));
        }

        await client.query('BEGIN');

        // 1. Update meeting status and completion flags
        await client.query(
            `UPDATE meetings SET status = 'past', is_completed = TRUE, completed_at = CURRENT_TIMESTAMP, completed_by = $1 WHERE id = $2`,
            [req.user.id, id]
        );

        await client.query('COMMIT');
        res.status(200).json({ success: true, message: 'Meeting marked as completed.' });
    } catch (err) {
        await client.query('ROLLBACK');
        next(err);
    } finally {
        client.release();
    }
};

const sendBackAgenda = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { target_level } = req.body;
        const meeting = await loadMeeting(req);
        if (!meeting) return next(new CustomError('Meeting not found', 404));

        const access = calculateMeetingAccess(meeting, req.user);
        if (!access.canSendBackAgenda) {
            return next(new CustomError('You cannot send back agenda. Only upper levels can send back handed over items.', 403));
        }

        const targetLevelInt = parseInt(target_level, 10);
        if (Number.isNaN(targetLevelInt)) {
            return next(new CustomError('target_level must be a valid integer', 400));
        }

        const newHandoverLevel = targetLevelInt <= 1 ? null : targetLevelInt - 1;
        await db.query('UPDATE meetings SET agenda_handover_level = $1 WHERE id = $2', [newHandoverLevel, id]);
        res.status(200).json({ success: true, message: `Agenda sent back to Level ${targetLevelInt}.` });
    } catch (err) {
        next(err);
    }
};

const sendBackResolution = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { target_level } = req.body;
        const meeting = await loadMeeting(req);
        if (!meeting) return next(new CustomError('Meeting not found', 404));

        const access = calculateMeetingAccess(meeting, req.user);
        if (!access.canSendBackResolution) {
            return next(new CustomError('You cannot send back resolution. Only upper levels can send back handed over items.', 403));
        }

        const targetLevelInt = parseInt(target_level, 10);
        if (Number.isNaN(targetLevelInt)) {
            return next(new CustomError('target_level must be a valid integer', 400));
        }

        const newHandoverLevel = targetLevelInt <= 1 ? null : targetLevelInt - 1;
        await db.query('UPDATE meetings SET resolution_handover_level = $1 WHERE id = $2', [newHandoverLevel, id]);
        res.status(200).json({ success: true, message: `Resolution sent back to Level ${targetLevelInt}.` });
    } catch (err) {
        next(err);
    }
};

const sendBackResolutionStatus = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { target_level } = req.body;
        const meeting = await loadMeeting(req);
        if (!meeting) return next(new CustomError('Meeting not found', 404));

        const access = calculateMeetingAccess(meeting, req.user);
        if (!access.canSendBackResolutionStatus) {
            return next(new CustomError('You cannot send back resolution status. Only upper levels can send back handed over items.', 403));
        }

        const targetLevelInt = parseInt(target_level, 10);
        if (Number.isNaN(targetLevelInt)) {
            return next(new CustomError('target_level must be a valid integer', 400));
        }

        const newHandoverLevel = targetLevelInt <= 1 ? null : targetLevelInt - 1;
        await db.query('UPDATE meetings SET resolution_status_handover_level = $1 WHERE id = $2', [newHandoverLevel, id]);
        res.status(200).json({ success: true, message: `Resolution Status sent back to Level ${targetLevelInt}.` });
    } catch (err) {
        next(err);
    }
};

const handoverResolutionStatus = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { password } = req.body;
        await verifyHandoverPassword(req, password);

        const meeting = await loadMeeting(req);
        if (!meeting) return next(new CustomError('Meeting not found', 404));

        const access = calculateMeetingAccess(meeting, req.user);
        if (!access.canHandoverResolutionStatus) {
            return next(new CustomError('You do not have permission to handover resolution status.', 403));
        }

        const levelToSet = (req.user.role === 'admin' || req.user.role === 'superadmin') ? 999999 : req.user.role_level;
        await db.query('UPDATE meetings SET resolution_status_handover_level = $1 WHERE id = $2', [levelToSet, id]);
        res.status(200).json({ success: true, message: 'Resolution Status handed over to upper levels.' });
    } catch (err) {
        next(err);
    }
};

const lockResolutionStatus = async (req, res, next) => {
    try {
        const { id } = req.params;
        const meeting = await loadMeeting(req);
        if (!meeting) return next(new CustomError('Meeting not found', 404));

        const access = calculateMeetingAccess(meeting, req.user);
        if (!access.canLockResolutionStatus) {
            return next(new CustomError('You do not have permission to lock resolution status.', 403));
        }

        const levelToSet = (req.user.role === 'admin' || req.user.role === 'superadmin') ? 999999 : req.user.role_level;
        const { roleTitle, username } = getUserLockInfo(req.user);
        await db.query(
            'UPDATE meetings SET resolution_status_locked_level = $1, resolution_status_locked_by_username = $2, resolution_status_locked_by_role = $3 WHERE id = $4',
            [levelToSet, username, roleTitle, id]
        );
        res.status(200).json({ success: true, message: 'Resolution Status locked successfully.' });
    } catch (err) {
        next(err);
    }
};

const unlockResolutionStatus = async (req, res, next) => {
    try {
        const { id } = req.params;
        const meeting = await loadMeeting(req);
        if (!meeting) return next(new CustomError('Meeting not found', 404));

        const access = calculateMeetingAccess(meeting, req.user);
        if (!access.canUnlockResolutionStatus) {
            return next(new CustomError('Lower levels cannot unlock resolution status locked by a higher level.', 403));
        }

        await db.query(
            'UPDATE meetings SET resolution_status_locked_level = NULL, resolution_status_handover_level = NULL, resolution_status_locked_by_username = NULL, resolution_status_locked_by_role = NULL WHERE id = $1',
            [id]
        );
        res.status(200).json({ success: true, message: 'Resolution Status unlocked successfully.' });
    } catch (err) {
        next(err);
    }
};

const sendBackSuppliAgenda = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { target_level } = req.body;
        const meeting = await loadMeeting(req);
        if (!meeting) return next(new CustomError('Meeting not found', 404));

        const access = calculateMeetingAccess(meeting, req.user);
        if (!access.canSendBackSuppliAgenda) {
            return next(new CustomError('You cannot send back supplementary agenda. Only upper levels can send back handed over items.', 403));
        }

        const targetLevelInt = parseInt(target_level, 10);
        if (Number.isNaN(targetLevelInt)) {
            return next(new CustomError('target_level must be a valid integer', 400));
        }

        const newHandoverLevel = targetLevelInt <= 1 ? null : targetLevelInt - 1;
        await db.query('UPDATE meetings SET suppli_agenda_handover_level = $1 WHERE id = $2', [newHandoverLevel, id]);
        res.status(200).json({ success: true, message: `Supplementary agenda sent back to Level ${targetLevelInt}.` });
    } catch (err) {
        next(err);
    }
};

const updateMeetingSignatures = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { president_signature, secretary_signature, president_signature_image, secretary_signature_image } = req.body;

        const meetingResult = await db.query('SELECT id FROM meetings WHERE id = $1', [id]);
        if (meetingResult.rows.length === 0) {
            return next(new CustomError('Meeting not found', 404));
        }

        await db.query(
            `UPDATE meetings 
             SET president_signature = COALESCE($1, president_signature), 
                 secretary_signature = COALESCE($2, secretary_signature),
                 president_signature_image = $3,
                 secretary_signature_image = $4
             WHERE id = $5`,
            [president_signature ?? '', secretary_signature ?? '', president_signature_image ?? '', secretary_signature_image ?? '', id]
        );

        res.status(200).json({ success: true, message: 'Meeting signatures updated' });
    } catch (error) {
        next(error);
    }
};

const uploadMeetingSignatureImage = async (req, res, next) => {
    try {
        const { id } = req.params;
        const target = (req.body.target || 'president').toLowerCase();
        if (target !== 'president' && target !== 'secretary') {
            return next(new CustomError('Invalid target, must be president or secretary', 400));
        }

        if (!req.file) {
            return next(new CustomError('No image file uploaded', 400));
        }

        const validTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
        if (!validTypes.includes(req.file.mimetype)) {
            return next(new CustomError('Invalid file type. Only PNG, JPG, JPEG, and WebP images are allowed.', 400));
        }

        const meetingResult = await db.query('SELECT id FROM meetings WHERE id = $1', [id]);
        if (meetingResult.rows.length === 0) {
            return next(new CustomError('Meeting not found', 404));
        }

        const ext = req.file.originalname.split('.').pop() || 'png';
        const fileKey = `signatures/meetings/${id}_${target}_${Date.now()}.${ext}`;
        await storageService.uploadFile(req.file.buffer, fileKey, req.file.mimetype);

        const columnName = target === 'president' ? 'president_signature_image' : 'secretary_signature_image';
        await db.query(
            `UPDATE meetings SET ${columnName} = $1 WHERE id = $2`,
            [fileKey, id]
        );

        res.status(200).json({ success: true, message: `${target} signature image uploaded successfully`, image_key: fileKey });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getMeetings,
    getMeetingById,
    getMeetingHistory,
    createMeeting,
    updateMeeting,
    updateOnlineMeetingLink,
    deleteMeeting,
    handoverAgenda,
    handoverSuppliAgenda,
    handoverResolution,
    handoverResolutionStatus,
    lockAgenda,
    unlockAgenda,
    lockSuppliAgenda,
    unlockSuppliAgenda,
    lockResolution,
    unlockResolution,
    lockResolutionStatus,
    unlockResolutionStatus,
    lockMeeting,
    unlockMeeting,
    lockPermissions,
    unlockPermissions,
    lockDescription,
    unlockDescription,
    lockInvitees,
    unlockInvitees,
    lockPresentees,
    unlockPresentees,
    lockConclusion,
    unlockConclusion,
    lockEmail,
    unlockEmail,
    sendBackAgenda,
    sendBackSuppliAgenda,
    sendBackResolution,
    sendBackResolutionStatus,
    completeMeeting,
    addInvitees,
    bulkFetchInvitees,
    getInvitees,
    updateInvitee,
    reorderInvitee,
    removeInvitee,
    getPresentees,
    addPresentees,
    updatePresentee,
    removePresentee,
    saveAttendance,
    generatePdf,
    generateDocx,
    getAttendanceGroups,
    uploadMaterial,
    deleteMaterial,
    bulkImportMeeting,
    getInviteesEmails,
    sendAgendaEmail,
    sendNoticeEmail,
    sendAgendaEmailBulk,
    sendResolutionEmail,
    getEmailDrafts,
    upsertEmailDraft,
    deleteEmailDraft,
    updateMeetingSignatures,
    uploadMeetingSignatureImage
};

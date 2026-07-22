const db = require('../db');
const CustomError = require('../errors/CustomError');

// Resolve the meeting id a mutating request targets, regardless of whether it
// comes in on the /meetings router (meeting id in the path/body) or the
// /agendas router (agenda / resolution / annexure id that must be traced back
// to its meeting). Mirrors the resolution logic in lockMiddleware.js so the
// ownership gate and the lock gate always agree on "which meeting is this".
const resolveMeetingId = async (req) => {
    const pathParts = req.path.split('/').filter(Boolean);
    const potentialId = pathParts[0];

    // /api/meetings/*
    if (req.baseUrl.includes('/meetings')) {
        if (potentialId && potentialId !== 'materials' && potentialId !== 'bulk-import') {
            return potentialId;
        }
        return null;
    }

    // /api/agendas/*
    if (req.baseUrl.includes('/agendas')) {
        // Creating an agenda: meeting id is in the body.
        if (req.method === 'POST' && req.path === '/' && req.body.meeting_id) {
            return req.body.meeting_id;
        }
        // /:agendaId, /:agendaId/resolutions, /:agendaId/annexures, /:agendaId/revisions/...
        if (potentialId && potentialId !== 'annexures' && potentialId !== 'resolutions') {
            const r = await db.query('SELECT meeting_id FROM agenda WHERE id = $1', [potentialId]);
            return r.rows[0]?.meeting_id || null;
        }
        // /resolutions/:resId (resId is an agenda id)
        if (req.path.startsWith('/resolutions/') && pathParts.length >= 2) {
            const r = await db.query('SELECT meeting_id FROM agenda WHERE id = $1', [pathParts[1]]);
            return r.rows[0]?.meeting_id || null;
        }
        // /annexures/reorder
        if (req.path === '/annexures/reorder' && Array.isArray(req.body.items) && req.body.items.length > 0) {
            const r = await db.query(
                'SELECT a.meeting_id FROM annexures an JOIN agenda a ON an.content_id = a.id WHERE an.id = $1',
                [req.body.items[0].id]
            );
            return r.rows[0]?.meeting_id || null;
        }
        // /annexures/:annexureId
        if (req.path.startsWith('/annexures/') && pathParts.length >= 2 && pathParts[1] !== 'reorder') {
            const r = await db.query(
                'SELECT a.meeting_id FROM annexures an JOIN agenda a ON an.content_id = a.id WHERE an.id = $1',
                [pathParts[1]]
            );
            return r.rows[0]?.meeting_id || null;
        }
    }

    return null;
};

// Fetch the workflow-relevant fields of a meeting once, cached on req so a
// route with several gates doesn't hit the DB repeatedly.
const loadMeeting = async (req) => {
    if (req._workflowMeeting !== undefined) return req._workflowMeeting;

    const meetingId = await resolveMeetingId(req);
    if (!meetingId) {
        req._workflowMeeting = null;
        return null;
    }

    const result = await db.query(
        'SELECT id, created_by, stage, return_source, status, resolution_approved FROM meetings WHERE id = $1',
        [meetingId]
    );
    req._workflowMeeting = result.rows[0] || null;
    return req._workflowMeeting;
};

const isOwner = (meeting, user) =>
    meeting.created_by && user && String(meeting.created_by) === String(user.id);

const isAdminRole = (user) => user && (user.role === 'admin' || user.role === 'superadmin');

// Whoever currently "holds" the file at its stage may edit it:
//   stage=initiator -> the initiator who created it, PLUS a moderator who handed
//                      it back (they keep working on it alongside the initiator)
//   stage=moderator -> any moderator
//   stage=admin / approved -> nobody below admin
// admin/superadmin may always edit.
//
// A moderator only loses edit access by escalating the file to the admin —
// handing it down to the initiator does not give up their own access.
const canEditAtStage = (meeting, user) => {
    if (isAdminRole(user)) return true;
    if (meeting.stage === 'initiator') {
        return isOwner(meeting, user) ||
            (user?.role === 'moderator' && meeting.return_source === 'moderator');
    }
    if (meeting.stage === 'moderator') return user?.role === 'moderator';
    return false;
};

const stageBlockedMessage = (meeting) => {
    switch (meeting.stage) {
        case 'moderator':
            return 'This file is with the moderator for review and can no longer be edited by the initiator.';
        case 'admin':
            return 'This file is with the admin for approval and can only be edited by an admin.';
        case 'approved':
            return 'This file has been approved and can only be edited by an admin.';
        default:
            return 'You do not have permission to edit this file at its current stage.';
    }
};

// Gate for editing the file's content (meeting info, agenda, and — for now —
// its operational sub-resources). Re-enforces the stage rules server-side.
const requireMeetingAuthor = async (req, res, next) => {
    try {
        if (!req.user) return next(new CustomError('You are not logged in.', 401));
        if (isAdminRole(req.user)) return next();

        const meeting = await loadMeeting(req);
        if (!meeting) return next(new CustomError('Meeting not found.', 404));

        if (!canEditAtStage(meeting, req.user)) {
            const owned = isOwner(meeting, req.user);
            const msg = owned || req.user.role === 'moderator'
                ? stageBlockedMessage(meeting)
                : 'Forbidden. You are not the current owner of this file.';
            return next(new CustomError(msg, 403));
        }
        return next();
    } catch (err) {
        next(err);
    }
};

// Operational actions that are part of building the file (invitees, materials)
// follow the same stage rules as content editing.
const requireMeetingOperator = requireMeetingAuthor;

// Resolutions & attendance are editable in two situations:
//   1. While the file is being built — by whoever currently holds edit access to
//      it, exactly like the agenda and the meeting info. So an initiator with
//      edit access drafts resolutions alongside the agenda.
//   2. During the meeting itself — once the agenda is approved and the status is
//      "ongoing", the initiator and moderator regain access even though the
//      approved file is otherwise admin-only.
// Either way, an admin-approved resolution is locked to everyone but admins.
const canEditResolutionAtStage = (meeting, user) => {
    if (isAdminRole(user)) return true;
    if (meeting.resolution_approved) return false;
    if (canEditAtStage(meeting, user)) return true;
    return meeting.stage === 'approved' && meeting.status === 'ongoing' &&
        (isOwner(meeting, user) || user?.role === 'moderator');
};

const resolutionBlockedMessage = (meeting) => {
    if (meeting.resolution_approved) return 'The resolution has been approved and is now locked.';
    if (meeting.stage === 'approved' && meeting.status !== 'ongoing') {
        return 'Set the meeting status to "Ongoing" to record resolutions and attendance.';
    }
    return stageBlockedMessage(meeting);
};

const requireResolutionEditor = async (req, res, next) => {
    try {
        if (!req.user) return next(new CustomError('You are not logged in.', 401));

        const meeting = await loadMeeting(req);
        if (!meeting) return next(new CustomError('Meeting not found.', 404));

        if (canEditResolutionAtStage(meeting, req.user)) return next();
        return next(new CustomError(resolutionBlockedMessage(meeting), 403));
    } catch (err) {
        next(err);
    }
};

module.exports = {
    resolveMeetingId,
    loadMeeting,
    isOwner,
    isAdminRole,
    canEditAtStage,
    canEditResolutionAtStage,
    requireMeetingAuthor,
    requireMeetingOperator,
    requireResolutionEditor,
};

const db = require('../db');
const CustomError = require('../errors/CustomError');

// Resolve the meeting id a mutating request targets, regardless of whether it
// comes in on the /meetings router (meeting id in the path/body) or the
// /agendas router (agenda / resolution / annexure id that must be traced back
// to its meeting).
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
        `SELECT id, created_by, stage, return_source, status,
                resolution_stage, resolution_return_source
         FROM meetings WHERE id = $1`,
        [meetingId]
    );
    req._workflowMeeting = result.rows[0] || null;
    return req._workflowMeeting;
};

const isOwner = (meeting, user) =>
    meeting.created_by && user && String(meeting.created_by) === String(user.id);

const isAdminRole = (user) => user && (user.role === 'admin' || user.role === 'superadmin');

// A completed meeting is closed for good. The one asymmetry between admin and
// superadmin lives here: the superadmin keeps an escape hatch for a mis-click,
// the admin does not.
const isCompleted = (meeting) => meeting.status === 'past';

const isSuperAdmin = (user) => user?.role === 'superadmin';

// Position-in-the-chain rule, shared by both the agenda chain (stage) and the
// resolution chain (resolution_stage):
//   initiator -> the initiator who created the file, PLUS a moderator who handed
//                it back (they keep working on it alongside the initiator)
//   moderator -> any moderator
//   admin     -> nobody below admin
//   approved  -> nobody at all; the chain is finished
// A moderator only loses access by escalating to the admin — handing the file
// down to the initiator does not give up their own access.
const holderCanEdit = (user, stage, returnSource, meeting) => {
    if (stage === 'approved') return false;
    if (isAdminRole(user)) return true;
    if (stage === 'initiator') {
        return isOwner(meeting, user) ||
            (user?.role === 'moderator' && returnSource === 'moderator');
    }
    if (stage === 'moderator') return user?.role === 'moderator';
    return false;
};

// Agenda phase. Approving the agenda FREEZES it for everyone, admins included —
// the way to correct an approved agenda is to send it back down the chain, which
// reopens it and returns the meeting to 'draft'.
const canEditAtStage = (meeting, user) => {
    if (isCompleted(meeting)) return isSuperAdmin(user);
    return holderCanEdit(user, meeting.stage, meeting.return_source, meeting);
};

const stageBlockedMessage = (meeting) => {
    if (isCompleted(meeting)) {
        return 'This meeting has been marked completed and can no longer be edited.';
    }
    switch (meeting.stage) {
        case 'moderator':
            return 'This file is with the moderator for review and can no longer be edited by the initiator.';
        case 'admin':
            return 'This file is with the admin for approval and can only be edited by an admin.';
        case 'approved':
            return 'The agenda has been approved and is now locked. Send the file back down the chain to reopen it for changes.';
        default:
            return 'You do not have permission to edit this file at its current stage.';
    }
};

// Gate for editing the file's content (meeting info, agenda, and — for now —
// its operational sub-resources). Re-enforces the stage rules server-side.
const requireMeetingAuthor = async (req, res, next) => {
    try {
        if (!req.user) return next(new CustomError('You are not logged in.', 401));

        const meeting = await loadMeeting(req);
        if (!meeting) return next(new CustomError('Meeting not found.', 404));

        // NB: no admin short-circuit — an approved agenda and a completed
        // meeting are locked to admins too (see canEditAtStage).
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

// Resolution phase. Opens only once the agenda is approved (which is what makes
// the meeting 'ongoing'), then runs its own escalation chain on
// resolution_stage. Reaching 'approved' there freezes the resolution for good.
const canEditResolutionAtStage = (meeting, user) => {
    if (isCompleted(meeting)) return isSuperAdmin(user);
    if (meeting.stage !== 'approved' || meeting.status !== 'ongoing') return false;
    return holderCanEdit(user, meeting.resolution_stage, meeting.resolution_return_source, meeting);
};

const resolutionBlockedMessage = (meeting) => {
    if (isCompleted(meeting)) {
        return 'This meeting has been marked completed and can no longer be edited.';
    }
    if (meeting.stage !== 'approved') {
        return 'Resolutions and attendance open once the agenda has been approved.';
    }
    switch (meeting.resolution_stage) {
        case 'moderator':
            return 'The resolution is with the moderator for review.';
        case 'admin':
            return 'The resolution is with the admin for approval.';
        case 'approved':
            return 'The resolution has been approved and is now locked.';
        default:
            return 'You do not have permission to edit the resolution at this stage.';
    }
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
    isCompleted,
    isSuperAdmin,
    holderCanEdit,
    canEditAtStage,
    canEditResolutionAtStage,
    requireMeetingAuthor,
    requireMeetingOperator,
    requireResolutionEditor,
};

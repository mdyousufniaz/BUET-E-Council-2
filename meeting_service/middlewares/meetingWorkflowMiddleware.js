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
        'SELECT id, created_by, approval_status FROM meetings WHERE id = $1',
        [meetingId]
    );
    req._workflowMeeting = result.rows[0] || null;
    return req._workflowMeeting;
};

const isOwner = (meeting, user) =>
    meeting.created_by && user && String(meeting.created_by) === String(user.id);

// Factory: allow admins always; allow the owning initiator when the file is in
// one of `allowStatuses`; allow any role listed in `allowRoles`. Everyone else
// is rejected. Used to enforce "only the creator can fix it" at the API layer.
const requireMeetingAccess = ({ allowStatuses = ['draft', 'sent_back'], allowRoles = [] } = {}) =>
    async (req, res, next) => {
        try {
            if (!req.user) return next(new CustomError('You are not logged in.', 401));

            if (req.user.role === 'admin' || req.user.role === 'superadmin') return next();
            if (allowRoles.includes(req.user.role)) return next();

            const meeting = await loadMeeting(req);
            if (!meeting) {
                return next(new CustomError('Meeting not found.', 404));
            }

            if (!isOwner(meeting, req.user)) {
                return next(new CustomError(
                    'Forbidden. Only the file initiator who created this meeting can edit it.',
                    403
                ));
            }

            if (!allowStatuses.includes(meeting.approval_status)) {
                const reason = meeting.approval_status === 'submitted'
                    ? 'This file has been submitted for review and is locked until a moderator sends it back.'
                    : meeting.approval_status === 'approved'
                        ? 'This file has been approved and can no longer be edited.'
                        : 'This file cannot be edited in its current state.';
                return next(new CustomError(reason, 403));
            }

            return next();
        } catch (err) {
            next(err);
        }
    };

// Editing the file's content: owner may edit only while draft/sent_back.
const requireMeetingAuthor = requireMeetingAccess({ allowStatuses: ['draft', 'sent_back'] });

// Operational actions on a meeting the owner runs across the whole lifecycle
// (invitees, attendance, materials, completion). Still owner-or-admin only.
const requireMeetingOperator = requireMeetingAccess({
    allowStatuses: ['draft', 'sent_back', 'submitted', 'approved']
});

module.exports = {
    resolveMeetingId,
    loadMeeting,
    isOwner,
    requireMeetingAccess,
    requireMeetingAuthor,
    requireMeetingOperator,
};

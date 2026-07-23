const db = require('../db');
const CustomError = require('../errors/CustomError');

const resolveMeetingId = async (req) => {
    const pathParts = req.path.split('/').filter(Boolean);
    const potentialId = pathParts[0];

    if (req.baseUrl.includes('/meetings')) {
        if (potentialId && potentialId !== 'materials' && potentialId !== 'bulk-import') {
            return potentialId;
        }
        return null;
    }

    if (req.baseUrl.includes('/agendas')) {
        if (req.method === 'POST' && req.path === '/' && req.body.meeting_id) {
            return req.body.meeting_id;
        }
        if (potentialId && potentialId !== 'annexures' && potentialId !== 'resolutions') {
            const r = await db.query('SELECT meeting_id FROM agenda WHERE id = $1', [potentialId]);
            return r.rows[0]?.meeting_id || null;
        }
        if (req.path.startsWith('/resolutions/') && pathParts.length >= 2) {
            const r = await db.query('SELECT meeting_id FROM agenda WHERE id = $1', [pathParts[1]]);
            return r.rows[0]?.meeting_id || null;
        }
        if (req.path === '/annexures/reorder' && Array.isArray(req.body.items) && req.body.items.length > 0) {
            const r = await db.query(
                'SELECT a.meeting_id FROM annexures an JOIN agenda a ON an.content_id = a.id WHERE an.id = $1',
                [req.body.items[0].id]
            );
            return r.rows[0]?.meeting_id || null;
        }
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

const loadMeeting = async (req) => {
    if (req._workflowMeeting !== undefined) return req._workflowMeeting;

    const meetingId = await resolveMeetingId(req);
    if (!meetingId) {
        req._workflowMeeting = null;
        return null;
    }

    const result = await db.query(
        `SELECT id, title, created_by,
                agenda_handover_level, suppli_agenda_handover_level, resolution_handover_level, resolution_status_handover_level,
                agenda_locked_level, suppli_agenda_locked_level, resolution_locked_level, resolution_status_locked_level, meeting_locked_level,
                invitees_locked_level, presentees_locked_level, conclusion_locked_level,
                is_completed, completed_at, completed_by,
                (SELECT value FROM system_settings WHERE key = 'min_completed_level') as min_completed_level,
                (SELECT MAX(level) FROM roles) as max_role_level
         FROM meetings WHERE id = $1`,
        [meetingId]
    );
    req._workflowMeeting = result.rows[0] || null;
    return req._workflowMeeting;
};

const calculateMeetingAccess = (meeting, user) => {
    const emptyAccess = {
        canEditMeeting: false,
        canEditAgenda: false,
        canEditSuppliAgenda: false,
        canEditResolution: false,
        canEditResolutionStatus: false,
        canEditInvitees: false,
        canEditPresentees: false,
        canEditConclusion: false,
        canMarkCompleted: false,
        canHandoverAgenda: false,
        canHandoverSuppliAgenda: false,
        canHandoverResolution: false,
        canHandoverResolutionStatus: false,
        canSendBackAgenda: false,
        canSendBackSuppliAgenda: false,
        canSendBackResolution: false,
        canSendBackResolutionStatus: false,
        canLockAgenda: false,
        canLockSuppliAgenda: false,
        canLockResolution: false,
        canLockResolutionStatus: false,
        canLockMeeting: false,
        canLockInvitees: false,
        canLockPresentees: false,
        canLockConclusion: false,
        canUnlockAgenda: false,
        canUnlockSuppliAgenda: false,
        canUnlockResolution: false,
        canUnlockResolutionStatus: false,
        canUnlockMeeting: false,
        canUnlockInvitees: false,
        canUnlockPresentees: false,
        canUnlockConclusion: false
    };

    if (!user) return emptyAccess;

    const isAdmin = user.role === 'admin' || user.role === 'superadmin';
    if (isAdmin) {
        return {
            canEditMeeting: true,
            canEditAgenda: true,
            canEditSuppliAgenda: true,
            canEditResolution: true,
            canEditResolutionStatus: true,
            canEditInvitees: true,
            canEditPresentees: true,
            canEditConclusion: true,
            canMarkCompleted: true,
            canHandoverAgenda: true,
            canHandoverSuppliAgenda: true,
            canHandoverResolution: true,
            canHandoverResolutionStatus: true,
            canSendBackAgenda: meeting?.agenda_handover_level !== null && meeting?.agenda_handover_level !== undefined,
            canSendBackSuppliAgenda: meeting?.suppli_agenda_handover_level !== null && meeting?.suppli_agenda_handover_level !== undefined,
            canSendBackResolution: meeting?.resolution_handover_level !== null && meeting?.resolution_handover_level !== undefined,
            canSendBackResolutionStatus: meeting?.resolution_status_handover_level !== null && meeting?.resolution_status_handover_level !== undefined,
            canLockAgenda: true,
            canLockSuppliAgenda: true,
            canLockResolution: true,
            canLockResolutionStatus: true,
            canLockMeeting: true,
            canLockInvitees: true,
            canLockPresentees: true,
            canLockConclusion: true,
            canUnlockAgenda: true,
            canUnlockSuppliAgenda: true,
            canUnlockResolution: true,
            canUnlockResolutionStatus: true,
            canUnlockMeeting: true,
            canUnlockInvitees: true,
            canUnlockPresentees: true,
            canUnlockConclusion: true
        };
    }

    if (user.role === 'viewer' || user.role_level === null || user.role_level === undefined) {
        return emptyAccess;
    }

    const userLevel = isAdmin ? 999999 : parseInt(user.role_level, 10);
    const maxRoleLevel = meeting?.max_role_level !== null && meeting?.max_role_level !== undefined ? parseInt(meeting.max_role_level, 10) : null;
    const hasHigherRole = maxRoleLevel === null || userLevel < maxRoleLevel;

    const isCompleted = meeting.is_completed === true;

    const getLock = (lvl) => (lvl !== null && lvl !== undefined ? parseInt(lvl, 10) : null);
    const getHandover = (lvl) => (lvl !== null && lvl !== undefined ? parseInt(lvl, 10) : null);

    // Meeting editing check (Locking at L removes edit rights from < L, so >= L retains access)
    const meetingLock = getLock(meeting.meeting_locked_level);
    const canEditMeeting = meetingLock === null || userLevel >= meetingLock;
    const canUnlockMeeting = meetingLock === null || userLevel >= meetingLock;

    // Agenda editing check (Handover: <= L loses access; Lock: < L loses access)
    const agendaHandover = getHandover(meeting.agenda_handover_level);
    const agendaLock = getLock(meeting.agenda_locked_level);
    let canEditAgenda = true;
    if (agendaHandover !== null && userLevel <= agendaHandover) canEditAgenda = false;
    if (agendaLock !== null && userLevel < agendaLock) canEditAgenda = false;
    const canUnlockAgenda = agendaLock === null || userLevel >= agendaLock;

    // Supplementary Agenda editing check
    const suppliHandover = getHandover(meeting.suppli_agenda_handover_level);
    const suppliLock = getLock(meeting.suppli_agenda_locked_level);
    let canEditSuppliAgenda = true;
    if (suppliHandover !== null && userLevel <= suppliHandover) canEditSuppliAgenda = false;
    if (suppliLock !== null && userLevel < suppliLock) canEditSuppliAgenda = false;
    const canUnlockSuppliAgenda = suppliLock === null || userLevel >= suppliLock;

    // Resolution editing check
    const resHandover = getHandover(meeting.resolution_handover_level);
    const resLock = getLock(meeting.resolution_locked_level);
    let canEditResolution = true;
    if (resHandover !== null && userLevel <= resHandover) canEditResolution = false;
    if (resLock !== null && userLevel < resLock) canEditResolution = false;
    const canUnlockResolution = resLock === null || userLevel >= resLock;

    // Resolution Status editing check
    const resStatusHandover = getHandover(meeting.resolution_status_handover_level);
    const resStatusLock = getLock(meeting.resolution_status_locked_level);
    let canEditResolutionStatus = true;
    if (resStatusHandover !== null && userLevel <= resStatusHandover) canEditResolutionStatus = false;
    if (resStatusLock !== null && userLevel < resStatusLock) canEditResolutionStatus = false;
    const canUnlockResolutionStatus = resStatusLock === null || userLevel >= resStatusLock;

    // Invitees editing check
    const inviteesLock = getLock(meeting.invitees_locked_level);
    const canEditInvitees = inviteesLock === null || userLevel >= inviteesLock;
    const canUnlockInvitees = inviteesLock === null || userLevel >= inviteesLock;

    // Presentees editing check
    const presenteesLock = getLock(meeting.presentees_locked_level);
    const canEditPresentees = presenteesLock === null || userLevel >= presenteesLock;
    const canUnlockPresentees = presenteesLock === null || userLevel >= presenteesLock;

    // Conclusion editing check
    const conclusionLock = getLock(meeting.conclusion_locked_level);
    const canEditConclusion = conclusionLock === null || userLevel >= conclusionLock;
    const canUnlockConclusion = conclusionLock === null || userLevel >= conclusionLock;

    // Send Back checks: Only strictly higher levels (> handoverLevel) or admin can send back a handed-over item.
    const canSendBackAgenda = agendaHandover !== null && (user.role === 'admin' || userLevel > agendaHandover);
    const canSendBackSuppliAgenda = suppliHandover !== null && (user.role === 'admin' || userLevel > suppliHandover);
    const canSendBackResolution = resHandover !== null && (user.role === 'admin' || userLevel > resHandover);
    const canSendBackResolutionStatus = resStatusHandover !== null && (user.role === 'admin' || userLevel > resStatusHandover);

    // Mark Meeting Completed check
    const minCompletedLevel = meeting.min_completed_level !== undefined && meeting.min_completed_level !== null
        ? parseInt(meeting.min_completed_level, 10)
        : 1;
    const canMarkCompleted = !isCompleted && (user.role === 'admin' || userLevel >= minCompletedLevel);

    return {
        canEditMeeting,
        canEditAgenda,
        canEditSuppliAgenda,
        canEditResolution,
        canEditResolutionStatus,
        canEditInvitees,
        canEditPresentees,
        canEditConclusion,
        canMarkCompleted,
        canHandoverAgenda: canEditAgenda && hasHigherRole,
        canHandoverSuppliAgenda: canEditSuppliAgenda && hasHigherRole,
        canHandoverResolution: canEditResolution && hasHigherRole,
        canHandoverResolutionStatus: canEditResolutionStatus && hasHigherRole,
        canSendBackAgenda,
        canSendBackSuppliAgenda,
        canSendBackResolution,
        canSendBackResolutionStatus,
        canLockAgenda: agendaHandover === null || userLevel > agendaHandover,
        canLockSuppliAgenda: suppliHandover === null || userLevel > suppliHandover,
        canLockResolution: resHandover === null || userLevel > resHandover,
        canLockResolutionStatus: resStatusHandover === null || userLevel > resStatusHandover,
        canLockMeeting: true,
        canLockInvitees: true,
        canLockPresentees: true,
        canLockConclusion: true,
        canUnlockAgenda,
        canUnlockSuppliAgenda,
        canUnlockResolution,
        canUnlockResolutionStatus,
        canUnlockMeeting,
        canUnlockInvitees,
        canUnlockPresentees,
        canUnlockConclusion
    };
};

const requireMeetingAuthor = async (req, res, next) => {
    try {
        if (!req.user) return next(new CustomError('You are not logged in.', 401));
        const meeting = await loadMeeting(req);
        if (!meeting) return next(new CustomError('Meeting not found.', 404));

        const access = calculateMeetingAccess(meeting, req.user);

        let isSuppliTarget = false;
        if (req.baseUrl.includes('/agendas')) {
            if (req.method === 'POST' && (req.body?.is_suppli === true || req.body?.is_suppli === 'true')) {
                isSuppliTarget = true;
            } else if (req.params.id) {
                const r = await db.query('SELECT is_suppli FROM agenda WHERE id = $1', [req.params.id]);
                if (r.rows[0]?.is_suppli) isSuppliTarget = true;
            }
        }

        if (isSuppliTarget) {
            if (!access.canEditSuppliAgenda) {
                return next(new CustomError('Access denied. Supplementary agenda is locked for your level.', 403));
            }
        } else {
            if (!access.canEditAgenda && !access.canEditMeeting) {
                return next(new CustomError('Access denied. Meeting or agenda editing is restricted.', 403));
            }
        }
        return next();
    } catch (err) {
        next(err);
    }
};

const requireMeetingOperator = requireMeetingAuthor;

const requireResolutionEditor = async (req, res, next) => {
    try {
        if (!req.user) return next(new CustomError('You are not logged in.', 401));
        const meeting = await loadMeeting(req);
        if (!meeting) return next(new CustomError('Meeting not found.', 404));

        const access = calculateMeetingAccess(meeting, req.user);
        if (!access.canEditResolution) {
            return next(new CustomError('Access denied. Resolution editing is restricted.', 403));
        }
        return next();
    } catch (err) {
        next(err);
    }
};

module.exports = {
    resolveMeetingId,
    loadMeeting,
    calculateMeetingAccess,
    requireMeetingAuthor,
    requireMeetingOperator,
    requireResolutionEditor,
};

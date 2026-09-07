const express = require('express');
const { authMiddleware } = require('../middlewares/authMiddleware');
const { requireRole, requireNonViewer } = require('../middlewares/roleMiddleware');
const { requireMeetingAuthor, requireMeetingOperator, requireResolutionEditor, requirePresenteesEditor, requireInviteesEditor, requireEmailSender, requireCompletedMeetingEmailSender } = require('../middlewares/meetingWorkflowMiddleware');
const meetingController = require('../controllers/meetingController');
const { auditLog } = require('../middlewares/auditMiddleware');
const multer = require('multer');

const upload = multer({ storage: multer.memoryStorage() });

const router = express.Router();
const adminOnly = requireRole('admin', 'superadmin');

router.use(authMiddleware);
router.use(auditLog('meeting'));

router.get('/', meetingController.getMeetings);
router.post('/', requireNonViewer, meetingController.createMeeting);
router.post('/bulk-import', requireNonViewer, meetingController.bulkImportMeeting);
router.get('/:id', meetingController.getMeetingById);
router.get('/:id/history', adminOnly, meetingController.getMeetingHistory);
router.put('/:id', requireMeetingAuthor, meetingController.updateMeeting);
router.put('/:id/signatures', requireNonViewer, meetingController.updateMeetingSignatures);
router.post('/:id/signatures/upload', requireNonViewer, upload.single('file'), meetingController.uploadMeetingSignatureImage);
router.put('/:id/online-link', requireNonViewer, meetingController.updateOnlineMeetingLink);
router.delete('/:id', adminOnly, meetingController.deleteMeeting);

// Level-based Handover, Locking & Send-Back controls
router.post('/:id/handover-agenda', requireNonViewer, meetingController.handoverAgenda);
router.post('/:id/handover-suppli-agenda', requireNonViewer, meetingController.handoverSuppliAgenda);
router.post('/:id/handover-resolution', requireNonViewer, meetingController.handoverResolution);
router.post('/:id/handover-resolution-status', requireNonViewer, meetingController.handoverResolutionStatus);
router.post('/:id/lock-agenda', requireNonViewer, meetingController.lockAgenda);
router.post('/:id/unlock-agenda', requireNonViewer, meetingController.unlockAgenda);
router.post('/:id/lock-suppli-agenda', requireNonViewer, meetingController.lockSuppliAgenda);
router.post('/:id/unlock-suppli-agenda', requireNonViewer, meetingController.unlockSuppliAgenda);
router.post('/:id/lock-resolution', requireNonViewer, meetingController.lockResolution);
router.post('/:id/unlock-resolution', requireNonViewer, meetingController.unlockResolution);
router.post('/:id/lock-resolution-status', requireNonViewer, meetingController.lockResolutionStatus);
router.post('/:id/unlock-resolution-status', requireNonViewer, meetingController.unlockResolutionStatus);
router.post('/:id/lock-meeting', requireNonViewer, meetingController.lockMeeting);
router.post('/:id/unlock-meeting', requireNonViewer, meetingController.unlockMeeting);
router.post('/:id/lock-permissions', requireNonViewer, meetingController.lockPermissions);
router.post('/:id/unlock-permissions', requireNonViewer, meetingController.unlockPermissions);
router.post('/:id/lock-description', requireNonViewer, meetingController.lockDescription);
router.post('/:id/unlock-description', requireNonViewer, meetingController.unlockDescription);
router.post('/:id/lock-invitees', requireNonViewer, meetingController.lockInvitees);
router.post('/:id/unlock-invitees', requireNonViewer, meetingController.unlockInvitees);
router.post('/:id/lock-presentees', requireNonViewer, meetingController.lockPresentees);
router.post('/:id/unlock-presentees', requireNonViewer, meetingController.unlockPresentees);
router.post('/:id/lock-conclusion', requireNonViewer, meetingController.lockConclusion);
router.post('/:id/unlock-conclusion', requireNonViewer, meetingController.unlockConclusion);
router.post('/:id/lock-email', requireNonViewer, meetingController.lockEmail);
router.post('/:id/unlock-email', requireNonViewer, meetingController.unlockEmail);
router.post('/:id/send-back-agenda', requireNonViewer, meetingController.sendBackAgenda);
router.post('/:id/send-back-suppli-agenda', requireNonViewer, meetingController.sendBackSuppliAgenda);
router.post('/:id/send-back-resolution', requireNonViewer, meetingController.sendBackResolution);
router.post('/:id/send-back-resolution-status', requireNonViewer, meetingController.sendBackResolutionStatus);
router.post('/:id/complete', requireNonViewer, meetingController.completeMeeting);

router.post('/:id/invitees', requireInviteesEditor, meetingController.addInvitees);
router.get('/:id/invitees', meetingController.getInvitees);
router.get('/:id/invitees/emails', meetingController.getInviteesEmails);
router.delete('/:id/invitees/:inviteeId', requireInviteesEditor, meetingController.removeInvitee);
router.put('/:id/invitees/:inviteeId', requireInviteesEditor, meetingController.updateInvitee);
router.put('/:id/invitees/:inviteeId/reorder', requireInviteesEditor, meetingController.reorderInvitee);
router.post('/:id/invitees/bulk-fetch', requireInviteesEditor, meetingController.bulkFetchInvitees);

router.get('/:id/presentees', meetingController.getPresentees);
router.post('/:id/presentees', requirePresenteesEditor, meetingController.addPresentees);
router.put('/:id/presentees/:presenteeId', requirePresenteesEditor, meetingController.updatePresentee);
router.delete('/:id/presentees/:presenteeId', requirePresenteesEditor, meetingController.removePresentee);
router.put('/:id/attendance', requirePresenteesEditor, meetingController.saveAttendance);

router.get('/:id/pdf/:type', meetingController.generatePdf);
router.get('/:id/docx/:type', meetingController.generateDocx);

// Send agenda (or any ad-hoc message) via email to selected invitees
router.post('/:id/send-email', requireEmailSender, meetingController.sendAgendaEmail);

// Send meeting notice email to selected invitees (draft/ongoing meetings only)
router.post('/:id/send-notice', requireEmailSender, meetingController.sendNoticeEmail);

// Send agenda email with PDF attached to selected invitees (ongoing meetings only)
router.post('/:id/send-agenda-email', requireEmailSender, meetingController.sendAgendaEmailBulk);

// Send resolution email with PDF attached to selected invitees (completed meetings only)
router.post('/:id/send-resolution-email', requireCompletedMeetingEmailSender, meetingController.sendResolutionEmail);

// Email drafts: one saved draft per (meeting, mode). Resolution drafts use the
// same completed-meeting gate as sending; notice/agenda use the email gate.
const requireDraftAccess = (req, res, next) => {
    if (req.params.mode === 'resolution') return requireCompletedMeetingEmailSender(req, res, next);
    return requireEmailSender(req, res, next);
};
router.get('/:id/email-drafts', requireEmailSender, meetingController.getEmailDrafts);
router.put('/:id/email-drafts/:mode', requireDraftAccess, meetingController.upsertEmailDraft);
router.delete('/:id/email-drafts/:mode', requireDraftAccess, meetingController.deleteEmailDraft);

// Endpoint for uploading material PDFs
router.post('/:id/materials/upload', requireMeetingOperator, upload.single('file'), meetingController.uploadMaterial);
router.delete('/:id/materials/:type', requireMeetingOperator, meetingController.deleteMaterial);

module.exports = router;

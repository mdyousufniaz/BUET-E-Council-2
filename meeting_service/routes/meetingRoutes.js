const express = require('express');
const { authMiddleware } = require('../middlewares/authMiddleware');
const { requireRole, requireNonViewer } = require('../middlewares/roleMiddleware');
const { requireMeetingAuthor, requireResolutionEditor } = require('../middlewares/meetingWorkflowMiddleware');
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
router.post('/:id/lock-invitees', requireNonViewer, meetingController.lockInvitees);
router.post('/:id/unlock-invitees', requireNonViewer, meetingController.unlockInvitees);
router.post('/:id/lock-presentees', requireNonViewer, meetingController.lockPresentees);
router.post('/:id/unlock-presentees', requireNonViewer, meetingController.unlockPresentees);
router.post('/:id/lock-conclusion', requireNonViewer, meetingController.lockConclusion);
router.post('/:id/unlock-conclusion', requireNonViewer, meetingController.unlockConclusion);
router.post('/:id/send-back-agenda', requireNonViewer, meetingController.sendBackAgenda);
router.post('/:id/send-back-suppli-agenda', requireNonViewer, meetingController.sendBackSuppliAgenda);
router.post('/:id/send-back-resolution', requireNonViewer, meetingController.sendBackResolution);
router.post('/:id/send-back-resolution-status', requireNonViewer, meetingController.sendBackResolutionStatus);
router.post('/:id/complete', requireNonViewer, meetingController.completeMeeting);

router.post('/:id/invitees', requireMeetingAuthor, meetingController.addInvitees);
router.get('/:id/invitees', meetingController.getInvitees);
router.get('/:id/invitees/emails', meetingController.getInviteesEmails);
router.delete('/:id/invitees/:inviteeId', requireMeetingAuthor, meetingController.removeInvitee);
router.put('/:id/invitees/:inviteeId', requireMeetingAuthor, meetingController.updateInvitee);
router.put('/:id/invitees/:inviteeId/reorder', requireMeetingAuthor, meetingController.reorderInvitee);
router.post('/:id/invitees/bulk-fetch', requireMeetingAuthor, meetingController.bulkFetchInvitees);

router.get('/:id/presentees', meetingController.getPresentees);
router.post('/:id/presentees', requireResolutionEditor, meetingController.addPresentees);
router.put('/:id/presentees/:presenteeId', requireResolutionEditor, meetingController.updatePresentee);
router.delete('/:id/presentees/:presenteeId', requireResolutionEditor, meetingController.removePresentee);
router.put('/:id/attendance', requireResolutionEditor, meetingController.saveAttendance);

router.get('/:id/pdf/:type', meetingController.generatePdf);
router.post('/:id/send-email', requireMeetingAuthor, meetingController.sendAgendaEmail);
router.post('/:id/materials/upload', requireMeetingAuthor, upload.single('file'), meetingController.uploadMaterial);

module.exports = router;

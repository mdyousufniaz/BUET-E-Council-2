const express = require('express');
const { authMiddleware } = require('../middlewares/authMiddleware');
const { requireRole } = require('../middlewares/roleMiddleware');
const { requireMeetingAuthor, requireMeetingOperator, requireResolutionEditor } = require('../middlewares/meetingWorkflowMiddleware');
const meetingController = require('../controllers/meetingController');
const { auditLog } = require('../middlewares/auditMiddleware');
const multer = require('multer');

const upload = multer({ storage: multer.memoryStorage() });

const router = express.Router();
const adminOnly = requireRole('admin', 'superadmin');
// All four workflow roles can create a meeting file.
const canCreate = requireRole('admin', 'superadmin', 'moderator', 'file_initiator');
// Move a file through the escalation chain. The controller enforces the exact
// stage + role rules (who can submit/return from where); these guards only keep
// read-only viewers out.
const canWorkflow = requireRole('admin', 'superadmin', 'moderator', 'file_initiator');
// Only admin/superadmin give final approval.
const canApprove = requireRole('admin', 'superadmin');
// Any authenticated role except viewer — used for the online meeting link,
// which is editable any time regardless of meeting ownership/workflow state.
// Same role set as canWorkflow, kept separate because it gates on "not a
// viewer" rather than on taking part in the approval chain.
const nonViewer = requireRole('admin', 'superadmin', 'moderator', 'file_initiator');

router.use(authMiddleware);
router.use(auditLog('meeting'));

router.get('/', meetingController.getMeetings);
router.post('/', canCreate, meetingController.createMeeting);
router.post('/bulk-import', canCreate, meetingController.bulkImportMeeting);
router.get('/:id', meetingController.getMeetingById);
router.get('/:id/history', adminOnly, meetingController.getMeetingHistory); // admin/superadmin only
router.put('/:id', requireMeetingAuthor, meetingController.updateMeeting);
router.put('/:id/online-link', nonViewer, meetingController.updateOnlineMeetingLink);
router.delete('/:id', adminOnly, meetingController.deleteMeeting); // critical - admin-only

// File approval escalation chain: initiator -> moderator -> admin -> approved.
router.post('/:id/submit', canWorkflow, meetingController.submitMeeting);      // forward one step up
router.post('/:id/approve', canApprove, meetingController.approveMeeting);     // admin/superadmin finalize
router.post('/:id/return', canWorkflow, meetingController.returnMeeting);      // hand back down (with note)

// Resolution approval chain, opened once the agenda is approved. Same
// initiator -> moderator -> admin escalation as above, on resolution_stage.
router.post('/:id/submit-resolution', canWorkflow, meetingController.submitResolution);
router.post('/:id/return-resolution', canWorkflow, meetingController.returnResolution);
router.post('/:id/approve-resolution', canApprove, meetingController.approveResolution);
router.post('/:id/reopen-resolution', canApprove, meetingController.reopenResolution);

// Only admin/superadmin can finalize a meeting as completed.
router.post('/:id/complete', adminOnly, meetingController.completeMeeting);

router.post('/:id/invitees', requireMeetingOperator, meetingController.addInvitees);
router.get('/:id/invitees', meetingController.getInvitees);
router.get('/:id/invitees/emails', meetingController.getInviteesEmails);
router.delete('/:id/invitees/:inviteeId', requireMeetingOperator, meetingController.removeInvitee);
router.put('/:id/invitees/:inviteeId', requireMeetingOperator, meetingController.updateInvitee);
router.put('/:id/invitees/:inviteeId/reorder', requireMeetingOperator, meetingController.reorderInvitee);
router.post('/:id/invitees/bulk-fetch', requireMeetingOperator, meetingController.bulkFetchInvitees);
// Presentees + attendance belong to the resolution/attendance phase.
router.get('/:id/presentees', meetingController.getPresentees);
router.post('/:id/presentees', requireResolutionEditor, meetingController.addPresentees);
router.put('/:id/presentees/:presenteeId', requireResolutionEditor, meetingController.updatePresentee);
router.delete('/:id/presentees/:presenteeId', requireResolutionEditor, meetingController.removePresentee);
router.put('/:id/attendance', requireResolutionEditor, meetingController.saveAttendance);

// Unified endpoint for generating PDFs
router.get('/:id/pdf/:type', meetingController.generatePdf);

// Send agenda (or any ad-hoc message) via email to selected invitees
router.post('/:id/send-email', requireMeetingOperator, meetingController.sendAgendaEmail);

// Endpoint for uploading material PDFs
router.post('/:id/materials/upload', requireMeetingOperator, upload.single('file'), meetingController.uploadMaterial);

module.exports = router;

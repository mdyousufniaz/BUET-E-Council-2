const express = require('express');
const { authMiddleware } = require('../middlewares/authMiddleware');
const { requireRole } = require('../middlewares/roleMiddleware');
const { requireMeetingAuthor, requireMeetingOperator } = require('../middlewares/meetingWorkflowMiddleware');
const meetingController = require('../controllers/meetingController');
const { checkMeetingLock } = require('../middlewares/lockMiddleware');
const { auditLog } = require('../middlewares/auditMiddleware');
const multer = require('multer');

const upload = multer({ storage: multer.memoryStorage() });

const router = express.Router();
const adminOnly = requireRole('admin', 'superadmin');
// File initiators (and admins) own meeting/agenda authoring; moderators only review.
const canCreate = requireRole('admin', 'superadmin', 'file_initiator');
// Approving / sending back a submitted file is the reviewer's job.
const canReview = requireRole('admin', 'superadmin', 'moderator');

router.use(authMiddleware);
router.use(checkMeetingLock);
router.use(auditLog('meeting'));

router.get('/', meetingController.getMeetings);
router.post('/', canCreate, meetingController.createMeeting);
router.post('/bulk-import', canCreate, meetingController.bulkImportMeeting);
router.get('/:id', meetingController.getMeetingById);
router.put('/:id', requireMeetingAuthor, meetingController.updateMeeting);
router.delete('/:id', adminOnly, meetingController.deleteMeeting); // critical - admin-only

// File approval workflow (initiator submits -> moderator reviews).
router.post('/:id/submit', canCreate, meetingController.submitMeeting);
router.post('/:id/approve', canReview, meetingController.reviewApproveMeeting);
router.post('/:id/send-back', canReview, meetingController.sendBackMeeting);
router.post('/:id/reopen', adminOnly, meetingController.reopenMeeting);

router.post('/:id/complete', requireMeetingOperator, meetingController.completeMeeting);
router.put('/:id/lock', adminOnly, meetingController.toggleLock);

// Super admin "dummy" approval (from PR #32) — flips meetings.is_approved.
router.put('/:id/approve', requireRole('superadmin'), meetingController.approveMeeting);

router.post('/:id/invitees', requireMeetingOperator, meetingController.addInvitees);
router.get('/:id/invitees', meetingController.getInvitees);
router.get('/:id/invitees/emails', meetingController.getInviteesEmails);
router.delete('/:id/invitees/:inviteeId', requireMeetingOperator, meetingController.removeInvitee);
router.put('/:id/invitees/:inviteeId', requireMeetingOperator, meetingController.updateInvitee);
router.put('/:id/invitees/:inviteeId/reorder', requireMeetingOperator, meetingController.reorderInvitee);
router.post('/:id/invitees/bulk-fetch', requireMeetingOperator, meetingController.bulkFetchInvitees);
router.get('/:id/presentees', meetingController.getPresentees);
router.post('/:id/presentees', requireMeetingOperator, meetingController.addPresentees);
router.put('/:id/presentees/:presenteeId', requireMeetingOperator, meetingController.updatePresentee);
router.delete('/:id/presentees/:presenteeId', requireMeetingOperator, meetingController.removePresentee);
router.put('/:id/attendance', requireMeetingOperator, meetingController.saveAttendance);

// Unified endpoint for generating PDFs
router.get('/:id/pdf/:type', meetingController.generatePdf);

// Send agenda (or any ad-hoc message) via email to selected invitees
router.post('/:id/send-email', requireMeetingOperator, meetingController.sendAgendaEmail);

// Endpoint for uploading material PDFs
router.post('/:id/materials/upload', requireMeetingOperator, upload.single('file'), meetingController.uploadMaterial);

module.exports = router;

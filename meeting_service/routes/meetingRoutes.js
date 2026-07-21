const express = require('express');
const { authMiddleware } = require('../middlewares/authMiddleware');
const { requireRole } = require('../middlewares/roleMiddleware');
const meetingController = require('../controllers/meetingController');
const { checkMeetingLock } = require('../middlewares/lockMiddleware');
const { auditLog } = require('../middlewares/auditMiddleware');
const multer = require('multer');

const upload = multer({ storage: multer.memoryStorage() });

const router = express.Router();
const canEdit = requireRole('admin', 'moderator', 'superadmin');
const adminOnly = requireRole('admin', 'superadmin');

router.use(authMiddleware);
router.use(checkMeetingLock);
router.use(auditLog('meeting'));

router.get('/', meetingController.getMeetings);
router.post('/', canEdit, meetingController.createMeeting);
router.post('/bulk-import', canEdit, meetingController.bulkImportMeeting);
router.get('/:id', meetingController.getMeetingById);
router.put('/:id', canEdit, meetingController.updateMeeting);
router.delete('/:id', adminOnly, meetingController.deleteMeeting); // critical - admin-only
router.post('/:id/complete', canEdit, meetingController.completeMeeting);
router.put('/:id/lock', adminOnly, meetingController.toggleLock);
router.put('/:id/approve', requireRole('superadmin'), meetingController.approveMeeting);

router.post('/:id/invitees', canEdit, meetingController.addInvitees);
router.get('/:id/invitees', meetingController.getInvitees);
router.get('/:id/invitees/emails', meetingController.getInviteesEmails);
router.delete('/:id/invitees/:inviteeId', canEdit, meetingController.removeInvitee);
router.put('/:id/invitees/:inviteeId', canEdit, meetingController.updateInvitee);
router.put('/:id/invitees/:inviteeId/reorder', canEdit, meetingController.reorderInvitee);
router.post('/:id/invitees/bulk-fetch', canEdit, meetingController.bulkFetchInvitees);
router.get('/:id/presentees', meetingController.getPresentees);
router.post('/:id/presentees', canEdit, meetingController.addPresentees);
router.put('/:id/presentees/:presenteeId', canEdit, meetingController.updatePresentee);
router.delete('/:id/presentees/:presenteeId', canEdit, meetingController.removePresentee);
router.put('/:id/attendance', canEdit, meetingController.saveAttendance);

// Unified endpoint for generating PDFs
router.get('/:id/pdf/:type', meetingController.generatePdf);

// Send agenda (or any ad-hoc message) via email to selected invitees
router.post('/:id/send-email', canEdit, meetingController.sendAgendaEmail);

// Endpoint for uploading material PDFs
router.post('/:id/materials/upload', canEdit, upload.single('file'), meetingController.uploadMaterial);

module.exports = router;

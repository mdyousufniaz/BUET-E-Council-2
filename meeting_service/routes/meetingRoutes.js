const express = require('express');
const { authMiddleware } = require('../middlewares/authMiddleware');
const meetingController = require('../controllers/meetingController');
const { checkMeetingLock } = require('../middlewares/lockMiddleware');
const multer = require('multer');

const upload = multer({ storage: multer.memoryStorage() });

const router = express.Router();

router.use(authMiddleware);
router.use(checkMeetingLock);

router.get('/', meetingController.getMeetings);
router.post('/', meetingController.createMeeting);
router.post('/bulk-import', meetingController.bulkImportMeeting);
router.get('/:id', meetingController.getMeetingById);
router.put('/:id', meetingController.updateMeeting);
router.delete('/:id', meetingController.deleteMeeting); // critical
router.post('/:id/complete', meetingController.completeMeeting);
router.put('/:id/lock', meetingController.toggleLock);

router.post('/:id/invitees', meetingController.addInvitees);
router.get('/:id/invitees', meetingController.getInvitees);
router.get('/:id/invitees/emails', meetingController.getInviteesEmails);
router.delete('/:id/invitees/:inviteeId', meetingController.removeInvitee);
router.put('/:id/invitees/:inviteeId', meetingController.updateInvitee);
router.post('/:id/invitees/bulk-fetch', meetingController.bulkFetchInvitees);
router.get('/:id/presentees', meetingController.getPresentees);
router.post('/:id/presentees', meetingController.addPresentees);
router.put('/:id/presentees/:presenteeId', meetingController.updatePresentee);
router.delete('/:id/presentees/:presenteeId', meetingController.removePresentee);
router.put('/:id/attendance', meetingController.saveAttendance);

// Unified endpoint for generating PDFs
router.get('/:id/pdf/:type', meetingController.generatePdf);

// Send agenda (or any ad-hoc message) via email to selected invitees
router.post('/:id/send-email', meetingController.sendAgendaEmail);

// Endpoint for uploading material PDFs
router.post('/:id/materials/upload', upload.single('file'), meetingController.uploadMaterial);

module.exports = router;

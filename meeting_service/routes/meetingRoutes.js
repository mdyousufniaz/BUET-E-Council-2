const express = require('express');
const { authMiddleware } = require('../middlewares/authMiddleware');
const meetingController = require('../controllers/meetingController');

const router = express.Router();

router.use(authMiddleware);

router.get('/', meetingController.getMeetings);
router.get('/:id', meetingController.getMeetingById);
router.post('/', meetingController.createMeeting);
router.put('/:id', meetingController.updateMeeting);
router.delete('/:id', meetingController.deleteMeeting); // critical
router.post('/:id/complete', meetingController.completeMeeting);

router.post('/:id/invitees', meetingController.addInvitees);
router.get('/:id/invitees', meetingController.getInvitees);
router.delete('/:id/invitees/:inviteeId', meetingController.removeInvitee);
router.post('/:id/invitees/bulk-fetch', meetingController.bulkFetchInvitees);
router.post('/:id/presentees', meetingController.addPresentees);
router.put('/:id/attendance', meetingController.saveAttendance);

// Unified endpoint for generating PDFs
router.get('/:id/pdf/:type', meetingController.generatePdf);

module.exports = router;

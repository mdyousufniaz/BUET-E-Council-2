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

router.post('/:id/invitees', meetingController.addInvitees);
router.post('/:id/invitees/bulk-fetch', meetingController.bulkFetchInvitees);
router.post('/:id/presentees', meetingController.addPresentees);

// Unified endpoint for generating PDFs
router.get('/:id/pdf/:type', meetingController.generatePdf);

module.exports = router;

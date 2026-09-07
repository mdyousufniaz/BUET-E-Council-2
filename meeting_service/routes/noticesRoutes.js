const express = require('express');
const { authMiddleware } = require('../middlewares/authMiddleware');
const { requireRole } = require('../middlewares/roleMiddleware');
const noticeController = require('../controllers/noticeController');
const { auditLog } = require('../middlewares/auditMiddleware');
const multer = require('multer');

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }
});

const router = express.Router();

router.use(authMiddleware);
router.use(auditLog('notice'));

const noticeAdmins = requireRole('admin', 'superadmin', 'moderator');

router.get('/settings/signatures', noticeAdmins, noticeController.getSignatures);
router.put('/settings/signatures', noticeAdmins, noticeController.updateSignatures);
router.post('/settings/signatures/upload', noticeAdmins, upload.single('file'), noticeController.uploadNoticeSignature);

router.get('/settings/signed-persona', noticeAdmins, noticeController.getSignedPersona);
router.put('/settings/signed-persona', noticeAdmins, noticeController.updateSignedPersona);
router.post('/settings/signed-persona/upload', noticeAdmins, upload.single('file'), noticeController.uploadSignedPersonaSignature);

router.post('/generate-pdf', noticeAdmins, noticeController.generateNoticePdfFromPayload);

// Saved notice documents (the "Email Document" editor's Save button)
router.get('/meeting/:meetingId', noticeAdmins, noticeController.getMeetingNotices);
router.put('/meeting/:meetingId', noticeAdmins, noticeController.saveMeetingNotice);

module.exports = router;

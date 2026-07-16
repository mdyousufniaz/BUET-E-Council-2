const express = require('express');
const { authMiddleware } = require('../middlewares/authMiddleware');
const { requireRole } = require('../middlewares/roleMiddleware');
const auditLogController = require('../controllers/auditLogController');

const router = express.Router();

router.use(authMiddleware);
router.use(requireRole('admin'));

router.get('/', auditLogController.getAuditLogs);
router.get('/archives', auditLogController.getAuditLogArchives);

module.exports = router;

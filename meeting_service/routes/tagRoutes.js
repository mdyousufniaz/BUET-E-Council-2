const express = require('express');
const { authMiddleware } = require('../middlewares/authMiddleware');
const { requireRole } = require('../middlewares/roleMiddleware');
const tagController = require('../controllers/tagController');

const router = express.Router();
const canEdit = requireRole('admin', 'superadmin', 'moderator', 'file_initiator');

router.use(authMiddleware);

router.get('/', tagController.getTags);
router.post('/', canEdit, tagController.createTag);

module.exports = router;

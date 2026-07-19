const express = require('express');
const { authMiddleware } = require('../middlewares/authMiddleware');
const { requireRole } = require('../middlewares/roleMiddleware');
const membersController = require('../controllers/membersController');

const router = express.Router();
const canEdit = requireRole('admin', 'moderator');

router.use(authMiddleware);

router.get('/', membersController.getMembers);
router.post('/fetch-external', canEdit, membersController.fetchExternalMembers);
router.put('/reorder', canEdit, membersController.reorderMembers);
router.post('/', canEdit, membersController.createMember);
router.put('/:id', canEdit, membersController.updateMember);
router.delete('/:id', canEdit, membersController.deleteMember);

module.exports = router;

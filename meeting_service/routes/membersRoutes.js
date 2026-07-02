const express = require('express');
const { authMiddleware } = require('../middlewares/authMiddleware');
const membersController = require('../controllers/membersController');

const router = express.Router();

router.use(authMiddleware);

router.get('/', membersController.getMembers);
router.post('/fetch-external', membersController.fetchExternalMembers);
router.post('/', membersController.createMember);
router.put('/:id', membersController.updateMember);
router.delete('/:id', membersController.deleteMember);

module.exports = router;

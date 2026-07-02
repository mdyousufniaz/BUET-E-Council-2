const express = require('express');
const { authMiddleware } = require('../middlewares/authMiddleware');
const templateController = require('../controllers/templateController');

const router = express.Router();

router.use(authMiddleware);

router.get('/', templateController.getTemplates);
router.get('/search', templateController.searchTemplates);
router.post('/', templateController.createTemplate);
router.put('/:id', templateController.updateTemplate);
router.delete('/:id', templateController.deleteTemplate);
router.patch('/:id/visibility', templateController.updateVisibility);
router.post('/:id/use', templateController.incrementUseCount);

module.exports = router;

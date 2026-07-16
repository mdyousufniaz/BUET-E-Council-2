const express = require('express');
const { authMiddleware } = require('../middlewares/authMiddleware');
const storageController = require('../controllers/storageController');

const router = express.Router();

router.use(authMiddleware);

// Matches any nested key, e.g. /api/storage/materials/<id>/agenda-abcd.pdf
router.get('/*key', storageController.streamFile);

module.exports = router;

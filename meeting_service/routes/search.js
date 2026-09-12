// File: ./meeting_service/routes/search.js
const express = require('express');
const { search } = require('../controllers/searchController');
const { authMiddleware } = require('../middlewares/authMiddleware');

const router = express.Router();

router.use(authMiddleware);
router.get('/', search);
router.get('/search', search);

module.exports = router;

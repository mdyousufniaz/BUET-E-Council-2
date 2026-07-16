const express = require('express');
const { authMiddleware } = require('../middlewares/authMiddleware');
const { requireRole } = require('../middlewares/roleMiddleware');
const agendaController = require('../controllers/agendaController');
const { checkMeetingLock } = require('../middlewares/lockMiddleware');
const { auditLog } = require('../middlewares/auditMiddleware');
const multer = require('multer');
const { fileFilter: annexureFileFilter, MAX_FILE_SIZE_MB } = require('../config/annexureUpload');

// Annexure uploads only: restricted to the formats/size configured in
// config/annexureUpload.js.
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_SIZE_MB * 1024 * 1024 },
    fileFilter: annexureFileFilter
});

const router = express.Router();
const canEdit = requireRole('admin', 'moderator');

router.use(authMiddleware);
router.use(checkMeetingLock);
router.use(auditLog('agenda'));

// Agendam routes
router.get('/', agendaController.getAgendams);
router.post('/', canEdit, agendaController.createAgendam);
router.put('/:id', canEdit, agendaController.updateAgendam);
router.delete('/:id', canEdit, agendaController.deleteAgendam);

// Resolution routes (nested or specific endpoints)
router.get('/:id/resolutions', agendaController.getResolutions);
router.post('/:id/resolutions', canEdit, agendaController.createResolution);
router.put('/resolutions/:resId', canEdit, agendaController.updateResolution);
router.put('/resolutions/:resId/execution', canEdit, agendaController.updateExecutionStatus);
router.delete('/resolutions/:resId', canEdit, agendaController.deleteResolution);

// Annexures
router.get('/:id/annexures', agendaController.getAnnexures);
router.post('/:id/annexures', canEdit, upload.single('file'), agendaController.uploadAnnexure);
router.put('/annexures/reorder', canEdit, agendaController.reorderAnnexures);
router.delete('/annexures/:annexureId', canEdit, agendaController.deleteAnnexure);

// Revision history (agenda content and resolution text)
router.get('/:id/revisions', agendaController.getRevisions);
router.post('/:id/revisions/:revisionId/restore', canEdit, agendaController.restoreRevision);

module.exports = router;

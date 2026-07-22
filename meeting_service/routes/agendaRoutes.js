const express = require('express');
const { authMiddleware } = require('../middlewares/authMiddleware');
const { requireMeetingAuthor, requireMeetingOperator, requireResolutionEditor } = require('../middlewares/meetingWorkflowMiddleware');
const agendaController = require('../controllers/agendaController');
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

router.use(authMiddleware);
router.use(auditLog('agenda'));

// Agendam routes.
// Agenda *content* is the file the initiator prepares and submits, so it is
// editable only by its owner while the file is in draft/sent_back (or by admin).
router.get('/', agendaController.getAgendams);
router.post('/', requireMeetingAuthor, agendaController.createAgendam);
router.put('/:id', requireMeetingAuthor, agendaController.updateAgendam);
router.delete('/:id', requireMeetingAuthor, agendaController.deleteAgendam);

// Resolution routes. Recorded in the resolution/attendance phase (agenda
// approved + meeting ongoing, before the resolution is approved).
router.get('/:id/resolutions', agendaController.getResolutions);
router.post('/:id/resolutions', requireResolutionEditor, agendaController.createResolution);
router.put('/resolutions/:resId', requireResolutionEditor, agendaController.updateResolution);
router.put('/resolutions/:resId/execution', requireResolutionEditor, agendaController.updateExecutionStatus);
router.delete('/resolutions/:resId', requireResolutionEditor, agendaController.deleteResolution);

// Annexures (attachments for agenda items or resolutions).
router.get('/:id/annexures', agendaController.getAnnexures);
router.post('/:id/annexures', requireMeetingOperator, upload.single('file'), agendaController.uploadAnnexure);
router.put('/annexures/reorder', requireMeetingOperator, agendaController.reorderAnnexures);
router.delete('/annexures/:annexureId', requireMeetingOperator, agendaController.deleteAnnexure);

// Revision history (agenda content and resolution text)
router.get('/:id/revisions', agendaController.getRevisions);
router.post('/:id/revisions/:revisionId/restore', requireMeetingAuthor, agendaController.restoreRevision);

module.exports = router;

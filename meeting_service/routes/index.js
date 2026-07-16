const express = require('express');
const router = express.Router();

const meetingRoutes = require('./meetingRoutes');
const facultiesRoutes = require('./facultiesRoutes');
const membersRoutes = require('./membersRoutes');
const departmentRoutes = require('./departmentRoutes');
const templateRoutes = require('./templateRoutes');
const agendaRoutes = require('./agendaRoutes');
const officeRoutes = require('./officeRoutes');
const tagRoutes = require('./tagRoutes');
const searchRoutes = require('./searchRoutes');
const storageRoutes = require('./storageRoutes');
const auditLogRoutes = require('./auditLogRoutes');

router.use('/meetings', meetingRoutes);
router.use('/faculties', facultiesRoutes);
router.use('/members', membersRoutes);
router.use('/departments', departmentRoutes);
router.use('/templates', templateRoutes);
router.use('/agendas', agendaRoutes);
router.use('/offices', officeRoutes);
router.use('/tags', tagRoutes);
router.use('/search', searchRoutes);
router.use('/storage', storageRoutes);
router.use('/audit-logs', auditLogRoutes);

module.exports = router;

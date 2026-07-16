const db = require('../db');
const storageService = require('../utils/storageService');

const ARCHIVE_PREFIX = 'audit-log-archives/';

// ISO 8601 week number (Monday-start weeks, matching most calendar conventions).
const getIsoWeek = (date) => {
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return { year: d.getUTCFullYear(), week: weekNo };
};

const getWeekLabel = (date) => {
    const { year, week } = getIsoWeek(date);
    return `${year}-W${String(week).padStart(2, '0')}`;
};

// Monday 00:00:00 UTC of the week containing `date`, and the following Monday (exclusive end).
const getWeekRange = (date) => {
    const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const dayNum = start.getUTCDay() || 7;
    start.setUTCDate(start.getUTCDate() - dayNum + 1);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 7);
    return { start, end };
};

// Archives one completed week of audit_logs into a single JSON file in
// object storage, keyed by ISO week (e.g. audit-log-archives/2026-W29.json).
// Idempotent/self-healing: safe to call repeatedly - skips weeks that are
// already archived and weeks with no log rows.
const archiveWeek = async (weekStartDate) => {
    const label = getWeekLabel(weekStartDate);
    const key = `${ARCHIVE_PREFIX}${label}.json`;

    const existing = await storageService.getFileMetadata(key);
    if (existing !== null) return; // already archived

    const { start, end } = getWeekRange(weekStartDate);
    const result = await db.query(
        `SELECT id, user_id, username, action, entity_type, entity_id, details, ip_address, created_at
         FROM audit_logs WHERE created_at >= $1 AND created_at < $2 ORDER BY created_at ASC`,
        [start.toISOString(), end.toISOString()]
    );

    if (result.rows.length === 0) return; // nothing to archive for this week

    const payload = JSON.stringify({ week: label, from: start.toISOString(), to: end.toISOString(), count: result.rows.length, logs: result.rows }, null, 2);
    await storageService.uploadFile(Buffer.from(payload, 'utf8'), key, 'application/json');
    console.log(`[audit-archiver] archived ${result.rows.length} log(s) for week ${label}`);
};

// Walks backward from last week (the most recently *completed* week) up to
// `weeksBack` weeks, archiving any that aren't already done. Running this
// daily means a missed run (e.g. the worker was down) self-heals on the next tick.
const reconcileWeeklyArchives = async (weeksBack = 8) => {
    try {
        const now = new Date();
        for (let i = 1; i <= weeksBack; i++) {
            const d = new Date(now);
            d.setUTCDate(d.getUTCDate() - 7 * i);
            await archiveWeek(d);
        }
    } catch (err) {
        console.error('[audit-archiver] reconciliation failed:', err.message);
    }
};

const startWeeklyAuditArchiver = (intervalMs = 24 * 60 * 60 * 1000) => {
    console.log('[audit-archiver] starting weekly audit log archiver');
    setTimeout(() => {
        reconcileWeeklyArchives().catch(err => console.error('[audit-archiver] startup run failed:', err.message));
    }, 15000);

    return setInterval(() => {
        reconcileWeeklyArchives();
    }, intervalMs);
};

module.exports = { startWeeklyAuditArchiver, reconcileWeeklyArchives, getWeekLabel, ARCHIVE_PREFIX };

// Standalone entrypoint (run as its own container/process: `npm run start:worker`)
// that consumes the 'embedding-jobs' queue produced by utils/searchIndexer.js.
// Kept out of the Express process so a burst of agenda saves can never block
// the API event loop with CPU-heavy embedding work.
const os = require('os');
const fs = require('fs');
const { Worker, DelayedError } = require('bullmq');
const IORedis = require('ioredis');
const db = require('./db');
const { embedAndStoreChunks } = require('./utils/searchIndexer');
const { startBackgroundIndexer } = require('./utils/backgroundIndexer');

const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379';
const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });

const MIN_FREE_MEMORY_MB = parseInt(process.env.MIN_FREE_MEMORY_MB || '400', 10);
// os.loadavg() is an absolute run-queue length, not a percentage, so it has
// to be normalized against core count to mean anything portable across
// differently-sized machines/containers - 0.85 here means "85% of this
// container's CPU allotment busy on average over the last minute".
const MAX_NORMALIZED_LOAD = parseFloat(process.env.MAX_NORMALIZED_LOAD || '0.85');
const RETRY_DELAY_MS = parseInt(process.env.EMBEDDING_RETRY_DELAY_MS || '10000', 10);

// os.freemem()/os.totalmem() report the *host's* memory, which is meaningless
// once Docker gives this container its own mem_limit - a host with plenty of
// free RAM would never trip the pause even as this specific container heads
// toward its own OOM kill. Cgroup v2 (standard on modern Docker/Debian/Alpine)
// exposes the container's own limit/usage directly, so prefer that and only
// fall back to host-wide stats when it's not available (e.g. local dev).
const getMemoryHeadroomMB = () => {
    try {
        const max = fs.readFileSync('/sys/fs/cgroup/memory.max', 'utf8').trim();
        if (max !== 'max') {
            const current = parseInt(fs.readFileSync('/sys/fs/cgroup/memory.current', 'utf8').trim(), 10);
            return (parseInt(max, 10) - current) / (1024 * 1024);
        }
    } catch (err) {
        // Not running under cgroup v2 - fall through to host-wide stats.
    }
    return os.freemem() / (1024 * 1024);
};

const hasEnoughResources = () => {
    const freeMemoryMB = getMemoryHeadroomMB();
    const normalizedLoad = os.loadavg()[0] / os.cpus().length;
    return freeMemoryMB >= MIN_FREE_MEMORY_MB && normalizedLoad <= MAX_NORMALIZED_LOAD;
};

const worker = new Worker('embedding-jobs', async (job, token) => {
    if (!hasEnoughResources()) {
        console.log(`[embedding-worker] resources low, delaying job ${job.id} (agenda ${job.data.agendaId}) by ${RETRY_DELAY_MS}ms`);
        await job.moveToDelayed(Date.now() + RETRY_DELAY_MS, token);
        throw new DelayedError();
    }

    const { agendaId, plainText, tableName } = job.data;
    await embedAndStoreChunks(agendaId, plainText, tableName);
}, { connection, concurrency: 1 });

worker.on('completed', (job) => {
    console.log(`[embedding-worker] indexed agenda ${job.data.agendaId} (${job.data.kind})`);
});

worker.on('failed', (job, err) => {
    console.error(`[embedding-worker] failed for agenda ${job?.data?.agendaId}:`, err.message);
});

console.log('Embedding worker started, waiting for jobs...');

// Reconciliation sweep (catches agenda/resolution rows saved without going
// through indexAgendaContent/indexResolutionContent - e.g. a bulk import, or
// a save that happened while this worker or Redis was down). It only reads
// rows and enqueues jobs onto the same queue this process drains, so it
// belongs here rather than competing with the Express API for CPU time.
const backgroundIndexerHandle = startBackgroundIndexer();

process.on('SIGTERM', async () => {
    clearInterval(backgroundIndexerHandle);
    await worker.close();
    await db.pool.end();
    process.exit(0);
});

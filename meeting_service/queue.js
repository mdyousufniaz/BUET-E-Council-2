const { Queue } = require('bullmq');
const IORedis = require('ioredis');

const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379';

// BullMQ requires this exact option on the ioredis connection it's handed.
const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });

const embeddingQueue = new Queue('embedding-jobs', { connection });

module.exports = { embeddingQueue, connection };

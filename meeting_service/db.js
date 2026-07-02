const { Pool } = require('pg');

const pool = new Pool(process.env.DATABASE_URL ? {
    connectionString: process.env.DATABASE_URL
} : {
    user: process.env.POSTGRES_USER || 'admin',
    host: process.env.POSTGRES_HOST || '127.0.0.1',
    database: process.env.POSTGRES_DB || 'buet_ecouncil',
    password: process.env.POSTGRES_PASSWORD || 'secretpassword',
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
});

module.exports = {
    query: (text, params) => pool.query(text, params),
    pool
};

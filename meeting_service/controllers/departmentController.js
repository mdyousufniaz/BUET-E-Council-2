const CustomError = require('../errors/CustomError');
const db = require('../db');
const csv = require('csv-parser');
const { Parser } = require('json2csv');
const { Readable } = require('stream');

const getDepartments = async (req, res, next) => {
    try {
        const result = await db.query(`
            SELECT d.*, f.name_english as faculty_name 
            FROM departments d
            LEFT JOIN faculties f ON d.faculty_id = f.id
            ORDER BY d.serial ASC NULLS LAST, d.created_at DESC
        `);
        res.status(200).json({ success: true, data: result.rows });
    } catch (error) {
        next(error);
    }
};

const createDepartment = async (req, res, next) => {
    try {
        const { name_bangla, name_english, alias_bangla, alias_english, faculty_id, serial } = req.body;

        if (!name_bangla || !name_english || !alias_bangla || !alias_english || !faculty_id) {
            return next(new CustomError('All fields (names, aliases, faculty_id) are required', 400));
        }

        let assignedSerial = serial;
        if (!assignedSerial) {
            const maxSerialResult = await db.query('SELECT MAX(serial) as max_serial FROM departments');
            assignedSerial = (maxSerialResult.rows[0].max_serial || 0) + 1;
        }

        const result = await db.query(
            'INSERT INTO departments (name_bangla, name_english, alias_bangla, alias_english, faculty_id, serial) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
            [name_bangla, name_english, alias_bangla, alias_english, faculty_id, assignedSerial]
        );

        res.status(201).json({ success: true, message: 'Department created', data: result.rows[0] });
    } catch (error) {
        if (error.code === '23505') {
            return next(new CustomError('Department names/aliases must be unique', 409));
        }
        next(error);
    }
};

const updateDepartment = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { name_bangla, name_english, alias_bangla, alias_english, faculty_id, serial } = req.body;

        const result = await db.query(
            `UPDATE departments 
             SET name_bangla = COALESCE($1, name_bangla), 
                 name_english = COALESCE($2, name_english),
                 alias_bangla = COALESCE($3, alias_bangla),
                 alias_english = COALESCE($4, alias_english),
                 faculty_id = COALESCE($5, faculty_id),
                 serial = COALESCE($6, serial)
             WHERE id = $7 RETURNING *`,
            [name_bangla, name_english, alias_bangla, alias_english, faculty_id, serial, id]
        );

        if (result.rows.length === 0) {
            return next(new CustomError('Department not found', 404));
        }

        res.status(200).json({ success: true, message: 'Department updated', data: result.rows[0] });
    } catch (error) {
        if (error.code === '23505') {
            return next(new CustomError('Department names/aliases must be unique', 409));
        }
        next(error);
    }
};

const deleteDepartment = async (req, res, next) => {
    try {
        const { id } = req.params;
        const result = await db.query('DELETE FROM departments WHERE id = $1 RETURNING *', [id]);

        if (result.rows.length === 0) {
            return next(new CustomError('Department not found', 404));
        }

        res.status(200).json({ success: true, message: 'Department deleted' });
    } catch (error) {
        next(error);
    }
};

const reorderDepartments = async (req, res, next) => {
    try {
        const { items } = req.body;
        if (!Array.isArray(items)) return next(new CustomError('Items array required', 400));

        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');
            for (const item of items) {
                await client.query('UPDATE departments SET serial = $1 WHERE id = $2', [item.serial, item.id]);
            }
            await client.query('COMMIT');
            res.status(200).json({ success: true, message: 'Departments reordered successfully' });
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (error) {
        next(error);
    }
};

const uploadCsv = async (req, res, next) => {
    try {
        if (!req.file) return next(new CustomError('No file uploaded', 400));

        const results = [];
        const stream = Readable.from(req.file.buffer);

        stream
            .pipe(csv())
            .on('data', (data) => results.push(data))
            .on('end', async () => {
                const client = await db.pool.connect();
                try {
                    await client.query('BEGIN');
                    let count = 0;
                    let nextSerial = null;
                    for (const row of results) {
                        if (row.name_bangla && row.name_english && row.faculty_id) {
                            let serial = row.serial ? parseInt(row.serial) : null;
                            if (serial === null) {
                                if (nextSerial === null) {
                                    const maxSerialResult = await client.query('SELECT MAX(serial) as max_serial FROM departments');
                                    nextSerial = (maxSerialResult.rows[0].max_serial || 0) + 1;
                                } else {
                                    nextSerial++;
                                }
                                serial = nextSerial;
                            }
                            await client.query(
                                `INSERT INTO departments (name_bangla, name_english, alias_bangla, alias_english, faculty_id, serial)
                                 VALUES ($1, $2, $3, $4, $5, $6)
                                 ON CONFLICT (name_bangla) DO UPDATE
                                 SET name_english = EXCLUDED.name_english,
                                     alias_bangla = EXCLUDED.alias_bangla,
                                     alias_english = EXCLUDED.alias_english,
                                     faculty_id = EXCLUDED.faculty_id,
                                     serial = EXCLUDED.serial`,
                                [row.name_bangla, row.name_english, row.alias_bangla, row.alias_english, row.faculty_id, serial]
                            );
                            count++;
                        }
                    }
                    await client.query('COMMIT');
                    res.status(200).json({ success: true, message: `${count} departments uploaded/updated` });
                } catch (err) {
                    await client.query('ROLLBACK');
                    next(err);
                } finally {
                    client.release();
                }
            });
    } catch (error) {
        next(error);
    }
};

const downloadCsv = async (req, res, next) => {
    try {
        const result = await db.query('SELECT id, serial, name_bangla, name_english, alias_bangla, alias_english, faculty_id, created_at FROM departments ORDER BY serial ASC NULLS LAST');
        
        if (result.rows.length === 0) {
            return next(new CustomError('No data found', 404));
        }

        const json2csvParser = new Parser();
        const csv = json2csvParser.parse(result.rows);

        res.header('Content-Type', 'text/csv');
        res.attachment('departments.csv');
        return res.send(csv);
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getDepartments,
    createDepartment,
    updateDepartment,
    deleteDepartment,
    reorderDepartments,
    uploadCsv,
    downloadCsv
};

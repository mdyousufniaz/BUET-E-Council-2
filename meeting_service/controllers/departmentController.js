const CustomError = require('../errors/CustomError');
const db = require('../db');

const getDepartments = async (req, res, next) => {
    try {
        const result = await db.query('SELECT * FROM departments ORDER BY created_at DESC');
        res.status(200).json({ success: true, data: result.rows });
    } catch (error) {
        next(error);
    }
};

const createDepartment = async (req, res, next) => {
    try {
        const { name_bangla, name_english, alias_bangla, alias_english, faculty_id } = req.body;

        if (!name_bangla || !name_english || !alias_bangla || !alias_english || !faculty_id) {
            return next(new CustomError('All fields (names, aliases, faculty_id) are required', 400));
        }

        const result = await db.query(
            'INSERT INTO departments (name_bangla, name_english, alias_bangla, alias_english, faculty_id) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [name_bangla, name_english, alias_bangla, alias_english, faculty_id]
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
        const { name_bangla, name_english, alias_bangla, alias_english, faculty_id } = req.body;

        const result = await db.query(
            `UPDATE departments 
             SET name_bangla = COALESCE($1, name_bangla), 
                 name_english = COALESCE($2, name_english),
                 alias_bangla = COALESCE($3, alias_bangla),
                 alias_english = COALESCE($4, alias_english),
                 faculty_id = COALESCE($5, faculty_id)
             WHERE id = $6 RETURNING *`,
            [name_bangla, name_english, alias_bangla, alias_english, faculty_id, id]
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

module.exports = {
    getDepartments,
    createDepartment,
    updateDepartment,
    deleteDepartment
};

const CustomError = require('../errors/CustomError');
const db = require('../db');

const getFaculties = async (req, res, next) => {
    try {
        const result = await db.query('SELECT * FROM faculties ORDER BY created_at DESC');
        res.status(200).json({ success: true, data: result.rows });
    } catch (error) {
        next(error);
    }
};

const createFaculty = async (req, res, next) => {
    try {
        const { name_bangla, name_english } = req.body;
        
        if (!name_bangla || !name_english) {
            return next(new CustomError('Name (Bangla and English) are required', 400));
        }

        const result = await db.query(
            'INSERT INTO faculties (name_bangla, name_english) VALUES ($1, $2) RETURNING *',
            [name_bangla, name_english]
        );
        
        res.status(201).json({ success: true, message: 'Faculty created', data: result.rows[0] });
    } catch (error) {
        if (error.code === '23505') { // unique violation
            return next(new CustomError('Faculty already exists', 409));
        }
        next(error);
    }
};

const updateFaculty = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { name_bangla, name_english } = req.body;

        const result = await db.query(
            'UPDATE faculties SET name_bangla = COALESCE($1, name_bangla), name_english = COALESCE($2, name_english) WHERE id = $3 RETURNING *',
            [name_bangla, name_english, id]
        );

        if (result.rows.length === 0) {
            return next(new CustomError('Faculty not found', 404));
        }

        res.status(200).json({ success: true, message: 'Faculty updated', data: result.rows[0] });
    } catch (error) {
        if (error.code === '23505') {
            return next(new CustomError('Faculty already exists with those names', 409));
        }
        next(error);
    }
};

const deleteFaculty = async (req, res, next) => {
    try {
        const { id } = req.params;
        const result = await db.query('DELETE FROM faculties WHERE id = $1 RETURNING *', [id]);

        if (result.rows.length === 0) {
            return next(new CustomError('Faculty not found', 404));
        }

        res.status(200).json({ success: true, message: 'Faculty deleted' });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getFaculties,
    createFaculty,
    updateFaculty,
    deleteFaculty
};

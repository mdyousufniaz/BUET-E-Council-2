const CustomError = require('../errors/CustomError');
const db = require('../db');

const getMembers = async (req, res, next) => {
    try {
        const result = await db.query('SELECT * FROM members ORDER BY created_at DESC');
        res.status(200).json({ success: true, data: result.rows });
    } catch (error) {
        next(error);
    }
};

const createMember = async (req, res, next) => {
    try {
        const { name, prefix, designation, department_id, office_id, email } = req.body;

        if (!name) {
            return next(new CustomError('Name is required', 400));
        }

        const result = await db.query(
            'INSERT INTO members (name, prefix, designation, department_id, office_id, email) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
            [name, prefix, designation, department_id || null, office_id || null, email]
        );

        res.status(201).json({ success: true, message: 'Member created', data: result.rows[0] });
    } catch (error) {
        if (error.code === '23505') {
            return next(new CustomError('Member email already exists', 409));
        }
        next(error);
    }
};

const updateMember = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { name, prefix, designation, department_id, office_id, email } = req.body;

        const result = await db.query(
            `UPDATE members 
             SET name = COALESCE($1, name), 
                 prefix = COALESCE($2, prefix),
                 designation = COALESCE($3, designation),
                 department_id = COALESCE($4, department_id),
                 office_id = COALESCE($5, office_id),
                 email = COALESCE($6, email)
             WHERE id = $7 RETURNING *`,
            [name, prefix, designation, department_id, office_id, email, id]
        );

        if (result.rows.length === 0) {
            return next(new CustomError('Member not found', 404));
        }

        res.status(200).json({ success: true, message: 'Member updated', data: result.rows[0] });
    } catch (error) {
        if (error.code === '23505') {
            return next(new CustomError('Email already in use', 409));
        }
        next(error);
    }
};

const deleteMember = async (req, res, next) => {
    try {
        const { id } = req.params;
        const result = await db.query('DELETE FROM members WHERE id = $1 RETURNING *', [id]);

        if (result.rows.length === 0) {
            return next(new CustomError('Member not found', 404));
        }

        res.status(200).json({ success: true, message: 'Member deleted' });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getMembers,
    createMember,
    updateMember,
    deleteMember
};

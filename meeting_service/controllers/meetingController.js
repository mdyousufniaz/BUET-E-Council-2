const CustomError = require('../errors/CustomError');
const db = require('../db');

const createMeeting = async (req, res, next) => {
    try {
        const { title, meeting_date, type, meeting_link } = req.body;

        if (!title || !meeting_date || !type) {
            return next(new CustomError('Title, meeting_date, and type are required', 400));
        }

        const result = await db.query(
            'INSERT INTO meetings (title, meeting_date, type, meeting_link) VALUES ($1, $2, $3, $4) RETURNING *',
            [title, meeting_date, type, meeting_link]
        );

        res.status(201).json({ success: true, message: 'Meeting created successfully', data: result.rows[0] });
    } catch (error) {
        next(error);
    }
};

const updateMeeting = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { title, meeting_date, type, meeting_link, status } = req.body;

        const result = await db.query(
            `UPDATE meetings 
             SET title = COALESCE($1, title), 
                 meeting_date = COALESCE($2, meeting_date),
                 type = COALESCE($3, type),
                 meeting_link = COALESCE($4, meeting_link),
                 status = COALESCE($5, status)
             WHERE id = $6 RETURNING *`,
            [title, meeting_date, type, meeting_link, status, id]
        );

        if (result.rows.length === 0) {
            return next(new CustomError('Meeting not found', 404));
        }

        res.status(200).json({ success: true, message: 'Meeting updated successfully', data: result.rows[0] });
    } catch (error) {
        next(error);
    }
};

const deleteMeeting = async (req, res, next) => {
    try {
        const { id } = req.params;
        
        // Cascading deletion is handled by Postgres ON DELETE CASCADE constraints
        // (e.g. for agenda, invitees, presentees)
        const result = await db.query('DELETE FROM meetings WHERE id = $1 RETURNING *', [id]);

        if (result.rows.length === 0) {
            return next(new CustomError('Meeting not found', 404));
        }

        res.status(200).json({ success: true, message: 'Meeting deleted successfully' });
    } catch (error) {
        next(error);
    }
};

const addAgendamToMeeting = async (req, res, next) => {
    try {
        const meeting_id = req.params.id;
        const { agenda_serial } = req.body;

        const result = await db.query(
            'INSERT INTO agenda (meeting_id, agenda_serial) VALUES ($1, $2) RETURNING *',
            [meeting_id, agenda_serial]
        );

        res.status(201).json({ success: true, message: 'Agendam added to meeting', data: result.rows[0] });
    } catch (error) {
        next(error);
    }
};

const addInvitees = async (req, res, next) => {
    try {
        const meeting_id = req.params.id;
        const { invitees } = req.body; // Expecting an array of invitees

        if (!Array.isArray(invitees) || invitees.length === 0) {
            return next(new CustomError('Invitees array is required', 400));
        }

        const values = [];
        const placeholders = [];
        let counter = 1;

        invitees.forEach(invitee => {
            placeholders.push(`($${counter++}, $${counter++}, $${counter++}, $${counter++}, $${counter++}, $${counter++})`);
            values.push(invitee.name, invitee.email, invitee.designation, invitee.department_id || null, invitee.office_id || null, meeting_id);
        });

        const query = `
            INSERT INTO invitees (name, email, designation, department_id, office_id, meeting_id) 
            VALUES ${placeholders.join(', ')} RETURNING *
        `;

        const result = await db.query(query, values);

        res.status(201).json({ success: true, message: 'Invitees added', data: result.rows });
    } catch (error) {
        next(error);
    }
};

const addPresentees = async (req, res, next) => {
    try {
        const meeting_id = req.params.id;
        const { presentees } = req.body; // Expecting an array of presentees

        if (!Array.isArray(presentees) || presentees.length === 0) {
            return next(new CustomError('Presentees array is required', 400));
        }

        const values = [];
        const placeholders = [];
        let counter = 1;

        presentees.forEach(presentee => {
            placeholders.push(`($${counter++}, $${counter++}, $${counter++}, $${counter++}, $${counter++})`);
            values.push(presentee.name, presentee.designation, presentee.department_id || null, presentee.office_id || null, meeting_id);
        });

        const query = `
            INSERT INTO presentees (name, designation, department_id, office_id, meeting_id) 
            VALUES ${placeholders.join(', ')} RETURNING *
        `;

        const result = await db.query(query, values);

        res.status(201).json({ success: true, message: 'Presentees added', data: result.rows });
    } catch (error) {
        next(error);
    }
};

// PDF Generators
const { generateAgendaPdf, generateResolutionPdf, generateAttendanceSheet } = require('../utils/pdfGenerator');

const handleGenerateAgendaPdf = async (req, res, next) => {
    try {
        const meeting_id = req.params.id;
        const meeting = await db.query('SELECT * FROM meetings WHERE id = $1', [meeting_id]);
        if (meeting.rows.length === 0) return next(new CustomError('Meeting not found', 404));

        const pdfData = await generateAgendaPdf(meeting.rows[0]);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=agenda_${meeting_id}.pdf`);
        res.send(pdfData);
    } catch (error) {
        next(error);
    }
};

const handleGenerateResolutionPdf = async (req, res, next) => {
    try {
        const meeting_id = req.params.id;
        const meeting = await db.query('SELECT * FROM meetings WHERE id = $1', [meeting_id]);
        if (meeting.rows.length === 0) return next(new CustomError('Meeting not found', 404));

        const pdfData = await generateResolutionPdf({ details: 'Resolution for ' + meeting.rows[0].title });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=resolution_${meeting_id}.pdf`);
        res.send(pdfData);
    } catch (error) {
        next(error);
    }
};

const handleGenerateAttendanceSheet = async (req, res, next) => {
    try {
        const meeting_id = req.params.id;
        const meeting = await db.query('SELECT * FROM meetings WHERE id = $1', [meeting_id]);
        if (meeting.rows.length === 0) return next(new CustomError('Meeting not found', 404));

        const pdfData = await generateAttendanceSheet(meeting.rows[0]);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=attendance_${meeting_id}.pdf`);
        res.send(pdfData);
    } catch (error) {
        next(error);
    }
};

module.exports = {
    createMeeting,
    updateMeeting,
    deleteMeeting,
    addAgendamToMeeting,
    addInvitees,
    addPresentees,
    generateAgendaPdf: handleGenerateAgendaPdf,
    generateResolutionPdf: handleGenerateResolutionPdf,
    generateAttendanceSheet: handleGenerateAttendanceSheet
};

const CustomError = require('../errors/CustomError');
const db = require('../db');
const { generateAgendaPdf, generateResolutionPdf, generateAttendanceSheet } = require('../utils/pdfGenerator');

const getMeetings = async (req, res, next) => {
    try {
        const result = await db.query(`
            SELECT *, 
                   ROW_NUMBER() OVER (ORDER BY created_at ASC) as serial 
            FROM meetings 
            ORDER BY created_at DESC
        `);
        
        // Format dates correctly for the frontend
        const data = result.rows.map(meeting => ({
            ...meeting,
            date: new Date(meeting.meeting_date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
        }));

        res.status(200).json({ success: true, data });
    } catch (error) {
        next(error);
    }
};

const getMeetingById = async (req, res, next) => {
    try {
        const { id } = req.params;
        const result = await db.query(`
            SELECT m.*, 
            (SELECT COUNT(*) FROM meetings m2 WHERE m2.created_at <= m.created_at) as serial 
            FROM meetings m
            WHERE m.id = $1
        `, [id]);
        
        if (result.rows.length === 0) {
            return next(new CustomError('Meeting not found', 404));
        }

        const meeting = result.rows[0];
        meeting.date = new Date(meeting.meeting_date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

        res.status(200).json({ success: true, data: meeting });
    } catch (error) {
        next(error);
    }
};

const createMeeting = async (req, res, next) => {
    try {
        const { title, meeting_date, type, status } = req.body;
        if (!title || !meeting_date || !type) {
            return next(new CustomError('Title, date, and type are required', 400));
        }

        const result = await db.query(
            'INSERT INTO meetings (title, meeting_date, type, status) VALUES ($1, $2, $3, $4) RETURNING *',
            [title, meeting_date, type, status || 'draft']
        );
        res.status(201).json({ success: true, message: 'Meeting created', data: result.rows[0] });
    } catch (error) {
        next(error);
    }
};

const updateMeeting = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { title, meeting_date, type, status, meeting_link } = req.body;

        const result = await db.query(
            `UPDATE meetings 
             SET title = COALESCE($1, title), 
                 meeting_date = COALESCE($2, meeting_date), 
                 type = COALESCE($3, type), 
                 status = COALESCE($4, status),
                 meeting_link = COALESCE($5, meeting_link)
             WHERE id = $6 RETURNING *`,
            [title, meeting_date, type, status, meeting_link, id]
        );

        if (result.rows.length === 0) return next(new CustomError('Meeting not found', 404));
        res.status(200).json({ success: true, message: 'Meeting updated', data: result.rows[0] });
    } catch (error) {
        next(error);
    }
};

const deleteMeeting = async (req, res, next) => {
    try {
        const { id } = req.params;
        const result = await db.query('DELETE FROM meetings WHERE id = $1 RETURNING *', [id]);
        if (result.rows.length === 0) return next(new CustomError('Meeting not found', 404));
        res.status(200).json({ success: true, message: 'Meeting deleted' });
    } catch (error) {
        next(error);
    }
};

const addInvitees = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { invitees } = req.body; // array of invitee objects
        if (!invitees || !Array.isArray(invitees)) return next(new CustomError('Invitees array is required', 400));

        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');
            for (const invitee of invitees) {
                await client.query(
                    'INSERT INTO invitees (name, email, designation, department_id, office_id, meeting_id) VALUES ($1, $2, $3, $4, $5, $6)',
                    [invitee.name, invitee.email, invitee.designation, invitee.department_id, invitee.office_id, id]
                );
            }
            await client.query('COMMIT');
            res.status(201).json({ success: true, message: 'Invitees added' });
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

const bulkFetchInvitees = async (req, res, next) => {
    try {
        const { id } = req.params;
        
        const meetingRes = await db.query('SELECT type FROM meetings WHERE id = $1', [id]);
        if (meetingRes.rows.length === 0) return next(new CustomError('Meeting not found', 404));
        
        const meetingType = meetingRes.rows[0].type;
        
        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');
            
            const insertQuery = `
                INSERT INTO invitees (name, email, designation, department_id, office_id, meeting_id)
                SELECT m.name, m.email, m.designation, m.department_id, m.office_id, $1
                FROM members m
                WHERE m.member_type = $2
                  AND NOT EXISTS (
                      SELECT 1 FROM invitees i 
                      WHERE i.meeting_id = $1 AND (i.email = m.email OR (i.name = m.name AND m.email IS NULL))
                  )
            `;
            const result = await client.query(insertQuery, [id, meetingType]);
            
            await client.query('COMMIT');
            res.status(201).json({ success: true, message: `Fetched and added ${result.rowCount} members.` });
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

const addPresentees = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { presentees } = req.body; // array of presentee objects
        if (!presentees || !Array.isArray(presentees)) return next(new CustomError('Presentees array is required', 400));

        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');
            for (const presentee of presentees) {
                await client.query(
                    'INSERT INTO presentees (name, designation, department_id, office_id, meeting_id) VALUES ($1, $2, $3, $4, $5)',
                    [presentee.name, presentee.designation, presentee.department_id, presentee.office_id, id]
                );
            }
            await client.query('COMMIT');
            res.status(201).json({ success: true, message: 'Presentees added' });
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

const generatePdf = async (req, res, next) => {
    try {
        const { id, type } = req.params; // type = agenda, resolution, attendance
        let pdfBuffer;
        
        // Basic check if meeting exists
        const meetingCheck = await db.query('SELECT * FROM meetings WHERE id = $1', [id]);
        if (meetingCheck.rows.length === 0) return next(new CustomError('Meeting not found', 404));

        if (type === 'agenda') {
            pdfBuffer = await generateAgendaPdf(id);
        } else if (type === 'resolution') {
            pdfBuffer = await generateResolutionPdf(id);
        } else if (type === 'attendance') {
            pdfBuffer = await generateAttendanceSheet(id);
        } else {
            return next(new CustomError('Invalid pdf type requested', 400));
        }

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=${type}-${id}.pdf`);
        res.send(pdfBuffer);
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getMeetings,
    getMeetingById,
    createMeeting,
    updateMeeting,
    deleteMeeting,
    addInvitees,
    bulkFetchInvitees,
    addPresentees,
    generatePdf
};

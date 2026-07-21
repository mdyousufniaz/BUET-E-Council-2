const CustomError = require('../errors/CustomError');
const db = require('../db');
const { generatePdf: generateMeetingPdf, generateAttendanceSheet } = require('../utils/pdfGenerator');
const storageService = require('../utils/storageService');
const { sendMail } = require('../utils/mailer');
const crypto = require('crypto');
const { indexAgendaContent, indexResolutionContent } = require('../utils/searchIndexer');

const getMeetings = async (req, res, next) => {
    try {
        const result = await db.query(`
            SELECT m.*,
                   u.username AS creator_username,
                   ROW_NUMBER() OVER (ORDER BY m.legacy_meeting_no DESC NULLS FIRST) as serial
            FROM meetings m
            LEFT JOIN users u ON u.id = m.created_by
            ORDER BY m.legacy_meeting_no DESC NULLS FIRST
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
            u.username AS creator_username,
            r.username AS reviewer_username,
            (SELECT COUNT(*) FROM meetings m2
             WHERE m2.legacy_meeting_no IS NOT NULL AND m.legacy_meeting_no IS NOT NULL
               AND m2.legacy_meeting_no <= m.legacy_meeting_no) as serial
            FROM meetings m
            LEFT JOIN users u ON u.id = m.created_by
            LEFT JOIN users r ON r.id = m.reviewed_by
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
        const { title, meeting_title, meeting_date, type, status } = req.body;
        if (!title || !meeting_date || !type) {
            return next(new CustomError('Title (serial), date, and type are required', 400));
        }

        const result = await db.query(
            `INSERT INTO meetings (title, meeting_title, meeting_date, type, status, created_by)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [title, meeting_title || null, meeting_date, type, status || 'draft', req.user?.id || null]
        );
        res.status(201).json({ success: true, message: 'Meeting created', data: result.rows[0] });
    } catch (error) {
        next(error);
    }
};

const updateMeeting = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { title, meeting_title, description, conclusion, meeting_date, type, status, meeting_link, agenda_pdf_link, resolution_pdf_link, transcript } = req.body;

        const result = await db.query(
            `UPDATE meetings SET 
                title = COALESCE($1, title),
                meeting_title = COALESCE($2, meeting_title),
                description = COALESCE($3, description),
                conclusion = COALESCE($4, conclusion),
                meeting_date = COALESCE($5, meeting_date),
                type = COALESCE($6, type),
                status = COALESCE($7, status),
                meeting_link = COALESCE($8, meeting_link),
                agenda_pdf_link = COALESCE($9, agenda_pdf_link),
                resolution_pdf_link = COALESCE($10, resolution_pdf_link),
                transcript = COALESCE($11, transcript)
             WHERE id = $12 RETURNING *`,
            [title, meeting_title, description, conclusion, meeting_date, type, status, meeting_link, agenda_pdf_link, resolution_pdf_link, transcript, id]
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

// --- File approval workflow --------------------------------------------------

const isMeetingOwner = (meeting, user) =>
    meeting.created_by && user && String(meeting.created_by) === String(user.id);

const isAdminRole = (user) => user && (user.role === 'admin' || user.role === 'superadmin');

// Forward the file one step UP the escalation chain:
//   initiator (owner) -> moderator      (submitted for moderator review)
//   moderator          -> admin         (escalated for admin approval)
// admin/superadmin may push either step on anyone's behalf.
const submitMeeting = async (req, res, next) => {
    try {
        const { id } = req.params;
        const check = await db.query('SELECT created_by, stage FROM meetings WHERE id = $1', [id]);
        if (check.rows.length === 0) return next(new CustomError('Meeting not found', 404));

        const meeting = check.rows[0];
        const admin = isAdminRole(req.user);
        let nextStage;

        if (meeting.stage === 'initiator') {
            if (!admin && !isMeetingOwner(meeting, req.user)) {
                return next(new CustomError('Only the initiator who created this file can submit it to the moderator.', 403));
            }
            nextStage = 'moderator';
        } else if (meeting.stage === 'moderator') {
            if (!admin && req.user?.role !== 'moderator') {
                return next(new CustomError('Only a moderator can escalate this file to the admin.', 403));
            }
            nextStage = 'admin';
        } else {
            return next(new CustomError(`This file cannot be submitted while it is at the "${meeting.stage}" stage.`, 409));
        }

        const result = await db.query(
            `UPDATE meetings
             SET stage = $2, moderator_can_return = FALSE, submitted_at = NOW(),
                 review_note = NULL, reviewed_by = $3, reviewed_at = NOW()
             WHERE id = $1 RETURNING *`,
            [id, nextStage, req.user?.id || null]
        );
        const dest = nextStage === 'moderator' ? 'moderator' : 'admin';
        res.status(200).json({ success: true, message: `Meeting file submitted to the ${dest}`, data: result.rows[0] });
    } catch (error) {
        next(error);
    }
};

// admin/superadmin approves a file that has reached the admin stage. Once
// approved only admin/superadmin can edit it (enforced in the workflow gate).
const approveMeeting = async (req, res, next) => {
    try {
        const { id } = req.params;
        const check = await db.query('SELECT stage FROM meetings WHERE id = $1', [id]);
        if (check.rows.length === 0) return next(new CustomError('Meeting not found', 404));
        if (check.rows[0].stage !== 'admin') {
            return next(new CustomError('Only a file that has reached the admin stage can be approved.', 409));
        }

        const result = await db.query(
            `UPDATE meetings
             SET stage = 'approved', moderator_can_return = FALSE, resolution_approved = FALSE,
                 review_note = NULL, reviewed_by = $2, reviewed_at = NOW()
             WHERE id = $1 RETURNING *`,
            [id, req.user?.id || null]
        );
        res.status(200).json({ success: true, message: 'Meeting file approved', data: result.rows[0] });
    } catch (error) {
        next(error);
    }
};

// Hand the file back DOWN the chain, with an optional note explaining what to fix.
//   - admin/superadmin: may return from any stage to 'moderator' or 'initiator'.
//       Returning to the moderator sets moderator_can_return = TRUE, which is the
//       ONLY way a moderator later gains the right to return it to the initiator.
//   - moderator: may return to 'initiator' only while holding the file at the
//       'moderator' stage AND only if an admin handed it down (moderator_can_return).
const returnMeeting = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { note } = req.body;
        const target = req.body?.target;
        if (!['initiator', 'moderator'].includes(target)) {
            return next(new CustomError("A valid target ('initiator' or 'moderator') is required.", 400));
        }

        const check = await db.query('SELECT stage, moderator_can_return FROM meetings WHERE id = $1', [id]);
        if (check.rows.length === 0) return next(new CustomError('Meeting not found', 404));
        const meeting = check.rows[0];

        const admin = isAdminRole(req.user);
        if (admin) {
            if (meeting.stage === 'initiator') {
                return next(new CustomError('This file is already with the initiator.', 409));
            }
        } else if (req.user?.role === 'moderator') {
            if (target !== 'initiator' || meeting.stage !== 'moderator' || !meeting.moderator_can_return) {
                return next(new CustomError('You can only return this file to the initiator after an admin has handed it back to you.', 403));
            }
        } else {
            return next(new CustomError('You do not have permission to return this file.', 403));
        }

        const moderatorCanReturn = admin && target === 'moderator';
        const result = await db.query(
            `UPDATE meetings
             SET stage = $2, moderator_can_return = $3, resolution_approved = FALSE, review_note = $4,
                 reviewed_by = $5, reviewed_at = NOW()
             WHERE id = $1 RETURNING *`,
            [id, target, moderatorCanReturn, note || null, req.user?.id || null]
        );
        res.status(200).json({ success: true, message: `Meeting file returned to the ${target}`, data: result.rows[0] });
    } catch (error) {
        next(error);
    }
};

// admin/superadmin approves the resolution, locking resolution + attendance
// editing. Requires the agenda approved and the meeting ongoing.
const approveResolution = async (req, res, next) => {
    try {
        const { id } = req.params;
        const check = await db.query('SELECT stage, status, resolution_approved FROM meetings WHERE id = $1', [id]);
        if (check.rows.length === 0) return next(new CustomError('Meeting not found', 404));
        const m = check.rows[0];
        if (m.stage !== 'approved') return next(new CustomError('The agenda must be approved before the resolution.', 409));
        if (m.status !== 'ongoing') return next(new CustomError('The meeting must be "ongoing" to approve its resolution.', 409));
        if (m.resolution_approved) return next(new CustomError('The resolution has already been approved.', 409));

        const result = await db.query(
            `UPDATE meetings SET resolution_approved = TRUE, reviewed_by = $2, reviewed_at = NOW()
             WHERE id = $1 RETURNING *`,
            [id, req.user?.id || null]
        );
        res.status(200).json({ success: true, message: 'Resolution approved', data: result.rows[0] });
    } catch (error) {
        next(error);
    }
};

// admin/superadmin reopens an approved resolution for further edits.
const reopenResolution = async (req, res, next) => {
    try {
        const { id } = req.params;
        const result = await db.query(
            `UPDATE meetings SET resolution_approved = FALSE, reviewed_by = $2, reviewed_at = NOW()
             WHERE id = $1 RETURNING *`,
            [id, req.user?.id || null]
        );
        if (result.rows.length === 0) return next(new CustomError('Meeting not found', 404));
        res.status(200).json({ success: true, message: 'Resolution reopened for editing', data: result.rows[0] });
    } catch (error) {
        next(error);
    }
};

const completeMeeting = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { title } = req.body;

        // Verify meeting
        const check = await db.query('SELECT title, status FROM meetings WHERE id = $1', [id]);
        if (check.rows.length === 0) return next(new CustomError('Meeting not found', 404));
        if (check.rows[0].status === 'past') return next(new CustomError('Meeting is already marked as past', 400));
        
        if (check.rows[0].title !== title) {
            return next(new CustomError('Meeting serial number does not match', 400));
        }

        await db.query('BEGIN');
        
        // Update meeting status
        await db.query('UPDATE meetings SET status = $1 WHERE id = $2', ['past', id]);
        
        // Get present invitees
        const invitees = await db.query('SELECT name, designation, department_id, office_id, serial FROM invitees WHERE meeting_id = $1 AND is_present = true', [id]);

        // Insert into presentees, freezing each invitee's current serial as the
        // presentee's permanent seniority order.
        for (const invitee of invitees.rows) {
            await db.query(
                'INSERT INTO presentees (meeting_id, name, designation, department_id, office_id, serial) VALUES ($1, $2, $3, $4, $5, $6)',
                [id, invitee.name, invitee.designation, invitee.department_id, invitee.office_id, invitee.serial]
            );
        }
        
        // Delete ALL invitees for this meeting
        await db.query('DELETE FROM invitees WHERE meeting_id = $1', [id]);
        
        await db.query('COMMIT');
        
        res.status(200).json({ success: true, message: 'Meeting marked as complete' });
    } catch (error) {
        await db.query('ROLLBACK');
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

            // Custom (non-member) invitees are appended after whatever is
            // already in the meeting's invitee list.
            const maxSerialResult = await client.query('SELECT MAX(serial) as max_serial FROM invitees WHERE meeting_id = $1', [id]);
            let nextSerial = (maxSerialResult.rows[0].max_serial || 0) + 1;

            for (const invitee of invitees) {
                let serial = null;
                if (invitee.member_id) {
                    // Trust the DB, not the client, for the linked member's serial.
                    const memberRes = await client.query('SELECT serial FROM members WHERE id = $1', [invitee.member_id]);
                    serial = memberRes.rows[0]?.serial ?? null;
                } else if (invitee.serial !== undefined && invitee.serial !== null && invitee.serial !== '') {
                    const requestedSerial = parseInt(invitee.serial, 10);
                    if (!Number.isNaN(requestedSerial)) {
                        // Only push down other custom invitees — member-linked ones must
                        // keep the serial their member owns, so leave them in place even
                        // if that means sharing a serial with the new row.
                        await client.query(
                            'UPDATE invitees SET serial = serial + 1 WHERE meeting_id = $1 AND member_id IS NULL AND serial >= $2',
                            [id, requestedSerial]
                        );
                        serial = requestedSerial;
                        nextSerial = Math.max(nextSerial + 1, requestedSerial + 1);
                    }
                }
                if (serial === null) {
                    serial = nextSerial++;
                }

                await client.query(
                    'INSERT INTO invitees (name, email, designation, department_id, office_id, meeting_id, member_id, serial) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
                    [invitee.name, invitee.email, invitee.designation, invitee.department_id || null, invitee.office_id || null, id, invitee.member_id || null, serial]
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
                INSERT INTO invitees (name, email, designation, department_id, office_id, meeting_id, member_id, serial)
                SELECT m.name, m.email, m.designation, m.department_id, m.office_id, $1, m.id, m.serial
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

const getInvitees = async (req, res, next) => {
    try {
        const { id } = req.params;
        const result = await db.query(`
            SELECT i.*, d.name_bangla as department_name, d.serial as department_serial, o.name_bangla as office_name
            FROM invitees i
            LEFT JOIN departments d ON i.department_id = d.id
            LEFT JOIN offices o ON i.office_id = o.id
            WHERE i.meeting_id = $1
            ORDER BY i.serial ASC NULLS LAST, i.created_at ASC
        `, [id]);

        res.status(200).json({ success: true, data: result.rows });
    } catch (error) {
        next(error);
    }
};

const getInviteesEmails = async (req, res, next) => {
    try {
        const { id } = req.params;
        const result = await db.query(`
            SELECT i.id, i.name, i.email, i.designation, i.serial,
                   d.name_bangla as department_name, d.serial as department_serial, o.name_bangla as office_name
            FROM invitees i
            LEFT JOIN departments d ON i.department_id = d.id
            LEFT JOIN offices o ON i.office_id = o.id
            WHERE i.meeting_id = $1
            ORDER BY i.serial ASC NULLS LAST, i.created_at ASC
        `, [id]);
        res.status(200).json({ success: true, data: result.rows });
    } catch (error) {
        next(error);
    }
};


const removeInvitee = async (req, res, next) => {
    try {
        const { id, inviteeId } = req.params;
        const result = await db.query(
            'DELETE FROM invitees WHERE id = $1 AND meeting_id = $2 RETURNING *',
            [inviteeId, id]
        );

        if (result.rows.length === 0) {
            return next(new CustomError('Invitee not found', 404));
        }

        res.status(200).json({ success: true, message: 'Invitee removed' });
    } catch (error) {
        next(error);
    }
};

const updateInvitee = async (req, res, next) => {
    try {
        const { id, inviteeId } = req.params;
        const { name, email, designation, department_id, office_id } = req.body;
        const result = await db.query(
            'UPDATE invitees SET name = $1, email = $2, designation = $3, department_id = $4, office_id = $5 WHERE id = $6 AND meeting_id = $7 RETURNING *',
            [name, email, designation, department_id || null, office_id || null, inviteeId, id]
        );

        if (result.rows.length === 0) {
            return next(new CustomError('Invitee not found', 404));
        }

        res.status(200).json({ success: true, message: 'Invitee updated', data: result.rows[0] });
    } catch (error) {
        next(error);
    }
};

const reorderInvitee = async (req, res, next) => {
    try {
        const { id, inviteeId } = req.params;
        const requestedSerial = parseInt(req.body.serial, 10);
        if (Number.isNaN(requestedSerial)) return next(new CustomError('serial is required', 400));

        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');

            const inviteeRes = await client.query(
                'SELECT serial FROM invitees WHERE id = $1 AND meeting_id = $2',
                [inviteeId, id]
            );
            if (inviteeRes.rows.length === 0) {
                await client.query('ROLLBACK');
                client.release();
                return next(new CustomError('Invitee not found', 404));
            }

            const oldSerial = inviteeRes.rows[0].serial ?? requestedSerial;

            // Meeting-local move only — never touches members.serial, even for
            // member-linked invitees. This is intentionally decoupled from the
            // global member order: the sync_invitee_serial trigger still seeds
            // (and re-syncs) a member-linked invitee's serial whenever that
            // member's own serial changes elsewhere, but a drag here never
            // reaches back out to move the member.
            if (requestedSerial > oldSerial) {
                await client.query(
                    'UPDATE invitees SET serial = serial - 1 WHERE meeting_id = $1 AND serial > $2 AND serial <= $3 AND id != $4',
                    [id, oldSerial, requestedSerial, inviteeId]
                );
            } else if (requestedSerial < oldSerial) {
                await client.query(
                    'UPDATE invitees SET serial = serial + 1 WHERE meeting_id = $1 AND serial >= $2 AND serial < $3 AND id != $4',
                    [id, requestedSerial, oldSerial, inviteeId]
                );
            }
            await client.query('UPDATE invitees SET serial = $1 WHERE id = $2', [requestedSerial, inviteeId]);

            await client.query('COMMIT');
            res.status(200).json({ success: true, message: 'Invitee reordered successfully' });
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

const getPresentees = async (req, res, next) => {
    try {
        const { id } = req.params;
        const result = await db.query(`
            SELECT p.*, d.name_bangla as department_name, d.serial as department_serial, o.name_bangla as office_name
            FROM presentees p
            LEFT JOIN departments d ON p.department_id = d.id
            LEFT JOIN offices o ON p.office_id = o.id
            WHERE p.meeting_id = $1
            ORDER BY p.serial ASC NULLS LAST
        `, [id]);

        res.status(200).json({ success: true, data: result.rows });
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

            // Custom (non-member) presentees are appended after whatever is
            // already recorded for this meeting.
            const maxSerialResult = await client.query('SELECT MAX(serial) as max_serial FROM presentees WHERE meeting_id = $1', [id]);
            let nextSerial = (maxSerialResult.rows[0].max_serial || 0) + 1;

            for (const presentee of presentees) {
                let serial = null;
                if (presentee.member_id) {
                    // Trust the DB, not the client, for the linked member's serial.
                    const memberRes = await client.query('SELECT serial FROM members WHERE id = $1', [presentee.member_id]);
                    serial = memberRes.rows[0]?.serial ?? null;
                } else if (presentee.serial !== undefined && presentee.serial !== null && presentee.serial !== '') {
                    const requestedSerial = parseInt(presentee.serial, 10);
                    if (!Number.isNaN(requestedSerial)) {
                        await client.query(
                            'UPDATE presentees SET serial = serial + 1 WHERE meeting_id = $1 AND serial >= $2',
                            [id, requestedSerial]
                        );
                        serial = requestedSerial;
                        nextSerial = Math.max(nextSerial + 1, requestedSerial + 1);
                    }
                }
                if (serial === null) {
                    serial = nextSerial++;
                }

                await client.query(
                    'INSERT INTO presentees (name, designation, department_id, office_id, meeting_id, serial) VALUES ($1, $2, $3, $4, $5, $6)',
                    [presentee.name, presentee.designation, presentee.department_id || null, presentee.office_id || null, id, serial]
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

const updatePresentee = async (req, res, next) => {
    try {
        const { id, presenteeId } = req.params;
        const { name, designation, department_id, office_id } = req.body;
        const result = await db.query(
            'UPDATE presentees SET name = $1, designation = $2, department_id = $3, office_id = $4 WHERE id = $5 AND meeting_id = $6 RETURNING *',
            [name, designation, department_id || null, office_id || null, presenteeId, id]
        );

        if (result.rows.length === 0) {
            return next(new CustomError('Presentee not found', 404));
        }

        res.status(200).json({ success: true, message: 'Presentee updated', data: result.rows[0] });
    } catch (error) {
        next(error);
    }
};

const removePresentee = async (req, res, next) => {
    try {
        const { id, presenteeId } = req.params;
        const result = await db.query(
            'DELETE FROM presentees WHERE id = $1 AND meeting_id = $2 RETURNING *',
            [presenteeId, id]
        );

        if (result.rows.length === 0) {
            return next(new CustomError('Presentee not found', 404));
        }

        res.status(200).json({ success: true, message: 'Presentee removed' });
    } catch (error) {
        next(error);
    }
};

const saveAttendance = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { present_invitee_ids } = req.body;

        if (!Array.isArray(present_invitee_ids)) {
            return next(new CustomError('present_invitee_ids must be an array', 400));
        }

        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');
            await client.query('UPDATE invitees SET is_present = false WHERE meeting_id = $1', [id]);
            
            if (present_invitee_ids.length > 0) {
                await client.query('UPDATE invitees SET is_present = true WHERE meeting_id = $1 AND id = ANY($2)', [id, present_invitee_ids]);
            }
            
            await client.query('COMMIT');
            res.status(200).json({ success: true, message: 'Attendance saved successfully' });
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

        // Basic check if meeting exists (the generators fetch the full data themselves).
        const meetingCheck = await db.query('SELECT id FROM meetings WHERE id = $1', [id]);
        if (meetingCheck.rows.length === 0) return next(new CustomError('Meeting not found', 404));

        if (type === 'agenda') {
            pdfBuffer = await generateMeetingPdf(id, false);
        } else if (type === 'resolution') {
            pdfBuffer = await generateMeetingPdf(id, true);
        } else if (type === 'attendance') {
            pdfBuffer = await generateAttendanceSheet(id);
        } else if (type === 'resolution-status') {
            pdfBuffer = await generateMeetingPdf(id, true, 'resolution-status');
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

const uploadMaterial = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { type } = req.body; // 'agenda', 'resolution', 'resolution-status'
        const file = req.file;

        if (!id || !type || !file) {
            return next(new CustomError('id, type, and file are required', 400));
        }

        const validTypes = ['agenda', 'resolution', 'resolution-status'];
        if (!validTypes.includes(type)) {
            return next(new CustomError('Invalid material type', 400));
        }

        // Check if meeting exists
        const meetingCheck = await db.query('SELECT * FROM meetings WHERE id = $1', [id]);
        if (meetingCheck.rows.length === 0) return next(new CustomError('Meeting not found', 404));

        const ext = file.originalname.split('.').pop() || 'pdf';
        const fileKey = `materials/${id}/${type}-${crypto.randomBytes(4).toString('hex')}.${ext}`;

        await storageService.uploadFile(file.buffer, fileKey, file.mimetype);

        let column = '';
        if (type === 'agenda') column = 'agenda_pdf_link';
        else if (type === 'resolution') column = 'resolution_pdf_link';
        else if (type === 'resolution-status') column = 'resolution_status_pdf_link';

        const result = await db.query(
            `UPDATE meetings SET ${column} = $1 WHERE id = $2 RETURNING *`,
            [fileKey, id]
        );

        res.status(200).json({ success: true, message: 'Material uploaded successfully', data: result.rows[0] });
    } catch (error) {
        next(error);
    }
};

const sendAgendaEmail = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { invitee_ids, from, subject, content, attach_agenda = true, attachments = [] } = req.body;

        if (!Array.isArray(invitee_ids) || invitee_ids.length === 0) {
            return next(new CustomError('invitee_ids must be a non-empty array', 400));
        }
        if (!from) return next(new CustomError('from is required', 400));
        if (!subject) return next(new CustomError('subject is required', 400));
        if (!content) return next(new CustomError('content is required', 400));

        const meetingCheck = await db.query('SELECT * FROM meetings WHERE id = $1', [id]);
        if (meetingCheck.rows.length === 0) return next(new CustomError('Meeting not found', 404));

        const inviteesResult = await db.query(
            `SELECT id, name, email FROM invitees WHERE meeting_id = $1 AND id = ANY($2::uuid[])`,
            [id, invitee_ids]
        );
        const foundInvitees = inviteesResult.rows;

        const recipients = foundInvitees.filter(i => !!i.email);
        const failed = foundInvitees
            .filter(i => !i.email)
            .map(i => ({ invitee_id: i.id, name: i.name, reason: 'No email address on file' }));

        const foundIds = new Set(foundInvitees.map(i => i.id));
        invitee_ids
            .filter(iid => !foundIds.has(iid))
            .forEach(iid => failed.push({ invitee_id: iid, reason: 'Invitee not found for this meeting' }));

        if (recipients.length === 0) {
            return next(new CustomError('None of the selected invitees have a valid email address', 400));
        }

        const mailAttachments = [...attachments];
        if (attach_agenda) {
            const pdfBuffer = await generateMeetingPdf(id, false);
            mailAttachments.push({
                filename: `agenda-${id}.pdf`,
                content: pdfBuffer.toString('base64'),
                contentType: 'application/pdf'
            });
        }

        const results = await Promise.allSettled(
            recipients.map(r => sendMail({
                from,
                to: r.email,
                subject,
                html: content,
                attachments: mailAttachments
            }))
        );

        const sent = [];
        results.forEach((r, idx) => {
            const recipient = recipients[idx];
            if (r.status === 'fulfilled') {
                sent.push({ invitee_id: recipient.id, email: recipient.email });
            } else {
                failed.push({ invitee_id: recipient.id, email: recipient.email, reason: r.reason?.message || 'Failed to send' });
            }
        });

        const statusCode = sent.length === 0 ? 502 : (failed.length > 0 ? 207 : 200);
        res.status(statusCode).json({
            success: sent.length > 0,
            message: sent.length === 0
                ? 'Failed to send email to all recipients'
                : failed.length > 0
                    ? `Sent to ${sent.length} recipient(s), ${failed.length} failed`
                    : `Email sent to ${sent.length} recipient(s)`,
            data: { sent, failed }
        });
    } catch (error) {
        next(error);
    }
};

const toggleLock = async (req, res, next) => {
    try {
        const { id } = req.params;

        const meetingCheck = await db.query('SELECT is_locked FROM meetings WHERE id = $1', [id]);
        if (meetingCheck.rows.length === 0) return next(new CustomError('Meeting not found', 404));

        const newLockState = !meetingCheck.rows[0].is_locked;

        const result = await db.query(
            'UPDATE meetings SET is_locked = $1 WHERE id = $2 RETURNING *',
            [newLockState, id]
        );

        res.status(200).json({ 
            success: true, 
            message: `Meeting successfully ${newLockState ? 'locked' : 'unlocked'}`, 
            data: result.rows[0] 
        });
    } catch (error) {
        next(error);
    }
};

const bulkImportMeeting = async (req, res, next) => {
    const client = await db.pool.connect();
    try {
        const { meeting, presentees, agendas } = req.body;
        
        await client.query('BEGIN');

        // 1. Insert Meeting
        const meetingResult = await client.query(
            `INSERT INTO meetings
            (title, meeting_title, meeting_date, type, status, description, president, conclusion, created_by)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING id`,
            [
                meeting.title,
                meeting.meeting_title,
                meeting.meeting_date,
                meeting.type,
                meeting.status || 'past',
                meeting.description,
                meeting.president,
                meeting.conclusion,
                req.user?.id || null
            ]
        );
        
        const meetingId = meetingResult.rows[0].id;

        // 2. Insert Presentees
        if (presentees && Array.isArray(presentees)) {
            // Legacy meetings have no serial data of their own — the JSON array's
            // order *is* the seniority order, so index 0 -> serial 1, etc.
            for (const [index, p] of presentees.entries()) {
                // Combine prefix and name if prefix exists
                const fullName = p.prefix ? `${p.prefix} ${p.name}` : p.name;

                await client.query(
                    `INSERT INTO presentees
                    (name, designation, department_id, office_id, meeting_id, serial)
                    VALUES ($1, $2, $3, $4, $5, $6)`,
                    [
                        fullName,
                        p.designation,
                        p.department_id || null,
                        p.office_id || null,
                        meetingId,
                        index + 1
                    ]
                );
            }
        }

        // 3. Insert Agendas
        if (agendas && Array.isArray(agendas)) {
            for (const a of agendas) {
                const res = await client.query(
                    `INSERT INTO agenda 
                    (content, resolution, agenda_serial, meeting_id) 
                    VALUES ($1, $2, $3, $4) RETURNING id`,
                    [
                        a.content,
                        a.resolution,
                        a.agenda_serial,
                        meetingId
                    ]
                );
                const agendaId = res.rows[0].id;
                
                if (a.content) {
                    indexAgendaContent(agendaId, a.content).catch(() => {});
                }
                if (a.resolution) {
                    indexResolutionContent(agendaId, a.resolution).catch(() => {});
                }
            }
        }

        await client.query('COMMIT');
        res.status(201).json({ success: true, message: 'Meeting imported successfully', meetingId });
    } catch (err) {
        await client.query('ROLLBACK');
        next(err);
    } finally {
        client.release();
    }
};

module.exports = {
    getMeetings,
    getMeetingById,
    createMeeting,
    updateMeeting,
    deleteMeeting,
    submitMeeting,
    approveMeeting,
    returnMeeting,
    approveResolution,
    reopenResolution,
    addInvitees,
    bulkFetchInvitees,
    getInvitees,
    updateInvitee,
    reorderInvitee,
    removeInvitee,
    getPresentees,
    addPresentees,
    updatePresentee,
    removePresentee,
    saveAttendance,
    generatePdf,
    completeMeeting,
    uploadMaterial,
    toggleLock,
    bulkImportMeeting,
    getInviteesEmails,
    sendAgendaEmail
};

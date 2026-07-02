const bulkImportMeeting = async (req, res, next) => {
    const client = await db.pool.connect();
    try {
        const { meeting, presentees, agendas } = req.body;
        
        await client.query('BEGIN');

        // 1. Insert Meeting
        const meetingResult = await client.query(
            `INSERT INTO meetings 
            (title, meeting_title, meeting_date, type, status, description, president, conclusion) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
            RETURNING id`,
            [
                meeting.title,
                meeting.meeting_title,
                meeting.meeting_date,
                meeting.type,
                meeting.status || 'past',
                meeting.description,
                meeting.president,
                meeting.conclusion
            ]
        );
        
        const meetingId = meetingResult.rows[0].id;

        // 2. Insert Presentees
        if (presentees && Array.isArray(presentees)) {
            for (const p of presentees) {
                // Combine prefix and name if prefix exists
                const fullName = p.prefix ? `${p.prefix} ${p.name}` : p.name;
                
                await client.query(
                    `INSERT INTO presentees 
                    (name, designation, department_id, office_id, meeting_id) 
                    VALUES ($1, $2, $3, $4, $5)`,
                    [
                        fullName,
                        p.designation,
                        p.department_id || null,
                        p.office_id || null,
                        meetingId
                    ]
                );
            }
        }

        // 3. Insert Agendas
        if (agendas && Array.isArray(agendas)) {
            for (const a of agendas) {
                await client.query(
                    `INSERT INTO agenda 
                    (content, resolution, agenda_serial, meeting_id) 
                    VALUES ($1, $2, $3, $4)`,
                    [
                        a.content,
                        a.resolution,
                        a.agenda_serial,
                        meetingId
                    ]
                );
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

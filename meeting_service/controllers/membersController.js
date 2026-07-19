const CustomError = require('../errors/CustomError');
const db = require('../db');
const axios = require('axios');

const getMembers = async (req, res, next) => {
    try {
        const { type } = req.query; // ?type=academic or ?type=syndicate

        let query = `
            SELECT m.*, d.name_bangla as department_name, o.name_bangla as office_name
            FROM members m
            LEFT JOIN departments d ON m.department_id = d.id
            LEFT JOIN offices o ON m.office_id = o.id
        `;
        const params = [];

        if (type && ['academic', 'syndicate', 'none'].includes(type)) {
            query += ' WHERE m.member_type = $1 ';
            params.push(type);
        }

        query += ' ORDER BY m.serial ASC NULLS LAST, m.created_at DESC';

        const result = await db.query(query, params);
        res.status(200).json({ success: true, data: result.rows });
    } catch (error) {
        next(error);
    }
};

const createMember = async (req, res, next) => {
    const client = await db.pool.connect();
    try {
        const { name, prefix, designation, department_id, office_id, email, member_type, serial } = req.body;

        if (!name) {
            client.release();
            return next(new CustomError('Name is required', 400));
        }

        const processedEmail = (email === "" || email === undefined) ? null : email;
        const requestedSerial = (serial === "" || serial === undefined || serial === null) ? null : parseInt(serial, 10);

        await client.query('BEGIN');

        let assignedSerial;
        if (requestedSerial !== null && !Number.isNaN(requestedSerial)) {
            // Make room at the requested position by pushing everyone at or after
            // it down by one, so the new member is inserted there instead of
            // colliding with (and silently losing to) an existing serial.
            await client.query('UPDATE members SET serial = serial + 1 WHERE serial >= $1', [requestedSerial]);
            assignedSerial = requestedSerial;
        } else {
            const maxSerialResult = await client.query('SELECT MAX(serial) as max_serial FROM members');
            assignedSerial = (maxSerialResult.rows[0].max_serial || 0) + 1;
        }

        const result = await client.query(
            `INSERT INTO members (name, prefix, designation, department_id, office_id, email, member_type, serial)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [
                name,
                prefix !== undefined ? prefix : null,
                designation !== undefined ? designation : null,
                (department_id === "" || department_id === undefined) ? null : department_id,
                (office_id === "" || office_id === undefined) ? null : office_id,
                processedEmail,
                member_type || 'none',
                assignedSerial
            ]
        );

        await client.query('COMMIT');
        res.status(201).json({ success: true, message: 'Member created', data: result.rows[0] });
    } catch (error) {
        await client.query('ROLLBACK');
        if (error.code === '23505') { // unique_violation
            return next(new CustomError('Member email must be unique', 409));
        }
        next(error);
    } finally {
        client.release();
    }
};

const reorderMembers = async (req, res, next) => {
    try {
        const { items } = req.body;
        if (!Array.isArray(items)) return next(new CustomError('Items array required', 400));

        const client = await db.pool.connect();
        try {
            await client.query('BEGIN');
            for (const item of items) {
                await client.query('UPDATE members SET serial = $1 WHERE id = $2', [item.serial, item.id]);
            }
            await client.query('COMMIT');
            res.status(200).json({ success: true, message: 'Members reordered successfully' });
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

const updateMember = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { name, prefix, designation, department_id, office_id, email, member_type } = req.body;

        // Convert empty strings to null for UUID and unique fields
        const processedDeptId = (department_id === "" || department_id === undefined) ? null : department_id;
        const processedOfficeId = (office_id === "" || office_id === undefined) ? null : office_id;
        const processedEmail = (email === "" || email === undefined) ? null : email;

        const result = await db.query(
            `UPDATE members 
             SET name = COALESCE($1, name), 
                 prefix = COALESCE($2, prefix), 
                 designation = COALESCE($3, designation), 
                 department_id = $4,
                 office_id = $5,
                 email = COALESCE($6, email),
                 member_type = COALESCE($7, member_type)
             WHERE id = $8 RETURNING *`,
            [
                name !== undefined ? name : null,
                prefix !== undefined ? prefix : null,
                designation !== undefined ? designation : null,
                processedDeptId,
                processedOfficeId,
                processedEmail,
                member_type !== undefined ? member_type : null,
                id
            ]
        );

        if (result.rows.length === 0) {
            return next(new CustomError('Member not found', 404));
        }

        res.status(200).json({ success: true, message: 'Member updated', data: result.rows[0] });
    } catch (error) {
        if (error.code === '23505') {
            return next(new CustomError('Member email must be unique', 409));
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

const fetchExternalMembers = async (req, res, next) => {
    try {
        const [usersResponse, deanHeadResponse] = await Promise.all([
            axios.get('https://regoffice.buet.ac.bd/filetracker/my-php-api/api/users.php'),
            axios.get('https://regoffice.buet.ac.bd/filetracker/my-php-api/api/Dean_Head.php')
        ]);

        const usersData = usersResponse.data;
        const deanHeadData = deanHeadResponse.data;

        const client = await db.pool.connect();
        
        const designationMap = {
            "Professor": "অধ্যাপক",
            "Associate Professor": "সহযোগী অধ্যাপক",
            "Assistant Professor": "সহকারী অধ্যাপক",
            "Lecturer": "প্রভাষক",
            "Dean": "ডিন",
            "Head": "বিভাগীয় প্রধান",
            "VC": "উপাচার্য",
            "Pro-VC": "উপ-উপাচার্য",
            "Registrar": "রেজিস্ট্রার"
        };
        
        try {
            await client.query('BEGIN');

            const deptsResult = await client.query('SELECT id, alias_english FROM departments');
            const deptMap = {};
            deptsResult.rows.forEach(d => {
                if (d.alias_english) deptMap[d.alias_english.toLowerCase()] = d.id;
            });

            const officesResult = await client.query('SELECT id, name_english FROM offices');
            const officeMap = {};
            officesResult.rows.forEach(o => {
                if (o.name_english) officeMap[o.name_english.toLowerCase()] = o.id;
            });

            let syncCount = 0;

            for (const [index, u] of usersData.entries()) {
                const name = u['Bangla Name:'];
                let designation = u['designation:'];
                if (designationMap[designation]) {
                    designation = designationMap[designation];
                }
                
                const deptSort = u['dept_sort:'];
                let rawEmail = u['email:'];

                if (!name) continue;

                let email = null;
                if (rawEmail) {
                    email = rawEmail.split(/<|\s/)[0].trim();
                    if (!email) email = null;
                }

                let department_id = (deptSort && deptMap[deptSort.toLowerCase()]) ? deptMap[deptSort.toLowerCase()] : null;
                let office_id = null;

                const dh = deanHeadData.find(d => d['Bangla Name:'] === name);
                if (dh) {
                    const dhDesig = dh['designation:'];
                    const dhOffice = dh['In-Charge-Office:'];
                    let officeStr = '';
                    if (dhDesig === 'Head') {
                        officeStr = `Department Head, ${dhOffice}`;
                    } else if (dhDesig === 'Dean') {
                        officeStr = `Dean, ${dhOffice}`;
                    } else {
                        officeStr = `${dhDesig}, ${dhOffice}`;
                    }

                    if (officeMap[officeStr.toLowerCase()]) {
                        office_id = officeMap[officeStr.toLowerCase()];
                    } else {
                        const newOfficeRes = await client.query(
                            'INSERT INTO offices (name_english, name_bangla) VALUES ($1, $2) RETURNING id',
                            [officeStr, officeStr]
                        );
                        office_id = newOfficeRes.rows[0].id;
                        officeMap[officeStr.toLowerCase()] = office_id;
                    }
                }

                const memberRes = await client.query('SELECT id FROM members WHERE name = $1', [name]);

                if (memberRes.rows.length > 0) {
                    await client.query(
                        `UPDATE members 
                         SET designation = $1, department_id = $2, office_id = $3, email = $4 
                         WHERE id = $5`,
                        [designation, department_id, office_id, email, memberRes.rows[0].id]
                    );
                } else {
                    if (email) {
                        const emailCheck = await client.query('SELECT id FROM members WHERE email = $1', [email]);
                        if (emailCheck.rows.length > 0) {
                            email = null;
                        }
                    }

                    // New members take their serial from this array's position, since it
                    // reflects the academic council's seniority order (index 0 -> serial 1).
                    // Members that already exist keep whatever serial they currently have.
                    await client.query(
                        `INSERT INTO members (name, designation, department_id, office_id, email, serial)
                         VALUES ($1, $2, $3, $4, $5, $6)`,
                        [name, designation, department_id, office_id, email, index + 1]
                    );
                }
                syncCount++;
            }

            await client.query('COMMIT');
            res.status(200).json({ success: true, message: `Synced ${syncCount} members successfully` });

        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }

    } catch (error) {
        next(error);
    }
};

module.exports = {
    getMembers,
    createMember,
    updateMember,
    deleteMember,
    fetchExternalMembers,
    reorderMembers
};

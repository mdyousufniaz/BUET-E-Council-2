const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const multer = require('multer');
const csv = require('csv-parser');
const { Parser } = require('json2csv');
const { Readable } = require('stream');
const db = require('./db');
const { requireAuth, requireAdmin } = require('./middleware');
const { getDeviceInfo } = require('./utils');
const { sendAccountCreatedEmail } = require('./email');
const { logAudit } = require('./auditLog');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

/**
 * @swagger
 * /signup:
 *   post:
 *     summary: Register a new user
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - username
 *               - email
 *               - password
 *             properties:
 *               username:
 *                 type: string
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *               role:
 *                 type: string
 *               member_type:
 *                 type: string
 *     responses:
 *       201:
 *         description: User created successfully
 *       400:
 *         description: Missing fields
 *       409:
 *         description: Username or email already exists
 */
// 1. POST /signup (admin-only: creating other users' accounts)
router.post('/signup', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { username, email, role = 'viewer', member_type = 'none' } = req.body;
        let { password } = req.body;

        if (!username || !email) {
            return res.status(400).json({ success: false, message: 'Username and Email are required' });
        }

        let generatedPassword = null;
        if (!password) {
            generatedPassword = crypto.randomBytes(9).toString('base64url'); // 12-char random password
            password = generatedPassword;
        }

        // Check if user exists
        const userCheck = await db.query('SELECT id FROM users WHERE username = $1 OR email = $2', [username || '', email]);
        if (userCheck.rows.length > 0) {
            return res.status(409).json({ success: false, message: 'Username or email already exists' });
        }

        // Hash password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Create user
        const result = await db.query(
            `INSERT INTO users (username, email, password, role, member_type)
             VALUES ($1, $2, $3, $4, $5) RETURNING id, username, email, role, status, created_at`,
            [username, email, hashedPassword, role, member_type]
        );

        const emailSent = await sendAccountCreatedEmail(email, username, password);

        logAudit({
            userId: req.user.id, username: req.user.username, action: 'create',
            entityType: 'user', entityId: result.rows[0].id,
            details: { created_username: username, role }, ip: req.ip
        });

        res.status(201).json({
            success: true,
            message: 'User created successfully',
            data: result.rows[0],
            generated_password: generatedPassword,
            email_sent: emailSent
        });
    } catch (err) {
        console.error('Signup error:', err);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

/**
 * @swagger
 * /signin:
 *   post:
 *     summary: Authenticate and create a session
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - username
 *               - password
 *             properties:
 *               username:
 *                 type: string
 *               password:
 *                 type: string
 *               location:
 *                 type: string
 *     responses:
 *       200:
 *         description: Login successful, returns session token
 *       400:
 *         description: Username and password are required
 *       401:
 *         description: Invalid credentials
 *       403:
 *         description: Account is inactive
 */
// 2. POST /signin
router.post('/signin', async (req, res) => {
    try {
        const { username, password, location } = req.body;
        const deviceInfo = JSON.stringify(getDeviceInfo(req));

        if (!username || !password) {
            return res.status(400).json({ success: false, message: 'Username and password are required' });
        }

        // Find user
        const userResult = await db.query('SELECT * FROM users WHERE username = $1 OR email = $1', [username]);
        if (userResult.rows.length === 0) {
            logAudit({ username, action: 'login_failed', entityType: 'auth', details: { reason: 'user not found' }, ip: req.ip });
            return res.status(401).json({ success: false, message: 'Invalid credentials', error_code: 'INVALID_CREDENTIALS' });
        }

        const user = userResult.rows[0];

        if (user.status !== 'active') {
            logAudit({ userId: user.id, username: user.username, action: 'login_failed', entityType: 'auth', details: { reason: 'account inactive' }, ip: req.ip });
            return res.status(403).json({ success: false, message: 'Account is inactive' });
        }

        // Verify password
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            logAudit({ userId: user.id, username: user.username, action: 'login_failed', entityType: 'auth', details: { reason: 'wrong password' }, ip: req.ip });
            return res.status(401).json({ success: false, message: 'Invalid credentials', error_code: 'INVALID_CREDENTIALS' });
        }

        // Create Session Token
        const sessionToken = crypto.randomBytes(64).toString('hex');
        const ipAddress = req.ip || req.connection.remoteAddress;

        // Expiration (30 days)
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 30);

        // Store session in DB
        const sessionResult = await db.query(
            `INSERT INTO sessions (user_id, session_token, device_info, ip_address, signin_location, expires_at) 
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, created_at`,
            [user.id, sessionToken, deviceInfo, ipAddress, location || 'Unknown', expiresAt]
        );

        logAudit({ userId: user.id, username: user.username, action: 'login', entityType: 'auth', entityId: user.id, ip: ipAddress });

        // Set HttpOnly, Secure Cookie
        res.cookie('session_token', sessionToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production', // Use secure cookies in production
            sameSite: 'strict',
            expires: expiresAt
        });

        res.status(200).json({
            success: true,
            message: 'Signin successful',
            data: {
                token: sessionToken,
                session_id: sessionResult.rows[0].id,
                user: {
                    id: user.id,
                    username: user.username,
                    email: user.email,
                    role: user.role
                }
            }
        });
    } catch (err) {
        console.error('Signin error:', err);
        res.status(500).json({ success: false, message: 'Internal server error', error: err.message, stack: err.stack });
    }
});

/**
 * @swagger
 * /signout:
 *   post:
 *     summary: Invalidate the current session
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: Logged out successfully
 *       401:
 *         description: Unauthorized
 */
// 3. POST /signout
router.post('/signout', requireAuth, async (req, res) => {
    try {
        await db.query('UPDATE sessions SET is_active = FALSE WHERE session_token = $1', [req.session.token]);
        logAudit({ userId: req.user.id, username: req.user.username, action: 'logout', entityType: 'auth', entityId: req.user.id, ip: req.ip });
        res.clearCookie('session_token');
        res.status(200).json({ success: true, message: 'Logged out successfully' });
    } catch (err) {
        console.error('Signout error:', err);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

/**
 * @swagger
 * /signout-all:
 *   post:
 *     summary: Invalidate all sessions for the current user
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: Logged out from all devices successfully
 *       401:
 *         description: Unauthorized
 */
// 4. POST /signout-all
router.post('/signout-all', requireAuth, async (req, res) => {
    try {
        await db.query('UPDATE sessions SET is_active = FALSE WHERE user_id = $1', [req.user.id]);
        logAudit({ userId: req.user.id, username: req.user.username, action: 'logout_all', entityType: 'auth', entityId: req.user.id, ip: req.ip });
        res.clearCookie('session_token');
        res.status(200).json({ success: true, message: 'Logged out from all devices successfully' });
    } catch (err) {
        console.error('Signout all error:', err);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

/**
 * @swagger
 * /sessions:
 *   get:
 *     summary: List all active sessions
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: Returns an array of active sessions
 *       401:
 *         description: Unauthorized
 */
// 5. GET /sessions
router.get('/sessions', requireAuth, async (req, res) => {
    try {
        const result = await db.query(
            `SELECT id, device_info, ip_address, signin_location, created_at, is_active 
             FROM sessions 
             WHERE user_id = $1 AND is_active = TRUE AND expires_at > NOW()
             ORDER BY created_at DESC`,
            [req.user.id]
        );

        const sessions = result.rows.map(session => {
            let type = 'desktop';
            try {
                if (session.device_info) {
                    const parsed = JSON.parse(session.device_info);
                    if (parsed.type) {
                        type = parsed.type;
                    }
                }
            } catch (e) {}
            return {
                ...session,
                type,
                is_current: session.id === req.session.id
            };
        });

        res.status(200).json({
            success: true,
            data: {
                sessions: sessions
            }
        });
    } catch (err) {
        console.error('Get sessions error:', err);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

/**
 * @swagger
 * /sessions/{sessionId}:
 *   delete:
 *     summary: Terminate a specific session
 *     tags: [Auth]
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID of the session to terminate
 *     responses:
 *       200:
 *         description: Session terminated successfully
 *       404:
 *         description: Session not found or already inactive
 *       401:
 *         description: Unauthorized
 */
// 6. DELETE /sessions/:sessionId
router.delete('/sessions/:sessionId', requireAuth, async (req, res) => {
    try {
        const { sessionId } = req.params;

        if (sessionId === req.session.id) {
            return res.status(403).json({ success: false, message: 'Cannot remove current session using this endpoint. Use /signout instead.' });
        }

        // Terminate specific session by setting is_active = FALSE
        const result = await db.query(
            'UPDATE sessions SET is_active = FALSE WHERE id = $1 AND user_id = $2 RETURNING id',
            [sessionId, req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Session not found or already inactive' });
        }

        res.status(200).json({ success: true, message: 'Session terminated successfully' });
    } catch (err) {
        console.error('Terminate session error:', err);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

/**
 * @swagger
 * /me:
 *   get:
 *     summary: Get information about the currently active user
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: Returns user profile information
 *       404:
 *         description: User not found
 *       401:
 *         description: Unauthorized
 */
// 7. GET /me (Get user info)
router.get('/me', requireAuth, async (req, res) => {
    try {
        const result = await db.query(
            'SELECT id, username, email, role, member_type, status, created_at FROM users WHERE id = $1',
            [req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        res.status(200).json({
            success: true,
            data: result.rows[0]
        });
    } catch (err) {
        console.error('Get user info error:', err);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

/**
 * @swagger
 * /secure-test:
 *   get:
 *     summary: Example endpoint to test the secure middleware
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: Returns a success message and user details
 *       401:
 *         description: Unauthorized
 */
// 8. GET /secure-test (Example of how to protect an endpoint)
router.get('/secure-test', requireAuth, (req, res) => {
    res.status(200).json({
        success: true,
        message: 'This is a secure endpoint!',
        user: req.user
    });
});

// 9. GET /users
router.get('/users', requireAuth, requireAdmin, async (req, res) => {
    try {
        const result = await db.query('SELECT id, username, email, role, member_type, status, created_at FROM users ORDER BY created_at DESC');
        res.status(200).json({ success: true, data: result.rows });
    } catch (err) {
        console.error('Get users error:', err);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

// 10. PUT /users/:id
router.put('/users/:id', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { username, email, password, role, member_type, status } = req.body;
        
        let updateQueries = [];
        let queryParams = [];
        let paramIndex = 1;

        if (username) { updateQueries.push(`username = $${paramIndex++}`); queryParams.push(username); }
        if (email) { updateQueries.push(`email = $${paramIndex++}`); queryParams.push(email); }
        if (role) { updateQueries.push(`role = $${paramIndex++}`); queryParams.push(role); }
        if (member_type) { updateQueries.push(`member_type = $${paramIndex++}`); queryParams.push(member_type); }
        if (status) { updateQueries.push(`status = $${paramIndex++}`); queryParams.push(status); }
        
        if (password) {
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(password, salt);
            updateQueries.push(`password = $${paramIndex++}`);
            queryParams.push(hashedPassword);
        }

        if (updateQueries.length === 0) {
            return res.status(400).json({ success: false, message: 'Nothing to update' });
        }

        queryParams.push(id);
        const result = await db.query(
            `UPDATE users SET ${updateQueries.join(', ')} WHERE id = $${paramIndex} RETURNING id, username, role, status`,
            queryParams
        );

        if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'User not found' });

        logAudit({
            userId: req.user.id, username: req.user.username, action: 'update',
            entityType: 'user', entityId: id,
            details: { fields_changed: Object.keys(req.body) }, ip: req.ip
        });

        res.status(200).json({ success: true, message: 'User updated successfully', data: result.rows[0] });
    } catch (err) {
        console.error('Update user error:', err);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

// 11. POST /upload-csv (users)
// Expected CSV columns: username, password, email, role, type (type -> member_type).
// Strict all-or-nothing: the whole file is validated up front, and nothing is
// written to the DB unless every row passes and the insert transaction succeeds.
const CSV_REQUIRED_COLUMNS = ['username', 'password', 'email', 'role', 'type'];
const CSV_VALID_ROLES = ['admin', 'superadmin', 'moderator', 'file_initiator', 'viewer'];
const CSV_VALID_TYPES = ['academic', 'syndicate', 'none'];

router.post('/upload-csv', requireAuth, requireAdmin, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });

        const filename = (req.file.originalname || '').toLowerCase();
        if (!filename.endsWith('.csv')) {
            return res.status(400).json({ success: false, message: 'File must be a .csv file' });
        }

        const results = [];
        const stream = Readable.from(req.file.buffer);

        stream
            .pipe(csv())
            .on('data', (data) => results.push(data))
            .on('error', (err) => {
                console.error('CSV parse error:', err);
                res.status(400).json({ success: false, message: 'Failed to parse CSV file' });
            })
            .on('end', async () => {
                try {
                    if (results.length === 0) {
                        return res.status(400).json({ success: false, message: 'CSV file is empty' });
                    }

                    const headerColumns = Object.keys(results[0]);
                    const missingColumns = CSV_REQUIRED_COLUMNS.filter(c => !headerColumns.includes(c));
                    if (missingColumns.length > 0) {
                        return res.status(400).json({
                            success: false,
                            message: `CSV is missing required column(s): ${missingColumns.join(', ')}. Expected format: username, password, email, role, type`
                        });
                    }

                    // Validate every row before writing anything — no partial imports.
                    const errors = [];
                    const seenUsernames = new Set();
                    results.forEach((row, idx) => {
                        const rowNum = idx + 2; // +1 for 0-index, +1 for header row
                        const username = (row.username || '').trim();
                        const password = (row.password || '').trim();
                        const email = (row.email || '').trim();
                        const role = (row.role || '').trim();
                        const type = (row.type || '').trim();

                        if (!username) errors.push(`Row ${rowNum}: username is required`);
                        if (!password) errors.push(`Row ${rowNum}: password is required`);
                        if (!email) errors.push(`Row ${rowNum}: email is required`);
                        if (role && !CSV_VALID_ROLES.includes(role)) errors.push(`Row ${rowNum}: invalid role "${role}"`);
                        if (type && !CSV_VALID_TYPES.includes(type)) errors.push(`Row ${rowNum}: invalid type "${type}"`);
                        if (username) {
                            if (seenUsernames.has(username)) errors.push(`Row ${rowNum}: duplicate username "${username}" in file`);
                            seenUsernames.add(username);
                        }
                    });

                    if (errors.length > 0) {
                        return res.status(400).json({
                            success: false,
                            message: `CSV validation failed (${errors.length} issue${errors.length > 1 ? 's' : ''}). No users were added.`,
                            errors: errors.slice(0, 20)
                        });
                    }

                    const client = await db.pool.connect();
                    try {
                        await client.query('BEGIN');
                        for (const row of results) {
                            const salt = await bcrypt.genSalt(10);
                            const hashedPassword = await bcrypt.hash(row.password.trim(), salt);

                            await client.query(
                                `INSERT INTO users (username, email, password, role, member_type)
                                 VALUES ($1, $2, $3, $4, $5)`,
                                [
                                    row.username.trim(),
                                    row.email.trim(),
                                    hashedPassword,
                                    row.role.trim() || 'viewer',
                                    row.type.trim() || 'none'
                                ]
                            );
                        }
                        await client.query('COMMIT');
                        logAudit({
                            userId: req.user.id, username: req.user.username, action: 'create',
                            entityType: 'user', details: { bulk_import_count: results.length }, ip: req.ip
                        });
                        res.status(200).json({ success: true, message: `${results.length} users added successfully` });
                    } catch (err) {
                        await client.query('ROLLBACK');
                        if (err.code === '23505') {
                            return res.status(409).json({ success: false, message: 'One or more usernames/emails already exist. No users were added.' });
                        }
                        throw err;
                    } finally {
                        client.release();
                    }
                } catch (err) {
                    console.error('Upload CSV error:', err);
                    res.status(500).json({ success: false, message: 'Internal server error' });
                }
            });
    } catch (err) {
        console.error('Upload CSV error:', err);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

// 12. GET /download-csv (users)
router.get('/download-csv', requireAuth, requireAdmin, async (req, res) => {
    try {
        const result = await db.query('SELECT id, username, email, role, member_type, status, created_at FROM users ORDER BY created_at DESC');
        if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'No data found' });

        const json2csvParser = new Parser();
        const csvData = json2csvParser.parse(result.rows);

        res.header('Content-Type', 'text/csv');
        res.attachment('users.csv');
        return res.send(csvData);
    } catch (err) {
        console.error('Download CSV error:', err);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

// 13. PUT /me (Update user profile)
router.put('/me', requireAuth, async (req, res) => {
    try {
        const { email, currentPassword, newPassword } = req.body;
        
        // Fetch current user details including password
        const userResult = await db.query('SELECT password FROM users WHERE id = $1', [req.user.id]);
        if (userResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const user = userResult.rows[0];

        let updateQueries = [];
        let queryParams = [];
        let paramIndex = 1;
        let passwordChanged = false;

        if (email) {
            // Check if email is already taken by someone else
            const emailCheck = await db.query('SELECT id FROM users WHERE email = $1 AND id != $2', [email, req.user.id]);
            if (emailCheck.rows.length > 0) {
                return res.status(409).json({ success: false, message: 'Email already exists' });
            }
            updateQueries.push(`email = $${paramIndex++}`);
            queryParams.push(email);
        }

        if (currentPassword && newPassword) {
            const isMatch = await bcrypt.compare(currentPassword, user.password);
            if (!isMatch) {
                return res.status(401).json({ success: false, message: 'Incorrect current password' });
            }
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(newPassword, salt);
            updateQueries.push(`password = $${paramIndex++}`);
            queryParams.push(hashedPassword);
            passwordChanged = true;
        }

        if (updateQueries.length === 0) {
            return res.status(400).json({ success: false, message: 'Nothing to update' });
        }

        queryParams.push(req.user.id);
        const result = await db.query(
            `UPDATE users SET ${updateQueries.join(', ')} WHERE id = $${paramIndex} RETURNING id, username, email`,
            queryParams
        );

        if (passwordChanged) {
            // Password changed: invalidate every session for this user, including the current one
            await db.query('UPDATE sessions SET is_active = FALSE WHERE user_id = $1', [req.user.id]);
            res.clearCookie('session_token');
        }

        logAudit({
            userId: req.user.id, username: req.user.username, action: 'update',
            entityType: 'user', entityId: req.user.id,
            details: { self_update: true, password_changed: passwordChanged }, ip: req.ip
        });

        res.status(200).json({
            success: true,
            message: passwordChanged
                ? 'Profile updated successfully. You have been signed out from all devices.'
                : 'Profile updated successfully',
            data: result.rows[0],
            passwordChanged
        });

    } catch (err) {
        console.error('Update profile error:', err);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

module.exports = router;

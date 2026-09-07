const CustomError = require('../errors/CustomError');
const db = require('../db');
const storageService = require('../utils/storageService');
const { generateNoticePdf } = require('../utils/pdfGenerator');

const SIGNED_PERSONA_KEYS = [
    'academic_president_signature',
    'academic_secretary_signature',
    'syndicate_president_signature',
    'syndicate_secretary_signature',
    'academic_president_signature_image',
    'academic_secretary_signature_image',
    'syndicate_president_signature_image',
    'syndicate_secretary_signature_image'
];

const SIGNATURE_KEYS = [
    'academic_signature_str',
    'syndicate_signature_str',
    'academic_signature_image',
    'syndicate_signature_image'
];

const getSignatures = async (req, res, next) => {
    try {
        const result = await db.query(
            "SELECT key, value FROM system_settings WHERE key IN ('academic_signature_str', 'syndicate_signature_str', 'academic_signature_image', 'syndicate_signature_image')"
        );
        const signatures = {};
        SIGNATURE_KEYS.forEach(key => { signatures[key] = ''; });
        result.rows.forEach(row => { signatures[row.key] = row.value; });
        res.status(200).json({ success: true, data: signatures });
    } catch (error) {
        next(error);
    }
};

const updateSignatures = async (req, res, next) => {
    try {
        const { academic_signature_str, syndicate_signature_str, academic_signature_image, syndicate_signature_image } = req.body;

        const updates = [
            { key: 'academic_signature_str', val: academic_signature_str },
            { key: 'syndicate_signature_str', val: syndicate_signature_str },
            { key: 'academic_signature_image', val: academic_signature_image },
            { key: 'syndicate_signature_image', val: syndicate_signature_image }
        ];

        for (const { key, val } of updates) {
            if (val !== undefined) {
                await db.query(
                    `INSERT INTO system_settings (key, value) VALUES ($1, $2)
                     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
                    [key, val ?? '']
                );
            }
        }

        res.status(200).json({ success: true, message: 'Signatures updated' });
    } catch (error) {
        next(error);
    }
};

const uploadNoticeSignature = async (req, res, next) => {
    try {
        if (!req.file) return next(new CustomError('No image file uploaded', 400));
        const type = (req.body.type || 'academic').toLowerCase();
        if (type !== 'academic' && type !== 'syndicate') {
            return next(new CustomError('Invalid type, must be academic or syndicate', 400));
        }

        const validTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
        if (!validTypes.includes(req.file.mimetype)) {
            return next(new CustomError('Invalid file type. Only PNG, JPG, JPEG, and WebP images are allowed.', 400));
        }

        const ext = req.file.originalname.split('.').pop() || 'png';
        const fileKey = `signatures/notices/${type}_${Date.now()}.${ext}`;
        await storageService.uploadFile(req.file.buffer, fileKey, req.file.mimetype);

        const targetKey = `${type}_signature_image`;
        await db.query(
            `INSERT INTO system_settings (key, value) VALUES ($1, $2)
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
            [targetKey, fileKey]
        );

        res.status(200).json({ success: true, message: 'Signature image uploaded successfully', image_key: fileKey });
    } catch (error) {
        next(error);
    }
};

const getSignedPersona = async (req, res, next) => {
    try {
        const result = await db.query(
            `SELECT key, value FROM system_settings WHERE key = ANY($1)`,
            [SIGNED_PERSONA_KEYS]
        );
        const data = {};
        SIGNED_PERSONA_KEYS.forEach(key => { data[key] = ''; });
        result.rows.forEach(row => { data[row.key] = row.value; });
        res.status(200).json({ success: true, data });
    } catch (error) {
        next(error);
    }
};

const updateSignedPersona = async (req, res, next) => {
    try {
        const {
            academic_president_signature, academic_secretary_signature, syndicate_president_signature, syndicate_secretary_signature,
            academic_president_signature_image, academic_secretary_signature_image, syndicate_president_signature_image, syndicate_secretary_signature_image
        } = req.body;

        const updates = [
            { key: 'academic_president_signature', val: academic_president_signature },
            { key: 'academic_secretary_signature', val: academic_secretary_signature },
            { key: 'syndicate_president_signature', val: syndicate_president_signature },
            { key: 'syndicate_secretary_signature', val: syndicate_secretary_signature },
            { key: 'academic_president_signature_image', val: academic_president_signature_image },
            { key: 'academic_secretary_signature_image', val: academic_secretary_signature_image },
            { key: 'syndicate_president_signature_image', val: syndicate_president_signature_image },
            { key: 'syndicate_secretary_signature_image', val: syndicate_secretary_signature_image }
        ];

        for (const { key, val } of updates) {
            if (val !== undefined) {
                await db.query(
                    `INSERT INTO system_settings (key, value) VALUES ($1, $2)
                     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
                    [key, val ?? '']
                );
            }
        }

        res.status(200).json({ success: true, message: 'Signed persona updated' });
    } catch (error) {
        next(error);
    }
};

const uploadSignedPersonaSignature = async (req, res, next) => {
    try {
        if (!req.file) return next(new CustomError('No image file uploaded', 400));
        const key = req.body.key;
        const allowedKeys = [
            'academic_president_signature_image',
            'academic_secretary_signature_image',
            'syndicate_president_signature_image',
            'syndicate_secretary_signature_image'
        ];
        if (!allowedKeys.includes(key)) {
            return next(new CustomError('Invalid signature image key', 400));
        }

        const validTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
        if (!validTypes.includes(req.file.mimetype)) {
            return next(new CustomError('Invalid file type. Only PNG, JPG, JPEG, and WebP images are allowed.', 400));
        }

        const ext = req.file.originalname.split('.').pop() || 'png';
        const fileKey = `signatures/persona/${key}_${Date.now()}.${ext}`;
        await storageService.uploadFile(req.file.buffer, fileKey, req.file.mimetype);

        await db.query(
            `INSERT INTO system_settings (key, value) VALUES ($1, $2)
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
            [key, fileKey]
        );

        res.status(200).json({ success: true, message: 'Signed persona signature image uploaded successfully', image_key: fileKey });
    } catch (error) {
        next(error);
    }
};

const generateNoticePdfFromPayload = async (req, res, next) => {
    try {
        const { meeting_id, notice_number, notice_date, notice_type, body, signature_text, signature_image } = req.body;
        if (!meeting_id || !notice_type) {
            return next(new CustomError('meeting_id and notice_type are required', 400));
        }

        const meetingResult = await db.query(
            `SELECT id, title AS meeting_title, meeting_date, type AS meeting_type,
                    is_regular, online_meeting_link, status AS meeting_status
             FROM meetings WHERE id = $1`,
            [meeting_id]
        );

        if (meetingResult.rows.length === 0) return next(new CustomError('Meeting not found', 404));

        const meeting = meetingResult.rows[0];

        const presenteesQuery = `
            SELECT p.id, p.name, p.designation, p.serial, d.name_bangla as department_name,
                   d.serial as department_serial, o.name_bangla as office_name
            FROM invitees p
            LEFT JOIN departments d ON p.department_id = d.id
            LEFT JOIN offices o ON p.office_id = o.id
            WHERE p.meeting_id = $1
            ORDER BY p.serial ASC NULLS LAST
        `;
        const presenteesResult = await db.query(presenteesQuery, [meeting_id]);

        const fakeNotice = {
            notice_number: notice_number || '',
            notice_date: notice_date || new Date().toISOString(),
            notice_type,
            body: body || '',
            signature_text: signature_text || '',
            signature_image: signature_image || '',
            meeting_id,
            meeting_title: meeting.meeting_title,
            meeting_date: meeting.meeting_date,
            meeting_type: meeting.meeting_type,
            is_regular: meeting.is_regular,
            online_meeting_link: meeting.online_meeting_link,
            meeting_status: meeting.meeting_status
        };

        const pdfBuffer = await generateNoticePdf(fakeNotice, presenteesResult.rows);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=notice-${notice_type}-${meeting.meeting_title || 'meeting'}.pdf`);
        res.send(pdfBuffer);
    } catch (error) {
        next(error);
    }
};

const NOTICE_TYPES = ['invitation', 'agenda', 'resolution'];

// GET /notices/meeting/:meetingId  -> all saved notice documents for the meeting
// (keyed by notice_type), so the "Email Document" editor can restore what was
// last saved.
const getMeetingNotices = async (req, res, next) => {
    try {
        const { meetingId } = req.params;
        const result = await db.query(
            'SELECT * FROM notices WHERE meeting_id = $1 ORDER BY updated_at DESC',
            [meetingId]
        );
        const byType = {};
        for (const row of result.rows) {
            if (!byType[row.notice_type]) byType[row.notice_type] = row;
        }
        res.status(200).json({ success: true, data: byType });
    } catch (error) {
        next(error);
    }
};

// PUT /notices/meeting/:meetingId  -> upsert the saved notice document for one
// notice_type. Explicit save from the editor's Save button.
const saveMeetingNotice = async (req, res, next) => {
    try {
        const { meetingId } = req.params;
        const {
            notice_number = '',
            notice_date,
            notice_type,
            body = '',
            signature_text = '',
            signature_image = ''
        } = req.body;

        if (!NOTICE_TYPES.includes(notice_type)) {
            return next(new CustomError('A valid notice_type (invitation | agenda | resolution) is required', 400));
        }

        const meetingCheck = await db.query('SELECT id FROM meetings WHERE id = $1', [meetingId]);
        if (meetingCheck.rows.length === 0) return next(new CustomError('Meeting not found', 404));

        const result = await db.query(
            `INSERT INTO notices
                 (meeting_id, notice_number, notice_date, notice_type, body, signature_text, signature_image, created_by, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
             ON CONFLICT (meeting_id, notice_type) DO UPDATE SET
                 notice_number  = EXCLUDED.notice_number,
                 notice_date    = EXCLUDED.notice_date,
                 body           = EXCLUDED.body,
                 signature_text = EXCLUDED.signature_text,
                 signature_image = EXCLUDED.signature_image,
                 updated_at     = NOW()
             RETURNING *`,
            [
                meetingId,
                notice_number,
                notice_date || new Date().toISOString(),
                notice_type,
                body,
                signature_text,
                signature_image,
                req.user?.id || null
            ]
        );

        res.status(200).json({ success: true, message: 'Notice document saved', data: result.rows[0] });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getSignatures,
    updateSignatures,
    uploadNoticeSignature,
    getSignedPersona,
    updateSignedPersona,
    uploadSignedPersonaSignature,
    generateNoticePdfFromPayload,
    getMeetingNotices,
    saveMeetingNotice
};

const CustomError = require('../errors/CustomError');

// Single place to tune what annexure files are accepted. To allow/remove a
// format, just add/remove its extension here (and its mime type below, if
// you want the stricter mime check - extensions without a mapping still
// pass on extension alone).
const ALLOWED_EXTENSIONS = ['pdf', 'docx'];

const MIME_TYPES_BY_EXTENSION = {
    pdf: ['application/pdf'],
    docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
};

// Overridable via env so ops can raise/lower the cap without a code change.
const MAX_FILE_SIZE_MB = parseInt(process.env.MAX_ANNEXURE_SIZE_MB || '20', 10);

const fileFilter = (req, file, cb) => {
    const ext = (file.originalname.split('.').pop() || '').toLowerCase();
    const allowedMimes = MIME_TYPES_BY_EXTENSION[ext];

    if (!ALLOWED_EXTENSIONS.includes(ext) || (allowedMimes && !allowedMimes.includes(file.mimetype))) {
        cb(new CustomError(`Unsupported file type. Allowed formats: ${ALLOWED_EXTENSIONS.join(', ').toUpperCase()}`, 400));
        return;
    }
    cb(null, true);
};

module.exports = {
    ALLOWED_EXTENSIONS,
    MAX_FILE_SIZE_MB,
    fileFilter,
};

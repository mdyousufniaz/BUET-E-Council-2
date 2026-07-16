const CustomError = require('../errors/CustomError');

const errorHandler = (err, req, res, next) => {
    // Multer errors (e.g. file too large) don't set statusCode themselves -
    // they're a client mistake, not a server fault, so treat them as a 400.
    if (err.name === 'MulterError' && !err.statusCode) {
        err.statusCode = 400;
    }

    err.statusCode = err.statusCode || 500;
    err.status = err.status || 'error';

    // Log the error
    console.error('Error:', err);

    res.status(err.statusCode).json({
        success: false,
        status: err.status,
        message: err.message,
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
};

module.exports = errorHandler;

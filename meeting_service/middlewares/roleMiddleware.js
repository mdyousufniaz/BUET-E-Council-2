const CustomError = require('../errors/CustomError');

const requireRole = (...roles) => (req, res, next) => {
    if (!req.user) {
        return next(new CustomError('Authentication required.', 401));
    }
    if (req.user.role === 'admin' || req.user.role === 'superadmin') {
        return next();
    }
    if (roles.includes(req.user.role) || (req.user.role === 'editor' && req.user.role_level !== null)) {
        return next();
    }
    return next(new CustomError('Forbidden. You do not have permission to perform this action.', 403));
};

const requireNonViewer = (req, res, next) => {
    if (!req.user || req.user.role === 'viewer') {
        return next(new CustomError('Forbidden. Viewer accounts have read-only access.', 403));
    }
    next();
};

module.exports = { requireRole, requireNonViewer };

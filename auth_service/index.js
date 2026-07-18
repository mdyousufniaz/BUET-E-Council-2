const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const swaggerUi = require('swagger-ui-express');
const swaggerSpecs = require('./swagger');
const authRoutes = require('./routes');
const { verifyOrigin, ALLOWED_ORIGINS } = require('./csrfMiddleware');

const app = express();
const port = process.env.PORT || 8000;

app.set('trust proxy', true);

app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true })); // Needs credentials for cookies
app.use(express.json());
app.use(cookieParser());
// CSRF defense for the cookie-authenticated routes below (see csrfMiddleware.js).
app.use(verifyOrigin);

app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// Main Auth Routes
app.use('/api/auth', authRoutes);

// Swagger Documentation Route
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpecs));

if (require.main === module) {
    app.listen(port, () => {
        console.log(`Auth service running on port ${port}`);
    });
}

module.exports = app;

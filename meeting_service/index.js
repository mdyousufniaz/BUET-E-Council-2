const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');

// Import routes
const routes = require('./routes');

// Import middlewares
const errorHandler = require('./middlewares/errorHandler');

// PDF service (Chromium warm-up)
const { warmUp: warmUpPdf } = require('./utils/pdfGenerator');
const { startBackgroundIndexer } = require('./utils/backgroundIndexer');

const app = express();
const port = process.env.PORT || 8001; // Using 8001 to distinguish from auth_service (8000)

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Health check route
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// API Routes
app.use('/api', routes);

// Global Error Handler
app.use(errorHandler);

if (require.main === module) {
    app.listen(port, () => {
        console.log(`Meeting service running on port ${port}`);
        // Warm up Chromium in the background so the first PDF request is fast.
        // Fire-and-forget: this never blocks startup and is safe if it fails.
        warmUpPdf();
        startBackgroundIndexer();
    });
}

module.exports = app;

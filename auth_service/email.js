const nodemailer = require('nodemailer');

// Any SMTP-speaking server works here (Gmail, SES, Mailgun, Postmark, a
// self-hosted Postfix box, etc.) - switching providers or moving to a
// dedicated mail server later is just a matter of changing these env vars,
// no code changes required.
let transporter = null;

const getTransporter = () => {
    if (transporter) return transporter;

    if (!process.env.SMTP_HOST) {
        return null;
    }

    transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587', 10),
        secure: process.env.SMTP_SECURE === 'true',
        auth: process.env.SMTP_USER ? {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
        } : undefined
    });

    return transporter;
};

// Resolves to false (instead of throwing) when mail isn't configured or
// delivery fails, so callers can treat email as best-effort.
const sendMail = async ({ to, subject, html, text }) => {
    const client = getTransporter();

    if (!client) {
        console.warn(`Email not sent (SMTP_HOST not configured): "${subject}" to ${to}`);
        return false;
    }

    try {
        await client.sendMail({
            from: process.env.MAIL_FROM || 'no-reply@buet-ecouncil.local',
            to,
            subject,
            html,
            text
        });
        return true;
    } catch (err) {
        console.error('Failed to send email:', err.message);
        return false;
    }
};

const sendAccountCreatedEmail = async (to, username, password) => {
    return sendMail({
        to,
        subject: 'Your BUET E-Council account has been created',
        text: `An account has been created for you on BUET E-Council.\n\nUsername: ${username}\nPassword: ${password}\n\nPlease sign in and change your password.`,
        html: `<p>An account has been created for you on BUET E-Council.</p>
<p><strong>Username:</strong> ${username}<br>
<strong>Password:</strong> ${password}</p>
<p>Please sign in and change your password.</p>`
    });
};

module.exports = { sendMail, sendAccountCreatedEmail };

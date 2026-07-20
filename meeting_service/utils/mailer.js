const nodemailer = require('nodemailer');

let transporter = null;

/**
 * Lazily builds (and caches) the SMTP transporter from env vars.
 * Returns null when SMTP_HOST is unset, i.e. email sending is disabled.
 */
const getTransporter = () => {
    if (!process.env.SMTP_HOST) return null;

    if (!transporter) {
        transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: Number(process.env.SMTP_PORT) || 587,
            secure: process.env.SMTP_SECURE === 'true',
            auth: process.env.SMTP_USER
                ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
                : undefined,
        });
    }

    return transporter;
};

/**
 * Sends a single email via SMTP (nodemailer). Works with any SMTP-speaking
 * provider (Gmail, SES, Mailgun, Postmark, a self-hosted server, etc.) -
 * configure via SMTP_HOST/PORT/SECURE/USER/PASS in the environment.
 *
 * The envelope/header `From` is always MAIL_FROM (most providers - Gmail
 * included - reject or rewrite mail whose From doesn't match the
 * authenticated account or a verified alias). The caller-supplied `from`
 * is used as Reply-To instead, so replies still reach the sending admin.
 *
 * @param {Object} mail
 * @param {string} mail.from
 * @param {string} mail.to
 * @param {string} mail.subject
 * @param {string} mail.html
 * @param {Array<{ filename: string, content: string, contentType?: string }>} [mail.attachments]
 *        `content` is base64-encoded.
 */
const sendMail = async ({ from, to, subject, html, attachments = [] }) => {
    const transport = getTransporter();
    if (!transport) {
        throw new Error('Email sending is disabled: SMTP_HOST is not configured');
    }

    await transport.sendMail({
        from: process.env.MAIL_FROM || process.env.SMTP_USER,
        replyTo: from,
        to,
        subject,
        html,
        attachments: attachments.map(({ filename, content, contentType }) => ({
            filename,
            content,
            encoding: 'base64',
            contentType,
        })),
    });
};

module.exports = { sendMail };

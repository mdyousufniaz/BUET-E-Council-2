/**
 * Sends a single email. This is currently a stub with no real provider wired up —
 * plug in an SMTP transport (nodemailer), AWS SES, SendGrid, Postmark, etc. here.
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
    // TODO: integrate an actual email provider here.
};

module.exports = { sendMail };

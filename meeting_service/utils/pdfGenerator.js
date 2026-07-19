const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pool } = require('../db');
const storageService = require('./storageService');

const getFontBase64 = () => {
    const sonarPath = path.join(__dirname, 'fonts', 'SonarBangla.ttf');
    const kalpurushPath = path.join(__dirname, 'fonts', 'Kalpurush.ttf');
    let fontPath = null;

    if (fs.existsSync(sonarPath)) {
        fontPath = sonarPath;
    } else if (fs.existsSync(kalpurushPath)) {
        fontPath = kalpurushPath;
    }

    if (fontPath) {
        return `data:font/ttf;base64,${fs.readFileSync(fontPath).toString('base64')}`;
    }
    return null;
};

// Read and encode the Bangla font once at startup, then reuse for every request.
const FONT_BASE64 = getFontBase64();

// Reuse a single Chromium instance across requests instead of launching one per PDF.
let browserPromise = null;

const getBrowser = async () => {
    if (browserPromise) {
        try {
            const existing = await browserPromise;
            if (existing.connected) return existing;
            // Stale/disconnected instance: best-effort teardown before relaunching.
            existing.close().catch(() => {});
        } catch (e) {
            // Previous launch failed; fall through and relaunch.
        }
        browserPromise = null;
    }

    browserPromise = puppeteer.launch({
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        headless: true
    });

    const browser = await browserPromise;
    // If Chromium ever crashes/disconnects, drop the cached instance so the next
    // request relaunches a fresh one.
    browser.on('disconnected', () => { browserPromise = null; });
    return browser;
};

/**
 * Warm up Chromium during service startup so the first PDF request doesn't pay
 * the launch cost. Non-blocking and best-effort: a failure here does not delay
 * startup and the lazy getBrowser() path still recovers on the first request.
 */
const warmUp = async () => {
    try {
        await getBrowser();
        console.log('Puppeteer Chromium warmed up and ready.');
    } catch (err) {
        console.error('Puppeteer warm-up failed (will retry lazily on first request):', err.message);
    }
};

/**
 * Render an HTML string to a PDF Buffer using the shared browser. Extracted so
 * both generators share identical rendering/cleanup behaviour.
 */
const renderPdf = async (html) => {
    const browser = await getBrowser();
    const page = await browser.newPage();
    try {
        // Harden against SSRF / local-file access: the PDF only needs the inline
        // HTML and the embedded (data: URI) font, so block any other resource
        // request that user-supplied content might trigger.
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            if (req.isNavigationRequest() || req.url().startsWith('data:')) {
                req.continue().catch(() => {});
            } else {
                req.abort().catch(() => {});
            }
        });

        await page.setContent(html, { waitUntil: 'load' });
        // Ensure the embedded Bangla font is fully loaded before rendering so
        // the output stays identical to the previous networkidle0 behaviour.
        await page.evaluate(() => document.fonts.ready.then(() => true));

        const pdfBuffer = await page.pdf({
            format: 'A4',
            margin: { top: '20mm', right: '20mm', bottom: '20mm', left: '20mm' },
            printBackground: true
        });

        return pdfBuffer;
    } finally {
        // Close the page but keep the shared browser alive for reuse. Never let a
        // cleanup failure mask the original error or crash the process.
        await page.close().catch(() => {});
    }
};

// ---------------------------------------------------------------------------
// PDF caching (backed by the existing MinIO/S3 bucket).
//
// A generated PDF is stored at a fixed key per (meeting, type) with a content
// fingerprint saved in its object metadata. On each request we recompute the
// fingerprint from the current meeting data; if it matches the stored one we
// return the cached bytes without launching Chromium. Any change to the meeting
// (or its presentees/agendas/joined names) changes the fingerprint and triggers
// a one-time regeneration. Locked meetings never change, so they always hit.
// Bump PDF_TEMPLATE_VERSION whenever the PDF template/appearance changes so all
// existing caches are invalidated.
// ---------------------------------------------------------------------------
const CACHE_PREFIX = 'generated-pdfs';
const PDF_TEMPLATE_VERSION = 'v3';

const pdfCacheKey = (meetingId, type) => `${CACHE_PREFIX}/${meetingId}/${type}.pdf`;

// Deterministic ordering so row order from the DB doesn't cause false misses.
const stableRows = (rows) => [...rows]
    .map(r => ({ ...r }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

const computeFingerprint = (payload) => crypto
    .createHash('sha256')
    .update(`${PDF_TEMPLATE_VERSION}|${JSON.stringify(payload)}`)
    .digest('hex');

// Returns the cached PDF Buffer if the fingerprint matches, otherwise null.
// Best-effort: any storage error falls back to regeneration.
const getCachedPdf = async (cacheKey, fingerprint) => {
    try {
        const meta = await storageService.getFileMetadata(cacheKey);
        if (meta && meta.fingerprint === fingerprint) {
            return await storageService.getFileBuffer(cacheKey);
        }
    } catch (err) {
        console.error('PDF cache read failed, regenerating:', err.message);
    }
    return null;
};

// Best-effort cache write: never fail the request if the upload fails.
const storeCachedPdf = async (cacheKey, pdfBuffer, fingerprint) => {
    try {
        await storageService.uploadFile(pdfBuffer, cacheKey, 'application/pdf', { fingerprint });
    } catch (err) {
        console.error('PDF cache write failed:', err.message);
    }
};

const generatePdf = async (meetingId, isResolution, cacheVariant) => {
    try {
        const meetingQuery = `SELECT title, meeting_date, description FROM meetings WHERE id = $1`;
        const presenteesQuery = `
            SELECT p.id, p.name, p.designation, p.serial, d.name_bangla as department_name, d.serial as department_serial, o.name_bangla as office_name
            FROM presentees p
            LEFT JOIN departments d ON p.department_id = d.id
            LEFT JOIN offices o ON p.office_id = o.id
            WHERE p.meeting_id = $1
        `;
        const agendasQuery = `SELECT agenda_serial, content, resolution FROM agenda WHERE meeting_id = $1 ORDER BY agenda_serial ASC`;

        // These queries are independent, so run them in parallel.
        const [meetingResult, presenteesResult, agendasResult] = await Promise.all([
            pool.query(meetingQuery, [meetingId]),
            pool.query(presenteesQuery, [meetingId]),
            pool.query(agendasQuery, [meetingId])
        ]);

        if (meetingResult.rows.length === 0) throw new Error("Meeting not found");
        const meeting = meetingResult.rows[0];
        const presentees = presenteesResult.rows;
        const agendas = agendasResult.rows;

        // Serve a cached PDF when the underlying data is unchanged.
        const cacheType = cacheVariant || (isResolution ? 'resolution' : 'agenda');
        const cacheKey = pdfCacheKey(meetingId, cacheType);
        const fingerprint = computeFingerprint({
            type: cacheType,
            meeting: { title: meeting.title, meeting_date: meeting.meeting_date, description: meeting.description },
            presentees: stableRows(presentees),
            agendas: stableRows(agendas)
        });
        const cached = await getCachedPdf(cacheKey, fingerprint);
        if (cached) return cached;

        const admins = [];
        const deans = [];
        const heads = [];
        const depts = {};
        const others = [];

        // Guards against invisible Unicode mismatches (e.g. differently-composed
        // Bengali conjuncts/vowel signs from DB entry vs. source-code literals)
        // that make .includes() silently fail on visually-identical text.
        const normalize = (str) => (str || '').normalize('NFC').trim();

        // Short label used when noting a dean/head's office inline within the dept-wise list
        const getShortOfficeLabel = (officeStr) => {
            const o = normalize(officeStr);
            if (!o) return null;
            if (o.includes(normalize('উপাচার্য'))) return 'উপাচার্য';
            if (o.includes(normalize('ডিন')) || o.includes(normalize('ডীন'))) return 'ডিন';
            if (o.includes(normalize('বিভাগীয় প্রধান'))) return 'বিভাগীয় প্রধান';
            return o;
        };

        presentees.forEach(p => {
            let extractedName = p.name;
            let officeStr = normalize(p.office_name || '');
            if (!extractedName && officeStr.includes(',')) {
                const parts = officeStr.split(',');
                extractedName = parts[0].trim();
                officeStr = parts.slice(1).join(',').trim();
            }
            if (!extractedName) extractedName = 'Unknown';

            const departmentName = normalize(p.department_name || '');
            const pObj = { name: extractedName, office: officeStr, designation: p.designation, department: departmentName, serial: p.serial };

            let classifiedOffice = null;

            if (officeStr.includes(normalize('উপাচার্য'))) {
                admins.push(pObj);
                classifiedOffice = officeStr;
            } else if (officeStr.includes(normalize('ডিন')) || officeStr.includes(normalize('ডীন'))) {
                // Dean rows also show their specific office (e.g. which faculty they're dean of).
                deans.push({ ...pObj, extraLabel: officeStr || null });
                classifiedOffice = officeStr;
            } else if (officeStr.includes(normalize('বিভাগীয় প্রধান'))) {
                // Head rows also show the specific department they head.
                heads.push({ ...pObj, extraLabel: departmentName || null });
                classifiedOffice = officeStr;
            }

            // Dept-wise membership is independent of the classification above: a dean/head
            // who also belongs to a department still shows up here, with their office noted.
            if (p.department_name) {
                if (!depts[p.department_name]) depts[p.department_name] = { serial: p.department_serial, members: [] };
                depts[p.department_name].members.push({
                    ...pObj,
                    extraLabel: classifiedOffice ? getShortOfficeLabel(classifiedOffice) : null
                });
            } else if (!classifiedOffice) {
                others.push(pObj);
            }
        });

        const bySerial = (a, b) => (a.serial ?? Infinity) - (b.serial ?? Infinity);
        deans.sort(bySerial);
        heads.sort(bySerial);
        others.sort(bySerial);
        Object.values(depts).forEach(dept => dept.members.sort(bySerial));

        admins.sort((a, b) => {
            const aIsVc = a.office === 'উপাচার্য' || (a.office.includes('উপাচার্য') && !a.office.includes('উপ-উপাচার্য') && !a.office.includes('উপউপাচার্য'));
            const bIsVc = b.office === 'উপাচার্য' || (b.office.includes('উপাচার্য') && !b.office.includes('উপ-উপাচার্য') && !b.office.includes('উপউপাচার্য'));
            const aIsPro = a.office.includes('উপউপাচার্য') || a.office.includes('উপ-উপাচার্য');
            const bIsPro = b.office.includes('উপউপাচার্য') || b.office.includes('উপ-উপাচার্য');
            if (aIsVc) return -1;
            if (bIsVc) return 1;
            if (aIsPro) return -1;
            if (bIsPro) return 1;
            return bySerial(a, b);
        });

        const fontBase64 = FONT_BASE64;
        const fontFace = fontBase64 ? `@font-face { font-family: 'PrimaryFont'; src: url(${fontBase64}) format('truetype'); }` : '';

        const getSuffix = (item) => {
            if (item.office === 'উপাচার্য' || (item.office.includes('উপাচার্য') && !item.office.includes('উপ-উপাচার্য') && !item.office.includes('উপউপাচার্য'))) {
                return 'সভাপতি';
            }
            return 'সদস্য';
        };

        // Builds the visible name text: appends "সহযোগী অধ্যাপক" when the designation is
        // Associate Professor and the name doesn't already start with "অধ্যাপক" (i.e. Professor
        // names already carry their own title, e.g. "অধ্যাপক ডঃ ..."), and appends an
        // extraLabel when present (dean's specific office, head's specific department, or the
        // short office label for a dean/head also shown within a dept section).
        const getDisplayName = (item) => {
            let displayName = item.name;
            if (item.designation && normalize(item.designation).includes(normalize('সহযোগী অধ্যাপক')) && !normalize(displayName).startsWith(normalize('অধ্যাপক'))) {
                displayName = `${displayName}, সহযোগী অধ্যাপক`;
            }
            if (item.extraLabel) {
                displayName = `${displayName} (${item.extraLabel})`;
            }
            return displayName;
        };

        const renderSection = (title, items) => {
            if (!items || items.length === 0) return '';
            let html = `<div class="presentee-section"><div class="section-title"><u>${title}</u></div>`;
            items.forEach(item => {
                html += `<div class="presentee-row">
                    <div class="p-name">${getDisplayName(item)}</div>
                    <div class="p-suffix">${getSuffix(item)}</div>
                </div>`;
            });
            html += `</div>`;
            return html;
        };

        const meetingDate = new Date(meeting.meeting_date).toLocaleDateString('bn-BD', { year: 'numeric', month: 'long', day: 'numeric' });
        const serialNo = meeting.title || 'Untitled';

        let html = `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                ${fontFace}
                body {
                    font-family: 'PrimaryFont', sans-serif;
                    font-size: 14px;
                    line-height: 1.5;
                    margin: 0;
                    padding: 0;
                }
                .text-center { text-align: center; }
                .header-title { font-size: 19px; margin-bottom: 10px; }
                .sub-title { font-size: 16px; text-decoration: underline; margin-bottom: 20px; }
                .description { font-size: 14px; text-align: justify; margin-bottom: 30px; }
                .presentees-header { font-size: 14px; text-decoration: underline; margin-bottom: 15px; }
                .columns-container {
                    column-count: 2;
                    column-gap: 40px;
                    column-fill: auto;
                    font-size: 12px;
                    margin-bottom: 30px;
                }
                .presentee-section {
                    margin-bottom: 15px;
                }
                .section-title {
                    font-weight: bold;
                    margin-bottom: 5px;
                    break-inside: avoid;
                    break-after: avoid;
                }
                .presentee-row {
                    display: flex;
                    justify-content: space-between;
                    margin-bottom: 3px;
                    break-inside: avoid;
                }
                .p-name { width: 75%; text-align: left; }
                .p-suffix { width: 25%; text-align: right; }
                .disclaimer { text-align: center; margin-top: 20px; margin-bottom: 40px; font-size: 14px; }

                .agenda-block {
                    page-break-inside: avoid;
                    margin-bottom: 30px;
                }
                .agenda-title { font-weight: bold; margin-bottom: 5px; font-size: 14px;}
                .agenda-content, .agenda-resolution { margin-left: 30px; text-align: justify; font-size: 14px;}

                table { border-collapse: collapse; width: 100%; margin-bottom: 10px; }
                table, th, td { border: 1px solid black; }
                th, td { padding: 4px; text-align: left; }
                p { margin: 0 0 10px 0; }
            </style>
        </head>
        <body>
            <div class="text-center header-title">বাংলাদেশ প্রকৌশল বিশ্ববিদ্যালয়, ঢাকা</div>
            <div class="text-center sub-title">${meetingDate} তারিখে অনুষ্ঠিত ${serialNo}নং সভার কার্যবিবরণী</div>

            ${meeting.description ? `<div class="description">${meeting.description}</div>` : ''}

            <div class="presentees-header">উপস্থিত সদস্যবৃন্দ</div>
            <div class="columns-container">
                ${renderSection('প্রশাসন', admins)}
                ${renderSection('সকল ডিন', deans)}
                ${renderSection('সকল বিভাগীয় প্রধান', heads)}
                ${Object.entries(depts)
                    .sort(([, a], [, b]) => (a.serial ?? Infinity) - (b.serial ?? Infinity))
                    .map(([deptName, dept]) => renderSection(deptName, dept.members)).join('')}
                ${renderSection('অন্যান্য সদস্য', others)}
            </div>

            <div class="disclaimer">এই তালিকা সিনিওরিটি হিসেবে গণ্য হবে না।</div>

            ${agendas.map(ag => `
                <div class="agenda-block">
                    <div class="agenda-title">প্রস্তাবনা নং ${ag.agenda_serial || ''}</div>
                    <div class="agenda-content">${ag.content || ''}</div>
                    ${isResolution ? `
                    <div class="agenda-title" style="margin-top:15px;">সিদ্ধান্ত:</div>
                    <div class="agenda-resolution">${ag.resolution || ''}</div>
                    ` : ''}
                </div>
            `).join('')}
        </body>
        </html>
        `;

        const pdfBuffer = await renderPdf(html);
        // Cache for future requests (best-effort; keyed by the content fingerprint).
        await storeCachedPdf(cacheKey, pdfBuffer, fingerprint);
        return pdfBuffer;

    } catch (error) {
        throw error;
    }
};

const generateAttendanceSheet = async (meetingId) => {
    try {
        const meetingQuery = `SELECT title FROM meetings WHERE id = $1`;
        const presenteesQuery = `
            SELECT p.id, p.name, p.designation, p.serial, d.name_bangla as department_name, d.serial as department_serial, o.name_bangla as office_name
            FROM invitees p
            LEFT JOIN departments d ON p.department_id = d.id
            LEFT JOIN offices o ON p.office_id = o.id
            WHERE p.meeting_id = $1
        `;

        // These queries are independent, so run them in parallel.
        const [meetingResult, presenteesResult] = await Promise.all([
            pool.query(meetingQuery, [meetingId]),
            pool.query(presenteesQuery, [meetingId])
        ]);

        if (meetingResult.rows.length === 0) throw new Error("Meeting not found");
        const meeting = meetingResult.rows[0];
        const presentees = presenteesResult.rows;

        // Serve a cached PDF when the underlying data is unchanged.
        const cacheKey = pdfCacheKey(meetingId, 'attendance');
        const fingerprint = computeFingerprint({
            type: 'attendance',
            meeting: { title: meeting.title },
            invitees: stableRows(presentees)
        });
        const cached = await getCachedPdf(cacheKey, fingerprint);
        if (cached) return cached;

        const admins = [];
        const deans = [];
        const heads = [];
        const depts = {};
        const others = [];

        presentees.forEach(p => {
            let extractedName = p.name;
            let officeStr = p.office_name || '';
            if (!extractedName && officeStr.includes(',')) {
                const parts = officeStr.split(',');
                extractedName = parts[0].trim();
                officeStr = parts.slice(1).join(',').trim();
            }
            if (!extractedName) extractedName = 'Unknown';
            
            // Collect full details for display
            let details = [];
            if (p.designation) details.push(p.designation);
            if (p.department_name) details.push(p.department_name);
            if (officeStr) details.push(officeStr);
            const detailStr = details.length > 0 ? `(${details.join(', ')})` : '';
            
            const pObj = { 
                name: extractedName, 
                office: officeStr, 
                designation: p.designation,
                detailStr: detailStr,
                serial: p.serial
            };

            if (officeStr.includes('উপাচার্য')) {
                admins.push(pObj);
            } else if (officeStr.includes('ডিন')) {
                deans.push(pObj);
            } else if (officeStr.includes('বিভাগীয় প্রধান')) {
                heads.push(pObj);
            } else if (p.department_name) {
                if (!depts[p.department_name]) depts[p.department_name] = { serial: p.department_serial, members: [] };
                depts[p.department_name].members.push(pObj);
            } else {
                others.push(pObj);
            }
        });

        const bySerial = (a, b) => (a.serial ?? Infinity) - (b.serial ?? Infinity);
        deans.sort(bySerial);
        heads.sort(bySerial);
        others.sort(bySerial);
        Object.values(depts).forEach(dept => dept.members.sort(bySerial));

        admins.sort((a, b) => {
            const aIsVc = a.office === 'উপাচার্য' || (a.office.includes('উপাচার্য') && !a.office.includes('উপ-উপাচার্য') && !a.office.includes('উপউপাচার্য'));
            const bIsVc = b.office === 'উপাচার্য' || (b.office.includes('উপাচার্য') && !b.office.includes('উপ-উপাচার্য') && !b.office.includes('উপউপাচার্য'));
            const aIsPro = a.office.includes('উপউপাচার্য') || a.office.includes('উপ-উপাচার্য');
            const bIsPro = b.office.includes('উপউপাচার্য') || b.office.includes('উপ-উপাচার্য');
            if (aIsVc) return -1;
            if (bIsVc) return 1;
            if (aIsPro) return -1;
            if (bIsPro) return 1;
            return bySerial(a, b);
        });

        const fontBase64 = FONT_BASE64;
        const fontFace = fontBase64 ? `@font-face { font-family: 'PrimaryFont'; src: url(${fontBase64}) format('truetype'); }` : '';

        const renderTableSection = (title, items) => {
            if (!items || items.length === 0) return '';
            let html = `
                <div class="section-title">${title}</div>
                <table>
                    <thead>
                        <tr>
                            <th style="width: 70%;">Name (Designation, Department, Office)</th>
                            <th style="width: 30%;">Signature</th>
                        </tr>
                    </thead>
                    <tbody>
            `;
            items.forEach(item => {
                html += `
                    <tr>
                        <td>
                            <strong>${item.name}</strong><br/>
                            <span style="font-size: 12px; color: #333;">${item.detailStr}</span>
                        </td>
                        <td></td>
                    </tr>
                `;
            });
            html += `</tbody></table>`;
            return html;
        };

        const serialNo = meeting.title || 'Untitled';

        let html = `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                ${fontFace}
                body {
                    font-family: 'PrimaryFont', sans-serif;
                    font-size: 14px;
                    line-height: 1.5;
                    margin: 0;
                    padding: 0;
                }
                .text-center { text-align: center; }
                .header-title { font-size: 19px; margin-bottom: 10px; font-weight: bold; }
                .sub-title { font-size: 16px; margin-bottom: 20px; }
                
                .section-title {
                    font-size: 16px;
                    font-weight: bold;
                    margin-top: 20px;
                    margin-bottom: 10px;
                    text-decoration: underline;
                }
                
                table { border-collapse: collapse; width: 100%; margin-bottom: 20px; }
                table, th, td { border: 1px solid black; }
                th, td { padding: 8px; text-align: left; vertical-align: middle; }
                td { height: 40px; } /* Space for signature */
            </style>
        </head>
        <body>
            <div class="text-center header-title">বাংলাদেশ প্রকৌশল বিশ্ববিদ্যালয়, ঢাকা</div>
            <div class="text-center sub-title">${serialNo}</div>
            
            ${renderTableSection('প্রশাসন', admins)}
            ${renderTableSection('সকল ডিন', deans)}
            ${renderTableSection('সকল বিভাগীয় প্রধান', heads)}
            ${Object.entries(depts)
                .sort(([, a], [, b]) => (a.serial ?? Infinity) - (b.serial ?? Infinity))
                .map(([deptName, dept]) => renderTableSection(deptName, dept.members)).join('')}
            ${renderTableSection('অন্যান্য সদস্য', others)}
        </body>
        </html>
        `;

        const pdfBuffer = await renderPdf(html);
        // Cache for future requests (best-effort; keyed by the content fingerprint).
        await storeCachedPdf(cacheKey, pdfBuffer, fingerprint);
        return pdfBuffer;

    } catch (error) {
        throw error;
    }
};

module.exports = {
    generatePdf,
    generateAttendanceSheet,
    warmUp
};

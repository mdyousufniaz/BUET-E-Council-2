const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const { pool } = require('../db');

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

const generatePdf = async (meetingId, isResolution) => {
    try {
        const meetingQuery = `SELECT * FROM meetings WHERE id = $1`;
        const { rows: meetings } = await pool.query(meetingQuery, [meetingId]);
        if (meetings.length === 0) throw new Error("Meeting not found");
        const meeting = meetings[0];

        const presenteesQuery = `
            SELECT p.id, p.name, p.designation, d.name_bangla as department_name, o.name_bangla as office_name 
            FROM presentees p 
            LEFT JOIN departments d ON p.department_id = d.id 
            LEFT JOIN offices o ON p.office_id = o.id 
            WHERE p.meeting_id = $1 
        `;
        const { rows: presentees } = await pool.query(presenteesQuery, [meetingId]);

        const agendasQuery = `SELECT * FROM agenda WHERE meeting_id = $1 ORDER BY agenda_serial ASC`;
        const { rows: agendas } = await pool.query(agendasQuery, [meetingId]);

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
            const pObj = { name: extractedName, office: officeStr, designation: p.designation, department: departmentName };

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
                if (!depts[p.department_name]) depts[p.department_name] = [];
                depts[p.department_name].push({
                    ...pObj,
                    extraLabel: classifiedOffice ? getShortOfficeLabel(classifiedOffice) : null
                });
            } else if (!classifiedOffice) {
                others.push(pObj);
            }
        });

        admins.sort((a, b) => {
            const aIsVc = a.office === 'উপাচার্য' || (a.office.includes('উপাচার্য') && !a.office.includes('উপ-উপাচার্য') && !a.office.includes('উপউপাচার্য'));
            const bIsVc = b.office === 'উপাচার্য' || (b.office.includes('উপাচার্য') && !b.office.includes('উপ-উপাচার্য') && !b.office.includes('উপউপাচার্য'));
            const aIsPro = a.office.includes('উপউপাচার্য') || a.office.includes('উপ-উপাচার্য');
            const bIsPro = b.office.includes('উপউপাচার্য') || b.office.includes('উপ-উপাচার্য');
            if (aIsVc) return -1;
            if (bIsVc) return 1;
            if (aIsPro) return -1;
            if (bIsPro) return 1;
            return 0;
        });

        const fontBase64 = getFontBase64();
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
                ${Object.keys(depts).sort().map(dept => renderSection(dept, depts[dept])).join('')}
                ${renderSection('অন্যান্য সদস্য', others)}
            </div>

            <div class="disclaimer">এই তালিকা সিনিওরিটি হিসেবে গণ্য হবে না।</div>

            ${agendas.map(ag => `
                <div class="agenda-block">
                    <div class="agenda-title">প্রস্তাব নং: ${ag.agenda_serial || ''}</div>
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

        const browser = await puppeteer.launch({
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
            headless: true
        });
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'networkidle0' });

        const pdfBuffer = await page.pdf({
            format: 'A4',
            margin: { top: '20mm', right: '20mm', bottom: '20mm', left: '20mm' },
            printBackground: true
        });

        await browser.close();
        return pdfBuffer;

    } catch (error) {
        throw error;
    }
};

const generateAttendanceSheet = async (meetingId) => {
    try {
        const meetingQuery = `SELECT * FROM meetings WHERE id = $1`;
        const { rows: meetings } = await pool.query(meetingQuery, [meetingId]);
        if (meetings.length === 0) throw new Error("Meeting not found");
        const meeting = meetings[0];

        const presenteesQuery = `
            SELECT p.id, p.name, p.designation, d.name_bangla as department_name, o.name_bangla as office_name 
            FROM invitees p 
            LEFT JOIN departments d ON p.department_id = d.id 
            LEFT JOIN offices o ON p.office_id = o.id 
            WHERE p.meeting_id = $1 
        `;
        const { rows: presentees } = await pool.query(presenteesQuery, [meetingId]);

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
                detailStr: detailStr
            };

            if (officeStr.includes('উপাচার্য')) {
                admins.push(pObj);
            } else if (officeStr.includes('ডিন')) {
                deans.push(pObj);
            } else if (officeStr.includes('বিভাগীয় প্রধান')) {
                heads.push(pObj);
            } else if (p.department_name) {
                if (!depts[p.department_name]) depts[p.department_name] = [];
                depts[p.department_name].push(pObj);
            } else {
                others.push(pObj);
            }
        });

        admins.sort((a, b) => {
            const aIsVc = a.office === 'উপাচার্য' || (a.office.includes('উপাচার্য') && !a.office.includes('উপ-উপাচার্য') && !a.office.includes('উপউপাচার্য'));
            const bIsVc = b.office === 'উপাচার্য' || (b.office.includes('উপাচার্য') && !b.office.includes('উপ-উপাচার্য') && !b.office.includes('উপউপাচার্য'));
            const aIsPro = a.office.includes('উপউপাচার্য') || a.office.includes('উপ-উপাচার্য');
            const bIsPro = b.office.includes('উপউপাচার্য') || b.office.includes('উপ-উপাচার্য');
            if (aIsVc) return -1;
            if (bIsVc) return 1;
            if (aIsPro) return -1;
            if (bIsPro) return 1;
            return 0;
        });

        const fontBase64 = getFontBase64();
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
            ${Object.keys(depts).sort().map(dept => renderTableSection(dept, depts[dept])).join('')}
            ${renderTableSection('অন্যান্য সদস্য', others)}
        </body>
        </html>
        `;

        const browser = await puppeteer.launch({
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
            headless: true
        });
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'networkidle0' });
        
        const pdfBuffer = await page.pdf({
            format: 'A4',
            margin: { top: '20mm', right: '20mm', bottom: '20mm', left: '20mm' },
            printBackground: true
        });
        
        await browser.close();
        return pdfBuffer;

    } catch (error) {
        throw error;
    }
};

module.exports = {
    generatePdf,
    generateAttendanceSheet
};

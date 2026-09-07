// Matches a leading official-proposal marker, e.g. "প্রস্তাব নং এ ২১০৬" or
// "প্রস্তাব নং এ ২১০৬০১", and captures only the run of Bangla letters
// (e.g. "এ") plus the first 4 Bangla digits (e.g. "২১০৬") as the stored
// prefix. Any digits beyond those first 4 (e.g. the trailing "০১" in
// "২১০৬০১") are actually that agendum's own serial number, not part of the
// meeting-wide prefix — display logic re-appends toBanglaDigits(agenda_serial)
// to reconstruct "এ ২১০৬০১" — so they're matched (to be stripped from
// content) but not captured/stored here.
const PROPOSAL_PREFIX_REGEX =
    /^\s*প্রস্তাব(?:না)?\s*নং\s*[:.\-]?\s*([ঀ-৥ৰ-৿]+\s*[০-৯]{4})[০-৯]*\s*[:.\-]?\s*/;

const BANGLA_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];

// Converts a non-negative integer to its Bangla-digit string, zero-padded to
// at least minWidth digits (default 2, e.g. 1 -> "০১"). Display-only: the
// underlying agenda_serial column stays a plain integer for ordering/arithmetic.
function toBanglaDigits(n, minWidth = 2) {
    if (n === null || n === undefined) return '';
    if (typeof n === 'number') {
        const padded = String(n).padStart(minWidth, '0');
        return padded.replace(/\d/g, d => BANGLA_DIGITS[Number(d)]);
    }
    let str = String(n);
    if (/^\d+$/.test(str) && minWidth > 0) {
        str = str.padStart(minWidth, '0');
    }
    return str.replace(/\d/g, d => BANGLA_DIGITS[Number(d)]);
}

function parseBanglaNumber(str) {
    if (!str) return null;
    const banglaToAscii = { '০':'0', '১':'1', '২':'2', '৩':'3', '৪':'4', '৫':'5', '৬':'6', '৭':'7', '৮':'8', '৯':'9' };
    const asciiStr = str.replace(/[০-৯]/g, d => banglaToAscii[d]);
    const num = parseInt(asciiStr, 10);
    return isNaN(num) ? null : num;
}

function stripProposalPrefix(content) {
    if (!content) return '';
    const clean = content.replace(/<[^>]*>/g, '').trim();
    if (/^\s*বিবিধ\s*[:.\-]?\s*/i.test(clean)) return content;
    let stripped = content.replace(/^(<p[^>]*>)?\s*(?:<strong[^>]*>)?\s*প্রস্তাব(?:না)?\s*নং\s*[:.\-]?\s*(?:[ঀ-৥ৰ-৿\w]+\s*)*[০-৯\d\s\/\-]*[:.\-]?\s*(?:<\/strong>)?\s*/i, '$1');
    // Bare leading serial, e.g. "<p>৫ :</p>" or "<p>12 - </p>". Anchored to the
    // very start so a number range further in ("... session 2026-2027") is never
    // touched, and a "-" separator only counts when it is NOT followed by more
    // digits, so a leading year range ("2026-2027 ...") is left intact too.
    stripped = stripped.replace(/^(<p[^>]*>)?\s*(?:<strong[^>]*>)?\s*[০-৯\d]+\s*(?:[:.]|-(?!\s*[০-৯\d]))\s*(?:<\/strong>)?\s*/i, '$1');
    return stripped;
}

// Inspects agendum content/body for leading markers:
// 1. "বিবিধ :" or "বিবিধ" -> returns { isBibidha: true, serial: 0, content }
// 2. "প্রস্তাব নং * ২১০৩২৪ :" or "প্রস্তাব নং ২১০৩২৪ :" -> extracts proposal serial (e.g. 210324) and strips header
function parseAgendumBody(content, defaultSerial = null) {
    if (!content) return { isBibidha: false, serial: defaultSerial, content: '' };

    const clean = content.replace(/<[^>]*>/g, '').trim();

    if (/^\s*বিবিধ\s*[:.\-]?\s*/.test(clean)) {
        return { isBibidha: true, serial: 0, content };
    }

    // Check for proposal serial marker: e.g. "প্রস্তাব নং এ ২১০৩২৪ :", "প্রস্তাব নং সি ২১০৩২৪ :", or "প্রস্তাব নং ২১০৬০১ :"
    const propMatch = clean.match(/^\s*প্রস্তাব(?:না)?\s*নং\s*([ঀ-৥ৰ-৿\w*]*\s*)?([০-৯\d]+)\s*[:.\-]?\s*/);
    if (propMatch) {
        const extractedPrefix = propMatch[1] ? propMatch[1].replace(/[*]/g, '').trim() : null;
        let digits = propMatch[2];
        if (digits && digits.length > 4) {
            digits = digits.slice(4);
        }
        const extractedSerial = parseBanglaNumber(digits);
        const cleanedContent = stripProposalPrefix(content);
        return { isBibidha: false, prefix: extractedPrefix, serial: extractedSerial !== null ? extractedSerial : defaultSerial, content: cleanedContent };
    }

    return { isBibidha: false, serial: defaultSerial, content };
}

// Given the first agendum's raw OCR text, extracts the meeting-wide proposal
// prefix (agendaPrefix) and strips the matched marker from the returned
// content. Returns { agendaPrefix: null, content } unchanged when no marker
// is found at the start of the content.
function extractAgendaPrefix(content) {
    if (!content) return { agendaPrefix: null, content };

    const match = content.match(PROPOSAL_PREFIX_REGEX);
    if (!match) return { agendaPrefix: null, content };

    const agendaPrefix = match[1].replace(/\s+/g, ' ').trim();
    const strippedContent = content.slice(match[0].length);
    return { agendaPrefix, content: strippedContent };
}

function getSerialWidth(totalCount) {
    if (!totalCount || totalCount <= 99) return 2;
    return String(totalCount).length;
}

function stripResolutionPrefix(content) {
    if (!content) return '';
    let str = String(content).normalize('NFC').replace(/&nbsp;/g, ' ').replace(/\u00a0/g, ' ').trim();

    const pattern = '(?:সিদ্ধান্ত|িসদ্ধ\\s*ান্ত|সদ্ধান্ত)\\s*[:.\\-\\u0983\\uFF1A]?';

    // Strip standalone paragraph(s) containing only 'সিদ্ধান্ত'
    const standaloneRegex = new RegExp(`^(?:\\s*<p[^>]*>\\s*(?:<[^>]+>)*\\s*${pattern}\\s*(?:<\\/[^>]+>)*\\s*<\\/p>\\s*)+`, 'gi');
    str = str.replace(standaloneRegex, '');

    // Strip inline leading 'সিদ্ধান্ত' prefix
    const leadingRegex = new RegExp(`^(?:\\s*<p[^>]*>)?\\s*(?:<[^>]+>)*\\s*${pattern}\\s*(?:<\\/[^>]+>)*\\s*`, 'gi');
    str = str.replace(leadingRegex, (match) => {
        return match.includes('<p') ? '<p>' : '';
    });

    // Strip trailing standalone paragraph(s) containing only 'সিদ্ধান্ত'
    const trailingRegex = new RegExp(`(?:\\s*<p[^>]*>\\s*(?:<[^>]+>)*\\s*${pattern}\\s*(?:<\\/[^>]+>)*\\s*<\\/p>\\s*)+$`, 'gi');
    str = str.replace(trailingRegex, '');

    // Clean up empty strong/b/span tags
    str = str.replace(/(<p[^>]*>)\s*(?:<(strong|b|span|em)[^>]*>\s*<\/\2>\s*)+/gi, '$1');
    return str.trim();
}

module.exports = { extractAgendaPrefix, toBanglaDigits, parseAgendumBody, parseBanglaNumber, getSerialWidth, stripProposalPrefix, stripResolutionPrefix };

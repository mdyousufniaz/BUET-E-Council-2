// Matches a leading official-proposal marker, e.g. "প্রস্তাব নং এ ২১০৬" or
// "প্রস্তাবনা নং এ ২১০৬০১", and captures only the run of Bangla letters
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
    const num = Number(n) || 0;
    const padded = String(num).padStart(minWidth, '0');
    return padded.split('').map(d => BANGLA_DIGITS[Number(d)]).join('');
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

module.exports = { extractAgendaPrefix, toBanglaDigits };

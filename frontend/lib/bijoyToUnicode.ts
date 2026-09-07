/**
 * Bijoy 52 (SutonnyMJ ANSI) to Unicode Bangla Converter Engine
 * Powered by the official `bijoy2unicode` library (behind bijoy2unicode.com).
 */

import {
  convertBijoyToUnicode as pkgConvertBijoyToUnicode,
  shouldConvertAsBijoy as pkgShouldConvertAsBijoy,
  hasBengaliUnicode as pkgHasBengaliUnicode
} from 'bijoy2unicode';

/**
 * Detects if a text string is Bijoy ANSI formatted.
 * Ignores English acronyms (like SME, BUET, CSE) and standard English sentences.
 */
export function isBijoyText(text: string): boolean {
  if (!text || typeof text !== "string") return false;
  if (pkgHasBengaliUnicode(text)) return false;

  // The package's own heuristic just checks whether ANY character falls in
  // legacy Windows-1252 "high byte" territory (codes 128-591, or the
  // 8208-8250 typographic punctuation block). SutonnyMJ/Bijoy hijacks
  // exactly those byte positions to draw Bangla glyphs, but so does every
  // English smart quote, em/en-dash, ellipsis, "©", "™", "£", "°", and
  // accented Latin letter that Word/Docs/browsers insert automatically.
  // A single stray one of those in an English paste used to be enough to
  // trigger a full ANSI->Bangla conversion, corrupting perfectly good
  // English text into gibberish.
  if (!pkgShouldConvertAsBijoy(text)) return false;

  const trimmed = text.trim();
  if (!trimmed) return false;

  let highByteCount = 0;
  for (let i = 0; i < trimmed.length; i++) {
    const code = trimmed.charCodeAt(i);
    if ((code >= 128 && code <= 591) || (code >= 8208 && code <= 8250)) {
      highByteCount++;
    }
  }
  // Real Bijoy-encoded text carries several such bytes (one per Bangla
  // vowel-sign/conjunct); a single em-dash or curly quote is ordinary
  // English typography, not a signal on its own.
  if (highByteCount < 2) return false;

  // If the plain-ASCII-letter skeleton of the text reads like real English
  // (normal vowel density, e.g. "committee's decision" or "twelfth draft"),
  // trust that over the package's coarse byte-range check. Bijoy's
  // ASCII-letter skeleton (SutonnyMJ keystrokes) is comparatively
  // vowel-poor since most vowel sounds are drawn from the high-byte range
  // instead of a/e/i/o/u. Content here is only ever Bangla or English, so
  // no need to account for other languages' accented letters.
  const letters = trimmed.replace(/[^a-zA-Z]/g, "");
  if (letters.length >= 4) {
    let vowels = 0;
    for (const c of letters.toLowerCase()) {
      if ("aeiouy".includes(c)) vowels++;
    }
    if (vowels / letters.length >= 0.3) return false;
  }

  return true;
}

/**
 * Converts Bijoy 52 ANSI (SutonnyMJ) text to Unicode Bangla text.
 */
export function convertBijoyToUnicode(text: string): string {
  if (!text) return "";
  try {
    return pkgConvertBijoyToUnicode(text);
  } catch (err) {
    console.error("Bijoy conversion error:", err);
    return text;
  }
}

/**
 * Safely converts Bijoy text within an HTML string by traversing text nodes only,
 * preserving HTML tags (<p>, <table>, <td>, etc.).
 */
export function convertHtmlBijoyToUnicode(html: string): string {
  if (!html) return "";
  if (typeof window === "undefined") return convertBijoyToUnicode(html);

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    const walkTextNodes = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        if (node.nodeValue && node.nodeValue.trim()) {
          // Only convert text nodes if they match Bijoy pattern
          if (isBijoyText(node.nodeValue)) {
            node.nodeValue = convertBijoyToUnicode(node.nodeValue);
          }
        }
      } else {
        node.childNodes.forEach(walkTextNodes);
      }
    };

    walkTextNodes(doc.body);
    return doc.body.innerHTML;
  } catch (e) {
    return convertBijoyToUnicode(html);
  }
}

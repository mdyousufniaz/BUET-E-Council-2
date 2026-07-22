const BANGLA_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];

// Converts a non-negative integer to its Bangla-digit string, zero-padded to
// at least minWidth digits (default 2, e.g. 1 -> "০১"). Display-only mirror
// of meeting_service/utils/agendaSerial.js's toBanglaDigits.
export function toBanglaDigits(n: number | string, minWidth = 2): string {
  const num = Number(n);
  if (!Number.isNaN(num)) {
    const padded = String(num).padStart(minWidth, '0');
    return padded.split('').map(d => BANGLA_DIGITS[Number(d)] ?? d).join('');
  }
  const str = String(n || '');
  return str.split('').map(d => {
    const parsed = parseInt(d, 10);
    return !Number.isNaN(parsed) ? BANGLA_DIGITS[parsed] : d;
  }).join('');
}

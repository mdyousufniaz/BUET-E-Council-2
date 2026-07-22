const BANGLA_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];

// Converts a non-negative integer to its Bangla-digit string, zero-padded to
// at least minWidth digits (default 2, e.g. 1 -> "০১"). Display-only mirror
// of meeting_service/utils/agendaSerial.js's toBanglaDigits.
export function toBanglaDigits(n: number, minWidth = 2): string {
  const num = Number(n) || 0;
  const padded = String(num).padStart(minWidth, '0');
  return padded.split('').map(d => BANGLA_DIGITS[Number(d)]).join('');
}

/**
 * Kenya / E.164 helpers for M-Pesa STK (Safaricom expects 2547XXXXXXXX).
 * Phase 1: normalize only — no Daraja calls yet.
 */

/**
 * @param {string|null|undefined} raw
 * @returns {string|null} digits-only MSISDN starting with 254, or null if unusable
 */
export function normalizeKenyaMsisdn(raw) {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;

  // Keep leading + for parsing, then strip non-digits.
  s = s.replace(/[^\d+]/g, "");
  if (s.startsWith("+")) s = s.slice(1);
  s = s.replace(/\D/g, "");

  if (s.startsWith("254") && s.length >= 12) {
    return s.slice(0, 12);
  }
  if (s.startsWith("0") && s.length >= 10) {
    return `254${s.slice(1, 10)}`;
  }
  if (s.startsWith("7") && s.length === 9) {
    return `254${s}`;
  }
  if (s.startsWith("1") && s.length === 9) {
    // Some Safaricom ranges; still valid local format without leading 0.
    return `254${s}`;
  }
  return null;
}

/**
 * @param {string|null|undefined} raw
 * @returns {boolean}
 */
export function isKenyaMsisdn(raw) {
  const n = normalizeKenyaMsisdn(raw);
  return Boolean(n && /^2547\d{8}$/.test(n));
}

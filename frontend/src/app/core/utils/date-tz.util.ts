const CAIRO_TZ = 'Africa/Cairo';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Format a Date into YYYY-MM-DD in Cairo time.
 * Intended for APIs that treat `from/to` as Cairo business days.
 */
export function formatCairoYMD(d: Date): string {
  // Use formatToParts to avoid locale-specific separators.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CAIRO_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);

  const year = parts.find((p) => p.type === 'year')?.value || '';
  const month = parts.find((p) => p.type === 'month')?.value || '';
  const day = parts.find((p) => p.type === 'day')?.value || '';

  // Fallback (should not happen in modern browsers)
  if (!year || !month || !day) {
    const dd = new Date(d);
    return `${dd.getFullYear()}-${pad2(dd.getMonth() + 1)}-${pad2(dd.getDate())}`;
  }
  return `${year}-${month}-${day}`;
}

/**
 * Format a date-like value into dd/M/YYYY in Cairo time for UI tables.
 * Accepts ISO strings from backend (e.g. createdAt) or Date objects.
 */
export function formatCairoDMY(value: string | Date | null | undefined): string {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: CAIRO_TZ,
    year: 'numeric',
    month: 'numeric',
    day: '2-digit',
  }).formatToParts(date);

  const day = parts.find((p) => p.type === 'day')?.value || '';
  const month = parts.find((p) => p.type === 'month')?.value || '';
  const year = parts.find((p) => p.type === 'year')?.value || '';
  if (!day || !month || !year) return '';
  return `${day}/${month}/${year}`;
}


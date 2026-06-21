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

/** dd/MM/yyyy HH:mm in Cairo time (return history, audit). */
export function formatCairoDateTime(value: string | Date | null | undefined): string {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: CAIRO_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const day = parts.find((p) => p.type === 'day')?.value || '';
  const month = parts.find((p) => p.type === 'month')?.value || '';
  const year = parts.find((p) => p.type === 'year')?.value || '';
  const hour = parts.find((p) => p.type === 'hour')?.value || '';
  const minute = parts.find((p) => p.type === 'minute')?.value || '';
  if (!day || !month || !year) return '';
  return `${day}/${month}/${year} ${hour}:${minute}`;
}

/** Whole days elapsed since a date (for invoice age warnings). */
export function daysSince(value: string | Date | null | undefined): number {
  if (!value) return 0;
  const start = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(start.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - start.getTime()) / 86400000));
}


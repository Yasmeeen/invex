import moment from "moment-timezone";

const TIMEZONE = "Africa/Cairo";

function dayKey(value) {
  if (!value) return null;
  const m = moment(value).tz(TIMEZONE);
  return m.isValid() ? m.format("YYYY-MM-DD") : null;
}

/**
 * Evaluate whether a payment happened on the promised calendar day (Africa/Cairo).
 * @returns {boolean|null} true = kept, false = missed, null = still pending
 */
export function evaluatePaidOnPromisedDay(promiseToPayAt, paidAt, now = new Date()) {
  const promisedDay = dayKey(promiseToPayAt);
  if (!promisedDay) return null;

  const paidDay = dayKey(paidAt);
  if (paidDay && paidDay === promisedDay) return true;

  const promisedEnd = moment.tz(promisedDay, "YYYY-MM-DD", TIMEZONE).endOf("day");
  const nowM = moment(now).tz(TIMEZONE);
  if (nowM.isAfter(promisedEnd)) return false;

  return null;
}

/**
 * Refresh outcome flags on history rows.
 */
export function refreshPromiseOutcomes(row, now = new Date()) {
  if (!row) return;
  const history = Array.isArray(row.promiseToPayHistory) ? row.promiseToPayHistory : [];
  for (const entry of history) {
    if (entry.paidOnPromisedDay === true || entry.paidOnPromisedDay === false) continue;
    const outcome = evaluatePaidOnPromisedDay(entry.promiseToPayAt, row.paidAt, now);
    if (outcome !== null) entry.paidOnPromisedDay = outcome;
  }
}

/**
 * Archive the current active promise into history, then clear active fields.
 */
export function archiveCurrentPromise(row, { userId, now = new Date() } = {}) {
  if (!row?.promiseToPayAt) return null;
  if (!Array.isArray(row.promiseToPayHistory)) row.promiseToPayHistory = [];

  const paidOnPromisedDay = evaluatePaidOnPromisedDay(
    row.promiseToPayAt,
    row.paidAt,
    now
  );
  const entry = {
    promiseToPayAt: row.promiseToPayAt,
    recordedAt: row.promiseToPayRecordedAt || now,
    recordedByUserId: userId || undefined,
    paidOnPromisedDay,
  };
  row.promiseToPayHistory.push(entry);
  row.promiseToPayAt = undefined;
  row.promiseToPayRecordedAt = undefined;
  return entry;
}

/**
 * Set a new promise: archive any existing active promise first.
 */
export function setInstallmentPromiseToPay(
  row,
  promiseToPayAt,
  { userId, now = new Date() } = {}
) {
  if (!row) return;
  refreshPromiseOutcomes(row, now);
  if (row.promiseToPayAt) {
    archiveCurrentPromise(row, { userId, now });
  }
  row.promiseToPayAt = promiseToPayAt;
  row.promiseToPayRecordedAt = now;
}

/**
 * Clear active promise (archives it with evaluated outcome).
 */
export function clearInstallmentPromiseToPay(row, { userId, now = new Date() } = {}) {
  if (!row) return;
  refreshPromiseOutcomes(row, now);
  archiveCurrentPromise(row, { userId, now });
}

/**
 * After a payment is applied: refresh outcomes and archive the active promise.
 */
export function onInstallmentPaymentForPromises(row, { userId, now = new Date() } = {}) {
  if (!row) return;
  refreshPromiseOutcomes(row, now);
  if (row.promiseToPayAt) {
    archiveCurrentPromise(row, { userId, now: row.paidAt || now });
  }
}

/**
 * Past promises only (newest first) for dialog / lists.
 * Does not include the live current promiseToPayAt.
 */
export function serializePastPromiseHistory(row, now = new Date()) {
  if (!row) return [];
  refreshPromiseOutcomes(row, now);
  const history = Array.isArray(row.promiseToPayHistory) ? row.promiseToPayHistory : [];
  const items = [];
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const entry = history[i];
    items.push({
      promiseToPayAt: entry.promiseToPayAt || null,
      recordedAt: entry.recordedAt || null,
      paidOnPromisedDay:
        entry.paidOnPromisedDay === true || entry.paidOnPromisedDay === false
          ? entry.paidOnPromisedDay
          : evaluatePaidOnPromisedDay(entry.promiseToPayAt, row.paidAt, now),
    });
  }
  return items;
}

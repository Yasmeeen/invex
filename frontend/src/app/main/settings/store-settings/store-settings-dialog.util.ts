import { PaymentAppFeePercent, PurchaseTreasuryMethod } from '@shared/services/store-settings.service';

export interface TreasuryUiRow {
  key: string;
  label: string;
}

export interface PaymentFeeUiRow {
  key: string;
  label: string;
  percent: number;
}

function latinSlug(label: string): string {
  const stripped = label
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
  return stripped.slice(0, 32);
}

function hashTreasuryKey(label: string): string {
  let h = 2166136261;
  for (let i = 0; i < label.length; i++) {
    h ^= label.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const hex = (h >>> 0).toString(16).padStart(8, '0').slice(0, 10);
  return `tr_${hex}`;
}

export function allocateSettingsSlugKey(label: string, used: Set<string>): string {
  const keyRe = /^[a-z][a-z0-9_]{0,39}$/;
  let base = latinSlug(label);
  if (!base.length || !keyRe.test(base)) {
    base = hashTreasuryKey(label);
  }
  if (!/^[a-z]/.test(base)) {
    base = `t_${base}`;
  }
  base = base.replace(/[^a-z0-9_]/g, '').slice(0, 36);
  if (!base.length) {
    base = hashTreasuryKey(label);
  }

  let cand = base;
  let n = 0;
  while (used.has(cand) || !keyRe.test(cand)) {
    n += 1;
    cand = `${base}_${n}`.slice(0, 40);
    if (n > 800) {
      cand = hashTreasuryKey(`${label}_${Date.now()}_${n}`).slice(0, 40);
    }
  }
  used.add(cand);
  return cand;
}

export function treasuryRowsFromSaved(
  methods: PurchaseTreasuryMethod[],
  cashLabelFallback: string
): TreasuryUiRow[] {
  const rows: TreasuryUiRow[] = [];
  const cash = methods.find((m) => String(m?.key ?? '').trim().toLowerCase() === 'cash');
  const others = methods.filter((m) => String(m?.key ?? '').trim().toLowerCase() !== 'cash');

  const cashLabel = String(cash?.label ?? '').trim() || cashLabelFallback;
  rows.push({ key: 'cash', label: cashLabel.slice(0, 120) });

  for (const m of others) {
    const key = String(m.key ?? '')
      .trim()
      .toLowerCase();
    const label = String(m.label ?? '').trim();
    if (!key) {
      continue;
    }
    rows.push({ key, label: label.slice(0, 120) });
  }
  return rows;
}

export function normalizeTreasuryRowsForSave(
  rows: TreasuryUiRow[],
  cashLabelFallback: string
): PurchaseTreasuryMethod[] {
  const keyRe = /^[a-z][a-z0-9_]{0,39}$/;
  const used = new Set<string>();
  const out: PurchaseTreasuryMethod[] = [];

  for (const r of rows) {
    const rawLabel = String(r.label ?? '').trim().slice(0, 120);
    let key = String(r.key ?? '')
      .trim()
      .toLowerCase();

    if (key === 'cash') {
      const label = rawLabel || cashLabelFallback.slice(0, 120);
      if (!used.has('cash')) {
        used.add('cash');
        out.push({ key: 'cash', label });
      }
      continue;
    }

    if (!rawLabel) {
      continue;
    }

    if (!key || !keyRe.test(key)) {
      key = allocateSettingsSlugKey(rawLabel, used);
    } else if (used.has(key)) {
      key = allocateSettingsSlugKey(`${rawLabel}_${key}`, used);
    } else {
      used.add(key);
    }

    out.push({ key, label: rawLabel });
  }

  if (!out.some((x) => x.key === 'cash')) {
    out.unshift({ key: 'cash', label: cashLabelFallback.slice(0, 120) });
  }
  return out;
}

export function paymentFeeRowsFromSaved(
  fees: PaymentAppFeePercent[],
  labelForMethod: (method: string) => string
): PaymentFeeUiRow[] {
  const rows: PaymentFeeUiRow[] = [];
  for (const f of fees || []) {
    const key = String(f?.method ?? '')
      .trim()
      .toLowerCase();
    if (!key) {
      continue;
    }
    let percent = Number(f?.percent);
    if (!Number.isFinite(percent)) {
      percent = 0;
    }
    const label = String(f?.label ?? '').trim().slice(0, 120) || labelForMethod(key);
    rows.push({ key, label, percent });
  }
  return rows;
}

export function normalizePaymentFeeRowsForSave(rows: PaymentFeeUiRow[]): PaymentAppFeePercent[] {
  const keyRe = /^[a-z][a-z0-9_]{0,39}$/;
  const blocked = new Set(['cash', 'credit', 'mixed']);
  const used = new Set<string>();
  const out: PaymentAppFeePercent[] = [];

  for (const r of rows) {
    const rawLabel = String(r.label ?? '').trim().slice(0, 120);
    if (!rawLabel) {
      continue;
    }

    let key = String(r.key ?? '')
      .trim()
      .toLowerCase();
    if (!key || !keyRe.test(key) || blocked.has(key)) {
      key = allocateSettingsSlugKey(rawLabel, used);
    } else if (used.has(key)) {
      key = allocateSettingsSlugKey(`${rawLabel}_${key}`, used);
    } else {
      used.add(key);
    }

    let percent = Number(r.percent);
    if (!Number.isFinite(percent)) {
      percent = 0;
    }
    percent = Math.max(0, Math.min(100, Math.round(percent * 100) / 100));

    out.push({ method: key, label: rawLabel, percent });
  }
  return out;
}

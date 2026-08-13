import { TranslateService } from '@ngx-translate/core';
import {
  PAYMENT_METHOD_OPTIONS,
  PaymentMethodOption,
} from '@shared/constants/payment-method-options';
import {
  PaymentAppFeePercent,
  PaymentMethodCatalogRow,
  RECEIPT_LANGUAGE_CODES,
  ReceiptLanguageCode,
} from '@shared/services/store-settings.service';

export interface CashierPaymentMethod {
  id: string;
  label: string;
  logo: string;
}

const HIDDEN_METHODS = new Set(['mixed']);

const CORE_METHOD_IDS = new Set(['cash', 'credit']);

/** Logos for known payment method ids (same paths as legacy cashier list). */
export const CASHIER_PAYMENT_LOGOS: Record<string, string> = {
  cash: 'assets/images/payment/cash.svg',
  credit: 'assets/images/payment/cash.svg',
  visa: 'assets/images/payment/visa.svg',
  mastercard: 'assets/images/payment/mastercard.svg',
  meeza: 'assets/images/payment/meeza.svg',
  valu: 'assets/images/payment/valu.svg',
  aman: 'assets/images/payment/aman.svg',
  halan: 'assets/images/payment/halan.svg',
  tru: 'assets/images/payment/tru.svg',
  sohoula: 'assets/images/payment/sohoula.svg',
  maylo_seven: 'assets/images/payment/maylo-seven.svg',
  forsa: 'assets/images/payment/cash.svg',
  fawry: 'assets/images/payment/fawry.svg',
  vodafone_cash: 'assets/images/payment/vodafone-cash.svg',
  instapay: 'assets/images/payment/instapay.svg',
  etisalat_cash: 'assets/images/payment/cash.svg',
};

const DEFAULT_LOGO = 'assets/images/payment/cash.svg';

const CATALOG_OPTIONS: PaymentMethodOption[] = PAYMENT_METHOD_OPTIONS.filter(
  (o) => !HIDDEN_METHODS.has(o.id) && !CORE_METHOD_IDS.has(o.id)
);

function paymentLogo(methodId: string): string {
  return CASHIER_PAYMENT_LOGOS[methodId] || DEFAULT_LOGO;
}

function labelFromOption(opt: PaymentMethodOption, translate: TranslateService, lang?: string): string {
  if (lang && RECEIPT_LANGUAGE_CODES.includes(lang as ReceiptLanguageCode)) {
    const pack = translate.translations[lang];
    if (pack) {
      const parsed = translate.getParsedResult(pack, opt.labelKey);
      if (parsed != null && parsed !== opt.labelKey) {
        return String(parsed);
      }
    }
    const enPack = translate.translations['en'];
    if (enPack && lang !== 'en') {
      const parsed = translate.getParsedResult(enPack, opt.labelKey);
      if (parsed != null && parsed !== opt.labelKey) {
        return String(parsed);
      }
    }
  }
  return translate.instant(opt.labelKey);
}

function defaultLabelForMethod(
  methodId: string,
  translate: TranslateService,
  lang?: string
): string {
  const m = String(methodId || '').trim().toLowerCase();
  const opt = PAYMENT_METHOD_OPTIONS.find((p) => p.id === m);
  if (opt) {
    return labelFromOption(opt, translate, lang);
  }
  if (m === 'mixed') {
    return labelFromOption({ id: 'mixed', labelKey: 'tr_pay_mixed' }, translate, lang);
  }
  return m.replace(/_/g, ' ');
}

function showsInSale(showIn: string | undefined): boolean {
  return showIn === 'sale' || showIn === 'both' || !showIn;
}

/**
 * Cashier + lists: prefer unified catalog (sale/both), else fees + static fallback.
 */
export function buildCashierPaymentMethods(
  fees: PaymentAppFeePercent[] | undefined | null,
  translate: TranslateService,
  catalog?: PaymentMethodCatalogRow[] | null
): CashierPaymentMethod[] {
  const seen = new Set<string>();
  const out: CashierPaymentMethod[] = [];

  const catalogSale = (catalog || []).filter(
    (r) => r?.key && !HIDDEN_METHODS.has(r.key) && showsInSale(r.showIn)
  );

  if (catalogSale.length) {
    for (const row of catalogSale) {
      const id = String(row.key).trim().toLowerCase();
      if (!id || seen.has(id)) continue;
      out.push({
        id,
        label: String(row.label || '').trim() || defaultLabelForMethod(id, translate),
        logo: paymentLogo(id),
      });
      seen.add(id);
    }
    return out;
  }

  for (const id of ['cash', 'credit']) {
    out.push({
      id,
      label: defaultLabelForMethod(id, translate),
      logo: paymentLogo(id),
    });
    seen.add(id);
  }

  for (const row of fees || []) {
    const id = String(row?.method ?? '')
      .trim()
      .toLowerCase();
    if (!id || seen.has(id) || HIDDEN_METHODS.has(id) || CORE_METHOD_IDS.has(id)) {
      continue;
    }
    const label = String(row?.label ?? '').trim() || defaultLabelForMethod(id, translate);
    out.push({ id, label, logo: paymentLogo(id) });
    seen.add(id);
  }

  for (const opt of CATALOG_OPTIONS) {
    if (seen.has(opt.id)) {
      continue;
    }
    out.push({
      id: opt.id,
      label: defaultLabelForMethod(opt.id, translate),
      logo: paymentLogo(opt.id),
    });
    seen.add(opt.id);
  }

  return out;
}

/** Display label for orders, client history, and UI (current UI language unless `lang` set). */
export function paymentMethodDisplayLabel(
  methodId: string | undefined | null,
  fees: PaymentAppFeePercent[] | undefined | null,
  translate: TranslateService,
  lang?: string,
  catalog?: PaymentMethodCatalogRow[] | null
): string {
  const m = String(methodId || '').trim().toLowerCase();
  if (!m) {
    return '—';
  }
  const cat = (catalog || []).find((x) => x.key === m);
  if (cat?.label && String(cat.label).trim()) {
    return String(cat.label).trim();
  }
  const row = (fees || []).find((x) => x.method === m);
  if (row?.label && String(row.label).trim()) {
    return String(row.label).trim();
  }
  return defaultLabelForMethod(m, translate, lang);
}

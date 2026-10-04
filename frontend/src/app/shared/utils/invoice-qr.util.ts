import { environment } from 'src/environments/environment';
import { toDataURL as qrToDataUrl } from 'qrcode';

const DEFAULT_INVOICE_QR_URL = 'https://www.innovation-tec.com/';
const DEFAULT_INVOICE_QR_CAPTION = 'innovation-tec.com';

export interface InvoiceQrTarget {
  url: string;
  caption: string;
}

/** Prefer store custom link; otherwise Innovation default. */
export function resolveInvoiceQrTarget(customUrl?: string | null): InvoiceQrTarget {
  const trimmed = String(customUrl ?? '').trim();
  if (!trimmed) {
    return {
      url: environment.innovationWebsiteUrl || DEFAULT_INVOICE_QR_URL,
      caption: DEFAULT_INVOICE_QR_CAPTION,
    };
  }
  const url = normalizeInvoiceQrUrl(trimmed);
  return { url, caption: invoiceQrCaptionFromUrl(url) };
}

function normalizeInvoiceQrUrl(raw: string): string {
  if (/^https?:\/\//i.test(raw)) {
    return raw;
  }
  return `https://${raw}`;
}

function invoiceQrCaptionFromUrl(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./i, '');
    return host || DEFAULT_INVOICE_QR_CAPTION;
  } catch {
    return url.slice(0, 48);
  }
}

export async function buildInvoiceQrDataUrl(
  customUrl?: string | null
): Promise<{ dataUrl: string; caption: string } | null> {
  const { url, caption } = resolveInvoiceQrTarget(customUrl);
  try {
    const dataUrl = await qrToDataUrl(url, {
      width: 240,
      margin: 1,
      color: { dark: '#000000', light: '#ffffff' },
    });
    return { dataUrl, caption };
  } catch {
    return null;
  }
}

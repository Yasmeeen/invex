/**
 * Isolated iframe print for 80mm thermal receipts.
 * @page is 80mm × 297mm (portrait roll). Landscape on POS-80 garbles output.
 * Printing only this document avoids a second page from hidden cashier/app UI.
 */
export const RECEIPT_ISOLATED_PRINT_CSS = `
  @page { size: 80mm 297mm; margin: 0; }
  * {
    color: #000 !important;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
    box-sizing: border-box;
  }
  html, body {
    margin: 0;
    padding: 0;
    width: 80mm;
    height: auto !important;
    min-height: 0 !important;
    overflow: visible !important;
    background: #fff;
    color: #000 !important;
  }
  .invoice-container {
    display: block !important;
    width: 80mm;
    font-family: Arial, Helvetica, sans-serif;
    font-size: 12px;
    font-weight: 700;
    line-height: 1.35;
    color: #000 !important;
    padding: 3mm 2.5mm 8mm;
  }
  .center { text-align: center; }
  .bold { font-weight: 900; }
  .mb-2 { margin-bottom: 8px; }
  .mtb-4 { margin: 10px 0; }
  .mt-2 { margin-top: 8px; }
  .size-small { font-size: 11px; }
  .store-name {
    font-size: 16px;
    font-weight: 900;
    margin: 6px 0;
  }
  .invoice-logo {
    display: block;
    margin: 0 auto 2mm;
    max-height: 64px;
    max-width: 100%;
    object-fit: contain;
  }
  .invoice-client-block {
    margin: 6px 0 8px;
    padding: 4px 2px 6px;
    border-top: 1px dashed #000;
    border-bottom: 1px dashed #000;
  }
  .invoice-client-block__title {
    font-weight: 900;
    font-size: 12px;
    text-align: center;
    margin-bottom: 4px;
  }
  .invoice-client-block__table td {
    font-size: 11px;
    font-weight: 700;
    padding: 2px 4px;
  }
  .invoice-client-block__label {
    font-weight: 900;
    white-space: nowrap;
    width: 40%;
  }
  .invoice-table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 5px;
    font-size: 12px;
    font-weight: 700;
  }
  .invoice-table td { padding: 3px 4px; vertical-align: top; }
  .invoice-table .header {
    border-bottom: 2px solid #000;
    font-weight: 900;
  }
  .products-table { table-layout: fixed; width: 100%; font-size: 12px; }
  .products-table__col-name { width: 40%; }
  .products-table__col-qty { width: 14%; }
  .products-table__col-price { width: 23%; }
  .products-table__col-total { width: 23%; }
  .products-table td:nth-child(3),
  .products-table td:nth-child(4) { text-align: right; white-space: nowrap; }
  .item-name { word-wrap: break-word; overflow-wrap: break-word; font-weight: 700; }
  .invoice-item-code,
  .invoice-item-attrs {
    margin-top: 2px;
    font-size: 11px;
    font-weight: 700;
    line-height: 1.3;
  }
  .invoice-item-attrs { margin-top: 4px; line-height: 1.35; }
  .invoice-item-attr { display: block; unicode-bidi: isolate; }
  .invoice-item-attr bdi { unicode-bidi: isolate; }
  .totals-table td,
  .invoice-payments-table td {
    text-align: right;
    white-space: nowrap;
    font-size: 12px;
    font-weight: 700;
  }
  .money { white-space: nowrap; font-weight: 900; }
  .separator { margin: 5px 0; }
  .separator.double-border { border-bottom: 2px solid #000; }
  .final-total {
    font-size: 14px;
    margin: 6px 0;
    text-align: center;
    font-weight: 900;
  }
  .footer { margin-top: 10px; font-size: 11px; font-weight: 700; }
  .invoice-return-policy {
    margin: 8px 0 10px;
    padding: 4px 2px 6px;
    border-top: 1px dashed #000;
    border-bottom: 1px dashed #000;
    font-size: 11px;
    font-weight: 700;
    line-height: 1.45;
    text-align: center;
  }
  .invoice-return-policy__title { font-size: 12px; font-weight: 900; margin-bottom: 4px; }
  .invoice-return-policy__text { white-space: pre-wrap; word-wrap: break-word; font-weight: 700; }
  .invoice-qr { margin-top: 10px; padding: 4px 3mm 0; }
  .invoice-qr__img {
    width: 96px;
    height: 96px;
    display: inline-block;
    image-rendering: pixelated;
  }
  .invoice-qr__caption { font-size: 10px; font-weight: 700; margin-top: 3px; }
  .booking-receipt-badge,
  .payment-receipt-badge {
    font-size: 15px;
    font-weight: 900;
    letter-spacing: 0.04em;
    margin: 0 0 6px;
    padding: 5px 8px;
    border: 2px dashed #000;
    display: inline-block;
    min-width: 60%;
  }
  .payment-receipt-subtitle {
    font-size: 11px;
    font-weight: 700;
    margin: 0 0 8px;
  }
  .payment-receipt-products .products-table__col-name { width: 78%; }
  .payment-receipt-products .products-table__col-qty { width: 22%; }
  [dir="rtl"] .invoice-table td { text-align: right; }
  [dir="rtl"] .products-table td:nth-child(3),
  [dir="rtl"] .products-table td:nth-child(4) { text-align: left; }
`;

export type IsolatedReceiptPrintHandle = {
  iframe: HTMLIFrameElement;
  dispose: () => void;
};

function receiptMarkupFromHost(host: HTMLElement): { dir: 'rtl' | 'ltr'; markup: string } {
  const dir = host.getAttribute('dir') === 'rtl' ? 'rtl' : 'ltr';
  const container = host.classList.contains('invoice-container')
    ? host
    : (host.querySelector('.invoice-container') as HTMLElement | null);
  const markup = container ? container.outerHTML : host.innerHTML;
  return { dir, markup };
}

/**
 * Print only the receipt node in a hidden iframe so page size is 80×297mm
 * and hidden app UI cannot force a second cut.
 */
export function printIsolatedReceipt(
  host: HTMLElement,
  options?: {
    title?: string;
    css?: string;
    onFallback?: () => void;
    onPrinted?: () => void;
  }
): IsolatedReceiptPrintHandle | null {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    options?.onFallback?.();
    return null;
  }

  const { dir, markup } = receiptMarkupFromHost(host);
  if (!markup || !markup.trim()) {
    options?.onFallback?.();
    return null;
  }

  const iframe = document.createElement('iframe');
  iframe.setAttribute('title', options?.title || 'receipt-print');
  iframe.setAttribute(
    'style',
    'position:fixed;left:0;top:0;width:80mm;height:1px;opacity:0;border:0;pointer-events:none;z-index:-1;'
  );
  document.body.appendChild(iframe);

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (iframe.parentNode) {
      iframe.parentNode.removeChild(iframe);
    }
  };

  const doc = iframe.contentDocument;
  const win = iframe.contentWindow;
  if (!doc || !win) {
    dispose();
    options?.onFallback?.();
    return null;
  }

  const css = options?.css || RECEIPT_ISOLATED_PRINT_CSS;
  const title = options?.title || 'Receipt';
  doc.open();
  doc.write(`<!DOCTYPE html>
<html dir="${dir}">
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
  <style>${css}</style>
</head>
<body>${markup}</body>
</html>`);
  doc.close();

  let finished = false;
  const finish = () => {
    if (finished || disposed) return;
    finished = true;
    try {
      win.focus();
      win.print();
    } catch {
      dispose();
      options?.onFallback?.();
      return;
    }
    setTimeout(() => {
      dispose();
      options?.onPrinted?.();
    }, 800);
  };

  const imgs = Array.from(doc.images);
  if (!imgs.length) {
    setTimeout(finish, 120);
    return { iframe, dispose };
  }
  let pending = imgs.length;
  const done = () => {
    pending -= 1;
    if (pending <= 0) {
      setTimeout(finish, 80);
    }
  };
  imgs.forEach((img) => {
    if (img.complete) {
      done();
    } else {
      img.addEventListener('load', done, { once: true });
      img.addEventListener('error', done, { once: true });
    }
  });
  setTimeout(finish, 2500);

  return { iframe, dispose };
}

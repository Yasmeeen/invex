import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import * as ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { toDataURL as qrToDataUrl } from 'qrcode';
import { environment } from 'src/environments/environment';
import html2canvas from 'html2canvas';

export interface PdfTableSection {
  title: string;
  columns: string[];
  rows: Record<string, unknown>[];
}

@Injectable({
  providedIn: 'root',
})
export class ReportExportService {
  constructor(private http: HttpClient) {}

  private containsArabicText(value: any): boolean {
    return /[\u0600-\u06FF]/.test(String(value ?? ''));
  }

  exportToExcel(filename: string, rows: any[]): void {
    this.exportToExcelMultiSheet(filename, [{ name: 'Report', rows: rows || [] }]);
  }

  /** Multiple sheets (e.g. summary + capital by branch + top products). */
  exportToExcelMultiSheet(
    filename: string,
    sheets: { name: string; rows: Record<string, unknown>[] }[]
  ): void {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'INVEX';
    workbook.created = new Date();

    const usedNames = new Set<string>();
    for (const sheet of sheets || []) {
      const rows = sheet.rows?.length ? sheet.rows : [];
      const name = this.uniqueExcelSheetName(sheet.name || 'Sheet', usedNames);
      this.addStyledExcelSheet(workbook, name, rows);
    }

    if (!workbook.worksheets.length) {
      this.addStyledExcelSheet(workbook, 'Report', []);
    }

    workbook.xlsx.writeBuffer().then((buffer: ExcelJS.Buffer) => {
      saveAs(
        new Blob([buffer], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
        `${filename}.xlsx`
      );
    });
  }

  private uniqueExcelSheetName(raw: string, usedNames: Set<string>): string {
    let name = String(raw || 'Sheet')
      .replace(/[\\/?*[\]]/g, ' ')
      .trim()
      .slice(0, 31);
    if (!name) name = 'Sheet';
    let unique = name;
    let i = 2;
    while (usedNames.has(unique)) {
      const suffix = ` (${i})`;
      unique = `${name.slice(0, Math.max(1, 31 - suffix.length))}${suffix}`;
      i += 1;
    }
    usedNames.add(unique);
    return unique;
  }

  private addStyledExcelSheet(
    workbook: ExcelJS.Workbook,
    name: string,
    rows: Record<string, unknown>[]
  ): void {
    const ws = workbook.addWorksheet(name);
    const keys =
      rows.length > 0
        ? Object.keys(rows[0])
        : [];

    if (!keys.length) {
      ws.getColumn(1).width = 40;
      ws.getRow(1).height = 40;
      return;
    }

    const headerFill = {
      type: 'pattern' as const,
      pattern: 'solid' as const,
      fgColor: { argb: '5B21B6' },
    };
    const thinBorder = {
      top: { style: 'thin' as const, color: { argb: 'CBD5E1' } },
      left: { style: 'thin' as const, color: { argb: 'CBD5E1' } },
      bottom: { style: 'thin' as const, color: { argb: 'CBD5E1' } },
      right: { style: 'thin' as const, color: { argb: 'CBD5E1' } },
    };

    ws.columns = keys.map((key) => {
      let maxLen = String(key).length;
      for (const row of rows) {
        const cellLen = String(row?.[key] ?? '').length;
        if (cellLen > maxLen) maxLen = cellLen;
      }
      const nameLike = this.isNameLikeExcelColumn(key);
      const minW = nameLike ? 36 : 18;
      const maxW = nameLike ? 72 : 48;
      const pad = nameLike ? 12 : 6;
      return {
        header: key,
        key,
        width: Math.min(maxW, Math.max(minW, maxLen + pad)),
      };
    });

    const headerRow = ws.getRow(1);
    headerRow.height = 42;
    headerRow.eachCell((cell, colNumber) => {
      const key = keys[colNumber - 1] || '';
      cell.font = { bold: true, size: 16, color: { argb: 'FFFFFF' } };
      cell.fill = headerFill;
      cell.alignment = {
        vertical: 'middle',
        horizontal: this.isNameLikeExcelColumn(key) ? 'left' : 'center',
        wrapText: true,
      };
      cell.border = thinBorder;
    });

    for (const rowData of rows) {
      const values = keys.map((k) => rowData?.[k] ?? '');
      const row = ws.addRow(values);
      row.height = 38;
      row.eachCell((cell, colNumber) => {
        const key = keys[colNumber - 1] || '';
        cell.font = { size: 16 };
        cell.alignment = {
          vertical: 'middle',
          horizontal: this.isNameLikeExcelColumn(key) ? 'left' : 'center',
          wrapText: true,
        };
        cell.border = thinBorder;
      });
    }

    ws.views = [{ state: 'frozen', ySplit: 1 }];
  }

  /** Wider columns for name / location / label text fields. */
  private isNameLikeExcelColumn(key: string): boolean {
    const k = String(key || '').trim().toLowerCase();
    if (!k) return false;
    return (
      k === 'name' ||
      k.includes('name') ||
      k.includes('اسم') ||
      k.includes('فرع') ||
      k.includes('موقع') ||
      k.includes('location') ||
      k.includes('branch') ||
      k.includes('product') ||
      k.includes('منتج') ||
      k.includes('بند') ||
      k.includes('label') ||
      k.includes('item')
    );
  }

  async exportToPdf(
    title: string,
    summaryRows: { label: string; value: any }[],
    columns: string[],
    rows: any[]
  ): Promise<void> {
    // Detect Arabic anywhere in the content; if present, prefer HTML render so the browser
    // handles RTL and Arabic shaping correctly.
    const isArabic =
      this.containsArabicText(title) ||
      (summaryRows || []).some(
        (r) => this.containsArabicText(r?.label) || this.containsArabicText(r?.value)
      ) ||
      (columns || []).some((c) => this.containsArabicText(c)) ||
      // Also scan a sample of row values (important when columns are English but data is Arabic).
      (rows || [])
        .slice(0, 50)
        .some((row: any) =>
          row &&
          Object.values(row).some((v) => this.containsArabicText(v))
        );

    // Arabic: render via HTML so the browser handles shaping/RTL and Tajawal font.
    if (isArabic && typeof document !== 'undefined') {
      await this.exportToPdfViaHtml({ title, summaryRows, columns, rows });
      return;
    }

    const doc = new jsPDF('p', 'pt');
    const margin = 40;
    const pageW = doc.internal.pageSize.getWidth();
    const logoSize = 40;
    const qrSize = 72;
    const headerTop = 28;

    let logoAdded = false;
    try {
      const blob = await this.http.get('assets/images/new logo.jpeg', { responseType: 'blob' }).toPromise();
      if (blob && blob.size > 0) {
        const dataUrl = await this.blobToDataUrl(blob);
        doc.addImage(dataUrl, 'PNG', margin, headerTop, logoSize, logoSize);
        logoAdded = true;
      }
    } catch {
      /* optional header */
    }

    const brandX = logoAdded ? margin + logoSize + 14 : margin;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.setTextColor(91, 33, 182);
    doc.text('INVEX', brandX, headerTop + 26);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text('Innovation', brandX, headerTop + 40);

    try {
      const qrUrl = environment.innovationWebsiteUrl || 'https://www.innovation-tec.com/';
      const qrDataUrl = await qrToDataUrl(qrUrl, {
        width: 240,
        margin: 1,
        color: { dark: '#1e1b4b', light: '#ffffff' },
      });
      doc.addImage(qrDataUrl, 'PNG', pageW - margin - qrSize, headerTop, qrSize, qrSize);
      doc.setFontSize(7);
      doc.setTextColor(100, 116, 139);
      doc.text('innovation-tec.com', pageW - margin - qrSize, headerTop + qrSize + 11);
    } catch {
      /* optional QR */
    }

    const headerBlockH = Math.max(logoSize + 6, qrSize + 18);
    const titleY = headerTop + headerBlockH + 14;

    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(title, margin, titleY);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    let y = titleY + 22;
    summaryRows.forEach((row) => {
      doc.text(`${row.label}: ${row.value}`, margin, y);
      y += 16;
    });

    // Inline images in tables (e.g., booking deposit proof URLs).
    const imageUrlToDataUrl: Record<string, string> = {};
    const imageUrls = new Set<string>();
    (rows || []).forEach((r: any) => {
      if (!r) return;
      Object.values(r).forEach((v) => {
        const s = String(v ?? '').trim();
        if (!s) return;
        s.split(/[\n,]+/)
          .map((x) => x.trim())
          .filter(Boolean)
          .forEach((part) => {
            if (this.isImageUrl(part)) imageUrls.add(part);
          });
      });
    });
    // Best-effort fetch: if CORS blocks, we keep the URL as text.
    for (const url of Array.from(imageUrls)) {
      try {
        const blob = await this.http.get(url, { responseType: 'blob' }).toPromise();
        if (blob && blob.size > 0) {
          imageUrlToDataUrl[url] = await this.blobToDataUrl(blob);
        }
      } catch {
        // ignore
      }
    }

    const renderTable = (cols: string[], startY: number): number => {
      autoTable(doc, {
        startY,
        head: [cols],
        body: (rows || []).map((row) => cols.map((col) => String(row?.[col] ?? ''))),
        styles: { fontSize: 9 },
        headStyles: { fillColor: [91, 33, 182] },
        // Make space for thumbnails when present.
        bodyStyles: { minCellHeight: 36 },
        didParseCell: (data) => {
          if (data.section !== 'body') return;
          const raw = String(data.cell.raw ?? '').trim();
          const imgUrl = this.firstImageUrlInCell(raw);
          if (imgUrl && imageUrlToDataUrl[imgUrl]) {
            // We'll draw the image manually in didDrawCell.
            data.cell.text = [''];
          }
        },
        didDrawCell: (data) => {
          if (data.section !== 'body') return;
          const raw = String(data.cell.raw ?? '').trim();
          const imgUrl = this.firstImageUrlInCell(raw);
          const dataUrl = imgUrl && imageUrlToDataUrl[imgUrl] ? imageUrlToDataUrl[imgUrl] : '';
          if (!dataUrl) return;
          try {
            const pad = 3;
            const w = Math.max(10, data.cell.width - pad * 2);
            const h = Math.max(10, data.cell.height - pad * 2);
            const size = Math.min(w, h);
            const x = data.cell.x + pad + (w - size) / 2;
            const yy = data.cell.y + pad + (h - size) / 2;
            doc.addImage(dataUrl, 'PNG', x, yy, size, size);
          } catch {
            // ignore
          }
        },
      });
      // jspdf-autotable attaches this.
      const last: any = (doc as any).lastAutoTable;
      return Number(last?.finalY) || startY;
    };

    const startY = y + 8;
    // Split wide tables into chunks to keep PDF readable.
    const MAX_COLS_PER_TABLE = 7;
    const safeCols = Array.isArray(columns) ? columns : [];
    if (safeCols.length > MAX_COLS_PER_TABLE) {
      let curY = startY;
      for (let i = 0; i < safeCols.length; i += MAX_COLS_PER_TABLE) {
        const chunk = safeCols.slice(i, i + MAX_COLS_PER_TABLE);
        curY = renderTable(chunk, curY);
        curY += 18; // space between tables (or next chunk)
      }
    } else {
      renderTable(safeCols, startY);
    }

    doc.save(`${title.replace(/\s+/g, '_').toLowerCase()}.pdf`);
  }

  /** Account history and similar reports: summary plus multiple titled tables. */
  async exportMultiSectionPdf(
    title: string,
    summaryRows: { label: string; value: unknown }[],
    sections: PdfTableSection[]
  ): Promise<void> {
    const isArabic =
      this.containsArabicText(title) ||
      (summaryRows || []).some(
        (r) => this.containsArabicText(r?.label) || this.containsArabicText(r?.value)
      ) ||
      (sections || []).some(
        (s) =>
          this.containsArabicText(s?.title) ||
          (s.columns || []).some((c) => this.containsArabicText(c)) ||
          (s.rows || [])
            .slice(0, 30)
            .some((row) => row && Object.values(row).some((v) => this.containsArabicText(v)))
      );

    if (isArabic && typeof document !== 'undefined') {
      await this.exportMultiSectionPdfViaHtml({ title, summaryRows, sections });
      return;
    }

    const doc = new jsPDF('p', 'pt');
    const margin = 40;
    let y = await this.drawPdfHeader(doc, title, margin);
    y = this.drawPdfSummary(doc, summaryRows, margin, y);

    for (const section of sections || []) {
      y = this.drawPdfSectionTable(doc, section, margin, y + 16);
    }

    doc.save(`${title.replace(/\s+/g, '_').toLowerCase()}.pdf`);
  }

  private async exportMultiSectionPdfViaHtml(args: {
    title: string;
    summaryRows: { label: string; value: unknown }[];
    sections: PdfTableSection[];
  }): Promise<void> {
    const { title, summaryRows, sections } = args;
    const doc = new jsPDF('p', 'pt', 'a4');

    let logoDataUrl = '';
    try {
      const blob = await this.http.get('assets/images/new logo.jpeg', { responseType: 'blob' }).toPromise();
      if (blob && blob.size > 0) logoDataUrl = await this.blobToDataUrl(blob);
    } catch {
      // ignore
    }

    let qrDataUrl = '';
    try {
      const qrUrl = environment.innovationWebsiteUrl || 'https://www.innovation-tec.com/';
      qrDataUrl = await qrToDataUrl(qrUrl, {
        width: 220,
        margin: 1,
        color: { dark: '#1e1b4b', light: '#ffffff' },
      });
    } catch {
      // ignore
    }

    const esc = (s: unknown) =>
      String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    const renderSectionTables = (section: PdfTableSection): string => {
      const MAX_COLS_PER_TABLE = 7;
      const cols = Array.isArray(section.columns) ? section.columns : [];
      const chunks: string[][] = [];
      for (let i = 0; i < cols.length; i += MAX_COLS_PER_TABLE) {
        chunks.push(cols.slice(i, i + MAX_COLS_PER_TABLE));
      }
      if (!chunks.length) {
        return `<div style="margin-top:8px;font-size:11px;color:#64748b;">—</div>`;
      }
      return chunks
        .map((chunk, idx) => {
          const head = `<tr>${chunk
            .map(
              (c) =>
                `<th style="background:#5b21b6;color:#fff;padding:8px 10px;font-size:11px;text-align:right;white-space:nowrap;border:1px solid #e5e7eb;">${esc(
                  c
                )}</th>`
            )
            .join('')}</tr>`;
          const body = (section.rows || [])
            .map((row) => {
              const tds = chunk
                .map(
                  (c) =>
                    `<td style="padding:8px 10px;border:1px solid #e5e7eb;font-size:11px;vertical-align:top;">${esc(
                      row?.[c]
                    )}</td>`
                )
                .join('');
              return `<tr>${tds}</tr>`;
            })
            .join('');
          return `
            <div style="margin-top:${idx === 0 ? 8 : 18}px;">
              <table style="width:100%; border-collapse:collapse; table-layout:auto;">
                <thead>${head}</thead>
                <tbody>${body}</tbody>
              </table>
            </div>
          `;
        })
        .join('');
    };

    const sectionsHtml = (sections || [])
      .map(
        (section) => `
        <div style="margin-top:22px;">
          <div style="font-size:14px;font-weight:800;color:#1e1b4b;margin-bottom:6px;">${esc(section.title)}</div>
          ${renderSectionTables(section)}
        </div>
      `
      )
      .join('');

    const container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.left = '0';
    container.style.top = '0';
    container.style.transform = 'translateX(-120vw)';
    container.style.opacity = '1';
    container.style.pointerEvents = 'none';
    container.style.zIndex = '2147483646';
    container.style.width = '794px';
    container.style.background = '#fff';
    container.dir = 'rtl';
    container.innerHTML = `
      <style>
        #invex-pdf-root, #invex-pdf-root * {
          box-sizing: border-box;
          font-family: Tajawal, Inter, Arial, sans-serif !important;
          direction: rtl !important;
          text-align: right !important;
          line-height: 1.65 !important;
          letter-spacing: 0 !important;
          word-break: break-word;
          white-space: normal;
        }
        #invex-pdf-root table { width: 100%; border-collapse: collapse; }
        #invex-pdf-root th, #invex-pdf-root td { vertical-align: top; }
        #invex-pdf-root .invex-pdf-ltr, #invex-pdf-root .invex-pdf-ltr * {
          direction: ltr !important;
          text-align: left !important;
        }
      </style>
      <div id="invex-pdf-root" style="padding:24px; background:#fff;">
        <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:16px;">
          <div style="display:flex; align-items:center; gap:10px;">
            ${logoDataUrl ? `<img src="${logoDataUrl}" style="width:42px;height:42px;object-fit:contain;" />` : ''}
            <div>
              <div style="font-weight:800; color:#5b21b6; font-size:20px; line-height:1;">INVEX</div>
              <div style="color:#64748b; font-size:11px;">Innovation</div>
            </div>
          </div>
          <div class="invex-pdf-ltr">
            ${qrDataUrl ? `<img src="${qrDataUrl}" style="width:72px;height:72px;" />` : ''}
            <div style="color:#64748b; font-size:9px; margin-top:4px;">innovation-tec.com</div>
          </div>
        </div>
        <div style="margin-top:14px; font-size:16px; font-weight:800;">${esc(title)}</div>
        <div style="margin-top:10px; font-size:12px; color:#111827;">
          ${summaryRows
            .map(
              (r) =>
                `<div style="margin:3px 0;"><span style="font-weight:700;">${esc(r.label)}</span>: ${esc(
                  r.value
                )}</div>`
            )
            .join('')}
        </div>
        ${sectionsHtml}
      </div>
    `;

    document.body.appendChild(container);
    try {
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      try {
        const anyDoc: any = document as any;
        if (anyDoc?.fonts?.ready) await anyDoc.fonts.ready;
      } catch {
        // ignore
      }
      const imgs = Array.from(container.querySelectorAll('img')) as HTMLImageElement[];
      await Promise.all(
        imgs.map(
          (img) =>
            new Promise<void>((resolve) => {
              if (img.complete) return resolve();
              img.onload = () => resolve();
              img.onerror = () => resolve();
            })
        )
      );

      const canvas = await html2canvas(container, {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#ffffff',
        windowWidth: 794,
      });

      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const pxPerPt = canvas.width / pageW;
      const pageCanvasPxH = Math.floor(pageH * pxPerPt);
      const totalPages = Math.max(1, Math.ceil(canvas.height / pageCanvasPxH));

      for (let pageIndex = 0; pageIndex < totalPages; pageIndex++) {
        const srcY = pageIndex * pageCanvasPxH;
        const sliceH = Math.min(pageCanvasPxH, canvas.height - srcY);
        if (sliceH <= 0) break;

        const pageCanvas = document.createElement('canvas');
        pageCanvas.width = canvas.width;
        pageCanvas.height = sliceH;
        const ctx = pageCanvas.getContext('2d');
        if (!ctx) break;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
        ctx.drawImage(canvas, 0, srcY, canvas.width, sliceH, 0, 0, canvas.width, sliceH);

        const imgData = pageCanvas.toDataURL('image/png');
        const imgW = pageW;
        const imgH = (sliceH * imgW) / canvas.width;
        doc.addImage(imgData, 'PNG', 0, 0, imgW, imgH);
        if (pageIndex < totalPages - 1) doc.addPage();
      }

      doc.save(`${String(title || '').replace(/\s+/g, '_').toLowerCase()}.pdf`);
    } finally {
      container.remove();
    }
  }

  private async drawPdfHeader(doc: jsPDF, title: string, margin: number): Promise<number> {
    const pageW = doc.internal.pageSize.getWidth();
    const logoSize = 40;
    const qrSize = 72;
    const headerTop = 28;
    let logoAdded = false;
    try {
      const blob = await this.http.get('assets/images/new logo.jpeg', { responseType: 'blob' }).toPromise();
      if (blob && blob.size > 0) {
        const dataUrl = await this.blobToDataUrl(blob);
        doc.addImage(dataUrl, 'PNG', margin, headerTop, logoSize, logoSize);
        logoAdded = true;
      }
    } catch {
      // optional
    }
    const brandX = logoAdded ? margin + logoSize + 14 : margin;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.setTextColor(91, 33, 182);
    doc.text('INVEX', brandX, headerTop + 26);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text('Innovation', brandX, headerTop + 40);
    try {
      const qrUrl = environment.innovationWebsiteUrl || 'https://www.innovation-tec.com/';
      const qrDataUrl = await qrToDataUrl(qrUrl, {
        width: 240,
        margin: 1,
        color: { dark: '#1e1b4b', light: '#ffffff' },
      });
      doc.addImage(qrDataUrl, 'PNG', pageW - margin - qrSize, headerTop, qrSize, qrSize);
    } catch {
      // optional
    }
    const headerBlockH = Math.max(logoSize + 6, qrSize + 18);
    const titleY = headerTop + headerBlockH + 14;
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(title, margin, titleY);
    return titleY + 22;
  }

  private drawPdfSummary(
    doc: jsPDF,
    summaryRows: { label: string; value: unknown }[],
    margin: number,
    startY: number
  ): number {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    let y = startY;
    (summaryRows || []).forEach((row) => {
      doc.text(`${row.label}: ${row.value}`, margin, y);
      y += 16;
    });
    return y;
  }

  private drawPdfSectionTable(
    doc: jsPDF,
    section: PdfTableSection,
    margin: number,
    startY: number
  ): number {
    const pageH = doc.internal.pageSize.getHeight();
    let y = startY;
    if (y > pageH - 80) {
      doc.addPage();
      y = margin;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text(section.title, margin, y);
    y += 14;
    const cols = section.columns || [];
    autoTable(doc, {
      startY: y,
      head: [cols],
      body: (section.rows || []).map((row) => cols.map((col) => String(row?.[col] ?? ''))),
      styles: { fontSize: 9 },
      headStyles: { fillColor: [91, 33, 182] },
      margin: { left: margin, right: margin },
    });
    const last: { finalY?: number } = (doc as unknown as { lastAutoTable?: { finalY?: number } })
      .lastAutoTable || {};
    return Number(last.finalY) || y;
  }

  private async exportToPdfViaHtml(args: {
    title: string;
    summaryRows: { label: string; value: any }[];
    columns: string[];
    rows: any[];
  }): Promise<void> {
    const { title, summaryRows, columns, rows } = args;
    const doc = new jsPDF('p', 'pt', 'a4');

    let logoDataUrl = '';
    try {
      const blob = await this.http.get('assets/images/new logo.jpeg', { responseType: 'blob' }).toPromise();
      if (blob && blob.size > 0) logoDataUrl = await this.blobToDataUrl(blob);
    } catch {
      // ignore
    }

    let qrDataUrl = '';
    try {
      const qrUrl = environment.innovationWebsiteUrl || 'https://www.innovation-tec.com/';
      qrDataUrl = await qrToDataUrl(qrUrl, {
        width: 220,
        margin: 1,
        color: { dark: '#1e1b4b', light: '#ffffff' },
      });
    } catch {
      // ignore
    }

    // Split wide tables like the autoTable path.
    const MAX_COLS_PER_TABLE = 7;
    const chunks: string[][] = [];
    const cols = Array.isArray(columns) ? columns : [];
    for (let i = 0; i < cols.length; i += MAX_COLS_PER_TABLE) {
      chunks.push(cols.slice(i, i + MAX_COLS_PER_TABLE));
    }

    const esc = (s: any) =>
      String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    const container = document.createElement('div');
    // Keep it in the viewport (but invisible) so html2canvas can measure & render correctly.
    container.style.position = 'fixed';
    container.style.left = '0';
    container.style.top = '0';
    // Move off-screen without huge negative coordinates (more reliable for html2canvas than visibility:hidden).
    container.style.transform = 'translateX(-120vw)';
    container.style.opacity = '1';
    container.style.pointerEvents = 'none';
    container.style.zIndex = '2147483646';
    container.style.width = '794px'; // ~A4 width at 96dpi
    container.style.background = '#fff';
    container.dir = 'rtl';
    container.innerHTML = `
      <style>
        /* Isolate PDF layout from app global styles (avoid overlap). */
        #invex-pdf-root, #invex-pdf-root * {
          box-sizing: border-box;
          font-family: Tajawal, Inter, Arial, sans-serif !important;
          direction: rtl !important;
          text-align: right !important;
          line-height: 1.65 !important;
          letter-spacing: 0 !important;
          word-break: break-word;
          white-space: normal;
        }
        #invex-pdf-root table { width: 100%; border-collapse: collapse; }
        #invex-pdf-root th, #invex-pdf-root td { vertical-align: top; }
        /* Keep QR block LTR. */
        #invex-pdf-root .invex-pdf-ltr, #invex-pdf-root .invex-pdf-ltr * {
          direction: ltr !important;
          text-align: left !important;
        }
      </style>
      <div id="invex-pdf-root" style="padding:24px; background:#fff;">
        <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:16px;">
          <div style="display:flex; align-items:center; gap:10px;">
            ${logoDataUrl ? `<img src="${logoDataUrl}" style="width:42px;height:42px;object-fit:contain;" />` : ''}
            <div>
              <div style="font-weight:800; color:#5b21b6; font-size:20px; line-height:1;">INVEX</div>
              <div style="color:#64748b; font-size:11px;">Innovation</div>
            </div>
          </div>
          <div class="invex-pdf-ltr">
            ${qrDataUrl ? `<img src="${qrDataUrl}" style="width:72px;height:72px;" />` : ''}
            <div style="color:#64748b; font-size:9px; margin-top:4px;">innovation-tec.com</div>
          </div>
        </div>

        <div style="margin-top:14px; font-size:16px; font-weight:800;">${esc(title)}</div>

        <div style="margin-top:10px; font-size:12px; color:#111827;">
          ${summaryRows
            .map((r) => `<div style="margin:3px 0;"><span style="font-weight:700;">${esc(r.label)}</span>: ${esc(r.value)}</div>`)
            .join('')}
        </div>

        ${chunks
          .map((chunk, idx) => {
            const head = `<tr>${chunk
              .map(
                (c) =>
                  `<th style="background:#5b21b6;color:#fff;padding:8px 10px;font-size:11px;text-align:right;white-space:nowrap;border:1px solid #e5e7eb;">${esc(
                    c
                  )}</th>`
              )
              .join('')}</tr>`;
            const body = (rows || [])
              .map((row: any) => {
                const tds = chunk
                  .map((c) => {
                    const v = row?.[c];
                    const imgUrl = this.firstImageUrlInCell(v);
                    if (imgUrl) {
                      return `<td style="padding:8px 10px;border:1px solid #e5e7eb;text-align:center;"><img src="${esc(
                        imgUrl
                      )}" style="width:44px;height:44px;object-fit:cover;border-radius:8px;border:1px solid #e5e7eb;" /></td>`;
                    }
                    return `<td style="padding:8px 10px;border:1px solid #e5e7eb;font-size:11px;vertical-align:top;">${esc(
                      v
                    )}</td>`;
                  })
                  .join('');
                return `<tr>${tds}</tr>`;
              })
              .join('');

            return `
              <div style="margin-top:${idx === 0 ? 14 : 26}px;">
                <table style="width:100%; border-collapse:collapse; table-layout:auto;">
                  <thead>${head}</thead>
                  <tbody>${body}</tbody>
                </table>
              </div>
            `;
          })
          .join('')}
      </div>
    `;

    document.body.appendChild(container);
    try {
      // Wait a tick for layout, then ensure images are loaded (best-effort).
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      await new Promise<void>((r) => requestAnimationFrame(() => r()));

      // Ensure web fonts (e.g., Tajawal) are loaded before capturing to avoid text overlap.
      try {
        const anyDoc: any = document as any;
        if (anyDoc?.fonts?.ready) {
          await anyDoc.fonts.ready;
        }
      } catch {
        // ignore
      }

      const imgs = Array.from(container.querySelectorAll('img')) as HTMLImageElement[];
      await Promise.all(
        imgs.map(
          (img) =>
            new Promise<void>((resolve) => {
              if (img.complete) return resolve();
              img.onload = () => resolve();
              img.onerror = () => resolve();
            })
        )
      );

      const canvas = await html2canvas(container, {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#ffffff',
        windowWidth: 794,
      });

      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();
      const isBlankCanvas =
        !canvas ||
        !Number.isFinite(canvas.width) ||
        !Number.isFinite(canvas.height) ||
        canvas.width <= 0 ||
        canvas.height <= 0;

      if (isBlankCanvas) {
        // Fallback: jsPDF html pipeline if canvas capture fails.
        await new Promise<void>((resolve) => {
          doc.html(container, {
            html2canvas: {
              scale: 1.6,
              useCORS: true,
              allowTaint: true,
              backgroundColor: '#ffffff',
              windowWidth: 794,
            },
            autoPaging: 'text',
            callback: (d) => {
              d.save(`${String(title || '').replace(/\s+/g, '_').toLowerCase()}.pdf`);
              resolve();
            },
          });
        });
        return;
      }

      const pxPerPt = canvas.width / pageW;
      const pageCanvasPxH = Math.floor(pageH * pxPerPt);
      if (!Number.isFinite(pxPerPt) || pxPerPt <= 0 || !Number.isFinite(pageCanvasPxH) || pageCanvasPxH <= 0) {
        await new Promise<void>((resolve) => {
          doc.html(container, {
            html2canvas: {
              scale: 1.6,
              useCORS: true,
              allowTaint: true,
              backgroundColor: '#ffffff',
              windowWidth: 794,
            },
            autoPaging: 'text',
            callback: (d) => {
              d.save(`${String(title || '').replace(/\s+/g, '_').toLowerCase()}.pdf`);
              resolve();
            },
          });
        });
        return;
      }

      const totalPages = Math.max(1, Math.ceil(canvas.height / pageCanvasPxH));

      // Slice canvas into page-sized images to avoid overlap artifacts.
      for (let pageIndex = 0; pageIndex < totalPages; pageIndex++) {
        const srcY = pageIndex * pageCanvasPxH;
        const sliceH = Math.min(pageCanvasPxH, canvas.height - srcY);
        if (sliceH <= 0) break;

        const pageCanvas = document.createElement('canvas');
        pageCanvas.width = canvas.width;
        pageCanvas.height = sliceH;
        const ctx = pageCanvas.getContext('2d');
        if (!ctx) break;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
        ctx.drawImage(canvas, 0, srcY, canvas.width, sliceH, 0, 0, canvas.width, sliceH);

        const imgData = pageCanvas.toDataURL('image/png');
        const imgW = pageW;
        const imgH = (sliceH * imgW) / canvas.width;
        doc.addImage(imgData, 'PNG', 0, 0, imgW, imgH);

        if (pageIndex < totalPages - 1) {
          doc.addPage();
        }
      }

      doc.save(`${String(title || '').replace(/\s+/g, '_').toLowerCase()}.pdf`);
    } finally {
      container.remove();
    }
  }

  private isImageUrl(s: string): boolean {
    const v = String(s || '').trim().toLowerCase();
    if (!v) return false;
    if (v.startsWith('data:image/')) return true;
    if (!v.startsWith('http://') && !v.startsWith('https://')) return false;
    // Cloudinary URLs may not end with extension; accept it too.
    return (
      v.includes('cloudinary') ||
      v.endsWith('.png') ||
      v.endsWith('.jpg') ||
      v.endsWith('.jpeg') ||
      v.endsWith('.webp')
    );
  }

  /** First image URL inside a cell value (single URL or newline/comma-separated URLs). */
  private firstImageUrlInCell(v: any): string {
    const s = String(v ?? '').trim();
    if (!s) return '';
    if (this.isImageUrl(s)) return s;
    const parts = s
      .split(/[\n,]+/)
      .map((p) => p.trim())
      .filter(Boolean);
    for (const p of parts) {
      if (this.isImageUrl(p)) return p;
    }
    return '';
  }

  private blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }
}

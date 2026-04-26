import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { toDataURL as qrToDataUrl } from 'qrcode';
import { environment } from 'src/environments/environment';

@Injectable({
  providedIn: 'root',
})
export class ReportExportService {
  constructor(private http: HttpClient) {}

  exportToExcel(filename: string, rows: any[]): void {
    const worksheet = XLSX.utils.json_to_sheet(rows || []);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Report');
    const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    saveAs(new Blob([buffer], { type: 'application/octet-stream' }), `${filename}.xlsx`);
  }

  async exportToPdf(
    title: string,
    summaryRows: { label: string; value: any }[],
    columns: string[],
    rows: any[]
  ): Promise<void> {
    const doc = new jsPDF('p', 'pt');
    const margin = 40;
    const pageW = doc.internal.pageSize.getWidth();
    const logoSize = 40;
    const qrSize = 72;
    const headerTop = 28;

    let logoAdded = false;
    try {
      const blob = await this.http.get('assets/images/logo3.png', { responseType: 'blob' }).toPromise();
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
        if (this.isImageUrl(s)) imageUrls.add(s);
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

    autoTable(doc, {
      startY: y + 8,
      head: [columns],
      body: (rows || []).map((row) => columns.map((col) => String(row[col] ?? ''))),
      styles: { fontSize: 9 },
      headStyles: { fillColor: [91, 33, 182] },
      // Make space for thumbnails when present.
      bodyStyles: { minCellHeight: 36 },
      didParseCell: (data) => {
        if (data.section !== 'body') return;
        const raw = String(data.cell.raw ?? '').trim();
        if (raw && imageUrlToDataUrl[raw] && this.isImageUrl(raw)) {
          // We'll draw the image manually in didDrawCell.
          data.cell.text = [''];
        }
      },
      didDrawCell: (data) => {
        if (data.section !== 'body') return;
        const raw = String(data.cell.raw ?? '').trim();
        const dataUrl = raw && imageUrlToDataUrl[raw] ? imageUrlToDataUrl[raw] : '';
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

    doc.save(`${title.replace(/\s+/g, '_').toLowerCase()}.pdf`);
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

  private blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }
}

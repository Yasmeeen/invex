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

    autoTable(doc, {
      startY: y + 8,
      head: [columns],
      body: (rows || []).map((row) => columns.map((col) => String(row[col] ?? ''))),
      styles: { fontSize: 9 },
      headStyles: { fillColor: [91, 33, 182] },
    });

    doc.save(`${title.replace(/\s+/g, '_').toLowerCase()}.pdf`);
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

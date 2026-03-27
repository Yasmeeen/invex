import { Injectable } from '@angular/core';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

@Injectable({
  providedIn: 'root',
})
export class ReportExportService {
  exportToExcel(filename: string, rows: any[]): void {
    const worksheet = XLSX.utils.json_to_sheet(rows || []);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Report');
    const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    saveAs(new Blob([buffer], { type: 'application/octet-stream' }), `${filename}.xlsx`);
  }

  exportToPdf(title: string, summaryRows: { label: string; value: any }[], columns: string[], rows: any[]): void {
    const doc = new jsPDF('p', 'pt');
    doc.setFontSize(14);
    doc.text(title, 40, 40);
    doc.setFontSize(10);

    let y = 64;
    summaryRows.forEach((row) => {
      doc.text(`${row.label}: ${row.value}`, 40, y);
      y += 16;
    });

    autoTable(doc, {
      startY: y + 8,
      head: [columns],
      body: (rows || []).map((row) => columns.map((col) => String(row[col] ?? ''))),
      styles: { fontSize: 9 },
      headStyles: { fillColor: [30, 77, 43] },
    });

    doc.save(`${title.replace(/\s+/g, '_').toLowerCase()}.pdf`);
  }
}


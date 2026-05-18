import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
    selector: 'app-report-table',
    templateUrl: './report-table.component.html',
    styleUrls: ['./report-table.component.scss'],
    standalone: false
})
export class ReportTableComponent {
  @Input() columns: { key: string; labelKey: string }[] = [];
  @Input() rows: any[] = [];
  /** Larger padding / row height (used for bookings table). */
  @Input() roomy = false;

  previewUrl: string | null = null;

  isUrl(v: any): boolean {
    const s = String(v ?? '').trim();
    if (!s) return false;
    return /^https?:\/\/\S+/i.test(s) || s.startsWith('data:image/');
  }

  isImageUrl(v: any): boolean {
    const s = String(v ?? '').trim().toLowerCase();
    if (!s) return false;
    if (s.startsWith('data:image/')) return true;
    return (
      s.startsWith('http://') ||
      s.startsWith('https://')
    ) && (s.includes('.png') || s.includes('.jpg') || s.includes('.jpeg') || s.includes('.webp') || s.includes('cloudinary'));
  }

  openPreview(url: string): void {
    this.previewUrl = String(url || '').trim() || null;
  }

  closePreview(): void {
    this.previewUrl = null;
  }
}


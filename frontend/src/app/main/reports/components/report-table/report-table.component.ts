import { Component, Input } from '@angular/core';

export type ReportCellPart = {
  text: string;
  routerLink?: string | any[];
  queryParams?: Record<string, string>;
};

@Component({
  selector: 'app-report-table',
  templateUrl: './report-table.component.html',
  styleUrls: ['./report-table.component.scss'],
})
export class ReportTableComponent {
  @Input() columns: { key: string; labelKey: string; format?: 'money' | 'parts' }[] = [];
  @Input() rows: any[] = [];
  /** Larger padding / row height (used for bookings table). */
  @Input() roomy = false;
  /** Soft purple panel look used on the profit report. */
  @Input() appearance: 'default' | 'panel' = 'default';
  /**
   * Optional totals row. Keys match column keys; money columns show the number.
   * Non-money / missing keys leave an empty cell (first non-money column shows the label).
   */
  @Input() totals: Record<string, number | null | undefined> | null = null;
  @Input() totalsLabelKey = 'tr_audit_total';
  @Input() showCurrencyNote = false;

  previewUrl: string | null = null;

  get hasTotals(): boolean {
    return !!this.totals && Object.keys(this.totals).length > 0;
  }

  /** First non-money column receives the “Total” label. */
  get totalsLabelColKey(): string | null {
    const col = (this.columns || []).find((c) => c.format !== 'money');
    return col?.key || this.columns?.[0]?.key || null;
  }

  isParts(v: any): v is ReportCellPart[] {
    return Array.isArray(v) && v.every((p) => p && typeof p === 'object' && 'text' in p);
  }

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

  totalsValue(key: string): number | null {
    if (!this.totals || !(key in this.totals)) return null;
    const v = this.totals[key];
    if (v == null || v === undefined || Number.isNaN(Number(v))) return null;
    return Number(v);
  }
}

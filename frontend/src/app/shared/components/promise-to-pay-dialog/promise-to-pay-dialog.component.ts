import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

export interface PromiseToPayHistoryItem {
  promiseToPayAt?: string | Date | null;
  recordedAt?: string | Date | null;
  /** true = paid on promised day, false = missed, null = still pending */
  paidOnPromisedDay?: boolean | null;
}

export interface PromiseToPayDialogData {
  promiseToPayAt?: string | Date | null;
  orderNumber?: string | number | null;
  installmentSequence?: number | null;
  promiseToPayHistory?: PromiseToPayHistoryItem[];
}

/** ISO local datetime string `YYYY-MM-DDTHH:mm`, or `null` to clear. */
export type PromiseToPayDialogResult = string | null | false;

@Component({
  selector: 'app-promise-to-pay-dialog',
  templateUrl: './promise-to-pay-dialog.component.html',
  styleUrls: ['./promise-to-pay-dialog.component.scss'],
})
export class PromiseToPayDialogComponent {
  promiseAt = '';
  history: PromiseToPayHistoryItem[] = [];

  constructor(
    private dialogRef: MatDialogRef<PromiseToPayDialogComponent, PromiseToPayDialogResult>,
    @Inject(MAT_DIALOG_DATA) public data: PromiseToPayDialogData
  ) {
    this.promiseAt = this.toLocalInputValue(data?.promiseToPayAt);
    this.history = Array.isArray(data?.promiseToPayHistory) ? data.promiseToPayHistory : [];
  }

  cancel(): void {
    this.dialogRef.close(false);
  }

  clear(): void {
    this.dialogRef.close(null);
  }

  submit(): void {
    const value = String(this.promiseAt || '').trim();
    this.dialogRef.close(value || null);
  }

  outcomeKey(item: PromiseToPayHistoryItem): 'kept' | 'missed' | 'pending' {
    if (item?.paidOnPromisedDay === true) return 'kept';
    if (item?.paidOnPromisedDay === false) return 'missed';
    return 'pending';
  }

  private toLocalInputValue(value?: string | Date | null): string {
    if (!value) return '';
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
}

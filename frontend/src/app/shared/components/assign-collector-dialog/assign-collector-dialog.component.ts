import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { CollectorUser } from '@shared/services/collections.service';

export interface AssignCollectorDialogData {
  orderNumber?: string | number | null;
  clientName?: string | null;
  collectorId?: string | null;
  collectors: CollectorUser[];
}

/** Collector id string, `null` to clear, or `false` if cancelled. */
export type AssignCollectorDialogResult = string | null | false;

@Component({
  selector: 'app-assign-collector-dialog',
  templateUrl: './assign-collector-dialog.component.html',
  styleUrls: ['./assign-collector-dialog.component.scss'],
})
export class AssignCollectorDialogComponent {
  selectedCollectorId = '';

  constructor(
    private dialogRef: MatDialogRef<
      AssignCollectorDialogComponent,
      AssignCollectorDialogResult
    >,
    @Inject(MAT_DIALOG_DATA) public data: AssignCollectorDialogData
  ) {
    this.selectedCollectorId = data?.collectorId ? String(data.collectorId) : '';
  }

  collectorLabel(c: CollectorUser): string {
    const name = c?.name || '—';
    const n = Number(c?.openOrdersCount);
    if (!Number.isFinite(n)) return name;
    return `${name} (${n})`;
  }

  cancel(): void {
    this.dialogRef.close(false);
  }

  clear(): void {
    this.dialogRef.close(null);
  }

  submit(): void {
    const id = String(this.selectedCollectorId || '').trim();
    this.dialogRef.close(id || null);
  }
}

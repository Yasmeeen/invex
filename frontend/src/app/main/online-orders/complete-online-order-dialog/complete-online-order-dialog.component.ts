import { Component, Inject, OnInit } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { BranchesServce } from '@shared/services/branches.service';

export type CompleteOnlineOrderDialogData = {
  order: any;
};

export type CompleteOnlineOrderDialogResult = {
  confirmed: true;
  deliveryPersonName?: string;
};

@Component({
  selector: 'app-complete-online-order-dialog',
  templateUrl: './complete-online-order-dialog.component.html',
  styleUrls: ['./complete-online-order-dialog.component.scss'],
})
export class CompleteOnlineOrderDialogComponent implements OnInit {
  deliveryStaff: string[] = [];
  selectedDeliveryPersonName: string | null = null;
  loadingStaff = false;
  staffLoadFailed = false;
  /** Pickup orders do not require a courier. */
  requireDeliveryPerson = true;

  constructor(
    private branches: BranchesServce,
    private ref: MatDialogRef<
      CompleteOnlineOrderDialogComponent,
      CompleteOnlineOrderDialogResult | undefined
    >,
    @Inject(MAT_DIALOG_DATA) public data: CompleteOnlineOrderDialogData
  ) {
    const method = String(data?.order?.deliveryMethod || '').trim().toLowerCase();
    this.requireDeliveryPerson = method !== 'pickup';
  }

  ngOnInit(): void {
    const branchId = this.branchId();
    if (!branchId) {
      this.staffLoadFailed = true;
      return;
    }
    this.loadingStaff = true;
    this.branches.getBranch(branchId).subscribe({
      next: (branch: any) => {
        this.deliveryStaff = (branch?.deliveryStaff || [])
          .filter((s: any) => s && s.active !== false && String(s.name || '').trim())
          .map((s: any) => String(s.name).trim());
        this.loadingStaff = false;
      },
      error: () => {
        this.loadingStaff = false;
        this.staffLoadFailed = true;
      },
    });
  }

  private branchId(): string {
    const order = this.data?.order;
    const b = order?.branch;
    if (typeof b === 'string') return b.trim();
    if (b?._id) return String(b._id).trim();
    return '';
  }

  cancel(): void {
    this.ref.close(undefined);
  }

  confirm(): void {
    if (!this.canConfirm) return;
    const name = String(this.selectedDeliveryPersonName || '').trim();
    this.ref.close({
      confirmed: true,
      ...(name ? { deliveryPersonName: name } : {}),
    });
  }

  get canConfirm(): boolean {
    if (this.loadingStaff) return false;
    if (!this.requireDeliveryPerson || !this.deliveryStaff.length) return true;
    return Boolean(String(this.selectedDeliveryPersonName || '').trim());
  }
}

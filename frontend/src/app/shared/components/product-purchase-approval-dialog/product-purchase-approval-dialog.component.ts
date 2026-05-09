import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { ProductPurchaseRequestsService } from '@shared/services/product-purchase-requests.service';
import { AuthenticationService } from '@core/services/authentication.service';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { TranslateService } from '@ngx-translate/core';

export interface ProductPurchaseApprovalDialogData {
  purchaseId: string;
  title?: string;
  body?: string;
  data?: any;
}

@Component({
  selector: 'app-product-purchase-approval-dialog',
  templateUrl: './product-purchase-approval-dialog.component.html',
  styleUrls: ['./product-purchase-approval-dialog.component.scss'],
})
export class ProductPurchaseApprovalDialogComponent {
  saving = false;
  note = '';

  constructor(
    private dialogRef: MatDialogRef<ProductPurchaseApprovalDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public dialogData: ProductPurchaseApprovalDialogData,
    private api: ProductPurchaseRequestsService,
    private auth: AuthenticationService,
    private notify: AppNotificationService,
    private translate: TranslateService
  ) {}

  private get userId(): string | null {
    const u: any = this.auth.getUserFromLocalStorage();
    return u?._id ? String(u._id) : null;
  }

  approve(): void {
    const uid = this.userId;
    if (!uid || !this.dialogData?.purchaseId) return;
    this.saving = true;
    this.api.approve(this.dialogData.purchaseId, { userId: uid, resolutionNote: this.note }).subscribe({
      next: () => {
        this.saving = false;
        this.notify.push(this.translate.instant('tr_action.approve') + ' ✅', 'success');
        this.dialogRef.close(true);
      },
      error: (err) => {
        this.saving = false;
        const msg = err?.error?.error || err?.error?.message || 'Failed';
        this.notify.push(msg, 'error');
      },
    });
  }

  reject(): void {
    const uid = this.userId;
    if (!uid || !this.dialogData?.purchaseId) return;
    this.saving = true;
    this.api.reject(this.dialogData.purchaseId, { userId: uid, resolutionNote: this.note }).subscribe({
      next: () => {
        this.saving = false;
        this.notify.push(this.translate.instant('tr_action.reject') + ' ✅', 'success');
        this.dialogRef.close(true);
      },
      error: (err) => {
        this.saving = false;
        const msg = err?.error?.error || err?.error?.message || 'Failed';
        this.notify.push(msg, 'error');
      },
    });
  }

  close(): void {
    this.dialogRef.close(false);
  }
}

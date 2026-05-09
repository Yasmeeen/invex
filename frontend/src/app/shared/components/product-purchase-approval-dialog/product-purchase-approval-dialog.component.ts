import { Component, Inject, OnInit } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { ProductPurchaseRequestsService } from '@shared/services/product-purchase-requests.service';
import { AuthenticationService } from '@core/services/authentication.service';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { TranslateService } from '@ngx-translate/core';
import { normalizeMongoId } from '@core/utils/mongo-id.util';

export interface ProductPurchaseApprovalDialogData {
  purchaseId: string;
  body?: string;
  data?: any;
}

@Component({
  selector: 'app-product-purchase-approval-dialog',
  templateUrl: './product-purchase-approval-dialog.component.html',
  styleUrls: ['./product-purchase-approval-dialog.component.scss'],
})
export class ProductPurchaseApprovalDialogComponent implements OnInit {
  saving = false;
  note = '';
  loading = true;
  loadError: string | null = null;
  /** Extra context when load fails (e.g. already approved → check products). */
  loadErrorHint: string | null = null;
  /** Latest purchase from API (authoritative status). */
  purchase: any = null;

  constructor(
    private dialogRef: MatDialogRef<ProductPurchaseApprovalDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public dialogData: ProductPurchaseApprovalDialogData,
    private api: ProductPurchaseRequestsService,
    private auth: AuthenticationService,
    private notify: AppNotificationService,
    private translate: TranslateService
  ) {}

  ngOnInit(): void {
    const uid = this.userId;
    const pid = normalizeMongoId(this.dialogData?.purchaseId);
    if (!uid || !pid) {
      this.loading = false;
      this.loadError = this.translate.instant('tr_product_purchase_load_missing_context');
      this.loadErrorHint = null;
      return;
    }
    this.api.getById(pid, uid).subscribe({
      next: (res) => {
        this.purchase = res?.purchase ?? null;
        this.loading = false;
        if (!this.purchase) {
          this.loadError = this.translate.instant('tr_product_purchase_request_not_found');
          this.loadErrorHint = this.translate.instant('tr_product_purchase_load_failed_hint');
        }
      },
      error: (err) => {
        this.loading = false;
        const msg = err?.error?.error || err?.error?.message;
        if (err?.status === 403) {
          this.loadError = msg || this.translate.instant('tr_product_purchase_load_forbidden');
          this.loadErrorHint = null;
          return;
        }
        this.loadError =
          msg || this.translate.instant('tr_product_purchase_load_failed');
        this.loadErrorHint = this.translate.instant('tr_product_purchase_load_failed_hint');
      },
    });
  }

  get status(): string | null {
    return this.purchase?.status ? String(this.purchase.status) : null;
  }

  get isPending(): boolean {
    return this.status === 'pending';
  }

  /** Snapshot for the card: prefer API payload, fallback to notification payload. */
  get displayBlock(): any {
    const p = this.purchase;
    if (p?.productPayload) {
      const pp = p.productPayload;
      const branchName = p.branch?.name || '';
      return {
        product: { name: pp.name, code: pp.code, price: pp.price, netPrice: pp.netPrice },
        branchName,
        quantity: p.quantity ?? 1,
      };
    }
    return this.dialogData?.data || {};
  }

  get headingKey(): string {
    if (this.status === 'approved') return 'tr_product_purchase_dialog_heading_approved';
    if (this.status === 'rejected') return 'tr_product_purchase_dialog_heading_rejected';
    return 'tr_notification_product_purchase_pending_title';
  }

  private get userId(): string | null {
    const u: any = this.auth.getUserFromLocalStorage();
    return u?._id ? String(u._id) : null;
  }

  approve(): void {
    const uid = this.userId;
    if (!uid || !this.dialogData?.purchaseId || !this.isPending) return;
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
    if (!uid || !this.dialogData?.purchaseId || !this.isPending) return;
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

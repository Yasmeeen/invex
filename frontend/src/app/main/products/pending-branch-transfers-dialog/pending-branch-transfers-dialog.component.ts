import { Component, Inject, OnInit } from '@angular/core';
import { MAT_LEGACY_DIALOG_DATA as MAT_DIALOG_DATA, MatLegacyDialogRef as MatDialogRef } from '@angular/material/legacy-dialog';
import { TranslateService } from '@ngx-translate/core';
import { AuthenticationService } from '@core/services/authentication.service';
import { AppNotificationService } from '@shared/services/app-notification.service';
import {
  BranchTransferItem,
  ProductsSerivce,
} from '@shared/services/products.service';
import { canPickBranchRole, isBranchManager } from '@core/utils/role-utils';

@Component({
    selector: 'app-pending-branch-transfers-dialog',
    templateUrl: './pending-branch-transfers-dialog.component.html',
    styleUrls: ['./pending-branch-transfers-dialog.component.scss'],
    standalone: false
})
export class PendingBranchTransfersDialogComponent implements OnInit {
  loading = true;
  transfers: BranchTransferItem[] = [];
  statusFilter: 'pending' | 'all' = 'pending';
  rejectTransfer: BranchTransferItem | null = null;
  rejectReason = '';
  actingId: string | null = null;

  constructor(
    private dialogRef: MatDialogRef<PendingBranchTransfersDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) private dialogData: { onChanged?: () => void },
    private auth: AuthenticationService,
    private products: ProductsSerivce,
    private notify: AppNotificationService,
    private translate: TranslateService
  ) {}

  ngOnInit(): void {
    this.load();
  }

  close(): void {
    this.dialogRef.close(false);
  }

  setFilter(v: 'pending' | 'all'): void {
    this.statusFilter = v;
    this.load();
  }

  load(): void {
    const user = this.auth.getUserFromLocalStorage();
    const uid = user?._id != null ? String(user._id) : '';
    if (!uid) {
      this.loading = false;
      return;
    }
    this.loading = true;
    this.products
      .listBranchTransfers({
        userId: uid,
        status: this.statusFilter === 'all' ? 'all' : 'pending',
      })
      .subscribe({
        next: (r) => {
          this.transfers = r?.transfers || [];
          this.loading = false;
        },
        error: () => {
          this.loading = false;
          this.notify.push(this.translate.instant('tr_unexpected_error_message'), 'error');
        },
      });
  }

  canResolve(transfer: BranchTransferItem): boolean {
    if (transfer.status !== 'pending') {
      return false;
    }
    const user = this.auth.getUserFromLocalStorage();
    if (!user) {
      return false;
    }
    const role = user.role as string;
    if (canPickBranchRole(role)) {
      return true;
    }
    if (isBranchManager(role) && user.branch?._id) {
      const tid =
        transfer.toBranch &&
        (typeof transfer.toBranch === 'object'
          ? (transfer.toBranch as { _id?: string })._id
          : transfer.toBranch);
      return !!tid && String(tid) === String(user.branch._id);
    }
    return false;
  }

  statusLabelKey(transfer: BranchTransferItem): string {
    if (transfer.status === 'approved') {
      return 'tr_branch_transfer_status_approved';
    }
    if (transfer.status === 'rejected') {
      return 'tr_branch_transfer_status_rejected';
    }
    return 'tr_branch_transfer_status_pending';
  }

  startReject(t: BranchTransferItem): void {
    this.rejectTransfer = t;
    this.rejectReason = '';
  }

  cancelReject(): void {
    this.rejectTransfer = null;
    this.rejectReason = '';
  }

  approve(t: BranchTransferItem): void {
    const user = this.auth.getUserFromLocalStorage();
    const uid = user?._id != null ? String(user._id) : '';
    if (!uid || this.actingId) {
      return;
    }
    this.actingId = t._id;
    this.products.approveBranchTransfer(t._id, uid).subscribe({
      next: () => {
        this.actingId = null;
        this.notify.push(this.translate.instant('tr_branch_transfer_approved_ok'), 'success');
        this.dialogData?.onChanged?.();
        this.load();
      },
      error: (err) => {
        this.actingId = null;
        const msg = err?.error?.error || this.translate.instant('tr_unexpected_error_message');
        this.notify.push(msg, 'error');
      },
    });
  }

  submitReject(): void {
    const t = this.rejectTransfer;
    const user = this.auth.getUserFromLocalStorage();
    const uid = user?._id != null ? String(user._id) : '';
    if (!t || !uid || this.actingId) {
      return;
    }
    this.actingId = t._id;
    this.products.rejectBranchTransfer(t._id, uid, this.rejectReason.trim()).subscribe({
      next: () => {
        this.actingId = null;
        this.cancelReject();
        this.notify.push(this.translate.instant('tr_branch_transfer_rejected_ok'), 'success');
        this.dialogData?.onChanged?.();
        this.load();
      },
      error: (err) => {
        this.actingId = null;
        const msg = err?.error?.error || this.translate.instant('tr_unexpected_error_message');
        this.notify.push(msg, 'error');
      },
    });
  }
}

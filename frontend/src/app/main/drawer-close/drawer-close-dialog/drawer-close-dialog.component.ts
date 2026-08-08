import { Component, Inject, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { formatDate } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
import { Branch } from '@core/models/products.model';
import { AuthenticationService } from '@core/services/authentication.service';
import { canPickBranchRole } from '@core/utils/role-utils';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { BranchesServce } from '@shared/services/branches.service';
import {
  CashDisposition,
  DrawerClosePreview,
  DrawerCloseService,
} from '@shared/services/drawer-close.service';
import { StoreSettingsService } from '@shared/services/store-settings.service';
import { paymentMethodDisplayLabel } from '@shared/utils/cashier-payment-methods.util';

export interface DrawerCloseDialogData {
  userId: string;
  forcedBranchId?: string | null;
  businessDate?: string;
}

function round2(n: number): number {
  return Math.round(Number(n || 0) * 100) / 100;
}

@Component({
  selector: 'app-drawer-close-dialog',
  templateUrl: './drawer-close-dialog.component.html',
  styleUrls: ['./drawer-close-dialog.component.scss'],
})
export class DrawerCloseDialogComponent implements OnInit {
  step: 1 | 2 = 1;
  preview: DrawerClosePreview | null = null;
  previewLoading = false;
  previewError = false;
  saving = false;

  branches: Branch[] = [];
  showBranchPicker = false;
  private fixedBranchId: string | null = null;

  businessDateStr = '';

  countForm: FormGroup;
  shortageReasonForm: FormGroup;

  /** deposit_all | retain (then retainMode: all | partial) */
  cashAction: 'deposit' | 'retain' = 'deposit';
  retainMode: 'all' | 'partial' = 'all';

  constructor(
    private fb: FormBuilder,
    private dialogRef: MatDialogRef<DrawerCloseDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public data: DrawerCloseDialogData,
    private auth: AuthenticationService,
    private drawerClose: DrawerCloseService,
    private branchesService: BranchesServce,
    private notify: AppNotificationService,
    private translate: TranslateService,
    private storeSettings: StoreSettingsService
  ) {
    const actor = this.auth.getUserFromLocalStorage();
    const forced = data.forcedBranchId ? String(data.forcedBranchId).trim() : '';

    if (forced) {
      this.fixedBranchId = forced;
      this.showBranchPicker = false;
    } else if (canPickBranchRole(actor?.role)) {
      this.showBranchPicker = true;
      this.fixedBranchId = null;
    } else {
      const b = actor?.branch as { _id?: string } | string | undefined;
      const bmBranch =
        typeof b === 'string' ? String(b).trim() : b?._id ? String(b._id).trim() : '';
      this.fixedBranchId = bmBranch || null;
      this.showBranchPicker = false;
    }

    const initialDate =
      data.businessDate?.trim() ||
      formatDate(new Date(), 'yyyy-MM-dd', 'en-US');

    this.businessDateStr = initialDate;

    this.countForm = this.fb.group({
      branchId: [this.fixedBranchId || '', this.showBranchPicker ? Validators.required : []],
      businessDate: [initialDate, Validators.required],
    });

    this.shortageReasonForm = this.fb.group({
      actualCashCounted: ['', Validators.required],
      retainedCash: [''],
      shortageReason: ['', Validators.maxLength(2000)],
    });
  }

  ngOnInit(): void {
    if (this.fixedBranchId) {
      this.countForm.patchValue({ branchId: this.fixedBranchId });
      this.countForm.get('branchId')?.disable();
    }

    if (this.showBranchPicker) {
      this.branchesService.getBranchs({ page: 1, limit: 1000 }).subscribe({
        next: (res: any) => {
          this.branches = res?.branches || [];
          const first = this.branches[0]?._id;
          if (first && !this.countForm.get('branchId')?.value) {
            this.countForm.patchValue({ branchId: first });
          }
          this.loadPreview();
        },
        error: () => {
          this.notify.push(this.translate.instant('tr_unexpected_error_message'), 'error');
        },
      });
      return;
    }

    if (!this.countForm.get('branchId')?.value) {
      this.notify.push(this.translate.instant('tr_branch_required'), 'error');
      this.dialogRef.close(false);
      return;
    }

    this.loadPreview();
  }

  effectiveBranchId(): string {
    const raw = this.countForm.getRawValue();
    return String(raw.branchId || '').trim();
  }

  isMultiDayPeriod(): boolean {
    if (!this.preview) return false;
    return (
      Boolean(this.preview.periodStartDate && this.preview.periodEndDate) &&
      this.preview.periodStartDate !== this.preview.periodEndDate
    );
  }

  loadPreview(): void {
    const branchId = this.effectiveBranchId();
    const dateRaw = String(this.countForm.get('businessDate')?.value || '').trim();
    if (!branchId || !dateRaw) {
      return;
    }

    this.previewLoading = true;
    this.previewError = false;
    this.preview = null;

    this.drawerClose
      .preview({
        userId: this.data.userId,
        branch: branchId,
        date: dateRaw,
      })
      .subscribe({
        next: (p) => {
          this.preview = p;
          this.previewLoading = false;
          this.previewError = false;
        },
        error: (err) => {
          this.previewLoading = false;
          this.previewError = true;
          const msg = err?.error?.error || this.translate.instant('tr_unexpected_error_message');
          this.notify.push(msg, 'error');
        },
      });
  }

  onBusinessDateChange(): void {
    this.loadPreview();
  }

  methodEntries(obj: Record<string, number> | undefined): [string, number][] {
    return Object.entries(obj || {})
      .filter(([, v]) => round2(Number(v)) !== 0)
      .sort((a, b) => a[0].localeCompare(b[0]));
  }

  payMethodLabel(method: string): string {
    return paymentMethodDisplayLabel(
      method,
      this.storeSettings.snapshot.paymentAppFeePercents,
      this.translate
    );
  }

  deskCashDrawerAmount(p: DrawerClosePreview | null): number {
    if (!p) return 0;
    const v = p.deskPurchaseCashDrawerTotal ?? p.deskPurchaseCashOutTotal ?? 0;
    return round2(Number(v));
  }

  deskGrandTotal(p: DrawerClosePreview | null): number | null {
    if (p == null || p.deskPurchaseGrandTotal == null) return null;
    const n = Number(p.deskPurchaseGrandTotal);
    if (!Number.isFinite(n)) return null;
    return round2(n);
  }

  vendorCashDrawerAmount(p: DrawerClosePreview | null): number {
    if (!p) return 0;
    return round2(Number(p.vendorCashDrawerTotal ?? 0));
  }

  clientOrderCashDrawerAmount(p: DrawerClosePreview | null): number {
    if (!p) return 0;
    return round2(Number(p.clientOrderCashDrawerTotal ?? 0));
  }

  vendorCashDrawerInflowAmount(p: DrawerClosePreview | null): number {
    if (!p) return 0;
    return round2(Number(p.vendorCashDrawerInflowTotal ?? 0));
  }

  clientDepositCashDrawerAmount(p: DrawerClosePreview | null): number {
    if (!p) return 0;
    return round2(Number(p.clientDepositCashDrawerTotal ?? 0));
  }

  showVendorCashRow(p: DrawerClosePreview | null): boolean {
    if (!p) return false;
    return (
      this.vendorCashDrawerAmount(p) > 0.005 ||
      Number(p.vendorCashDrawerPaymentCount || 0) > 0
    );
  }

  showVendorCashInflowRow(p: DrawerClosePreview | null): boolean {
    if (!p) return false;
    return (
      this.vendorCashDrawerInflowAmount(p) > 0.005 ||
      Number(p.vendorCashDrawerInflowCount || 0) > 0
    );
  }

  showClientCashRow(p: DrawerClosePreview | null): boolean {
    if (!p) return false;
    return (
      this.clientOrderCashDrawerAmount(p) > 0.005 ||
      Number(p.clientOrderCashDrawerPaymentCount || 0) > 0
    );
  }

  showClientDepositCashRow(p: DrawerClosePreview | null): boolean {
    if (!p) return false;
    return (
      this.clientDepositCashDrawerAmount(p) > 0.005 ||
      Number(p.clientDepositCashDrawerCount || 0) > 0
    );
  }

  isPeriodAlreadyClosed(): boolean {
    return Boolean(this.preview?.periodAlreadyClosed);
  }

  goToConfirm(): void {
    if (this.previewLoading || !this.preview) {
      if (!this.previewLoading && !this.preview) {
        this.notify.push(this.translate.instant('tr_drawer_close_preview_required'), 'error');
      }
      return;
    }
    if (this.isPeriodAlreadyClosed()) {
      this.notify.push(this.translate.instant('tr_drawer_close_period_already_closed'), 'error');
      return;
    }
    this.step = 2;
    this.cashAction = 'deposit';
    this.retainMode = 'all';
    const exp = this.preview.expectedCashInDrawer;
    this.shortageReasonForm.patchValue({
      actualCashCounted: round2(exp),
      retainedCash: '',
      shortageReason: '',
    });
    this.updateRetainedValidators();
  }

  goBack(): void {
    this.step = 1;
  }

  actualCounted(): number {
    const raw = this.shortageReasonForm.get('actualCashCounted')?.value;
    const a = round2(Number(raw));
    return Number.isFinite(a) ? a : 0;
  }

  retainedAmount(): number {
    if (this.cashAction !== 'retain') return 0;
    if (this.retainMode === 'all') return this.actualCounted();
    const raw = this.shortageReasonForm.get('retainedCash')?.value;
    const r = round2(Number(raw));
    return Number.isFinite(r) ? r : 0;
  }

  depositedAmount(): number {
    return round2(this.actualCounted() - this.retainedAmount());
  }

  onCashActionChange(): void {
    this.updateRetainedValidators();
  }

  onRetainModeChange(): void {
    this.updateRetainedValidators();
  }

  onActualCashChange(): void {
    this.updateRetainedValidators();
  }

  private updateRetainedValidators(): void {
    const ctrl = this.shortageReasonForm.get('retainedCash');
    if (!ctrl) return;
    const actual = this.actualCounted();
    if (this.cashAction === 'retain' && this.retainMode === 'partial' && actual !== 0) {
      if (actual > 0) {
        ctrl.setValidators([
          Validators.required,
          Validators.min(0.01),
          Validators.max(actual - 0.01),
        ]);
      } else {
        ctrl.setValidators([
          Validators.required,
          Validators.min(actual + 0.01),
          Validators.max(-0.01),
        ]);
      }
    } else {
      ctrl.clearValidators();
    }
    ctrl.updateValueAndValidity({ emitEvent: false });
  }

  private isValidPartialRetain(actual: number, retained: number): boolean {
    if (actual > 0) return retained > 0 && retained < actual;
    if (actual < 0) return retained < 0 && retained > actual;
    return false;
  }

  resolveCashDisposition(): CashDisposition | null {
    if (this.cashAction === 'deposit') return 'deposit_all';
    if (this.retainMode === 'all') return 'retain_all';
    return 'retain_partial';
  }

  variance(): number {
    const exp = this.preview?.expectedCashInDrawer ?? 0;
    return round2(this.actualCounted() - exp);
  }

  isShortage(): boolean {
    return this.variance() < -0.02;
  }

  isSurplus(): boolean {
    return this.variance() > 0.02;
  }

  needsVarianceNote(): boolean {
    return this.isShortage() || this.isSurplus();
  }

  isBalanced(): boolean {
    return Math.abs(this.variance()) <= 0.02;
  }

  submit(): void {
    if (!this.preview) return;

    this.shortageReasonForm.markAllAsTouched();
    this.updateRetainedValidators();

    const actual = this.actualCounted();
    const actualCtrl = this.shortageReasonForm.get('actualCashCounted');
    if (!Number.isFinite(actual) || actualCtrl?.invalid) {
      actualCtrl?.markAsTouched();
      this.notify.push(this.translate.instant('tr_drawer_close_actual_cash_required'), 'error');
      return;
    }

    const disposition = this.resolveCashDisposition();
    if (!disposition) return;

    if (disposition === 'retain_partial') {
      const retained = this.retainedAmount();
      if (!this.isValidPartialRetain(actual, retained)) {
        this.shortageReasonForm.get('retainedCash')?.markAsTouched();
        this.notify.push(this.translate.instant('tr_drawer_close_retained_invalid'), 'error');
        return;
      }
    }

    const needsNote = this.needsVarianceNote();
    const reason = String(this.shortageReasonForm.get('shortageReason')?.value || '').trim();
    if (needsNote && !reason) {
      this.shortageReasonForm.get('shortageReason')?.markAsTouched();
      const msgKey = this.isShortage()
        ? 'tr_drawer_close_shortage_reason_required'
        : 'tr_drawer_close_surplus_reason_required';
      this.notify.push(this.translate.instant(msgKey), 'error');
      return;
    }

    const branchId = this.effectiveBranchId();
    const dateStr = String(this.countForm.get('businessDate')?.value || '').trim();
    if (!branchId || !dateStr) {
      this.notify.push(this.translate.instant('tr_branch_required'), 'error');
      return;
    }

    const payload: Parameters<DrawerCloseService['close']>[0] = {
      branch: branchId,
      businessDate: dateStr,
      userId: this.data.userId,
      actualCashCounted: actual,
      cashDisposition: disposition,
      ...(needsNote ? { shortageReason: reason } : {}),
    };

    if (disposition === 'retain_partial') {
      payload.retainedCash = this.retainedAmount();
    }

    this.saving = true;
    this.drawerClose.close(payload).subscribe({
      next: () => {
        this.saving = false;
        this.notify.push(this.translate.instant('tr_drawer_close_saved'), 'success');
        this.dialogRef.close(true);
      },
      error: (err) => {
        this.saving = false;
        const msg = err?.error?.error || this.translate.instant('tr_unexpected_error_message');
        this.notify.push(msg, 'error');
      },
    });
  }

  cancel(): void {
    this.dialogRef.close(false);
  }
}

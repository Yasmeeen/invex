import { Component, Inject, OnDestroy, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Branch, Vendor, VendorPurchasingRequestRow } from '@core/models/products.model';
import { AuthenticationService } from '@core/services/authentication.service';
import { resolveActorBranchContext } from '@core/utils/branch-utils';
import { TranslateService } from '@ngx-translate/core';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { BranchesServce } from '@shared/services/branches.service';
import { StoreSettingsService } from '@shared/services/store-settings.service';
import {
  TreasurySplitPayload,
  VendorsSerivce,
} from '@shared/services/vendors.service';
import { Subscription } from 'rxjs';

export type VendorDeferredPaymentDialogData = {
  vendor: Vendor;
  purchasingRequest: VendorPurchasingRequestRow;
  forcedBranchId?: string | null;
};

@Component({
  selector: 'app-vendor-deferred-payment-dialog',
  templateUrl: './vendor-deferred-payment-dialog.component.html',
  styleUrls: ['./vendor-deferred-payment-dialog.component.scss'],
})
export class VendorDeferredPaymentDialogComponent implements OnInit, OnDestroy {
  form: FormGroup;
  saving = false;
  readonly vendor: Vendor;
  readonly pr: VendorPurchasingRequestRow;
  branches: Branch[] = [];
  showBranchPicker = false;
  private paymentBranchId: string | null = null;
  private subscriptions: Subscription[] = [];

  treasuryMethodOptions: { key: string; label: string }[] = [];
  selectedTreasuryKeys: string[] = ['cash'];
  treasuryAmounts: Record<string, number> = {};

  constructor(
    private fb: FormBuilder,
    private vendors: VendorsSerivce,
    private auth: AuthenticationService,
    private branchesService: BranchesServce,
    private storeSettings: StoreSettingsService,
    private translate: TranslateService,
    private notify: AppNotificationService,
    private ref: MatDialogRef<VendorDeferredPaymentDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) data: VendorDeferredPaymentDialogData
  ) {
    this.vendor = data.vendor;
    this.pr = data.purchasingRequest;

    const actor = this.auth.getUserFromLocalStorage();
    const ctx = resolveActorBranchContext(actor, data.forcedBranchId);
    this.paymentBranchId = ctx.branchId;
    this.showBranchPicker = ctx.showBranchPicker;

    this.form = this.fb.group({
      branchId: [ctx.branchId || '', this.showBranchPicker ? Validators.required : []],
      note: ['', Validators.maxLength(500)],
    });
  }

  get remaining(): number {
    return Math.max(0, Math.round((Number(this.pr.remaining) || 0) * 100) / 100);
  }

  ngOnInit(): void {
    this.syncTreasuryOptions();
    this.subscriptions.push(
      this.storeSettings.settings$.subscribe(() => this.syncTreasuryOptions())
    );

    if (this.showBranchPicker) {
      this.branchesService.getBranchs({ page: 1, limit: 1000 }).subscribe({
        next: (res: any) => {
          this.branches = res?.branches || [];
          const first = this.branches[0]?._id;
          if (first && !this.form.get('branchId')?.value) {
            this.form.patchValue({ branchId: first });
            this.paymentBranchId = String(first);
          }
        },
        error: () => {
          this.notify.push(this.translate.instant('tr_unexpected_error_message'), 'error');
        },
      });
    } else if (this.paymentBranchId) {
      this.form.patchValue({ branchId: this.paymentBranchId });
      this.form.get('branchId')?.disable();
    }
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach((s) => s.unsubscribe());
  }

  private syncTreasuryOptions(): void {
    const deferredKey = 'deferred';
    const m = this.storeSettings.snapshot.purchaseTreasuryMethods;
    const raw = Array.isArray(m) && m.length ? m : [{ key: 'cash', label: 'Cash' }];
    this.treasuryMethodOptions = raw
      .map((x) => ({
        key: String(x.key || '').trim().toLowerCase(),
        label: String(x.label || x.key || '').trim(),
      }))
      .filter((o) => o.key && o.key !== deferredKey);

    const keys = new Set(this.treasuryMethodOptions.map((o) => o.key));
    const valid = this.selectedTreasuryKeys.filter((k) => keys.has(k));
    if (!valid.length) {
      const cash = this.treasuryMethodOptions.find((o) => o.key === 'cash');
      this.selectedTreasuryKeys = [cash ? cash.key : this.treasuryMethodOptions[0]?.key || 'cash'];
    } else {
      this.selectedTreasuryKeys = valid;
    }
    this.reconcileTreasuryAmountsKeys(this.selectedTreasuryKeys);
  }

  treasuryOptionLabel(key: string): string {
    return this.treasuryMethodOptions.find((o) => o.key === key)?.label || key;
  }

  onSelectedTreasuryChange(ids: string[] | null): void {
    const raw = Array.isArray(ids) ? ids.filter((x) => !!String(x || '').trim()) : [];
    if (!raw.length) {
      this.selectedTreasuryKeys = ['cash'];
      this.reconcileTreasuryAmountsKeys(['cash']);
      return;
    }
    this.reconcileTreasuryAmountsKeys(raw);
  }

  private reconcileTreasuryAmountsKeys(ids: string[]): void {
    const next: Record<string, number> = {};
    for (const id of ids) {
      next[id] = Number(this.treasuryAmounts[id]) || 0;
    }
    this.treasuryAmounts = next;
    this.selectedTreasuryKeys = ids;
  }

  trackTreasuryKey(_index: number, key: string): string {
    return key;
  }

  treasuryOverflowTitle(items: readonly { key?: string; label?: string }[] | null | undefined): string {
    if (!items?.length || items.length <= 2) {
      return '';
    }
    return items
      .slice(2)
      .map((row) => String(row?.label || row?.key || '').trim())
      .filter(Boolean)
      .join(', ');
  }

  treasurySplitsTotal(): number {
    const sum = this.selectedTreasuryKeys.reduce(
      (acc, key) => acc + (Number(this.treasuryAmounts[key]) || 0),
      0
    );
    return Math.round(sum * 100) / 100;
  }

  treasuryRemaining(): number {
    return Math.round((this.remaining - this.treasurySplitsTotal()) * 100) / 100;
  }

  treasuryOverAllocated(): boolean {
    return this.treasurySplitsTotal() > this.remaining + 0.001;
  }

  private buildTreasurySplitsPayload(): TreasurySplitPayload[] | null {
    const splits = this.selectedTreasuryKeys
      .map((key) => ({
        key,
        label: this.treasuryOptionLabel(key),
        amount: Math.round((Number(this.treasuryAmounts[key]) || 0) * 100) / 100,
      }))
      .filter((s) => s.amount > 0);

    if (!splits.length) {
      this.notify.push(this.translate.instant('tr_vendor_deferred_treasury_required'), 'error');
      return null;
    }
    if (this.treasuryOverAllocated()) {
      this.notify.push(this.translate.instant('tr_vendor_deferred_payment_over'), 'error');
      return null;
    }
    if (this.treasurySplitsTotal() <= 0) {
      this.notify.push(this.translate.instant('tr_vendor_deferred_amount_required'), 'error');
      return null;
    }
    return splits;
  }

  submit(): void {
    if (this.saving) return;
    if (this.showBranchPicker) {
      this.form.get('branchId')?.enable();
    }
    this.form.markAllAsTouched();
    if (!this.form.valid) {
      return;
    }

    const vendorId = this.vendor._id;
    const prId = this.pr._id;
    if (!vendorId || !prId) {
      return;
    }

    const branchId = String(this.form.getRawValue().branchId || this.paymentBranchId || '').trim();
    if (!branchId) {
      this.notify.push(this.translate.instant('tr_branch_required'), 'error');
      return;
    }

    const splits = this.buildTreasurySplitsPayload();
    if (!splits) {
      return;
    }

    const u = this.auth.getUserFromLocalStorage();
    this.saving = true;
    this.vendors
      .recordDeferredPurchasePayment(String(vendorId), {
        purchasingRequestId: String(prId),
        amount: this.treasurySplitsTotal(),
        paymentTreasurySplits: splits,
        userId: u?._id,
        branchId,
        note: String(this.form.getRawValue().note || '').trim(),
      })
      .subscribe({
        next: () => {
          this.saving = false;
          this.notify.push(this.translate.instant('tr_vendor_deferred_payment_ok'), 'success');
          this.ref.close(true);
        },
        error: (err) => {
          this.saving = false;
          const msg =
            err?.error?.message || this.translate.instant('tr_unexpected_error_message');
          this.notify.push(msg, 'error');
        },
      });
  }

  close(): void {
    this.ref.close(false);
  }
}

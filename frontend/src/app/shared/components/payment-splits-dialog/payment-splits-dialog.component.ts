import { Component, Inject, OnDestroy, OnInit } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { StoreSettingsService } from '@shared/services/store-settings.service';
import {
  buildCashierPaymentMethods,
  CashierPaymentMethod,
  paymentMethodDisplayLabel,
} from '@shared/utils/cashier-payment-methods.util';
import {
  buildPaymentSplitsResult,
  defaultFeeSources,
  FEE_PAID_VIA_SAME,
  methodsWithFees,
  paymentAppFeePercent,
  paymentSplitsNetTotal,
  PaymentFeeSource,
  PaymentSplitsResult,
  round2,
} from '@shared/utils/payment-app-fee.util';
import {
  catalogCreditFeePercent,
  creditMarkupAmount,
} from '@shared/utils/credit-sale-markup.util';
import {
  InstallmentPlan,
  InstallmentPlansService,
} from '@shared/services/installment-plans.service';
import { Subscription } from 'rxjs';

export type PaymentSplitsDialogMode = 'checkout' | 'installment' | 'deposit';

export interface PaymentSplitsDialogInitialState {
  selectedPayMethods?: string[];
  payAmounts?: Record<string, number>;
  feeSources?: PaymentFeeSource[];
}

export interface PaymentSplitsDialogData {
  invoiceNetTotal: number;
  mode: PaymentSplitsDialogMode;
  initialState?: PaymentSplitsDialogInitialState;
}

export interface FeeSourceOption {
  id: string;
  label: string;
  percent: number;
  logo?: string;
}

@Component({
  selector: 'app-payment-splits-dialog',
  templateUrl: './payment-splits-dialog.component.html',
  styleUrls: ['./payment-splits-dialog.component.scss'],
})
export class PaymentSplitsDialogComponent implements OnInit, OnDestroy {
  paymentMethods: CashierPaymentMethod[] = [];
  paymentMethodsForSplit: CashierPaymentMethod[] = [];
  selectedPayMethods: string[] = ['cash'];
  payAmounts: Record<string, number> = { cash: 0 };
  feeSources: PaymentFeeSource[] = [];
  /** Stable ng-select items per fee-bearing method (avoid new array each CD cycle). */
  feeSourceOptionsMap: Record<string, FeeSourceOption[]> = {};

  installmentPlans: InstallmentPlan[] = [];
  selectedInstallmentPlanId = '';
  installmentStartDate = '';

  readonly invoiceNetTotal: number;
  readonly mode: PaymentSplitsDialogMode;

  private settingsSub?: Subscription;
  private plansSub?: Subscription;

  constructor(
    private dialogRef: MatDialogRef<PaymentSplitsDialogComponent, PaymentSplitsResult | null>,
    @Inject(MAT_DIALOG_DATA) data: PaymentSplitsDialogData,
    private storeSettings: StoreSettingsService,
    private translate: TranslateService,
    private notify: AppNotificationService,
    private installmentPlansService: InstallmentPlansService
  ) {
    this.invoiceNetTotal = round2(Number(data.invoiceNetTotal) || 0);
    this.mode =
      data.mode === 'installment'
        ? 'installment'
        : data.mode === 'deposit'
          ? 'deposit'
          : 'checkout';

    const init = data.initialState;
    if (init?.selectedPayMethods?.length) {
      this.selectedPayMethods = [...init.selectedPayMethods];
      this.payAmounts = { ...(init.payAmounts || {}) };
      this.feeSources = init.feeSources?.length ? [...init.feeSources] : [];
    }
  }

  ngOnInit(): void {
    this.rebuildPaymentMethods();
    this.settingsSub = this.storeSettings.settings$.subscribe(() => this.rebuildPaymentMethods());
    this.ensureDefaultNetAmounts();
    this.syncFeeSources();
    this.installmentStartDate = this.defaultInstallmentStartDate();
    if (this.mode === 'checkout') {
      this.plansSub = this.installmentPlansService.list(true).subscribe({
        next: (res) => {
          this.installmentPlans = res?.plans || [];
          if (!this.selectedInstallmentPlanId && this.installmentPlans.length) {
            this.selectedInstallmentPlanId = String(this.installmentPlans[0]._id || '');
          }
        },
        error: () => {
          this.installmentPlans = [];
        },
      });
    }
  }

  ngOnDestroy(): void {
    this.settingsSub?.unsubscribe();
    this.plansSub?.unsubscribe();
  }

  private defaultInstallmentStartDate(): string {
    const d = new Date();
    d.setMonth(d.getMonth() + 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  private rebuildPaymentMethods(): void {
    const all = buildCashierPaymentMethods(
      this.storeSettings.snapshot.paymentAppFeePercents,
      this.translate,
      this.storeSettings.snapshot.paymentMethodsCatalog
    );
    this.paymentMethods =
      this.mode === 'installment' || this.mode === 'deposit'
        ? all.filter((m) => m.id !== 'credit' && m.id !== 'installment')
        : all;
    this.paymentMethodsForSplit = this.paymentMethods;

    const keys = new Set(this.paymentMethods.map((m) => m.id));
    const valid = this.selectedPayMethods.filter((k) => keys.has(k));
    if (!valid.length) {
      this.selectedPayMethods = ['cash'];
      this.payAmounts = { cash: 0 };
    } else {
      this.selectedPayMethods = valid;
      this.reconcilePayAmountsKeys(valid);
    }
    this.refreshFeeSourceOptionsMap();
  }

  paymentAppFeePercent(methodId: string | undefined | null): number {
    return paymentAppFeePercent(methodId, this.storeSettings.snapshot.paymentAppFeePercents);
  }

  creditFeePercent(): number {
    return catalogCreditFeePercent(this.storeSettings.snapshot.paymentMethodsCatalog);
  }

  /** App-fee % or credit-sale / installment markup % for badges in the picker. */
  methodSalePercent(methodId: string | undefined | null): number {
    if (this.isCreditPayMethod(methodId)) {
      return this.creditFeePercent();
    }
    if (this.isInstallmentPayMethod(methodId)) {
      return this.installmentInterestPercent();
    }
    return this.paymentAppFeePercent(methodId);
  }

  creditMarkupPreview(): number {
    if (this.mode === 'deposit' || this.paymentOverAllocated() || this.hasInstallmentPayMethodSelected()) {
      return 0;
    }
    const remaining = this.paymentRemaining();
    if (remaining <= 0.005) {
      return 0;
    }
    return creditMarkupAmount(remaining, this.creditFeePercent());
  }

  installmentMarkupPreview(): number {
    if (this.mode === 'deposit' || this.paymentOverAllocated() || !this.hasInstallmentPayMethodSelected()) {
      return 0;
    }
    const remaining = this.paymentRemaining();
    if (remaining <= 0.005) {
      return 0;
    }
    return creditMarkupAmount(remaining, this.installmentInterestPercent());
  }

  installmentDueAfterMarkup(): number {
    return round2(this.paymentRemaining() + this.installmentMarkupPreview());
  }

  /**
   * Monthly installment amount (matches backend buildSaleInstallmentSchedule base).
   * Last month may absorb a few piastres of rounding.
   */
  installmentMonthlyAmount(): number {
    if (
      this.mode === 'deposit' ||
      this.paymentOverAllocated() ||
      !this.hasInstallmentPayMethodSelected()
    ) {
      return 0;
    }
    const months = Math.max(1, Math.floor(Number(this.selectedInstallmentPlan()?.months) || 0));
    if (!this.selectedInstallmentPlan() || months < 1) {
      return 0;
    }
    const totalDue = this.installmentDueAfterMarkup();
    if (totalDue <= 0.005) {
      return 0;
    }
    return Math.floor((totalDue / months) * 100) / 100;
  }

  installmentPlanMonths(): number {
    return Math.max(0, Math.floor(Number(this.selectedInstallmentPlan()?.months) || 0));
  }

  creditDueAfterMarkup(): number {
    return round2(this.paymentRemaining() + this.creditMarkupPreview());
  }

  getPayMethodDef(id: string): CashierPaymentMethod | undefined {
    return this.paymentMethods.find((m) => m.id === id);
  }

  payMethodDisplayLabel(methodId: string): string {
    return paymentMethodDisplayLabel(
      methodId,
      this.storeSettings.snapshot.paymentAppFeePercents,
      this.translate
    );
  }

  isCreditPayMethod(id: string | undefined | null): boolean {
    return String(id || '').trim().toLowerCase() === 'credit';
  }

  isInstallmentPayMethod(id: string | undefined | null): boolean {
    return String(id || '').trim().toLowerCase() === 'installment';
  }

  isFinancingPayMethod(id: string | undefined | null): boolean {
    return this.isCreditPayMethod(id) || this.isInstallmentPayMethod(id);
  }

  hasCreditPayMethodSelected(): boolean {
    return this.selectedPayMethods.some((id) => this.isCreditPayMethod(id));
  }

  hasInstallmentPayMethodSelected(): boolean {
    return this.selectedPayMethods.some((id) => this.isInstallmentPayMethod(id));
  }

  selectedInstallmentPlan(): InstallmentPlan | undefined {
    const id = String(this.selectedInstallmentPlanId || '');
    return this.installmentPlans.find((p) => String(p._id) === id);
  }

  installmentInterestPercent(): number {
    return Number(this.selectedInstallmentPlan()?.interestPercent) || 0;
  }

  payAmountInputMax(methodId: string): number | undefined {
    if (this.isFinancingPayMethod(methodId) || this.mode === 'installment') {
      return this.invoiceNetTotal;
    }
    return undefined;
  }

  onSelectedPayMethodsChange(ids: string[] | null): void {
    let raw = Array.isArray(ids) ? ids.filter((x) => !!String(x || '').trim()) : [];
    if (!raw.length) {
      this.selectedPayMethods = ['cash'];
      this.reconcilePayAmountsKeys(['cash']);
      this.ensureDefaultNetAmounts();
      this.syncFeeSources();
      return;
    }
    // Switching from cash-only to another method: drop cash automatically.
    // To split cash + other, the user must re-select cash explicitly.
    const prevWasCashOnly =
      this.selectedPayMethods.length === 1 &&
      String(this.selectedPayMethods[0] || '')
        .trim()
        .toLowerCase() === 'cash';
    const hasNonCash = raw.some((id) => String(id || '').trim().toLowerCase() !== 'cash');
    if (prevWasCashOnly && hasNonCash) {
      raw = raw.filter((id) => String(id || '').trim().toLowerCase() !== 'cash');
    }
    // Credit and installment are mutually exclusive.
    const hasCredit = raw.some((id) => this.isCreditPayMethod(id));
    const hasInstallment = raw.some((id) => this.isInstallmentPayMethod(id));
    if (hasCredit && hasInstallment) {
      const last = String(raw[raw.length - 1] || '').toLowerCase();
      if (last === 'installment') {
        raw = raw.filter((id) => !this.isCreditPayMethod(id));
      } else {
        raw = raw.filter((id) => !this.isInstallmentPayMethod(id));
      }
      this.notify.push(this.translate.instant('tr_cashier_credit_or_installment'), 'error');
    }
    this.reconcilePayAmountsKeys(raw);
    this.ensureDefaultNetAmounts();
    this.syncFeeSources();
  }

  private reconcilePayAmountsKeys(ids: string[]): void {
    const next: Record<string, number> = {};
    for (const id of ids) {
      if (this.isFinancingPayMethod(id) && !Number.isFinite(Number(this.payAmounts[id]))) {
        next[id] = 0;
      } else {
        next[id] = Number(this.payAmounts[id]) || 0;
      }
    }
    this.payAmounts = next;
    this.selectedPayMethods = ids;
  }

  private ensureDefaultNetAmounts(): void {
    // Deposit amounts are free-form (invoiceNetTotal is 0); do not overwrite user input.
    if (this.mode === 'deposit') {
      return;
    }
    if (this.selectedPayMethods.length !== 1) {
      return;
    }
    const id = this.selectedPayMethods[0];
    const cur = Number(this.payAmounts[id]);
    if (this.isFinancingPayMethod(id)) {
      if (!Number.isFinite(cur) || cur < 0) {
        this.payAmounts = { ...this.payAmounts, [id]: 0 };
      }
      return;
    }
    // Prefill empty amount only. Never replace a typed partial (installment / down payment).
    if (!Number.isFinite(cur) || cur <= 0) {
      this.payAmounts = { ...this.payAmounts, [id]: Math.max(0, this.invoiceNetTotal) };
    }
  }

  onPayAmountChange(): void {
    this.syncFeeSources();
  }

  private syncFeeSources(): void {
    const splits = this.buildCurrentSplits();
    const feeMethods = methodsWithFees(splits, this.storeSettings.snapshot.paymentAppFeePercents);
    const prev = new Map(this.feeSources.map((s) => [s.forMethod, s.paidVia]));
    this.refreshFeeSourceOptionsMap();
    this.feeSources = feeMethods.map((forMethod) => {
      let paidVia = prev.get(forMethod) ?? FEE_PAID_VIA_SAME;
      paidVia = this.normalizeFeePaidVia(forMethod, paidVia);
      return { forMethod, paidVia };
    });
  }

  private normalizeFeePaidVia(forMethod: string, paidVia: string): string {
    const fm = String(forMethod || '')
      .trim()
      .toLowerCase();
    const via = String(paidVia || '')
      .trim()
      .toLowerCase();
    if (!via || via === fm) {
      return FEE_PAID_VIA_SAME;
    }
    if (via === FEE_PAID_VIA_SAME) {
      return FEE_PAID_VIA_SAME;
    }
    const opts = this.feeSourceOptionsMap[fm] || this.buildFeeSourceOptions(fm);
    return opts.some((o) => o.id === via) ? via : FEE_PAID_VIA_SAME;
  }

  private refreshFeeSourceOptionsMap(): void {
    const splits = this.buildCurrentSplits();
    const feeMethods = methodsWithFees(splits, this.storeSettings.snapshot.paymentAppFeePercents);
    const next: Record<string, FeeSourceOption[]> = {};
    for (const fm of feeMethods) {
      next[fm] = this.buildFeeSourceOptions(fm);
    }
    this.feeSourceOptionsMap = next;
  }

  private buildFeeSourceOptions(forMethod: string): FeeSourceOption[] {
    const fm = String(forMethod || '').trim().toLowerCase();
    const seen = new Set<string>();
    const opts: FeeSourceOption[] = [];

    const pushOption = (id: string, label: string, percent: number) => {
      const key = String(id || '').trim().toLowerCase();
      if (!key || seen.has(key)) {
        return;
      }
      seen.add(key);
      const def = this.getPayMethodDef(key === FEE_PAID_VIA_SAME ? fm : key);
      opts.push({
        id: key,
        label,
        percent: round2(Number(percent) || 0),
        logo: def?.logo,
      });
    };

    pushOption(
      FEE_PAID_VIA_SAME,
      this.translate.instant('tr_payment_fee_via_same', {
        method: this.payMethodDisplayLabel(fm),
      }),
      this.paymentAppFeePercent(fm)
    );

    for (const m of this.paymentMethods) {
      if (m.id === 'credit' || m.id === 'installment' || m.id === fm) {
        continue;
      }
      pushOption(m.id, m.label, this.paymentAppFeePercent(m.id));
    }

    return opts;
  }

  feeSourceOptions(forMethod: string): FeeSourceOption[] {
    const fm = String(forMethod || '')
      .trim()
      .toLowerCase();
    return this.feeSourceOptionsMap[fm] || this.buildFeeSourceOptions(fm);
  }

  onFeePaidViaChange(forMethod: string, paidVia: string | null): void {
    const fm = String(forMethod || '')
      .trim()
      .toLowerCase();
    const row = this.feeSources.find((s) => s.forMethod === fm);
    if (!row) {
      return;
    }
    row.paidVia = this.normalizeFeePaidVia(fm, String(paidVia || FEE_PAID_VIA_SAME));
  }

  trackFeeSourceId(_index: number, src: PaymentFeeSource): string {
    return src.forMethod;
  }

  feeNetForMethod(forMethod: string): number {
    const net = Number(this.payAmounts[forMethod]) || 0;
    const pct = this.paymentAppFeePercent(forMethod);
    if (pct <= 0 || net <= 0) {
      return 0;
    }
    return round2(net * (pct / 100));
  }

  feePaidViaLabel(forMethod: string): string {
    const src = this.feeSources.find((s) => s.forMethod === forMethod);
    const paidVia = src?.paidVia ?? FEE_PAID_VIA_SAME;
    if (paidVia === FEE_PAID_VIA_SAME) {
      return this.payMethodDisplayLabel(forMethod);
    }
    return this.payMethodDisplayLabel(paidVia);
  }

  feeGrossPreview(forMethod: string): number {
    const result = buildPaymentSplitsResult(
      this.buildCurrentSplits(),
      this.feeSources,
      this.storeSettings.snapshot.paymentAppFeePercents
    );
    const row = result.feeAllocations.find((a) => a.forMethod === forMethod);
    return row?.feeGrossOnPaidVia ?? 0;
  }

  buildCurrentSplits(): { method: string; amount: number }[] {
    return this.selectedPayMethods
      .filter((id) => String(id || '').trim())
      .map((id) => ({
        method: String(id).trim().toLowerCase(),
        amount: round2(Number(this.payAmounts[id]) || 0),
      }))
      .filter((s) => !this.isFinancingPayMethod(s.method) || s.amount >= 0);
  }

  paymentSplitsTotal(): number {
    return paymentSplitsNetTotal(this.buildCurrentSplits());
  }

  paymentRemaining(): number {
    return round2(this.invoiceNetTotal - this.paymentSplitsTotal());
  }

  paymentOverAllocated(): boolean {
    return this.paymentSplitsTotal() > this.invoiceNetTotal + 0.001;
  }

  hasAnyFee(): boolean {
    return methodsWithFees(
      this.buildCurrentSplits(),
      this.storeSettings.snapshot.paymentAppFeePercents
    ).length > 0;
  }

  isSettlementMethod(method: string): boolean {
    const m = String(method || '')
      .trim()
      .toLowerCase();
    const row = (this.storeSettings.snapshot.paymentMethodsCatalog || []).find(
      (c) => String(c.key || '').toLowerCase() === m
    );
    return row?.effectMode === 'settlement';
  }

  hasSettlementFee(): boolean {
    return this.feeSources.some((src) => {
      if (this.feeNetForMethod(src.forMethod) <= 0) return false;
      if (this.isSettlementMethod(src.forMethod)) return true;
      const via = src.paidVia === 'same' ? src.forMethod : src.paidVia;
      return this.isSettlementMethod(via);
    });
  }

  settlementReceivable(method: string): number | null {
    if (!this.isSettlementMethod(method)) return null;
    const m = String(method || '')
      .trim()
      .toLowerCase();
    const result = this.currentSplitsResult();
    let rec = round2(Number(this.payAmounts[m]) || 0);
    for (const fee of result.feeAllocations || []) {
      if (fee.forMethod === m) {
        const ownDeduction =
          fee.paidVia === m
            ? round2(Number(fee.feeGrossOnPaidVia) || Number(fee.feeNet) || 0)
            : round2(Number(fee.feeNet) || 0);
        rec = round2(rec - ownDeduction);
      }
      const via = String(fee.paidVia || '').toLowerCase();
      if (via && via !== 'same' && via === m && fee.forMethod !== m) {
        const gross = round2(Number(fee.feeGrossOnPaidVia) || Number(fee.feeNet) || 0);
        const nested = round2(Math.max(0, gross - (Number(fee.feeNet) || 0)));
        rec = round2(rec + gross - nested);
      }
    }
    return round2(Math.max(0, rec));
  }

  private currentSplitsResult() {
    return buildPaymentSplitsResult(
      this.buildCurrentSplits(),
      this.feeSources.length
        ? this.feeSources
        : defaultFeeSources(
            this.buildCurrentSplits(),
            this.storeSettings.snapshot.paymentAppFeePercents
          ),
      this.storeSettings.snapshot.paymentAppFeePercents
    );
  }

  grossWithdrawalPreview() {
    return this.currentSplitsResult().grossWithdrawals;
  }

  trackPayMethodId(_index: number, id: string): string {
    return id;
  }

  payMethodsOverflowTitle(items: readonly CashierPaymentMethod[] | null | undefined): string {
    if (!items?.length || items.length <= 2) {
      return '';
    }
    return items
      .slice(2)
      .map((row) => row?.label || '')
      .filter(Boolean)
      .join(', ');
  }

  cancel(): void {
    this.dialogRef.close(null);
  }

  confirm(): void {
    // Checkout with an empty amount can default to the invoice total.
    // Installment / deposit must keep the typed amount (partial payments).
    if (this.mode === 'checkout') {
      this.ensureDefaultNetAmounts();
    }

    const paymentSplits = this.selectedPayMethods
      .filter((id) => String(id || '').trim())
      .map((id) => ({
        method: String(id).trim().toLowerCase(),
        amount: round2(Number(this.payAmounts[id]) || 0),
      }));

    const hasCredit = paymentSplits.some((s) => s.method === 'credit');
    const hasInstallment = paymentSplits.some((s) => s.method === 'installment');
    const moneySplits = paymentSplits.filter(
      (s) => s.method !== 'credit' && s.method !== 'installment' && s.amount > 0
    );

    if (!moneySplits.length && !hasCredit && !hasInstallment) {
      this.notify.push(this.translate.instant('tr_order_payment_method_required'), 'error');
      return;
    }

    if (this.mode !== 'deposit' && this.paymentOverAllocated()) {
      this.notify.push(this.translate.instant('tr_cashier_payment_over'), 'error');
      return;
    }

    const netTotal = paymentSplitsNetTotal(
      paymentSplits.filter((s) => s.method !== 'credit' && s.method !== 'installment')
    );
    if (netTotal <= 0 && !hasCredit && !hasInstallment) {
      this.notify.push(this.translate.instant('tr_vendor_deferred_amount_required'), 'error');
      return;
    }

    if (hasInstallment) {
      if (!this.selectedInstallmentPlanId) {
        this.notify.push(this.translate.instant('tr_installment_plan_required'), 'error');
        return;
      }
      if (!this.installmentStartDate) {
        this.notify.push(this.translate.instant('tr_installment_start_date_required'), 'error');
        return;
      }
      if (this.paymentRemaining() <= 0.005) {
        this.notify.push(this.translate.instant('tr_installment_needs_remaining'), 'error');
        return;
      }
    }

    const feeSources = this.feeSources.length
      ? this.feeSources
      : defaultFeeSources(
          paymentSplits.filter((s) => s.amount > 0 && s.method !== 'installment'),
          this.storeSettings.snapshot.paymentAppFeePercents
        );

    const result = buildPaymentSplitsResult(
      paymentSplits.filter((s) => s.amount > 0 && s.method !== 'installment'),
      feeSources,
      this.storeSettings.snapshot.paymentAppFeePercents
    );

    // Preserve credit / installment line (including zero paid-now) for checkout resolution.
    const creditLine = paymentSplits.find((s) => s.method === 'credit');
    if (creditLine && !result.paymentSplits.some((s) => s.method === 'credit')) {
      result.paymentSplits.push(creditLine);
    }
    const installmentLine = paymentSplits.find((s) => s.method === 'installment');
    if (installmentLine && !result.paymentSplits.some((s) => s.method === 'installment')) {
      result.paymentSplits.push({
        method: 'installment',
        amount: round2(Number(installmentLine.amount) || 0),
      });
    }

    if (hasInstallment) {
      result.installmentPlanId = this.selectedInstallmentPlanId;
      result.installmentStartDate = this.installmentStartDate;
    }

    this.dialogRef.close(result);
  }
}

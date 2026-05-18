import { Component, OnInit, ViewChild, Inject, Output, EventEmitter } from '@angular/core';
import { NgForm } from '@angular/forms';
import { MAT_LEGACY_DIALOG_DATA as MAT_DIALOG_DATA, MatLegacyDialogRef as MatDialogRef } from '@angular/material/legacy-dialog';
import { Subscription } from 'rxjs';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { TranslateService } from '@ngx-translate/core';
import { VendorsSerivce } from '@shared/services/vendors.service';
import { PurchasingRequestsService } from '@shared/services/purchasing.service';
import { Vendor } from '@core/models/products.model';

export type InstallmentSchedulePeriod = 'weekly' | 'biweekly' | 'monthly' | 'quarterly';

@Component({
    selector: 'app-create-edit-purchasing-request',
    templateUrl: './create-edit-purchasing-request.component.html',
    styleUrls: ['./create-edit-purchasing-request.component.scss'],
    standalone: false
})
export class CreateEditPurchasingRequestComponent implements OnInit {
  @ViewChild('purchasingForm') purchasingForm: NgForm;
  @Output() destroyEmitter: EventEmitter<any> = new EventEmitter();

  purchasingRequestId: string;
  isEdit = false;
  vendorsList: any[] = [];
  installments: any[] = [];
  selectedPaymentTerm: string;
  private subscriptions: Subscription[] = [];
  selectedVendor: Vendor;

  /** Auto-schedule: cadence, count, first due date (manual rows still allowed after generate). */
  installmentSchedulePeriod: InstallmentSchedulePeriod = 'monthly';
  installmentScheduleCount = 3;
  installmentScheduleStart: Date | null = null;

  readonly installmentPeriodOptions: { value: InstallmentSchedulePeriod; labelKey: string }[] = [
    { value: 'weekly', labelKey: 'tr_installment_period_weekly' },
    { value: 'biweekly', labelKey: 'tr_installment_period_biweekly' },
    { value: 'monthly', labelKey: 'tr_installment_period_monthly' },
    { value: 'quarterly', labelKey: 'tr_installment_period_quarterly' },
  ];

  /** After true, payment/schedule changes may auto-fill installments (avoid clobbering edit load). */
  private formReadyForInstallmentSuggestions = false;

  /** Skip duplicate auto-fill when term is already Installments (e.g. after loading an existing request). */
  private lastPaymentTerm: string | null = null;

  purchasingStatusList = [
    { label: this.translateService.instant('tr_received'), value: 'Received' },
    { label: this.translateService.instant('tr_pending'), value: 'Pending' },
    { label: this.translateService.instant('tr_ordered'), value: 'Ordered' },
  ];

  constructor(
    private dialogRef: MatDialogRef<CreateEditPurchasingRequestComponent>,
    private purchasingService: PurchasingRequestsService,
    private vendorsService: VendorsSerivce,
    private appNotificationService: AppNotificationService,
    private translateService: TranslateService,
    @Inject(MAT_DIALOG_DATA) public data: any
  ) {}

  ngOnInit(): void {
    this.purchasingRequestId = this.data?.requestId;
    this.isEdit = this.data?.isEdit || false;
    if (!this.isEdit) {
      this.formReadyForInstallmentSuggestions = true;
    }
    this.getVendors();

    if (this.isEdit) {
      this.getPurchasingRequest();
    }
  }

  getVendors() {
    const params = { page: 1, limit: 1000 };
    this.subscriptions.push(
      this.vendorsService.getVendors(params).subscribe({
        next: (res: any) => (this.vendorsList = res.vendors),
        error: () =>
          this.appNotificationService.push(
            this.translateService.instant('tr_unexpected_error_message'),
            'error'
          ),
      })
    );
  }

  getPurchasingRequest() {
    this.purchasingService.getPurchasingRequest(this.purchasingRequestId).subscribe({
      next: (response: any) => {
        this.lastPaymentTerm = response.paymentStatus;
        this.purchasingForm.form.patchValue(response);
        if (response.installments?.length) {
          this.installments = response.installments.map((inst: any) => ({
            ...inst,
            dueDate: inst.dueDate ? new Date(inst.dueDate) : null,
          }));
          const first = this.installments[0]?.dueDate;
          if (first instanceof Date && !isNaN(first.getTime())) {
            this.installmentScheduleStart = first;
          }
        }
        this.selectedPaymentTerm = response.paymentStatus;
        this.selectedVendor = response.supplier;
        this.formReadyForInstallmentSuggestions = true;
      },
      error: () =>
        this.appNotificationService.push(
          this.translateService.instant('tr_unexpected_error_message'),
          'error'
        ),
    });
  }

  buildPayload() {
    const formValue = this.purchasingForm.value;
    const payload: any = {
      supplier: this.selectedVendor?._id,
      paymentStatus: this.selectedPaymentTerm,
      requestDate: formValue.requestDate,
      requestedBy: formValue.requestedBy,
      totalAmount: formValue.totalAmount,
      status: formValue.status,
      notes: formValue.notes || '',
    };

    if (this.selectedPaymentTerm === 'Installments') {
      payload.installments = this.installments.map((inst) => ({
        dueDate:
          inst.dueDate instanceof Date
            ? inst.dueDate.toISOString()
            : inst.dueDate
            ? new Date(inst.dueDate).toISOString()
            : inst.dueDate,
        amount: Number(inst.amount),
        paid: !!inst.paid,
      }));
    }

    return payload;
  }

  private installmentsReadyForSubmit(): boolean {
    if (this.selectedPaymentTerm !== 'Installments') {
      return true;
    }
    if (!this.installments.length) {
      this.appNotificationService.push(
        this.translateService.instant('tr_installments_list_required'),
        'error'
      );
      return false;
    }
    for (const inst of this.installments) {
      const hasDate = inst.dueDate instanceof Date ? !isNaN(inst.dueDate.getTime()) : !!inst.dueDate;
      if (!hasDate) {
        this.appNotificationService.push(
          this.translateService.instant('tr_installments_dates_required'),
          'error'
        );
        return false;
      }
      const amt = Number(inst.amount);
      if (!Number.isFinite(amt) || amt < 0) {
        this.appNotificationService.push(
          this.translateService.instant('tr_installments_amounts_required'),
          'error'
        );
        return false;
      }
    }
    return true;
  }

  createPurchasingRequest() {
    if (!this.purchasingForm.valid) return;
    if (!this.installmentsReadyForSubmit()) return;

    const payload = this.buildPayload();

    this.purchasingService.createPurchasingRequest(payload).subscribe({
      next: () => {
        this.appNotificationService.push(
          this.translateService.instant('tr_success_create_purchasing_request'),
          'success'
        );
        this.closeModal(true);
      },
      error: (error) =>
        this.appNotificationService.push(
          error?.error?.message || this.translateService.instant('tr_unexpected_error_message'),
          'error'
        ),
    });
  }

  updatePurchasingRequest() {
    if (!this.purchasingForm.valid) return;
    if (!this.installmentsReadyForSubmit()) return;

    const payload = this.buildPayload();

    this.purchasingService.updatePurchasingRequest(this.purchasingRequestId, payload).subscribe({
      next: () => {
        this.appNotificationService.push(
          this.translateService.instant('tr_success_update_purchasing_request'),
          'success'
        );
        this.closeModal(true);
      },
      error: (error) =>
        this.appNotificationService.push(
          error?.error?.message || this.translateService.instant('tr_unexpected_error_message'),
          'error'
        ),
    });
  }

  addInstallment() {
    this.installments.push({ dueDate: null, amount: '', paid: false });
  }

  removeInstallment(index: number) {
    this.installments.splice(index, 1);
  }

  /** Advance `d` by one schedule period (clone). */
  private addOnePeriod(d: Date, period: InstallmentSchedulePeriod): Date {
    const next = new Date(d.getTime());
    switch (period) {
      case 'weekly':
        next.setDate(next.getDate() + 7);
        break;
      case 'biweekly':
        next.setDate(next.getDate() + 14);
        break;
      case 'monthly':
        next.setMonth(next.getMonth() + 1);
        break;
      case 'quarterly':
        next.setMonth(next.getMonth() + 3);
        break;
      default:
        next.setMonth(next.getMonth() + 1);
    }
    return next;
  }

  /**
   * Builds rows from total amount + period + count + start date.
   * @param silentNoTotal If true, missing/invalid total does nothing (no toast) — for auto-suggestions.
   */
  generateInstallmentSchedule(opts?: { silentNoTotal?: boolean }): void {
    const rawTotal = this.purchasingForm?.value?.totalAmount;
    const total = Number(rawTotal);
    if (!Number.isFinite(total) || total <= 0) {
      if (!opts?.silentNoTotal) {
        this.appNotificationService.push(
          this.translateService.instant('tr_installment_generate_need_total'),
          'error'
        );
      }
      return;
    }

    const n = Math.max(1, Math.floor(Number(this.installmentScheduleCount)) || 1);
    this.installmentScheduleCount = n;

    let start: Date;
    if (this.installmentScheduleStart instanceof Date && !isNaN(this.installmentScheduleStart.getTime())) {
      start = new Date(this.installmentScheduleStart.getTime());
    } else {
      const rd = this.purchasingForm?.value?.requestDate;
      if (rd instanceof Date && !isNaN(rd.getTime())) {
        start = new Date(rd.getTime());
      } else if (rd) {
        start = new Date(rd);
      } else {
        start = new Date();
      }
      start.setHours(12, 0, 0, 0);
      this.installmentScheduleStart = start;
    }

    const totalCents = Math.round(total * 100);
    const baseCents = Math.floor(totalCents / n);
    const remainder = totalCents - baseCents * n;

    const rows: { dueDate: Date; amount: number; paid: boolean }[] = [];
    let cursor = new Date(start.getTime());
    cursor.setHours(12, 0, 0, 0);

    for (let i = 0; i < n; i++) {
      const cents = i === n - 1 ? baseCents + remainder : baseCents;
      rows.push({
        dueDate: new Date(cursor.getTime()),
        amount: cents / 100,
        paid: false,
      });
      if (i < n - 1) {
        cursor = this.addOnePeriod(cursor, this.installmentSchedulePeriod);
      }
    }

    this.installments = rows;
  }

  /** Auto-fill when user picks Installments, changes total, or adjusts period/count/start (after form is ready). */
  private refreshInstallmentSuggestions(): void {
    if (!this.formReadyForInstallmentSuggestions || this.selectedPaymentTerm !== 'Installments') {
      return;
    }
    this.generateInstallmentSchedule({ silentNoTotal: true });
  }

  onPaymentTermChange(): void {
    const t = this.selectedPaymentTerm;
    if (!this.formReadyForInstallmentSuggestions) {
      this.lastPaymentTerm = t;
      return;
    }
    if (t === 'Installments' && this.lastPaymentTerm !== 'Installments') {
      this.refreshInstallmentSuggestions();
    }
    this.lastPaymentTerm = t;
  }

  onTotalAmountBlur(): void {
    this.refreshInstallmentSuggestions();
  }

  onInstallmentScheduleControlsChange(): void {
    this.refreshInstallmentSuggestions();
  }

  onRequestDatePicked(d: Date | null): void {
    if (
      this.selectedPaymentTerm === 'Installments' &&
      !this.installmentScheduleStart &&
      d instanceof Date &&
      !isNaN(d.getTime())
    ) {
      const copy = new Date(d.getTime());
      copy.setHours(12, 0, 0, 0);
      this.installmentScheduleStart = copy;
    }
    if (this.selectedPaymentTerm === 'Installments') {
      this.refreshInstallmentSuggestions();
    }
  }

  submitForm() {
    this.isEdit ? this.updatePurchasingRequest() : this.createPurchasingRequest();
  }

  closeModal(isSubmit?: boolean) {
    this.dialogRef.close(isSubmit);
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(sub => sub.unsubscribe());
  }
}

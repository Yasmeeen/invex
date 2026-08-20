import { Component, Inject, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { Branch, Order } from '@core/models/products.model';
import {
  countUnpaidSaleInstallments,
  orderDisplayPaid,
  orderDisplayRemaining,
  orderHasInstallmentSchedule,
} from '@core/utils/order-display.util';
import { AuthenticationService } from '@core/services/authentication.service';
import { resolveActorBranchContext } from '@core/utils/branch-utils';
import { TranslateService } from '@ngx-translate/core';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { BranchesServce } from '@shared/services/branches.service';
import { OrdersSerivce } from '@shared/services/orders.service';
import {
  PaymentSplitsDialogComponent,
  PaymentSplitsDialogData,
} from '@shared/components/payment-splits-dialog/payment-splits-dialog.component';
import { InvoiceReprintService } from '@shared/services/invoice-reprint.service';
import {
  PaymentSplitsResult,
  paymentSplitsNetTotal,
  round2,
} from '@shared/utils/payment-app-fee.util';

export type PayOrderDialogData = {
  order: Order;
  forcedBranchId?: string | null;
  /** Prefill / lock to a specific installment row. */
  installmentId?: string | null;
};

function orderBranchId(order: Order | null | undefined): string {
  const b = order?.branch as { _id?: string } | string | undefined;
  if (typeof b === 'string') return String(b).trim();
  if (b?._id) return String(b._id).trim();
  return '';
}

interface UnpaidInstallmentOption {
  id: string;
  sequence: number;
  dueDate?: string;
  remaining: number;
  label: string;
}

@Component({
  selector: 'app-pay-order-dialog',
  templateUrl: './pay-order-dialog.component.html',
  styleUrls: ['./pay-order-dialog.component.scss'],
})
export class PayOrderDialogComponent implements OnInit {
  form: FormGroup;
  saving = false;
  readonly order: Order;
  branches: Branch[] = [];
  showBranchPicker = false;
  printReceipt = true;
  private paymentBranchId: string | null = null;
  confirmedPayment: PaymentSplitsResult | null = null;

  hasInstallmentSchedule = false;
  unpaidInstallments: UnpaidInstallmentOption[] = [];
  selectedInstallmentId = '';

  constructor(
    private fb: FormBuilder,
    private orders: OrdersSerivce,
    private auth: AuthenticationService,
    private branchesService: BranchesServce,
    private translate: TranslateService,
    private notify: AppNotificationService,
    private dialog: MatDialog,
    private invoiceReprint: InvoiceReprintService,
    private ref: MatDialogRef<PayOrderDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) data: PayOrderDialogData
  ) {
    this.order = data.order;
    const actor = this.auth.getUserFromLocalStorage();
    const ctx = resolveActorBranchContext(actor, data.forcedBranchId);
    this.paymentBranchId = ctx.branchId;
    this.showBranchPicker = ctx.showBranchPicker;

    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');

    const defaultBranch =
      ctx.branchId || (this.showBranchPicker ? orderBranchId(this.order) : '') || '';

    this.form = this.fb.group({
      branchId: [defaultBranch, this.showBranchPicker ? Validators.required : []],
      paidAt: [`${yyyy}-${mm}-${dd}`, [Validators.required]],
      note: ['', Validators.maxLength(500)],
    });

    this.hasInstallmentSchedule = orderHasInstallmentSchedule(this.order);
    this.unpaidInstallments = this.buildUnpaidInstallments();
    if (data.installmentId) {
      this.selectedInstallmentId = String(data.installmentId);
    } else if (this.unpaidInstallments.length) {
      this.selectedInstallmentId = this.unpaidInstallments[0].id;
    }
  }

  ngOnInit(): void {
    if (this.showBranchPicker) {
      this.branchesService.getBranchs({ page: 1, limit: 1000 }).subscribe({
        next: (res: any) => {
          this.branches = res?.branches || [];
          if (this.form.get('branchId')?.value) {
            this.paymentBranchId = String(this.form.get('branchId')?.value);
            return;
          }
          const fromOrder = orderBranchId(this.order);
          const preferred =
            (fromOrder && this.branches.some((b) => String(b._id) === fromOrder)
              ? fromOrder
              : '') ||
            this.branches[0]?._id ||
            '';
          if (preferred) {
            this.form.patchValue({ branchId: preferred });
            this.paymentBranchId = String(preferred);
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

  private buildUnpaidInstallments(): UnpaidInstallmentOption[] {
    const rows = this.order?.installments || [];
    return rows
      .map((r) => {
        const amount = round2(Number(r.amount) || 0);
        const paidAmount = round2(Number(r.paidAmount) || 0);
        const remaining = r.paid ? 0 : Math.max(0, round2(amount - paidAmount));
        return {
          id: String(r._id || ''),
          sequence: Number(r.sequence) || 0,
          dueDate: r.dueDate,
          remaining,
          label: '',
        };
      })
      .filter((r) => r.id && r.remaining > 0.001)
      .map((r) => ({
        ...r,
        label: this.translate.instant('tr_installment_option_label', {
          n: r.sequence,
          amount: r.remaining.toFixed(2),
        }),
      }));
  }

  get remaining(): number {
    const selected = this.selectedInstallment();
    if (selected) {
      return Math.min(selected.remaining, orderDisplayRemaining(this.order));
    }
    return orderDisplayRemaining(this.order);
  }

  selectedInstallment(): UnpaidInstallmentOption | undefined {
    if (!this.selectedInstallmentId) return undefined;
    return this.unpaidInstallments.find((r) => r.id === this.selectedInstallmentId);
  }

  onInstallmentChange(): void {
    this.confirmedPayment = null;
  }

  displayPaid(): number {
    return orderDisplayPaid(this.order);
  }

  unpaidInstallmentsCount(): number {
    return countUnpaidSaleInstallments(this.order?.installments);
  }

  paymentSummaryText(): string {
    if (!this.confirmedPayment) {
      return '';
    }
    const methods = this.confirmedPayment.paymentSplits.filter((s) => s.amount > 0).length;
    const total = paymentSplitsNetTotal(this.confirmedPayment.paymentSplits);
    return this.translate.instant('tr_payment_splits_summary', { count: methods, total });
  }

  openPaymentSplitsDialog(): void {
    const data: PaymentSplitsDialogData = {
      invoiceNetTotal: this.remaining,
      mode: 'installment',
      initialState: this.confirmedPayment
        ? {
            selectedPayMethods: this.confirmedPayment.paymentSplits.map((s) => s.method),
            payAmounts: this.confirmedPayment.paymentSplits.reduce(
              (acc, s) => {
                acc[s.method] = s.amount;
                return acc;
              },
              {} as Record<string, number>
            ),
            feeSources: this.confirmedPayment.feeAllocations.map((f) => ({
              forMethod: f.forMethod,
              paidVia: f.paidVia === f.forMethod ? 'same' : f.paidVia,
            })),
          }
        : undefined,
    };

    this.dialog
      .open(PaymentSplitsDialogComponent, {
        width: '560px',
        maxWidth: '95vw',
        panelClass: 'payment-splits-dialog-panel',
        backdropClass: 'payment-splits-dialog-backdrop',
        data,
      })
      .afterClosed()
      .subscribe((result: PaymentSplitsResult | null) => {
        if (result) {
          this.confirmedPayment = result;
        }
      });
  }

  submit(): void {
    if (this.saving) {
      return;
    }
    if (this.showBranchPicker) {
      this.form.get('branchId')?.enable();
    }
    this.form.markAllAsTouched();
    if (!this.form.valid) {
      return;
    }

    if (!this.confirmedPayment) {
      this.openPaymentSplitsDialog();
      return;
    }

    const branchId = String(
      this.form.getRawValue().branchId || this.paymentBranchId || ''
    ).trim();
    if (!branchId) {
      this.notify.push(this.translate.instant('tr_branch_required'), 'error');
      return;
    }

    this.postPayment(this.confirmedPayment, branchId);
  }

  private postPayment(payment: PaymentSplitsResult, branchId: string): void {
    const orderId = this.order._id;
    if (!orderId) {
      return;
    }

    const splits = payment.paymentSplits.filter((s) => s.amount > 0);
    const netTotal = paymentSplitsNetTotal(splits);
    if (netTotal <= 0) {
      this.notify.push(this.translate.instant('tr_vendor_deferred_amount_required'), 'error');
      return;
    }
    if (netTotal > this.remaining + 0.001) {
      this.notify.push(this.translate.instant('tr_vendor_deferred_payment_over'), 'error');
      return;
    }

    const v = this.form.getRawValue();
    const paidAt = String(v.paidAt || '').trim();
    const note = String(v.note || '').trim();
    const u = this.auth.getUserFromLocalStorage();

    this.saving = true;
    this.orders
      .addPayment(String(orderId), {
        amount: netTotal,
        paymentSplits: splits,
        paymentFeeAllocations: payment.feeAllocations,
        paidAt,
        userId: u?._id,
        note,
        branchId,
        ...(this.selectedInstallmentId
          ? { installmentId: this.selectedInstallmentId }
          : {}),
      })
      .subscribe({
        next: (res: any) => {
          this.notify.push(this.translate.instant('tr_payment_added'), 'success');
          if (this.printReceipt) {
            this.printPaymentReceipt(
              String(orderId),
              res?.order,
              netTotal,
              splits,
              paidAt,
              Number(res?.remainingInstallments)
            );
          } else {
            this.saving = false;
            this.ref.close(true);
          }
        },
        error: (err) => {
          this.saving = false;
          const msg =
            err?.error?.error ||
            err?.error?.message ||
            this.translate.instant('tr_unexpected_error_message');
          this.notify.push(msg, 'error');
        },
      });
  }

  private printPaymentReceipt(
    orderId: string,
    fallback: any,
    paidNow: number,
    payments: Array<{ method?: string; amount: number }>,
    paidAt: string,
    remainingInstallmentsFromApi?: number
  ): void {
    const remainingAfter = Math.max(
      0,
      Math.round((orderDisplayRemaining(this.order) - paidNow) * 100) / 100
    );
    const unwrapOrder = (raw: any) =>
      raw?.products || raw?.orderNumber != null ? raw : raw?.order || raw;

    const printAndClose = (order: any) => {
      this.saving = false;
      const source = unwrapOrder(order) || unwrapOrder(fallback) || this.order;
      const merged = {
        ...(this.order || {}),
        ...(source || {}),
        products:
          (source?.products?.length ? source.products : null) || this.order?.products || [],
        installments: source?.installments || this.order?.installments,
      };
      const remainingInstallments =
        Number.isFinite(remainingInstallmentsFromApi)
          ? remainingInstallmentsFromApi
          : countUnpaidSaleInstallments(merged.installments);
      this.invoiceReprint.printPayment({
        order: merged,
        paidNow,
        remainingAfter,
        payments,
        paidAt,
        remainingInstallments,
      });
      this.ref.close(true);
    };

    this.orders.getOrder(orderId).subscribe({
      next: (full: any) => printAndClose(full || fallback),
      error: () => printAndClose(fallback),
    });
  }

  close(): void {
    this.ref.close(false);
  }
}

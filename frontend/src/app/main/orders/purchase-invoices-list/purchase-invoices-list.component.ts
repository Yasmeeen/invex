import { Component, OnInit } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { PaginationData } from '@core/models/users-interfaces.model';
import { Branch } from '@core/models/products.model';
import { AuthenticationService } from '@core/services/authentication.service';
import { formatCairoDMY, formatCairoYMD } from '@core/utils/date-tz.util';
import { TranslateService } from '@ngx-translate/core';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { BranchesServce } from '@shared/services/branches.service';
import { ProductPurchaseRequestsService } from '@shared/services/product-purchase-requests.service';
import {
  ProductPurchaseApprovalDialogComponent,
} from '@shared/components/product-purchase-approval-dialog/product-purchase-approval-dialog.component';
import { normalizeMongoId } from '@core/utils/mongo-id.util';
import { DeskPurchaseDeferredPaymentDialogComponent } from '../desk-purchase-deferred-payment-dialog/desk-purchase-deferred-payment-dialog.component';
import { InvoiceReturnDialogComponent } from '../invoice-return-dialog/invoice-return-dialog.component';
import { InvoiceReturnDetailsDialogComponent } from '../invoice-return-details-dialog/invoice-return-details-dialog.component';
import { InvoiceReprintService } from '@shared/services/invoice-reprint.service';
import { canReturnPurchase as canReturnPurchaseCheck, hasPurchaseReturns } from '@core/utils/order-display.util';

const DEFERRED_KEY = 'deferred';

@Component({
  selector: 'app-purchase-invoices-list',
  templateUrl: './purchase-invoices-list.component.html',
  styleUrls: ['./purchase-invoices-list.component.scss'],
})
export class PurchaseInvoicesListComponent implements OnInit {
  loading = true;
  isFilterOpen = true;
  purchasesList: any[] = [];
  paginationPerPage = 10;
  params: { page: number; limit: number; status?: string; branchId?: string } = {
    page: 1,
    limit: this.paginationPerPage,
  };
  paginationData: PaginationData;
  searchTerm = '';
  searchTimeout: any;
  selectedStatus: string | null = null;
  selectedBranchId: string | null = null;
  listFromDate: Date | null = null;
  listToDate: Date | null = null;
  branches: Branch[] = [];
  curentUser: any;
  viewMode: 'table' | 'cards' = 'table';

  readonly statusOptions = [
    { value: null, labelKey: 'tr_all' },
    { value: 'approved', labelKey: 'tr_purchase_invoice_status_approved' },
    { value: 'pending', labelKey: 'tr_purchase_invoice_status_pending' },
    { value: 'rejected', labelKey: 'tr_purchase_invoice_status_rejected' },
  ];

  constructor(
    private api: ProductPurchaseRequestsService,
    private auth: AuthenticationService,
    private branchesService: BranchesServce,
    private translate: TranslateService,
    private notify: AppNotificationService,
    private dialog: MatDialog,
    private invoiceReprint: InvoiceReprintService
  ) {}

  ngOnInit(): void {
    const saved = localStorage.getItem('purchase-invoices.viewMode');
    this.viewMode = saved === 'cards' ? 'cards' : 'table';
    this.curentUser = this.auth.getUserFromLocalStorage();
    this.getBranches();
    this.loadPurchases();
  }

  setViewMode(mode: 'table' | 'cards'): void {
    this.viewMode = mode;
    localStorage.setItem('purchase-invoices.viewMode', mode);
  }

  getBranches(): void {
    this.branchesService.getBranchs({ page: 1, limit: 1000 }).subscribe({
      next: (res: any) => {
        this.branches = res?.branches || [];
      },
    });
  }

  loadPurchases(): void {
    const q: Record<string, string | number> = {
      page: this.params.page,
      limit: this.params.limit,
    };
    if (this.selectedStatus) {
      q.status = this.selectedStatus;
    }
    const branchId = this.resolveBranchId();
    if (branchId) {
      q.branchId = branchId;
    }
    if (this.listFromDate) {
      q.from = formatCairoYMD(this.listFromDate);
    }
    if (this.listToDate) {
      q.to = formatCairoYMD(this.listToDate);
    }

    this.loading = true;
    this.api.list(q as any).subscribe({
      next: (res: any) => {
        let items = res?.purchases || [];
        const term = String(this.searchTerm || '').trim().toLowerCase();
        if (term) {
          items = items.filter((p: any) => this.matchesSearch(p, term));
        }
        this.purchasesList = items;
        const total = Number(res?.meta?.totalCount) || 0;
        const page = Number(res?.meta?.page) || 1;
        const limit = Number(res?.meta?.limit) || this.paginationPerPage;
        this.paginationData = {
          currentPage: page,
          nextPage: page < Math.ceil(total / limit) ? page + 1 : page,
          prevPage: page > 1 ? page - 1 : 1,
          totalCount: total,
          totalPages: Math.max(1, Math.ceil(total / limit)),
        };
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.notify.push(this.translate.instant('tr_unexpected_error_message'), 'error');
      },
    });
  }

  private resolveBranchId(): string | null {
    const role = this.curentUser?.role;
    if (role === 'Cashier' || role === 'Branch Manager') {
      const b = this.curentUser?.branch?._id || this.curentUser?.branch;
      return b ? String(b) : null;
    }
    return this.selectedBranchId ? String(this.selectedBranchId) : null;
  }

  private matchesSearch(p: any, term: string): boolean {
    const pp = p?.productPayload || {};
    const code = String(pp.code || '').toLowerCase();
    const name = String(pp.name || '').toLowerCase();
    const party = String(pp.acquiredFrom?.displayName || pp.acquiredFrom?.name || '').toLowerCase();
    const phone = String(pp.acquiredFrom?.phone || '').toLowerCase();
    const id = String(p?._id || '').toLowerCase();
    return (
      code.includes(term) ||
      name.includes(term) ||
      party.includes(term) ||
      phone.includes(term) ||
      id.includes(term)
    );
  }

  lineTotal(p: any): number {
    const q = Math.max(1, Math.floor(Number(p?.quantity) || 1));
    const net = Number(p?.productPayload?.netPrice) || 0;
    return Math.round(net * q * 100) / 100;
  }

  hasDeferredTreasury(p: any): boolean {
    const splits = Array.isArray(p?.purchaseTreasurySplits) ? p.purchaseTreasurySplits : [];
    if (splits.some((s: any) => String(s?.key || '').toLowerCase() === DEFERRED_KEY)) {
      return true;
    }
    return String(p?.purchaseTreasuryKey || '').toLowerCase() === DEFERRED_KEY;
  }

  deferredAmount(p: any): number {
    const splits = Array.isArray(p?.purchaseTreasurySplits) ? p.purchaseTreasurySplits : [];
    const def = splits.filter((s: any) => String(s?.key || '').toLowerCase() === DEFERRED_KEY);
    if (def.length) {
      return Math.round(def.reduce((a: number, s: any) => a + (Number(s?.amount) || 0), 0) * 100) / 100;
    }
    if (this.hasDeferredTreasury(p)) {
      return this.lineTotal(p);
    }
    return 0;
  }

  totalPaid(p: any): number {
    if (!this.hasDeferredTreasury(p)) {
      return p?.status === 'approved' ? this.lineTotal(p) : 0;
    }
    if (p?.status !== 'approved') {
      return 0;
    }
    const remaining = this.remaining(p);
    return Math.round((this.deferredAmount(p) - remaining) * 100) / 100;
  }

  remaining(p: any): number {
    if (!this.hasDeferredTreasury(p) || p?.status !== 'approved') {
      return 0;
    }
    const paid = Number(p?.amountPaid) || 0;
    return Math.max(0, Math.round((this.deferredAmount(p) - paid) * 100) / 100);
  }

  isDeferredPurchase(p: any): boolean {
    return this.hasDeferredTreasury(p);
  }

  partyTypeLabel(p: any): string {
    const t = String(p?.productPayload?.acquiredFrom?.partyType || 'client').toLowerCase();
    return t === 'supplier'
      ? this.translate.instant('tr_party_supplier')
      : this.translate.instant('tr_party_client');
  }

  partyNameRaw(p: any): string {
    const af = p?.productPayload?.acquiredFrom;
    return String(af?.displayName || af?.name || af?.phone || '').trim();
  }

  partyName(p: any): string {
    return this.partyNameRaw(p) || '—';
  }

  treasuryDisplay(p: any): string {
    const splits = Array.isArray(p?.purchaseTreasurySplits) ? p.purchaseTreasurySplits : [];
    if (splits.length > 1) {
      return splits
        .map((s: any) => {
          const name = String(s?.label || s?.key || '').trim();
          const amt = Number(s?.amount);
          return `${name}: ${Number.isFinite(amt) ? amt : 0}`;
        })
        .join(' · ');
    }
    const label = String(p?.purchaseTreasuryLabel || '').trim();
    const key = String(p?.purchaseTreasuryKey || '').trim();
    return label || key || '—';
  }

  purchaseRef(p: any): string {
    const id = normalizeMongoId(p?._id);
    if (!id) return '—';
    const s = String(id);
    return s.length > 10 ? s.slice(-10).toUpperCase() : s.toUpperCase();
  }

  statusLabel(status: string): string {
    const s = String(status || '').toLowerCase();
    if (s === 'approved') {
      return this.translate.instant('tr_purchase_invoice_status_approved');
    }
    if (s === 'partially_returned') {
      return this.translate.instant('tr_purchase_invoice_status_partially_returned');
    }
    if (s === 'returned') {
      return this.translate.instant('tr_purchase_invoice_status_returned');
    }
    if (s === 'pending') {
      return this.translate.instant('tr_purchase_invoice_status_pending');
    }
    if (s === 'rejected') {
      return this.translate.instant('tr_purchase_invoice_status_rejected');
    }
    return status || '—';
  }

  createdAtDisplay(p: any): string {
    return formatCairoDMY(p?.createdAt);
  }

  filterPurchases(term: any): void {
    clearTimeout(this.searchTimeout);
    this.searchTimeout = setTimeout(() => {
      this.searchTerm = String(term?.target?.value ?? term ?? '').trim();
      this.params.page = 1;
      this.loadPurchases();
    }, 400);
  }

  onStatusChange(): void {
    this.params.page = 1;
    this.loadPurchases();
  }

  onBranchChange(): void {
    this.params.page = 1;
    this.loadPurchases();
  }

  onListDateFilterChange(): void {
    this.params.page = 1;
    this.loadPurchases();
  }

  clearListDateFilters(): void {
    this.listFromDate = null;
    this.listToDate = null;
    this.onListDateFilterChange();
  }

  get hasListDateFilterToClear(): boolean {
    return this.listFromDate != null || this.listToDate != null;
  }

  paginationUpdate(page: number): void {
    this.params.page = page;
    this.loadPurchases();
  }

  canPayDeferredPurchase(p: any): boolean {
    return (
      p?.status === 'approved' &&
      this.isDeferredPurchase(p) &&
      this.remaining(p) > 0.005
    );
  }

  openPayDeferredPurchase(p: any): void {
    const id = normalizeMongoId(p?._id);
    if (!id) return;
    const branchId = this.resolveBranchId();
    const ref = this.dialog.open(DeskPurchaseDeferredPaymentDialogComponent, {
      width: '520px',
      maxWidth: '96vw',
      panelClass: 'vendor-deferred-payment-dialog-panel',
      backdropClass: 'vendor-deferred-payment-dialog-backdrop',
      data: {
        purchaseId: id,
        remaining: this.remaining(p),
        partyTypeLabel: this.partyTypeLabel(p),
        partyName: this.partyNameRaw(p),
        productName: String(p?.productPayload?.name || '').trim(),
        requestDate: p?.createdAt,
        forcedBranchId: branchId,
      },
      disableClose: true,
    });
    ref.afterClosed().subscribe((ok) => {
      if (ok) {
        this.loadPurchases();
      }
    });
  }

  openPurchaseReturn(p: any): void {
    const id = normalizeMongoId(p?._id);
    if (!id) return;
    this.api.getById(id, this.auth.getUserFromLocalStorage()?._id).subscribe({
      next: (res: any) => {
        const fresh = res?.purchase || res;
        if (!this.canReturnPurchase(fresh)) {
          this.loadPurchases();
          return;
        }
        this.openPurchaseReturnDialog(fresh);
      },
      error: () => {
        this.notify.push(this.translate.instant('tr_unexpected_error_message'), 'error');
      },
    });
  }

  openPurchaseReturnDialog(p: any): void {
    const branchId = this.resolveBranchId();
    const ref = this.dialog.open(InvoiceReturnDialogComponent, {
      width: '720px',
      maxWidth: '96vw',
      panelClass: 'invoice-return-dialog-panel',
      backdropClass: 'invoice-return-dialog-backdrop',
      data: {
        mode: 'purchase',
        purchase: p,
        forcedBranchId: branchId,
      },
      disableClose: true,
    });
    ref.afterClosed().subscribe((ok) => {
      if (ok) {
        this.loadPurchases();
      }
    });
  }

  hasReturnDetails(p: any): boolean {
    return hasPurchaseReturns(p);
  }

  openPurchaseReturnDetails(p: any): void {
    const id = normalizeMongoId(p?._id);
    if (!id) return;
    const open = (doc: any) => {
      this.dialog.open(InvoiceReturnDetailsDialogComponent, {
        width: '640px',
        maxWidth: '96vw',
        panelClass: 'invoice-return-dialog-panel',
        backdropClass: 'invoice-return-dialog-backdrop',
        data: { mode: 'purchase', purchase: doc },
      });
    };
    if (hasPurchaseReturns(p) && p.returns?.length) {
      open(p);
      return;
    }
    this.api.getById(id, this.auth.getUserFromLocalStorage()?._id).subscribe({
      next: (res: any) => open(res?.purchase || res),
      error: () => {
        this.notify.push(this.translate.instant('tr_unexpected_error_message'), 'error');
      },
    });
  }

  canReturnPurchase(p: any): boolean {
    return canReturnPurchaseCheck(p);
  }

  canPrintPurchase(p: any): boolean {
    const s = String(p?.status || '').toLowerCase();
    return s === 'approved' || s === 'partially_returned' || s === 'returned';
  }

  printPurchase(p: any): void {
    if (!this.canPrintPurchase(p)) {
      return;
    }
    this.invoiceReprint.printPurchase(p);
  }

  openPurchaseDetail(p: any): void {
    const id = normalizeMongoId(p?._id);
    if (!id) return;
    this.dialog.open(ProductPurchaseApprovalDialogComponent, {
      width: '720px',
      maxWidth: '96vw',
      data: { purchaseId: id, body: '', data: null },
    });
  }
}

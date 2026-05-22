import { Component, OnInit } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { PaginationData } from '@core/models/users-interfaces.model';
import { Branch } from '@core/models/products.model';
import { AuthenticationService } from '@core/services/authentication.service';
import { formatCairoDMY } from '@core/utils/date-tz.util';
import { TranslateService } from '@ngx-translate/core';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { BranchesServce } from '@shared/services/branches.service';
import { ProductPurchaseRequestsService } from '@shared/services/product-purchase-requests.service';
import {
  ProductPurchaseApprovalDialogComponent,
} from '@shared/components/product-purchase-approval-dialog/product-purchase-approval-dialog.component';
import { normalizeMongoId } from '@core/utils/mongo-id.util';

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
    private dialog: MatDialog
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

  partyName(p: any): string {
    const af = p?.productPayload?.acquiredFrom;
    return String(af?.displayName || af?.name || af?.phone || '').trim() || '—';
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

  paginationUpdate(page: number): void {
    this.params.page = page;
    this.loadPurchases();
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

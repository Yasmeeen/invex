import { Component, OnInit } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Globals } from '@core/globals';
import { Client, PaginationData } from '@core/models/users-interfaces.model';
import { AuthenticationService } from '@core/services/authentication.service';
import { resolveActorBranchContext } from '@core/utils/branch-utils';
import { Router } from '@angular/router';
import { ClientDepositDialogComponent } from '../client-deposit-dialog/client-deposit-dialog.component';
import { CreateEditClientComponent } from '../create-edit-client/create-edit-client.component';
import { TranslateService } from '@ngx-translate/core';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { UserSerivce } from '@shared/services/user.service';
import {
  InstallmentPlan,
  InstallmentPlansService,
} from '@shared/services/installment-plans.service';
import { Subscription } from 'rxjs';
import { isBranchManager, isBranchlessUserRole } from '@core/utils/role-utils';

@Component({
  selector: 'app-client-list',
  templateUrl: './client-list.component.html',
  styleUrls: ['./client-list.component.scss']
})
export class ClientListComponent implements OnInit {

  clientsList: Client[] = [];
  clientsLoading = true;
  isFilterOpen = true;
  isNotAuthorized = false;
  nameSearchTerm: string = '';
  phoneSearchTerm: string = '';
  lastInstallmentAmountTerm: string = '';
  installmentSaleNumberTerm: string = '';
  selectedInstallmentPlanId: string | null = null;
  installmentPlans: InstallmentPlan[] = [];
  balanceSideFilter: 'all' | 'debit' | 'credit' = 'all';
  balanceSideOptions = [
    { value: 'all', labelKey: 'tr_balance_filter_all' },
    { value: 'debit', labelKey: 'tr_balance_filter_debit' },
    { value: 'credit', labelKey: 'tr_balance_filter_credit' },
  ];
  installmentStatusFilter: 'all' | 'open' | 'settled' = 'all';
  installmentStatusOptions = [
    { value: 'all', labelKey: 'tr_installment_status_filter_all' },
    { value: 'open', labelKey: 'tr_installment_status_filter_open' },
    { value: 'settled', labelKey: 'tr_installment_status_filter_settled' },
  ];
  installmentDueFrom = '';
  installmentDueTo = '';
  paginationData: PaginationData;
  paginationPerPage = 10;
  viewMode: 'table' | 'cards' = 'cards';
  params: any = { page: 1, perPage: this.paginationPerPage };
  /** Expanded installment detail blocks on cards (key = client id). Missing → collapsed when multiple sales. */
  private installmentCardExpanded: Record<string, boolean> = {};
  private nameSearchTimeout: any;
  private phoneSearchTimeout: any;
  private amountTimeout: any;
  private installmentSaleNumberTimeout: any;
  private subscriptions: Subscription[] = [];

  constructor(
    private userSerivce: UserSerivce,
    private installmentPlansService: InstallmentPlansService,
    private dialog: MatDialog,
    private auth: AuthenticationService,
    private notificationService: AppNotificationService,
    private translate: TranslateService,
    private router: Router,
    public globals: Globals
  ) {}

  ngOnInit(): void {
    const saved = localStorage.getItem('clients.viewMode');
    this.viewMode = saved === 'table' ? 'table' : 'cards';
    if (isBranchManager(this.globals.currentUser?.role) && this.globals.currentUser?.branch?._id) {
      this.params.branch_id = this.globals.currentUser.branch._id;
    }
    this.loadInstallmentPlans();
    this.getClients();
  }

  private loadInstallmentPlans(): void {
    this.subscriptions.push(
      this.installmentPlansService.list(false).subscribe({
        next: (res) => {
          this.installmentPlans = res?.plans || [];
        },
        error: () => {
          this.installmentPlans = [];
        },
      })
    );
  }

  planLabel(plan: InstallmentPlan): string {
    if (!plan) return '';
    const months = plan.months != null ? ` (${plan.months})` : '';
    return `${plan.name || ''}${months}`.trim();
  }

  setViewMode(mode: 'table' | 'cards'): void {
    this.viewMode = mode;
    localStorage.setItem('clients.viewMode', mode);
  }

  getClients(): void {
    this.clientsLoading = true;
    this.subscriptions.push(
      this.userSerivce.getClients(this.params).subscribe(
        (response: any) => {
          this.clientsList = response.clients;
          this.paginationData = response.meta;
          this.clientsLoading = false;
        },
        (error:any) => {
          this.clientsLoading = false;
          this.isNotAuthorized = error.status === 403;
          if (!this.isNotAuthorized) {
            this.notificationService.push(this.translate.instant('tr_unexpected_error_message'), 'error');
          }
        }
      )
    );
  }

  filterClientsByName(event: any): void {
    clearTimeout(this.nameSearchTimeout);
    this.nameSearchTimeout = setTimeout(() => {
      const value = (event?.target?.value ?? this.nameSearchTerm ?? '').toString().trim();
      if (value) {
        this.params.name = value;
      } else {
        delete this.params.name;
      }
      this.params.page = 1;
      this.getClients();
    }, 500);
  }

  filterClientsByPhone(event: any): void {
    clearTimeout(this.phoneSearchTimeout);
    this.phoneSearchTimeout = setTimeout(() => {
      const value = (event?.target?.value ?? this.phoneSearchTerm ?? '').toString().trim();
      if (value) {
        this.params.search = value;
      } else {
        delete this.params.search;
      }
      this.params.page = 1;
      this.getClients();
    }, 500);
  }

  onBalanceSideFilterChange(value: 'all' | 'debit' | 'credit' | null): void {
    this.balanceSideFilter = value || 'all';
    if (this.balanceSideFilter === 'debit' || this.balanceSideFilter === 'credit') {
      this.params.balanceSide = this.balanceSideFilter;
    } else {
      delete this.params.balanceSide;
    }
    this.params.page = 1;
    this.getClients();
  }

  onInstallmentStatusFilterChange(value: 'all' | 'open' | 'settled' | null): void {
    this.installmentStatusFilter = value || 'all';
    if (this.installmentStatusFilter === 'open' || this.installmentStatusFilter === 'settled') {
      this.params.installmentStatus = this.installmentStatusFilter;
    } else {
      delete this.params.installmentStatus;
    }
    this.params.page = 1;
    this.getClients();
  }

  onInstallmentDueDateFilterChange(): void {
    const from = (this.installmentDueFrom || '').toString().trim();
    const to = (this.installmentDueTo || '').toString().trim();
    if (from) {
      this.params.installmentDueFrom = from;
    } else {
      delete this.params.installmentDueFrom;
    }
    if (to) {
      this.params.installmentDueTo = to;
    } else {
      delete this.params.installmentDueTo;
    }
    this.params.page = 1;
    this.getClients();
  }

  onInstallmentPlanFilterChange(planId: string | null): void {
    this.selectedInstallmentPlanId = planId || null;
    if (this.selectedInstallmentPlanId) {
      this.params.lastInstallmentPlanId = this.selectedInstallmentPlanId;
      const plan = this.installmentPlans.find((p) => p._id === this.selectedInstallmentPlanId);
      if (plan?.months != null) {
        this.params.lastInstallmentPlanMonths = plan.months;
      } else {
        delete this.params.lastInstallmentPlanMonths;
      }
    } else {
      delete this.params.lastInstallmentPlanId;
      delete this.params.lastInstallmentPlanMonths;
    }
    this.params.page = 1;
    this.getClients();
  }

  filterByLastInstallmentAmount(event: any): void {
    clearTimeout(this.amountTimeout);
    this.amountTimeout = setTimeout(() => {
      const raw = (event?.target?.value ?? this.lastInstallmentAmountTerm ?? '')
        .toString()
        .trim();
      if (raw === '') {
        delete this.params.lastInstallmentAmount;
      } else {
        const amount = Number(raw);
        if (!Number.isFinite(amount) || amount < 0) {
          return;
        }
        this.params.lastInstallmentAmount = amount;
      }
      this.params.page = 1;
      this.getClients();
    }, 500);
  }

  filterByInstallmentSaleNumber(event: any): void {
    clearTimeout(this.installmentSaleNumberTimeout);
    this.installmentSaleNumberTimeout = setTimeout(() => {
      const raw = (event?.target?.value ?? this.installmentSaleNumberTerm ?? '')
        .toString()
        .trim();
      if (raw === '') {
        delete this.params.installmentSaleNumber;
      } else {
        const n = Math.floor(Number(raw));
        if (!Number.isFinite(n) || n <= 0) {
          return;
        }
        this.params.installmentSaleNumber = n;
      }
      this.params.page = 1;
      this.getClients();
    }, 500);
  }

  clientInstallmentSaleNumbers(client: Client): number[] {
    const nums = client?.installmentSaleNumbers;
    if (!Array.isArray(nums) || !nums.length) return [];
    return nums
      .map((n) => Number(n))
      .filter((n) => Number.isFinite(n) && n > 0)
      .sort((a, b) => a - b);
  }

  /** Per-sale installment rows for the card/table (open sales first, then by sale #). */
  clientInstallmentSales(client: Client): NonNullable<Client['installmentSales']> {
    const rows = client?.installmentSales;
    if (!Array.isArray(rows) || !rows.length) return [];
    return [...rows].sort((a, b) => {
      const aOpen = a?.hasOpen ? 0 : 1;
      const bOpen = b?.hasOpen ? 0 : 1;
      if (aOpen !== bOpen) return aOpen - bOpen;
      const an = Number(a?.installmentSaleNumber) || 0;
      const bn = Number(b?.installmentSaleNumber) || 0;
      if (an && bn && an !== bn) return an - bn;
      return (Number(a?.orderNumber) || 0) - (Number(b?.orderNumber) || 0);
    });
  }

  clientOpenInstallmentSales(client: Client): NonNullable<Client['installmentSales']> {
    return this.clientInstallmentSales(client).filter(
      (s) => s?.hasOpen === true || (Number(s?.remainingAmount) || 0) > 0.001
    );
  }

  clientOpenInstallmentSalesCount(client: Client): number {
    return this.clientOpenInstallmentSales(client).length;
  }

  clientOpenInstallmentRemainingTotal(client: Client): number {
    const sales = this.clientOpenInstallmentSales(client);
    if (!sales.length) {
      return Math.round((Number(client?.installmentRemainingAmount) || 0) * 100) / 100;
    }
    const sum = sales.reduce((acc, s) => acc + (Number(s?.remainingAmount) || 0), 0);
    return Math.round(sum * 100) / 100;
  }

  private clientCardKey(client: Client): string {
    return String(client?._id || '').trim();
  }

  /** Multiple open installment sales → details collapsed by default. */
  shouldCollapseInstallmentCard(client: Client): boolean {
    return this.clientOpenInstallmentSalesCount(client) > 1;
  }

  isInstallmentCardExpanded(client: Client): boolean {
    if (!this.shouldCollapseInstallmentCard(client)) return true;
    const key = this.clientCardKey(client);
    if (!key) return false;
    return !!this.installmentCardExpanded[key];
  }

  toggleInstallmentCard(client: Client, event?: Event): void {
    event?.stopPropagation();
    if (!this.shouldCollapseInstallmentCard(client)) return;
    const key = this.clientCardKey(client);
    if (!key) return;
    this.installmentCardExpanded = {
      ...this.installmentCardExpanded,
      [key]: !this.isInstallmentCardExpanded(client),
    };
  }

  trackInstallmentSale(
    _index: number,
    sale: NonNullable<Client['installmentSales']>[number]
  ): string {
    return String(sale?.orderId || sale?.installmentSaleNumber || sale?.orderNumber || _index);
  }

  clientHasOpenInstallments(client: Client): boolean {
    if (!client) return false;
    if (client.hasOpenInstallments === true) return true;
    if (this.clientOpenInstallmentSales(client).length) return true;
    return (Number(client.installmentRemainingAmount) || 0) > 0.001;
  }

  clientNetBalanceText(client: Client): string {
    const net = client?.netBalanceMessage;
    if (!net) {
      return this.translate.instant('tr_balance_none');
    }
    if (net.who === 'even') {
      return this.translate.instant('tr_client_balance_even');
    }
    if (net.who === 'client') {
      return this.translate.instant('tr_client_owes_us_net', { amount: net.amount });
    }
    return this.translate.instant('tr_we_owe_client_net', { amount: net.amount });
  }

  paginationUpdate(page: number): void {
    this.params.page = page;
    this.getClients();
  }

  openClientHistory(client: Client): void {
    if (!client?._id) return;
    this.router.navigate(['/clients', client._id, 'history']);
  }

  createOrEditClient(isEdit: boolean, client?: Client): void {
    this.dialog
      .open(CreateEditClientComponent, {
        width: '820px',
        maxWidth: '96vw',
        data: { isEdit, client, clientId: client?._id },
        disableClose: true,
      })
      .afterClosed()
      .subscribe((saved) => {
        if (saved) {
          this.getClients();
        }
      });
  }

  createClient(): void {
    this.createOrEditClient(false);
  }

  openClientDeposit(client: Client): void {
    const actor = this.auth.getUserFromLocalStorage();
    // Branchless roles (admin, collector, …) pick the branch at payment time.
    const forcedBranchId = isBranchlessUserRole(actor?.role)
      ? null
      : this.globals.currentUser?.branch?._id;
    const ctx = resolveActorBranchContext(actor, forcedBranchId);
    this.dialog
      .open(ClientDepositDialogComponent, {
        width: '520px',
        maxWidth: '96vw',
        data: { client, forcedBranchId: ctx.branchId },
        disableClose: true,
      })
      .afterClosed()
      .subscribe((saved) => {
        if (saved) {
          this.getClients();
        }
      });
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(s => s && s.unsubscribe());
  }
}

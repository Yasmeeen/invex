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
  selectedInstallmentPlanId: string | null = null;
  installmentPlans: InstallmentPlan[] = [];
  balanceSideFilter: 'all' | 'debit' | 'credit' = 'all';
  balanceSideOptions = [
    { value: 'all', labelKey: 'tr_balance_filter_all' },
    { value: 'debit', labelKey: 'tr_balance_filter_debit' },
    { value: 'credit', labelKey: 'tr_balance_filter_credit' },
  ];
  paginationData: PaginationData;
  paginationPerPage = 10;
  viewMode: 'table' | 'cards' = 'cards';
  params: any = { page: 1, perPage: this.paginationPerPage };
  private nameSearchTimeout: any;
  private phoneSearchTimeout: any;
  private amountTimeout: any;
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

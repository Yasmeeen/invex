import { Component, OnInit } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Globals } from '@core/globals';
import { Client, PaginationData } from '@core/models/users-interfaces.model';
import { AuthenticationService } from '@core/services/authentication.service';
import { resolveActorBranchContext } from '@core/utils/branch-utils';
import { ClientHistoryDialogComponent } from '../client-history-dialog/client-history-dialog.component';
import { ClientDepositDialogComponent } from '../client-deposit-dialog/client-deposit-dialog.component';
import { CreateEditClientComponent } from '../create-edit-client/create-edit-client.component';
import { TranslateService } from '@ngx-translate/core';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { UserSerivce } from '@shared/services/user.service';
import { Subscription } from 'rxjs';
import { isBranchManager } from '@core/utils/role-utils';

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
  searchTerm: string = '';
  nameSearchTerm: string = '';
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
  private searchTimeout: any;
  private subscriptions: Subscription[] = [];

  constructor(
    private userSerivce: UserSerivce,
    private dialog: MatDialog,
    private auth: AuthenticationService,
    private notificationService: AppNotificationService,
    private translate: TranslateService,
    public globals: Globals
  ) {}

  ngOnInit(): void {
    const saved = localStorage.getItem('clients.viewMode');
    this.viewMode = saved === 'table' ? 'table' : 'cards';
    if (isBranchManager(this.globals.currentUser?.role) && this.globals.currentUser?.branch?._id) {
      this.params.branch_id = this.globals.currentUser.branch._id;
    }
    this.getClients();
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

  filterClients(event: any, key: string): void {
    clearTimeout(this.searchTimeout);
    this.searchTimeout = setTimeout(() => {
      this.params.search = event.target.value.trim();
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
    const actor = this.auth.getUserFromLocalStorage();
    const ctx = resolveActorBranchContext(actor, this.globals.currentUser?.branch?._id);
    this.dialog.open(ClientHistoryDialogComponent, {
      width: '960px',
      maxWidth: '96vw',
      data: { client, forcedBranchId: ctx.branchId },
      disableClose: false,
    });
  }

  createOrEditClient(isEdit: boolean, client?: Client): void {
    this.dialog
      .open(CreateEditClientComponent, {
        width: '640px',
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
    const ctx = resolveActorBranchContext(actor, this.globals.currentUser?.branch?._id);
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

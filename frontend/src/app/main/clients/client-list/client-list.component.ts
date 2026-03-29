import { Component, OnInit } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Globals } from '@core/globals';
import { Client, PaginationData } from '@core/models/users-interfaces.model';
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
  paginationData: PaginationData;
  paginationPerPage = 10;
  params: any = { page: 1, perPage: this.paginationPerPage };
  private searchTimeout: any;
  private subscriptions: Subscription[] = [];

  constructor(
    private userSerivce: UserSerivce,
    private dialog: MatDialog,
    private notificationService: AppNotificationService,
    private translate: TranslateService,
    public globals: Globals
  ) {}

  ngOnInit(): void {
    if (isBranchManager(this.globals.currentUser?.role) && this.globals.currentUser?.branch?._id) {
      this.params.branch_id = this.globals.currentUser.branch._id;
    }
    this.getClients();
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

  paginationUpdate(page: number): void {
    this.params.page = page;
    this.getClients();
  }

 

  ngOnDestroy(): void {
    this.subscriptions.forEach(s => s && s.unsubscribe());
  }
}

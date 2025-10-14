import { Component, OnInit, OnDestroy } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { Globals } from '@core/globals';
import { Subscription } from 'rxjs';

// import { UserService } from '@shared/services/user.service';
import { CreateEditUserComponent } from '../create-edit-user/create-edit-user.component';
import { User, PaginationData } from '@core/models/users-interfaces.model';
import { UserSerivce } from '@shared/services/user.service';



@Component({
  selector: 'app-users-list',
  templateUrl: './users-list.component.html',
  styleUrls: ['./users-list.component.scss']
})
export class UsersListComponent implements OnInit, OnDestroy {
  usersList: User[] = [];
  usersLoading = true;
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
    this.getUsers();
  }

  getUsers(): void {
    this.usersLoading = true;
    this.subscriptions.push(
      this.userSerivce.getUsers(this.params).subscribe(
        (response: any) => {
          this.usersList = response.users;
          this.paginationData = response.meta;
          this.usersLoading = false;
        },
        (error:any) => {
          this.usersLoading = false;
          this.isNotAuthorized = error.status === 403;
          if (!this.isNotAuthorized) {
            this.notificationService.push(this.translate.instant('tr_unexpected_error_message'), 'error');
          }
        }
      )
    );
  }

  filterUsers(event: any, key: string): void {
    clearTimeout(this.searchTimeout);
    this.searchTimeout = setTimeout(() => {
      this.params.search = event.target.value.trim();
      this.params.page = 1;
      this.getUsers();
    }, 500);
  }

  paginationUpdate(page: number): void {
    this.params.page = page;
    this.getUsers();
  }

  createOrEditUser(isEdit: boolean, user?: User): void {
    const dialogRef = this.dialog.open(CreateEditUserComponent, {
      width: '750px',
      data: { isEdit, user, userId: user?._id },
      disableClose: true
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) this.getUsers();
    });
  }

  deleteUser(userId: string): void {
    this.userSerivce.deleteUser(userId).subscribe(() => {
      this.params.page = 1;
      this.getUsers();
    });
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(s => s && s.unsubscribe());
  }
}

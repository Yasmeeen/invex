import { Component, OnInit, OnDestroy } from '@angular/core';
import { MatLegacyDialog as MatDialog } from '@angular/material/legacy-dialog';
import { Subscription } from 'rxjs';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { TranslateService } from '@ngx-translate/core';
import { ConfirmationDialogComponent } from '@shared/components/confirmation-dialog/confirmation-dialog.component';
import { PaginationData } from '@core/models/users-interfaces.model';
import { PurchasingRequest } from '@core/models/products.model';
import { CreateEditPurchasingRequestComponent } from '../create-edit-purchasing-request/create-edit-purchasing-request.component';
import { PurchasingRequestsService } from '@shared/services/purchasing.service';


@Component({
    selector: 'app-purchasing-requests-list',
    templateUrl: './purchasing-requests-list.component.html',
    styleUrls: ['./purchasing-requests-list.component.scss'],
    standalone: false
})
export class PurchasingRequestsListComponent implements OnInit, OnDestroy {
  purchasingRequestsList: PurchasingRequest[] = [];
  paginationData: PaginationData;
  paginationPerPage = 10;
  totalNumberOfPurchasingRequests = 0;
  isLoading = true;
  isFilterOpen = false;
  isNotAuthorized = false;
  supplierSearchTerm = '';
  params: any = { page: 1, perPage: this.paginationPerPage };
  private subscriptions: Subscription[] = [];

  constructor(
    private dialog: MatDialog,
    private purchasingService: PurchasingRequestsService,
    private translateService: TranslateService,
    private appNotificationService: AppNotificationService
  ) {}

  ngOnInit(): void {
    this.getPurchasingRequests();
  }


  getPurchasingRequests() {
    this.isLoading = true;
    this.subscriptions.push(
      this.purchasingService.getPurchasingRequests(this.params).subscribe(
         (response: any) => {
          this.purchasingRequestsList = response.requests;
          this.paginationData = response.meta;
          this.totalNumberOfPurchasingRequests = response.meta.totalCount;
          this.isLoading = false;
        },
        error=> {
          this.isLoading = false;
          if (error.status === 403) this.isNotAuthorized = true;
          else
            this.appNotificationService.push(
              this.translateService.instant('tr_unexpected_error_message'),
              'error'
            );
        
      })
    );
  }

  filterPurchasingRequests(event: any) {
    clearTimeout(this.params.searchTimeout);
    this.params.searchTimeout = setTimeout(() => {
      this.params.search = event.target.value.trim();
      this.params.page = 1;
      this.getPurchasingRequests();
    }, 500);
  }

  paginationUpdate(page: number) {
    this.params.page = page;
    this.getPurchasingRequests();
  }

  createOrEditPurchasing(isEditForm: boolean, request?: PurchasingRequest) {
    console.log("request",request?._id);
    
    const dialogRef = this.dialog.open(CreateEditPurchasingRequestComponent, {
      width: '850px',
      data: { isEdit: isEditForm, requestId: request?._id },
      disableClose: true
    });
    dialogRef.afterClosed().subscribe((event) => {
      if (event) this.getPurchasingRequests();
    });
  }

  deletePurchasingRequest(requestId: string) {
    const dialogRef = this.dialog.open(ConfirmationDialogComponent, {
      width: '450px',
      data: {
        title: this.translateService.instant('tr_confirmation_message'),
        buttons: [
          { label: this.translateService.instant('tr_action.cancel'), actionCallback: 'cancel', type: 'btn-secondary' },
          { label: this.translateService.instant('tr_action.delete'), actionCallback: 'delete', type: 'btn-danger' }
        ]
      },
      disableClose: true
    });
    dialogRef.afterClosed().subscribe((result) => {
      if (result === 'delete') {
        this.purchasingService.deletePurchasingRequest(requestId).subscribe(() => {
          this.params.page = 1;
          this.getPurchasingRequests();
        });
      }
    });
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach((sub) => sub.unsubscribe());
  }
}


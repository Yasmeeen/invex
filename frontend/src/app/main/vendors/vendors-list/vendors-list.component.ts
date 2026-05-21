import { VendorsSerivce } from './../../../shared/services/vendors.service';
import { Component, OnInit } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { PaginationData, User } from '@core/models/users-interfaces.model'
import { Subscription } from 'rxjs';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { TranslateService } from '@ngx-translate/core';

import { CreateEditVendorComponent } from '../create-edit-vendor/create-edit-vendor.component';
import { VendorHistoryDialogComponent } from '../vendor-history-dialog/vendor-history-dialog.component';
import { VendorDepositDialogComponent } from '../vendor-deposit-dialog/vendor-deposit-dialog.component';
import { Vendor } from '@core/models/products.model';
import { ConfirmationDialogComponent } from '@shared/components/confirmation-dialog/confirmation-dialog.component';


@Component({
  selector: 'app-vendors-list',
  templateUrl: './vendors-list.component.html',
  styleUrls: ['./vendors-list.component.scss']
})
export class VendorsListComponent implements OnInit {
  vendorsLoading: boolean = true;
  isFilterOpen: boolean = true;
  paginationPerPage:number = 10;
  viewMode: 'table' | 'cards' = 'table';
  selectedcategory: string;
  vendorsList: Vendor[] = [];
  categorysLoading: boolean = false;
  fullscreenEnabled = false;
  searchTerm: string;
  isNotAuthorized: boolean = false;
  iscategoryNotAuthorized: boolean = false;
  selectedBranch: string ;
  totalNumberOfVendors: number;

  currentOrder: any = {
    name: '',
    category: ''
  }
  params: any = {
    page: 1,
    perPage: this.paginationPerPage,
  };
  categorysParams: any = {
    page: 1,
    per_page: 10,
  };
  paginationData: PaginationData
  categorysPagination: PaginationData
  searchTimeout: any;
  nameSearchTerm: string
  numberSearchTerm: string
  nationalId: string

  private subscriptions: Subscription[] = [];

  constructor(
    private appNotificationService: AppNotificationService,
    private translateService: TranslateService,
    private dialog: MatDialog,
    private vendorsSerivce: VendorsSerivce
  ) { }

  ngOnInit(): void {
    const saved = localStorage.getItem('vendors.viewMode');
    this.viewMode = saved === 'cards' ? 'cards' : 'table';
    this.getVendors();
  }

  setViewMode(mode: 'table' | 'cards'): void {
    this.viewMode = mode;
    localStorage.setItem('vendors.viewMode', mode);
  }
  getVendors() {
    this.vendorsLoading = true;
    if(this.selectedBranch){
      this.params['branchId'] = this.selectedBranch;
    }
    else {
      delete this.params['branchId']
    }

    this.subscriptions.push(this.vendorsSerivce.getVendors(this.params).subscribe((response: any) => {
      this.vendorsList = response.vendors
      this.paginationData = response.meta
      this.totalNumberOfVendors = response.meta.totalCount
      this.vendorsLoading = false;
    },(error:any)=> {
      if(error.status == 403) {
        this.isNotAuthorized = true;
        this.vendorsLoading = false;
      }
      else {
        this.appNotificationService.push( this.translateService.instant('tr_unexpected_error_message'), 'error');
      }
    }))
  }


  filterVendors(term: any, searchKey: string) {
    clearTimeout(this.searchTimeout);
    this.searchTimeout = setTimeout(() => {
      term = (searchKey == 'by_category_id') ? term : term.target.value.trim()
      this.params['search'] = term;
      this.params.page = 1;
      this.getVendors();
    }, 500);
  }
  paginationUpdate(page: number) {
    this.params.page = page;
    this.getVendors();
  }


  deleteVendor(vendorId: string){
    let confirmationData = {
      title: this.translateService.instant('tr_confirmation_message'),
      buttons: [
        {
          label: this.translateService.instant('tr_action.cancel'),
          actionCallback: 'cancel',
          type: 'btn-secondary'
        },
        {
          label: this.translateService.instant('tr_action.delete'),
          actionCallback: 'delete',
          type: 'btn-danger'
        },
      ]
    };
    let dialogRef = this.dialog.open(ConfirmationDialogComponent, {
      width: '450px',
      data: confirmationData,
      disableClose: true,
    });
    dialogRef.afterClosed().subscribe(result => {
      if (result != 'delete') {
        return;
      }
      this.vendorsSerivce.deleteVendor(vendorId).subscribe(() => {
        this.params.page = 1;
          this.getVendors()
  
      })
    });


  }
  openVendorHistory(vendor: Vendor): void {
    this.dialog.open(VendorHistoryDialogComponent, {
      width: '920px',
      maxWidth: '96vw',
      data: { vendor },
      disableClose: false,
    });
  }

  openVendorDeposit(vendor: Vendor): void {
    this.dialog.open(VendorDepositDialogComponent, {
      width: '480px',
      maxWidth: '96vw',
      data: { vendor },
      disableClose: true,
    });
  }

  createOrEditvendor(isEdit: boolean, vendor?: Vendor){
    let dialogRef = this.dialog.open(CreateEditVendorComponent, {
      width: '850px',
      data: {isEdit:isEdit,vendor:vendor, vendorId: vendor?._id},
      disableClose: true,
  });
  dialogRef.afterClosed().subscribe(event => {
    if(event){
       this.getVendors();
    }
  })
  }

 

  ngOnDestroy() {
    this.subscriptions.forEach(s => s && s.unsubscribe())
  }

}


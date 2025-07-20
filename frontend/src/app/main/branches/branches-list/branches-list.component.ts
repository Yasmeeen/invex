import { Component, OnInit } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Globals } from '@core/globals';
import { Branch } from '@core/models/products.model';
import { PaginationData } from '@core/models/users-interfaces.model';
import { TranslateService } from '@ngx-translate/core';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { BranchesServce } from '@shared/services/branches.service';
import { Subscription } from 'rxjs';
import { CreateEditBranchComponent } from '../create-edit-branch/create-edit-branch.component';

@Component({
  selector: 'app-branches-list',
  templateUrl: './branches-list.component.html',
  styleUrls: ['./branches-list.component.scss']
})
export class BranchesListComponent implements OnInit {

  branchesLoading: boolean = true;
  isFilterOpen: boolean = true;
  paginationPerPage:number = 10;
  branchs: Branch[] = [];
  selectedbranch: string;
  branchesList: Branch[] = [];
  branchsLoading: boolean = false;
  fullscreenEnabled = false;
  searchTerm: string;
  isNotAuthorized: boolean = false;
  isbranchNotAuthorized: boolean = false;

  currentOrder: any = {
    name: '',
    branch: ''
  }
  params: any = {
    page: 1,
    perPage: this.paginationPerPage,
  };
  branchsParams: any = {
    page: 1,
    per_page: 10,
  };
  paginationData: PaginationData
  branchsPagination: PaginationData
  searchTimeout: any;
  nameSearchTerm: string
  numberSearchTerm: string
  nationalId: string

  private subscriptions: Subscription[] = [];

  constructor(
    private branchesService: BranchesServce,
    private appNotificationService: AppNotificationService,
    private translateService: TranslateService,
    private globals: Globals,
    private dialog: MatDialog,
    private BranchesServce: BranchesServce
  ) { }

  ngOnInit(): void {
    this.getbranches();
    this.getbranchs();
  }
  getbranches() {
    this.branchesLoading = true;
    this.subscriptions.push(this.branchesService.getBranchs(this.params).subscribe((response: any) => {
      this.branchesList = response.branches
      this.paginationData = response.meta
      this.branchesLoading = false;
    },(error:any)=> {
      if(error.status == 403) {
        this.isNotAuthorized = true;
        this.branchesLoading = false;
      }
      else {
        this.appNotificationService.push( this.translateService.instant('tr_unexpected_error_message'), 'error');
      }
    }))
  }
  getbranchs() {
    this.branchsLoading = true
    this.subscriptions.push(this.BranchesServce.getBranchs(this.branchsParams).subscribe((response: any) => {
      this.branchsPagination = response.meta;
      this.branchs = this.branchs.concat(response.branches);
      this.branchsLoading = false
    },(error:any)=> {
      if(error.status == 403) {
       this.isbranchNotAuthorized = true;
       this.branchsLoading = false
      }
    }))
  }
  nextBatch() {
    if (this.branchsPagination.nextPage) {
      this.branchsLoading = true;
      this.branchsParams.page = this.branchsPagination.nextPage;
      this.getbranchs();
    }
  }

  filterbranches(term: any, searchKey: string) {
    clearTimeout(this.searchTimeout);
    this.searchTimeout = setTimeout(() => {
      term = (searchKey == 'by_branch_id') ? term : term.target.value.trim()
      this.params['search'] = term;
      this.params.page = 1;
      this.getbranches();
    }, 500);
  }
  paginationUpdate(page: number) {
    this.params.page = page;
    this.getbranches();
  }

  createOrEditbranch(isEdit: boolean, branch?: Branch){
    let dialogRef = this.dialog.open(CreateEditBranchComponent, {
      width: '850px',
      data: {isEdit:isEdit,branch:branch, branchId: branch?._id},
      disableClose: true,
  });
  dialogRef.afterClosed().subscribe(event => {
    if(event){
       this.getbranches();
    }
  })
  }

  deleteBranch(branchId: string){
    this.branchesService.deleteBranch(branchId).subscribe(() => {
      this.params.page = 1;
        this.getbranches()

    })
  }

  ngOnDestroy() {
    this.subscriptions.forEach(s => s && s.unsubscribe())
  }

}


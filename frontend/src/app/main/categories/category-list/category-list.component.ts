import { Component, OnInit } from '@angular/core';
import { CategoriesServce } from './../../../shared/services/categories.service';
import { MatDialog } from '@angular/material/dialog';
import { PaginationData, User } from '@core/models/users-interfaces.model'
import { Subscription } from 'rxjs';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { TranslateService } from '@ngx-translate/core';
import { Globals } from '@core/globals';
import { Category } from '@core/models/products.model';
import { CreateEditCategoryComponent } from '../create-edit-category/create-edit-category.component';



@Component({
  selector: 'app-category-list',
  templateUrl: './category-list.component.html',
  styleUrls: ['./category-list.component.scss']
})
export class CategoryListComponent implements OnInit {

  categoriesLoading: boolean = true;
  isFilterOpen: boolean = true;
  paginationPerPage:number = 10;
  categorys: Category[] = [];
  selectedcategory: string;
  categoriesList: Category[] = [];
  categorysLoading: boolean = false;
  fullscreenEnabled = false;
  searchTerm: string;
  isNotAuthorized: boolean = false;
  iscategoryNotAuthorized: boolean = false;

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
    private categoriesService: CategoriesServce,
    private appNotificationService: AppNotificationService,
    private translateService: TranslateService,
    private globals: Globals,
    private dialog: MatDialog
  ) { }

  ngOnInit(): void {
    this.getcategories();
  }
  getcategories() {
    this.categoriesLoading = true;
    this.subscriptions.push(this.categoriesService.getCategorys(this.params).subscribe((response: any) => {
      this.categoriesList = response.categories
      this.paginationData = response.meta
      this.categoriesLoading = false;
    },(error:any)=> {
      if(error.status == 403) {
        this.isNotAuthorized = true;
        this.categoriesLoading = false;
      }
      else {
        this.appNotificationService.push( this.translateService.instant('tr_unexpected_error_message'), 'error');
      }
    }))
  }


  filtercategories(term: any, searchKey: string) {
    clearTimeout(this.searchTimeout);
    this.searchTimeout = setTimeout(() => {
      term = (searchKey == 'by_category_id') ? term : term.target.value.trim()
      this.params['search'] = term;
      this.params.page = 1;
      this.getcategories();
    }, 500);
  }
  paginationUpdate(page: number) {
    this.params.page = page;
    this.getcategories();
  }

  createOrEditcategory(isEdit: boolean, category?: Category){
    let dialogRef = this.dialog.open(CreateEditCategoryComponent, {
      width: '850px',
      data: {isEdit:isEdit,category:category, categoryId: category?._id},
      disableClose: true,
  });
  dialogRef.afterClosed().subscribe(event => {
    if(event){
       this.getcategories();
    }
  })
  }

  deleteCategory(categoryId: string){
    this.categoriesService.deleteCategory(categoryId).subscribe(() => {
      this.params.page = 1;
        this.getcategories()

    })
  }

  ngOnDestroy() {
    this.subscriptions.forEach(s => s && s.unsubscribe())
  }

}


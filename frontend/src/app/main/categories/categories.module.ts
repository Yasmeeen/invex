import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

import { CategoriesRoutingModule } from './categories-routing.module';
import { CategoryListComponent } from './category-list/category-list.component';
import { CreateEditCategoryComponent } from './create-edit-category/create-edit-category.component';
import { CategoriesServce } from '@shared/services/categories.service';
import { SharedModule } from '@shared/shared.module';


@NgModule({
  declarations: [
    CategoryListComponent,
    CreateEditCategoryComponent
  ],
  imports: [
    CommonModule,
    CategoriesRoutingModule,
    SharedModule
  ],
  providers: [
    CategoriesServce
  ]
})
export class CategoriesModule { }

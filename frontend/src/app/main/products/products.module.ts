import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

import { ProductsRoutingModule } from './products-routing.module';
import { ProductsListComponent } from './products-list/products-list.component';
import { SharedModule } from '@shared/shared.module';
import { ProductsSerivce } from '@shared/services/products.service';
import { CreateEditProductComponent } from './create-edit-product/create-edit-product.component';


@NgModule({
  declarations: [
    ProductsListComponent,
    CreateEditProductComponent
  ],
  imports: [
    CommonModule,
    ProductsRoutingModule,
    SharedModule
  ],
  providers: [
    ProductsSerivce
  ]
})
export class ProductsModule { }

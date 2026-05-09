import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';

import { ProductsRoutingModule } from './products-routing.module';
import { ProductsListComponent } from './products-list/products-list.component';
import { SharedModule } from '@shared/shared.module';
import { ProductsSerivce } from '@shared/services/products.service';
import { CreateEditProductComponent } from './create-edit-product/create-edit-product.component';
import { BookProductDialogComponent } from './book-product-dialog/book-product-dialog.component';
import { ViewProductBookingDialogComponent } from './view-product-booking-dialog/view-product-booking-dialog.component';
import { ImportProductsDialogComponent } from './import-products-dialog/import-products-dialog.component';
import { TransferProductBranchDialogComponent } from './transfer-product-branch-dialog/transfer-product-branch-dialog.component';
import { PendingBranchTransfersDialogComponent } from './pending-branch-transfers-dialog/pending-branch-transfers-dialog.component';


@NgModule({
  declarations: [
    ProductsListComponent,
    CreateEditProductComponent,
    BookProductDialogComponent,
    ViewProductBookingDialogComponent,
    ImportProductsDialogComponent,
    TransferProductBranchDialogComponent,
    PendingBranchTransfersDialogComponent,
  ],
  imports: [
    CommonModule,
    ProductsRoutingModule,
    SharedModule,
    TranslateModule.forChild(),
  ],
  providers: [
    ProductsSerivce
  ]
})
export class ProductsModule { }

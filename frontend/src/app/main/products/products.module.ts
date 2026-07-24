import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';

import { ProductsRoutingModule } from './products-routing.module';
import { ProductsListComponent } from './products-list/products-list.component';
import { SharedModule } from '@shared/shared.module';
import { ProductsSerivce } from '@shared/services/products.service';
import { CreateEditProductModule } from './create-edit-product/create-edit-product.module';
import { BookProductDialogComponent } from './book-product-dialog/book-product-dialog.component';
import { ViewProductBookingDialogComponent } from './view-product-booking-dialog/view-product-booking-dialog.component';
import { ImportProductsDialogComponent } from './import-products-dialog/import-products-dialog.component';
import { TransferProductBranchDialogComponent } from './transfer-product-branch-dialog/transfer-product-branch-dialog.component';
import { PendingBranchTransfersComponent } from './pending-branch-transfers/pending-branch-transfers.component';
import { ProductHistoryDialogComponent } from './product-history-dialog/product-history-dialog.component';
import { ProductInventoryAuditDialogComponent } from './product-inventory-audit-dialog/product-inventory-audit-dialog.component';
import { SerialTrackComponent } from './serial-track/serial-track.component';
import { PaymentSplitsDialogModule } from '@shared/components/payment-splits-dialog/payment-splits-dialog.module';


@NgModule({
  declarations: [
    ProductsListComponent,
    BookProductDialogComponent,
    ViewProductBookingDialogComponent,
    ImportProductsDialogComponent,
    TransferProductBranchDialogComponent,
    PendingBranchTransfersComponent,
    ProductHistoryDialogComponent,
    ProductInventoryAuditDialogComponent,
    SerialTrackComponent,
  ],
  imports: [
    CommonModule,
    ProductsRoutingModule,
    SharedModule,
    CreateEditProductModule,
    PaymentSplitsDialogModule,
    TranslateModule.forChild(),
  ],
  providers: [
    ProductsSerivce
  ]
})
export class ProductsModule { }

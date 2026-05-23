import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

import { OrdersRoutingModule } from './orders-routing.module';
import { OrdersListComponent } from './orders-list/orders-list.component';
import { AddOrderComponent } from './add-order/add-order.component';
import { PayOrderDialogComponent } from './pay-order-dialog/pay-order-dialog.component';
import { DeskPurchaseDeferredPaymentDialogComponent } from './desk-purchase-deferred-payment-dialog/desk-purchase-deferred-payment-dialog.component';
import { InvoicesPageComponent } from './invoices-page/invoices-page.component';
import { PurchaseInvoicesListComponent } from './purchase-invoices-list/purchase-invoices-list.component';
import { SharedModule } from '@shared/shared.module';
import { OrdersSerivce } from '@shared/services/orders.service';
import { MatDialogModule } from '@angular/material/dialog';


@NgModule({
  declarations: [
    InvoicesPageComponent,
    OrdersListComponent,
    PurchaseInvoicesListComponent,
    AddOrderComponent,
    PayOrderDialogComponent,
    DeskPurchaseDeferredPaymentDialogComponent,
  ],
  imports: [
    CommonModule,
    OrdersRoutingModule,
    SharedModule,
    MatDialogModule,
  ],
  providers: [OrdersSerivce],
  exports: [PayOrderDialogComponent, DeskPurchaseDeferredPaymentDialogComponent],
})
export class OrdersModule { }

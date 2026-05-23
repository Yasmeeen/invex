import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

import { CreateEditVendorComponent } from './create-edit-vendor/create-edit-vendor.component';
import { VendorsListComponent } from './vendors-list/vendors-list.component';
import { VendorHistoryDialogComponent } from './vendor-history-dialog/vendor-history-dialog.component';
import { VendorDepositDialogComponent } from './vendor-deposit-dialog/vendor-deposit-dialog.component';
import { VendorDeferredPaymentDialogModule } from './vendor-deferred-payment-dialog/vendor-deferred-payment-dialog.module';
import { OrdersModule } from '../orders/orders.module';
import { SharedModule } from '@shared/shared.module';
import { VendorsRoutingModule } from './vendors-routing.module';
import { VendorsSerivce } from '@shared/services/vendors.service';


@NgModule({
  declarations: [
    VendorsListComponent,
    CreateEditVendorComponent,
    VendorHistoryDialogComponent,
    VendorDepositDialogComponent,
  ],
  imports: [
    CommonModule,
    VendorsRoutingModule,
    SharedModule,
    VendorDeferredPaymentDialogModule,
    OrdersModule,
  ],
  providers: [
    VendorsSerivce
  ]
})
export class VendorsModule { }

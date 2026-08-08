import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

import { CreateEditVendorComponent } from './create-edit-vendor/create-edit-vendor.component';
import { VendorsListComponent } from './vendors-list/vendors-list.component';
import { VendorHistoryComponent } from './vendor-history/vendor-history.component';
import { VendorDepositDialogComponent } from './vendor-deposit-dialog/vendor-deposit-dialog.component';
import { VendorOpeningDebitDialogComponent } from './vendor-opening-debit-dialog/vendor-opening-debit-dialog.component';
import { VendorPaySupplierDialogModule } from './vendor-pay-supplier-dialog/vendor-pay-supplier-dialog.module';
import { VendorDeferredPaymentDialogModule } from './vendor-deferred-payment-dialog/vendor-deferred-payment-dialog.module';
import { VendorInstallmentPaymentDialogModule } from './vendor-installment-payment-dialog/vendor-installment-payment-dialog.module';
import { OrdersModule } from '../orders/orders.module';
import { SharedModule } from '@shared/shared.module';
import { VendorsRoutingModule } from './vendors-routing.module';
import { VendorsSerivce } from '@shared/services/vendors.service';
import { MatDialogModule } from '@angular/material/dialog';
import { PaymentSplitsDialogModule } from '@shared/components/payment-splits-dialog/payment-splits-dialog.module';


@NgModule({
  declarations: [
    VendorsListComponent,
    CreateEditVendorComponent,
    VendorHistoryComponent,
    VendorDepositDialogComponent,
    VendorOpeningDebitDialogComponent,
  ],
  imports: [
    CommonModule,
    VendorsRoutingModule,
    SharedModule,
    VendorPaySupplierDialogModule,
    VendorDeferredPaymentDialogModule,
    VendorInstallmentPaymentDialogModule,
    OrdersModule,
    MatDialogModule,
    PaymentSplitsDialogModule,
  ],
  providers: [
    VendorsSerivce
  ]
})
export class VendorsModule { }

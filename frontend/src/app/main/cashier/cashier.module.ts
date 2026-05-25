import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule } from '@angular/material/dialog';

import { CashierRoutingModule } from './cashier-routing.module';
import { CashierComponent } from './cashier/cashier.component';
import { SharedModule } from '@shared/shared.module';
import { ProductsSerivce } from '@shared/services/products.service';
import { OrdersSerivce } from '@shared/services/orders.service';
import { CreateEditProductModule } from '../products/create-edit-product/create-edit-product.module';
import { DailyExpenseDialogModule } from '../expenses/daily-expense-dialog/daily-expense-dialog.module';
import { DrawerCloseDialogModule } from '../drawer-close/drawer-close-dialog/drawer-close-dialog.module';
import { PaymentSplitsDialogModule } from '@shared/components/payment-splits-dialog/payment-splits-dialog.module';
import { OrdersModule } from '../orders/orders.module';


@NgModule({
  declarations: [
    CashierComponent
  ],
  imports: [
    CommonModule,
    CashierRoutingModule,
    SharedModule,
    MatDialogModule,
    CreateEditProductModule,
    DailyExpenseDialogModule,
    DrawerCloseDialogModule,
    PaymentSplitsDialogModule,
    OrdersModule,
  ],
  providers: [
    ProductsSerivce,
    OrdersSerivce
  ]
})
export class CashierModule { }

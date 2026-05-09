import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule } from '@angular/material/dialog';

import { CashierRoutingModule } from './cashier-routing.module';
import { CashierComponent } from './cashier/cashier.component';
import { SharedModule } from '@shared/shared.module';
import { ProductsSerivce } from '@shared/services/products.service';
import { OrdersSerivce } from '@shared/services/orders.service';
import { CreateEditProductModule } from '../products/create-edit-product/create-edit-product.module';


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
  ],
  providers: [
    ProductsSerivce,
    OrdersSerivce
  ]
})
export class CashierModule { }

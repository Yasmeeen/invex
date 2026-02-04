
import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

import { CashierRoutingModule } from './cashier-routing.module';
import { CashierComponent } from './cashier/cashier.component';
import { SharedModule } from '@shared/shared.module';
import { ProductsSerivce } from '@shared/services/products.service';
import { OrdersSerivce } from '@shared/services/orders.service';


@NgModule({
  declarations: [
    CashierComponent
  ],
  imports: [
    CommonModule,
    CashierRoutingModule,
    SharedModule
  ],
  providers: [
    ProductsSerivce,
    OrdersSerivce
  ]
})
export class CashierModule { }

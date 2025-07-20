import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

import { OrdersRoutingModule } from './orders-routing.module';
import { OrdersListComponent } from './orders-list/orders-list.component';
import { AddOrderComponent } from './add-order/add-order.component';
import { SharedModule } from '@shared/shared.module';
import { OrdersSerivce } from '@shared/services/orders.service';


@NgModule({
  declarations: [
    OrdersListComponent,
    AddOrderComponent
  ],
  imports: [
    CommonModule,
    OrdersRoutingModule,
    SharedModule
  ],
  providers: [OrdersSerivce]
})
export class OrdersModule { }

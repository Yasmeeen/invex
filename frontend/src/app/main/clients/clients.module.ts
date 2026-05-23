import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

import { ClientsRoutingModule } from './clients-routing.module';
import { ClientListComponent } from './client-list/client-list.component';
import { ClientHistoryDialogComponent } from './client-history-dialog/client-history-dialog.component';
import { SharedModule } from '@shared/shared.module';
import { UserSerivce } from '@shared/services/user.service';
import { OrdersModule } from '../orders/orders.module';


@NgModule({
  declarations: [
    ClientListComponent,
    ClientHistoryDialogComponent,
  ],
  imports: [
    CommonModule,
    ClientsRoutingModule,
    SharedModule,
    OrdersModule,
  ],
  providers: [
    UserSerivce
  ]
})
export class ClientsModule { }

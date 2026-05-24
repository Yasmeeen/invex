import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

import { ClientsRoutingModule } from './clients-routing.module';
import { ClientListComponent } from './client-list/client-list.component';
import { ClientHistoryDialogComponent } from './client-history-dialog/client-history-dialog.component';
import { ClientDepositDialogComponent } from './client-deposit-dialog/client-deposit-dialog.component';
import { ClientOpeningDebitDialogComponent } from './client-opening-debit-dialog/client-opening-debit-dialog.component';
import { SharedModule } from '@shared/shared.module';
import { UserSerivce } from '@shared/services/user.service';
import { OrdersModule } from '../orders/orders.module';
import { MatDialogModule } from '@angular/material/dialog';
import { PaymentSplitsDialogModule } from '@shared/components/payment-splits-dialog/payment-splits-dialog.module';


@NgModule({
  declarations: [
    ClientListComponent,
    ClientHistoryDialogComponent,
    ClientDepositDialogComponent,
    ClientOpeningDebitDialogComponent,
  ],
  imports: [
    CommonModule,
    ClientsRoutingModule,
    SharedModule,
    OrdersModule,
    MatDialogModule,
    PaymentSplitsDialogModule,
  ],
  providers: [
    UserSerivce
  ]
})
export class ClientsModule { }

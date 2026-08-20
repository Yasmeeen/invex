import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

import { ClientsRoutingModule } from './clients-routing.module';
import { ClientListComponent } from './client-list/client-list.component';
import { ClientHistoryComponent } from './client-history/client-history.component';
import { ClientDepositDialogComponent } from './client-deposit-dialog/client-deposit-dialog.component';
import { ClientOpeningDebitDialogComponent } from './client-opening-debit-dialog/client-opening-debit-dialog.component';
import { ClientPayClientDialogModule } from './client-pay-client-dialog/client-pay-client-dialog.module';
import { CreateEditClientComponent } from './create-edit-client/create-edit-client.component';
import { SharedModule } from '@shared/shared.module';
import { UserSerivce } from '@shared/services/user.service';
import { OrdersModule } from '../orders/orders.module';
import { MatDialogModule } from '@angular/material/dialog';
import { PaymentSplitsDialogModule } from '@shared/components/payment-splits-dialog/payment-splits-dialog.module';
import { PromiseToPayDialogModule } from '@shared/components/promise-to-pay-dialog/promise-to-pay-dialog.module';


@NgModule({
  declarations: [
    ClientListComponent,
    ClientHistoryComponent,
    ClientDepositDialogComponent,
    ClientOpeningDebitDialogComponent,
    CreateEditClientComponent,
  ],
  imports: [
    CommonModule,
    ClientsRoutingModule,
    SharedModule,
    OrdersModule,
    MatDialogModule,
    PaymentSplitsDialogModule,
    ClientPayClientDialogModule,
    PromiseToPayDialogModule,
  ],
  providers: [
    UserSerivce
  ]
})
export class ClientsModule { }

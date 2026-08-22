import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SharedModule } from '@shared/shared.module';
import { MatDialogModule } from '@angular/material/dialog';
import { DueInstallmentsComponent } from './due-installments/due-installments.component';
import { OrdersModule } from '../orders/orders.module';
import { PromiseToPayDialogModule } from '@shared/components/promise-to-pay-dialog/promise-to-pay-dialog.module';
import { AssignCollectorDialogModule } from '@shared/components/assign-collector-dialog/assign-collector-dialog.module';

@NgModule({
  declarations: [DueInstallmentsComponent],
  imports: [
    CommonModule,
    FormsModule,
    SharedModule,
    MatDialogModule,
    OrdersModule,
    PromiseToPayDialogModule,
    AssignCollectorDialogModule,
  ],
  exports: [DueInstallmentsComponent],
})
export class DueInstallmentsModule {}

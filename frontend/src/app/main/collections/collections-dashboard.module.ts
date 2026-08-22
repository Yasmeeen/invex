import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SharedModule } from '@shared/shared.module';
import { MatDialogModule } from '@angular/material/dialog';
import { CollectionsDashboardComponent } from './collections-dashboard/collections-dashboard.component';
import { OrdersModule } from '../orders/orders.module';
import { PromiseToPayDialogModule } from '@shared/components/promise-to-pay-dialog/promise-to-pay-dialog.module';
import { AssignCollectorDialogModule } from '@shared/components/assign-collector-dialog/assign-collector-dialog.module';

@NgModule({
  declarations: [CollectionsDashboardComponent],
  imports: [
    CommonModule,
    FormsModule,
    SharedModule,
    MatDialogModule,
    OrdersModule,
    PromiseToPayDialogModule,
    AssignCollectorDialogModule,
  ],
  exports: [CollectionsDashboardComponent],
})
export class CollectionsDashboardModule {}

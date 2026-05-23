import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule } from '@angular/material/dialog';
import { SharedModule } from '@shared/shared.module';
import { PaymentSplitsDialogComponent } from './payment-splits-dialog.component';

@NgModule({
  declarations: [PaymentSplitsDialogComponent],
  imports: [CommonModule, SharedModule, MatDialogModule],
  exports: [PaymentSplitsDialogComponent],
})
export class PaymentSplitsDialogModule {}

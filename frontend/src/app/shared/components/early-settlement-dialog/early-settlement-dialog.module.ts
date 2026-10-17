import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule } from '@angular/material/dialog';
import { SharedModule } from '@shared/shared.module';
import { PaymentSplitsDialogModule } from '@shared/components/payment-splits-dialog/payment-splits-dialog.module';
import { EarlySettlementDialogComponent } from './early-settlement-dialog.component';

@NgModule({
  declarations: [EarlySettlementDialogComponent],
  imports: [CommonModule, FormsModule, SharedModule, MatDialogModule, PaymentSplitsDialogModule],
  exports: [EarlySettlementDialogComponent],
})
export class EarlySettlementDialogModule {}

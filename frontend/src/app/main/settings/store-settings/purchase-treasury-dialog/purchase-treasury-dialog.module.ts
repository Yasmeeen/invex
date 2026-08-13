import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule } from '@angular/material/dialog';
import { SharedModule } from '@shared/shared.module';
import { TreasuryTransferDialogModule } from '../../../treasury/treasury-transfer-dialog/treasury-transfer-dialog.module';
import { TreasurySettleDialogModule } from '../../../treasury/treasury-settle-dialog/treasury-settle-dialog.module';
import { PurchaseTreasuryDialogComponent } from './purchase-treasury-dialog.component';
import { MoneyAccountFormDialogComponent } from '../money-account-form-dialog/money-account-form-dialog.component';

@NgModule({
  declarations: [PurchaseTreasuryDialogComponent, MoneyAccountFormDialogComponent],
  imports: [
    CommonModule,
    FormsModule,
    SharedModule,
    MatDialogModule,
    TreasuryTransferDialogModule,
    TreasurySettleDialogModule,
  ],
  exports: [PurchaseTreasuryDialogComponent],
})
export class PurchaseTreasuryDialogModule {}

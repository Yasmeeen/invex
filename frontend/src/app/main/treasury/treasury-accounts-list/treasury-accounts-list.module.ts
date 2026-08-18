import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule } from '@angular/material/dialog';
import { SharedModule } from '@shared/shared.module';
import { TreasuryTransferDialogModule } from '../treasury-transfer-dialog/treasury-transfer-dialog.module';
import { TreasuryDepositDialogModule } from '../treasury-deposit-dialog/treasury-deposit-dialog.module';
import { TreasurySettleDialogModule } from '../treasury-settle-dialog/treasury-settle-dialog.module';
import { TreasuryAccountsListComponent } from './treasury-accounts-list.component';

@NgModule({
  declarations: [TreasuryAccountsListComponent],
  imports: [
    CommonModule,
    FormsModule,
    SharedModule,
    MatDialogModule,
    TreasuryTransferDialogModule,
    TreasuryDepositDialogModule,
    TreasurySettleDialogModule,
  ],
  exports: [TreasuryAccountsListComponent],
})
export class TreasuryAccountsListModule {}

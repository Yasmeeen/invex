import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule } from '@angular/material/dialog';
import { SharedModule } from '@shared/shared.module';
import { TreasuryWithdrawDialogComponent } from './treasury-withdraw-dialog.component';

@NgModule({
  declarations: [TreasuryWithdrawDialogComponent],
  imports: [CommonModule, FormsModule, SharedModule, MatDialogModule],
  exports: [TreasuryWithdrawDialogComponent],
  entryComponents: [TreasuryWithdrawDialogComponent],
})
export class TreasuryWithdrawDialogModule {}

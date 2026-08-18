import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule } from '@angular/material/dialog';
import { SharedModule } from '@shared/shared.module';
import { TreasuryDepositDialogComponent } from './treasury-deposit-dialog.component';

@NgModule({
  declarations: [TreasuryDepositDialogComponent],
  imports: [CommonModule, FormsModule, SharedModule, MatDialogModule],
  exports: [TreasuryDepositDialogComponent],
  entryComponents: [TreasuryDepositDialogComponent],
})
export class TreasuryDepositDialogModule {}

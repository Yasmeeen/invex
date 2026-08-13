import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule } from '@angular/material/dialog';
import { SharedModule } from '@shared/shared.module';
import { SettlementAccountsDialogComponent } from './settlement-accounts-dialog.component';

@NgModule({
  declarations: [SettlementAccountsDialogComponent],
  imports: [CommonModule, FormsModule, SharedModule, MatDialogModule],
  exports: [SettlementAccountsDialogComponent],
})
export class SettlementAccountsDialogModule {}

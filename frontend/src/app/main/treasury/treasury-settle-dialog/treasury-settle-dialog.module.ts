import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule } from '@angular/material/dialog';
import { SharedModule } from '@shared/shared.module';
import { TreasurySettleDialogComponent } from './treasury-settle-dialog.component';

@NgModule({
  declarations: [TreasurySettleDialogComponent],
  imports: [CommonModule, FormsModule, SharedModule, MatDialogModule],
  exports: [TreasurySettleDialogComponent],
  entryComponents: [TreasurySettleDialogComponent],
})
export class TreasurySettleDialogModule {}

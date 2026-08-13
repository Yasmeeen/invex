import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule } from '@angular/material/dialog';
import { SharedModule } from '@shared/shared.module';
import { TreasuryTransferDialogComponent } from './treasury-transfer-dialog.component';

@NgModule({
  declarations: [TreasuryTransferDialogComponent],
  imports: [CommonModule, FormsModule, SharedModule, MatDialogModule],
  exports: [TreasuryTransferDialogComponent],
  entryComponents: [TreasuryTransferDialogComponent],
})
export class TreasuryTransferDialogModule {}

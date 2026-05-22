import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule } from '@angular/material/dialog';
import { SharedModule } from '@shared/shared.module';
import { PurchaseTreasuryDialogComponent } from './purchase-treasury-dialog.component';

@NgModule({
  declarations: [PurchaseTreasuryDialogComponent],
  imports: [CommonModule, FormsModule, SharedModule, MatDialogModule],
  exports: [PurchaseTreasuryDialogComponent],
})
export class PurchaseTreasuryDialogModule {}

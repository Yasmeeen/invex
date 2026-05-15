import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule } from '@angular/material/dialog';
import { SharedModule } from '@shared/shared.module';
import { PaymentAppFeesDialogComponent } from './payment-app-fees-dialog.component';

@NgModule({
  declarations: [PaymentAppFeesDialogComponent],
  imports: [CommonModule, FormsModule, SharedModule, MatDialogModule],
  exports: [PaymentAppFeesDialogComponent],
})
export class PaymentAppFeesDialogModule {}

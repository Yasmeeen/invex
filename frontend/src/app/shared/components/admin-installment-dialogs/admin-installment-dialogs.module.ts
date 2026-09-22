import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule } from '@angular/material/dialog';
import { SharedModule } from '@shared/shared.module';
import { AdminDeleteSaleDialogComponent } from './admin-delete-sale-dialog.component';
import { AdminEditInstallmentDialogComponent } from './admin-edit-installment-dialog.component';
import { AdminEditSaleNumberDialogComponent } from './admin-edit-sale-number-dialog.component';

@NgModule({
  declarations: [
    AdminDeleteSaleDialogComponent,
    AdminEditInstallmentDialogComponent,
    AdminEditSaleNumberDialogComponent,
  ],
  imports: [CommonModule, FormsModule, SharedModule, MatDialogModule],
  exports: [
    AdminDeleteSaleDialogComponent,
    AdminEditInstallmentDialogComponent,
    AdminEditSaleNumberDialogComponent,
  ],
})
export class AdminInstallmentDialogsModule {}

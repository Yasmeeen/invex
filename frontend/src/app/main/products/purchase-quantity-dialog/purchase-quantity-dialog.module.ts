import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { MatDialogModule } from '@angular/material/dialog';
import { SharedModule } from '@shared/shared.module';
import { PurchaseQuantityDialogComponent } from './purchase-quantity-dialog.component';

@NgModule({
  declarations: [PurchaseQuantityDialogComponent],
  imports: [CommonModule, SharedModule, MatDialogModule, TranslateModule.forChild()],
  exports: [PurchaseQuantityDialogComponent],
})
export class PurchaseQuantityDialogModule {}

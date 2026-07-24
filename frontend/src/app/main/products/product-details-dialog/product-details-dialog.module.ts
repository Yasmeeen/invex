import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule } from '@angular/material/dialog';
import { SharedModule } from '@shared/shared.module';
import { ProductDetailsDialogComponent } from './product-details-dialog.component';

@NgModule({
  declarations: [ProductDetailsDialogComponent],
  imports: [CommonModule, SharedModule, MatDialogModule],
  exports: [ProductDetailsDialogComponent],
})
export class ProductDetailsDialogModule {}

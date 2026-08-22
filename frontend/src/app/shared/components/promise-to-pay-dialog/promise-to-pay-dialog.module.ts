import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule } from '@angular/material/dialog';
import { SharedModule } from '@shared/shared.module';
import { PromiseToPayDialogComponent } from './promise-to-pay-dialog.component';

@NgModule({
  declarations: [PromiseToPayDialogComponent],
  imports: [CommonModule, FormsModule, SharedModule, MatDialogModule],
  exports: [PromiseToPayDialogComponent],
})
export class PromiseToPayDialogModule {}

import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatLegacyDialogModule as MatDialogModule } from '@angular/material/legacy-dialog';
import { SharedModule } from '@shared/shared.module';
import { DailyExpenseDialogComponent } from './daily-expense-dialog.component';

@NgModule({
  declarations: [DailyExpenseDialogComponent],
  imports: [CommonModule, SharedModule, MatDialogModule],
  exports: [DailyExpenseDialogComponent],
})
export class DailyExpenseDialogModule {}

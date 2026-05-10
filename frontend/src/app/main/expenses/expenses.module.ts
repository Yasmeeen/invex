import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule } from '@angular/material/dialog';
import { SharedModule } from '@shared/shared.module';
import { ExpensesRoutingModule } from './expenses-routing.module';
import { ExpensesListComponent } from './expenses-list/expenses-list.component';
import { DailyExpenseDialogModule } from './daily-expense-dialog/daily-expense-dialog.module';

@NgModule({
  declarations: [ExpensesListComponent],
  imports: [
    CommonModule,
    SharedModule,
    MatDialogModule,
    DailyExpenseDialogModule,
    ExpensesRoutingModule,
  ],
})
export class ExpensesModule {}

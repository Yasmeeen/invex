import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule } from '@angular/material/dialog';
import { SharedModule } from '@shared/shared.module';
import { AssignCollectorDialogComponent } from './assign-collector-dialog.component';

@NgModule({
  declarations: [AssignCollectorDialogComponent],
  imports: [CommonModule, FormsModule, SharedModule, MatDialogModule],
  exports: [AssignCollectorDialogComponent],
})
export class AssignCollectorDialogModule {}

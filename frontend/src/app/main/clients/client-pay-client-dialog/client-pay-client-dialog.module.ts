import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule } from '@angular/material/dialog';
import { SharedModule } from '@shared/shared.module';
import { ClientPayClientDialogComponent } from './client-pay-client-dialog.component';

@NgModule({
  declarations: [ClientPayClientDialogComponent],
  imports: [CommonModule, SharedModule, MatDialogModule],
  exports: [ClientPayClientDialogComponent],
})
export class ClientPayClientDialogModule {}

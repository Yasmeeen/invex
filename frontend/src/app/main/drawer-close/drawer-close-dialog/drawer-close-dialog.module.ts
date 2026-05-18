import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatLegacyDialogModule as MatDialogModule } from '@angular/material/legacy-dialog';
import { SharedModule } from '@shared/shared.module';
import { DrawerCloseDialogComponent } from './drawer-close-dialog.component';

@NgModule({
  declarations: [DrawerCloseDialogComponent],
  imports: [CommonModule, SharedModule, MatDialogModule],
  exports: [DrawerCloseDialogComponent],
})
export class DrawerCloseDialogModule {}

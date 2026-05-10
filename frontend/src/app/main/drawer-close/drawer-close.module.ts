import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule } from '@angular/material/dialog';
import { SharedModule } from '@shared/shared.module';
import { DrawerCloseRoutingModule } from './drawer-close-routing.module';
import { DrawerCloseHistoryComponent } from './drawer-close-history/drawer-close-history.component';
import { DrawerCloseDialogModule } from './drawer-close-dialog/drawer-close-dialog.module';

@NgModule({
  declarations: [DrawerCloseHistoryComponent],
  imports: [
    CommonModule,
    SharedModule,
    MatDialogModule,
    DrawerCloseDialogModule,
    DrawerCloseRoutingModule,
  ],
})
export class DrawerCloseModule {}

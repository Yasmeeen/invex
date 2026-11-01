import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule } from '@angular/material/dialog';
import { SharedModule } from '@shared/shared.module';
import { StockCountRoutingModule } from './stock-count-routing.module';
import { StockCountListComponent } from './stock-count-list/stock-count-list.component';
import { StockCountSessionComponent } from './stock-count-session/stock-count-session.component';
import { StockCountStartDialogComponent } from './stock-count-start-dialog/stock-count-start-dialog.component';

@NgModule({
  declarations: [
    StockCountListComponent,
    StockCountSessionComponent,
    StockCountStartDialogComponent,
  ],
  imports: [CommonModule, SharedModule, MatDialogModule, StockCountRoutingModule],
})
export class StockCountModule {}

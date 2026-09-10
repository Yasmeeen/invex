import { NgModule } from '@angular/core';
import { MatDialogModule } from '@angular/material/dialog';
import { SharedModule } from '@shared/shared.module';
import { CompleteOnlineOrderDialogComponent } from './complete-online-order-dialog/complete-online-order-dialog.component';
import { OnlineOrdersPageComponent } from './online-orders-page.component';
import { OnlineOrdersRoutingModule } from './online-orders-routing.module';

@NgModule({
  declarations: [OnlineOrdersPageComponent, CompleteOnlineOrderDialogComponent],
  imports: [SharedModule, MatDialogModule, OnlineOrdersRoutingModule],
})
export class OnlineOrdersModule {}

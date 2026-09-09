import { NgModule } from '@angular/core';
import { MatDialogModule } from '@angular/material/dialog';
import { SharedModule } from '@shared/shared.module';
import { OnlineOrdersPageComponent } from './online-orders-page.component';
import { OnlineOrdersRoutingModule } from './online-orders-routing.module';

@NgModule({
  declarations: [OnlineOrdersPageComponent],
  imports: [SharedModule, MatDialogModule, OnlineOrdersRoutingModule],
})
export class OnlineOrdersModule {}

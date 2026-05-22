import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SharedModule } from '@shared/shared.module';
import { MatDialogModule } from '@angular/material/dialog';
import { SettingsRoutingModule } from './settings-routing.module';
import { StoreSettingsComponent } from './store-settings/store-settings.component';
import { PaymentAppFeesDialogModule } from './store-settings/payment-app-fees-dialog/payment-app-fees-dialog.module';
import { PurchaseTreasuryDialogModule } from './store-settings/purchase-treasury-dialog/purchase-treasury-dialog.module';

@NgModule({
  declarations: [StoreSettingsComponent],
  imports: [
    CommonModule,
    FormsModule,
    SharedModule,
    SettingsRoutingModule,
    MatDialogModule,
    PaymentAppFeesDialogModule,
    PurchaseTreasuryDialogModule,
  ],
})
export class SettingsModule {}

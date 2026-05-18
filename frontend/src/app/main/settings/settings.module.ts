import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SharedModule } from '@shared/shared.module';
import { MatLegacyDialogModule as MatDialogModule } from '@angular/material/legacy-dialog';
import { SettingsRoutingModule } from './settings-routing.module';
import { PaymentAppFeesDialogModule } from './store-settings/payment-app-fees-dialog/payment-app-fees-dialog.module';
import { StoreSettingsComponent } from './store-settings/store-settings.component';

@NgModule({
  declarations: [StoreSettingsComponent],
  imports: [
    CommonModule,
    FormsModule,
    SharedModule,
    SettingsRoutingModule,
    MatDialogModule,
    PaymentAppFeesDialogModule,
  ],
})
export class SettingsModule {}

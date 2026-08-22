import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule } from '@angular/material/dialog';
import { SharedModule } from '@shared/shared.module';
import { SettingsRoutingModule } from './settings-routing.module';
import { StoreSettingsComponent } from './store-settings/store-settings.component';
import { InstallmentPlansSettingsComponent } from './installment-plans-settings/installment-plans-settings.component';
import { InstallmentPlanFormDialogComponent } from './installment-plans-settings/installment-plan-form-dialog/installment-plan-form-dialog.component';
import { PaymentAppFeesDialogModule } from './store-settings/payment-app-fees-dialog/payment-app-fees-dialog.module';
import { PurchaseTreasuryDialogModule } from './store-settings/purchase-treasury-dialog/purchase-treasury-dialog.module';

@NgModule({
  declarations: [
    StoreSettingsComponent,
    InstallmentPlansSettingsComponent,
    InstallmentPlanFormDialogComponent,
  ],
  imports: [
    CommonModule,
    FormsModule,
    SharedModule,
    MatDialogModule,
    SettingsRoutingModule,
    PaymentAppFeesDialogModule,
    PurchaseTreasuryDialogModule,
  ],
})
export class SettingsModule {}

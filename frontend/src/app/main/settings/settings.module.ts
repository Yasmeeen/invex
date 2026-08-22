import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule } from '@angular/material/dialog';
import { SharedModule } from '@shared/shared.module';
import { SettingsRoutingModule } from './settings-routing.module';
import { StoreSettingsComponent } from './store-settings/store-settings.component';
import { InstallmentPlansSettingsComponent } from './installment-plans-settings/installment-plans-settings.component';
import { InstallmentPlanFormDialogComponent } from './installment-plans-settings/installment-plan-form-dialog/installment-plan-form-dialog.component';

@NgModule({
  declarations: [
    StoreSettingsComponent,
    InstallmentPlansSettingsComponent,
    InstallmentPlanFormDialogComponent,
  ],
  imports: [CommonModule, FormsModule, SharedModule, MatDialogModule, SettingsRoutingModule],
})
export class SettingsModule {}

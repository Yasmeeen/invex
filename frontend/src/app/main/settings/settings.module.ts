import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SharedModule } from '@shared/shared.module';
import { SettingsRoutingModule } from './settings-routing.module';
import { StoreSettingsComponent } from './store-settings/store-settings.component';

@NgModule({
  declarations: [StoreSettingsComponent],
  imports: [CommonModule, FormsModule, SharedModule, SettingsRoutingModule],
})
export class SettingsModule {}

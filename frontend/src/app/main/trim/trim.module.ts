import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SharedModule } from '@shared/shared.module';
import { TrimRoutingModule } from './trim-routing.module';
import { TrimPageComponent } from './trim-page.component';

@NgModule({
  declarations: [TrimPageComponent],
  imports: [CommonModule, FormsModule, SharedModule, TrimRoutingModule],
})
export class TrimModule {}

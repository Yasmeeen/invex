import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SharedModule } from '@shared/shared.module';
import { FaqPageComponent } from './faq-page/faq-page.component';
import { FaqRoutingModule } from './faq-routing.module';

@NgModule({
  declarations: [FaqPageComponent],
  imports: [CommonModule, SharedModule, FaqRoutingModule],
})
export class FaqModule {}

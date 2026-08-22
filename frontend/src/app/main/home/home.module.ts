import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HomeRoutingModule } from './home-routing.module';
import { HomeComponent } from './home/home.component';
import { SharedModule } from '@shared/shared.module';
import { TreasuryAccountsListModule } from '../treasury/treasury-accounts-list/treasury-accounts-list.module';
import { CollectionsDashboardModule } from '../collections/collections-dashboard.module';

@NgModule({
  declarations: [HomeComponent],
  imports: [
    CommonModule,
    FormsModule,
    HomeRoutingModule,
    SharedModule,
    TreasuryAccountsListModule,
    CollectionsDashboardModule,
  ],
})
export class HomeModule {}


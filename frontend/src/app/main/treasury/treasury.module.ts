import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule } from '@angular/material/dialog';
import { SharedModule } from '@shared/shared.module';
import { PurchaseTreasuryDialogModule } from '../settings/store-settings/purchase-treasury-dialog/purchase-treasury-dialog.module';
import { SettlementAccountsDialogModule } from '../settings/store-settings/settlement-accounts-dialog/settlement-accounts-dialog.module';
import { PaymentMethodAccountMapDialogModule } from '../settings/store-settings/payment-method-account-map-dialog/payment-method-account-map-dialog.module';
import { TreasuryAccountsListComponent } from './treasury-accounts-list/treasury-accounts-list.component';
import { TreasuryAccountDetailComponent } from './treasury-account-detail/treasury-account-detail.component';
import { TreasuryTransferDialogComponent } from './treasury-transfer-dialog/treasury-transfer-dialog.component';
import { TreasuryOpeningDialogComponent } from './treasury-opening-dialog/treasury-opening-dialog.component';
import { TreasuryConfigPageComponent } from './treasury-config-page/treasury-config-page.component';

const routes: Routes = [
  { path: '', component: TreasuryAccountsListComponent },
  {
    path: 'config/treasuries',
    component: TreasuryConfigPageComponent,
    data: { mode: 'treasuries' },
  },
  {
    path: 'config/settlement',
    component: TreasuryConfigPageComponent,
    data: { mode: 'settlement' },
  },
  {
    path: 'config/payment-map',
    component: TreasuryConfigPageComponent,
    data: { mode: 'payment-map' },
  },
  { path: ':accountKey', component: TreasuryAccountDetailComponent },
];

@NgModule({
  declarations: [
    TreasuryAccountsListComponent,
    TreasuryAccountDetailComponent,
    TreasuryTransferDialogComponent,
    TreasuryOpeningDialogComponent,
    TreasuryConfigPageComponent,
  ],
  imports: [
    CommonModule,
    FormsModule,
    SharedModule,
    MatDialogModule,
    PurchaseTreasuryDialogModule,
    SettlementAccountsDialogModule,
    PaymentMethodAccountMapDialogModule,
    RouterModule.forChild(routes),
  ],
})
export class TreasuryModule {}

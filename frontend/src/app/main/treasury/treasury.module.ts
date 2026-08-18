import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule } from '@angular/material/dialog';
import { SharedModule } from '@shared/shared.module';
import { PurchaseTreasuryDialogModule } from '../settings/store-settings/purchase-treasury-dialog/purchase-treasury-dialog.module';
import { PaymentAppFeesDialogModule } from '../settings/store-settings/payment-app-fees-dialog/payment-app-fees-dialog.module';
import { PaymentMethodAccountMapDialogModule } from '../settings/store-settings/payment-method-account-map-dialog/payment-method-account-map-dialog.module';
import { TreasuryAccountsListModule } from './treasury-accounts-list/treasury-accounts-list.module';
import { TreasuryAccountsListComponent } from './treasury-accounts-list/treasury-accounts-list.component';
import { TreasuryAccountDetailComponent } from './treasury-account-detail/treasury-account-detail.component';
import { TreasuryTransferDialogModule } from './treasury-transfer-dialog/treasury-transfer-dialog.module';
import { TreasuryDepositDialogModule } from './treasury-deposit-dialog/treasury-deposit-dialog.module';
import { TreasurySettleDialogModule } from './treasury-settle-dialog/treasury-settle-dialog.module';
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
    path: 'config/payment-methods',
    component: TreasuryConfigPageComponent,
    data: { mode: 'payment-methods' },
  },
  {
    path: 'config/payment-map',
    redirectTo: 'config/payment-methods',
    pathMatch: 'full',
  },
  { path: ':accountKey', component: TreasuryAccountDetailComponent },
];

@NgModule({
  declarations: [
    TreasuryAccountDetailComponent,
    TreasuryOpeningDialogComponent,
    TreasuryConfigPageComponent,
  ],
  imports: [
    CommonModule,
    FormsModule,
    SharedModule,
    MatDialogModule,
    TreasuryAccountsListModule,
    TreasuryTransferDialogModule,
    TreasuryDepositDialogModule,
    TreasurySettleDialogModule,
    PurchaseTreasuryDialogModule,
    PaymentAppFeesDialogModule,
    PaymentMethodAccountMapDialogModule,
    RouterModule.forChild(routes),
  ],
})
export class TreasuryModule {}


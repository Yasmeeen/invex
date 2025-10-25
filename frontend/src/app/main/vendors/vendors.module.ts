import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

import { VendorsRoutingModule } from './vendors-routing.module';
import { VendorsListComponent } from './vendors-list/vendors-list.component';
import { CreateEditVendorComponent } from './create-edit-vendor/create-edit-vendor.component';


@NgModule({
  declarations: [
    VendorsListComponent,
    CreateEditVendorComponent
  ],
  imports: [
    CommonModule,
    VendorsRoutingModule
  ]
})
export class VendorsModule { }

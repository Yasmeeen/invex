import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

import { InventoryRoutingModule } from './inventory-routing.module';
import { InventoryListComponent } from './inventory-list/inventory-list.component';
import { CreateEditProductComponent } from './create-edit-product/create-edit-product.component';
import { SharedModule } from '@shared/shared.module';


@NgModule({
  declarations: [
    InventoryListComponent,
    CreateEditProductComponent
  ],
  imports: [
    CommonModule,
    InventoryRoutingModule,
    SharedModule
  ]
})
export class InventoryModule { }

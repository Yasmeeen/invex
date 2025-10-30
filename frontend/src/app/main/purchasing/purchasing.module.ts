import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { PurchasingRoutingModule } from './purchasing-routing.module';
import { PurchasingRequestsListComponent } from './purchasing-requests-list/purchasing-requests-list.component';
import { CreateEditPurchasingRequestComponent } from './create-edit-purchasing-request/create-edit-purchasing-request.component';
import { SharedModule } from '@shared/shared.module';
import { PurchasingRequestsService } from '@shared/services/purchasing.service';
import { ProductsSerivce } from '@shared/services/products.service';


@NgModule({
  declarations: [
    PurchasingRequestsListComponent,
    CreateEditPurchasingRequestComponent
  ],
  imports: [
    CommonModule,
    PurchasingRoutingModule,
    SharedModule
  ],
  providers: [
    PurchasingRequestsService,
    ProductsSerivce
  ]
})
export class PurchasingModule { }

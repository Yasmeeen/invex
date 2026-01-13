import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

import { ClientsRoutingModule } from './clients-routing.module';
import { ClientListComponent } from './client-list/client-list.component';
import { SharedModule } from '@shared/shared.module';
import { UserSerivce } from '@shared/services/user.service';


@NgModule({
  declarations: [
    ClientListComponent
  ],
  imports: [
    CommonModule,
    ClientsRoutingModule,
    SharedModule
  ],
  providers: [
    UserSerivce
  ]
})
export class ClientsModule { }

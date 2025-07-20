import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

import { UsersRoutingModule } from './users-routing.module';
import { UsersListComponent } from './users-list/users-list.component';
import { CreateEditUserComponent } from './create-edit-user/create-edit-user.component';
import { SharedModule } from '@shared/shared.module';
import { UserSerivce } from '@shared/services/user.service';


@NgModule({
  declarations: [
    UsersListComponent,
    CreateEditUserComponent
  ],
  imports: [
    CommonModule,
    UsersRoutingModule,
    SharedModule
  ],
  providers: [
    UserSerivce
  ]
})
export class UsersModule { }

import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

import { BranchesRoutingModule } from './branches-routing.module';
import { BranchesListComponent } from './branches-list/branches-list.component';
import { CreateEditBranchComponent } from './create-edit-branch/create-edit-branch.component';
import { SharedModule } from '@shared/shared.module';


@NgModule({
  declarations: [
    BranchesListComponent,
    CreateEditBranchComponent
  ],
  imports: [
    CommonModule,
    BranchesRoutingModule,
    SharedModule
  ]
})
export class BranchesModule { }

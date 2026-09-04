import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule } from '@angular/material/dialog';
import { SharedModule } from '@shared/shared.module';
import { FactoryRoutingModule } from './factory-routing.module';
import { FactoryPageComponent } from './factory-page.component';
import { AddFactoryDialogComponent } from './add-factory-dialog/add-factory-dialog.component';

@NgModule({
  declarations: [FactoryPageComponent, AddFactoryDialogComponent],
  imports: [CommonModule, FormsModule, SharedModule, MatDialogModule, FactoryRoutingModule],
})
export class FactoryModule {}

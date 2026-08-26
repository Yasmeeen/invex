import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule } from '@angular/material/dialog';
import { SharedModule } from '@shared/shared.module';
import { SlaughterRoutingModule } from './slaughter-routing.module';
import { SlaughterPageComponent } from './slaughter-page.component';
import { SlaughterDialogComponent } from './slaughter-dialog/slaughter-dialog.component';

@NgModule({
  declarations: [SlaughterPageComponent, SlaughterDialogComponent],
  imports: [CommonModule, FormsModule, SharedModule, MatDialogModule, SlaughterRoutingModule],
})
export class SlaughterModule {}

import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { MatDialogModule } from '@angular/material/dialog';
import { SharedModule } from '@shared/shared.module';
import { CreateEditProductComponent } from './create-edit-product.component';

@NgModule({
  declarations: [CreateEditProductComponent],
  imports: [CommonModule, SharedModule, TranslateModule.forChild(), MatDialogModule],
  exports: [CreateEditProductComponent],
})
export class CreateEditProductModule {}

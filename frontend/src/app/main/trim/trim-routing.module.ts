import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { TrimPageComponent } from './trim-page.component';

const routes: Routes = [{ path: '', component: TrimPageComponent }];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class TrimRoutingModule {}

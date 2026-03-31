import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { AuditsPageComponent } from './pages/audits-page/audits-page.component';

const routes: Routes = [{ path: '', component: AuditsPageComponent }];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class AuditsRoutingModule {}


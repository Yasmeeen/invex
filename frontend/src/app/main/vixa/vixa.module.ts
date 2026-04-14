import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { SharedModule } from '@shared/shared.module';
import { VixaPageComponent } from './vixa.page';
import { VixaGuard } from '@core/guards/vixa.guard';

const routes: Routes = [
  {
    path: '',
    component: VixaPageComponent,
    canActivate: [VixaGuard],
  },
];

@NgModule({
  declarations: [VixaPageComponent],
  imports: [SharedModule, RouterModule.forChild(routes)],
})
export class VixaModule {}


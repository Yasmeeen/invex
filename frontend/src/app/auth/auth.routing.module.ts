import { UpdatePasswordComponent } from './update-password/update-password.component';
import { NgModule } from '@angular/core';
import { Routes, RouterModule, Resolve } from '@angular/router';
import { LoginComponent } from './login/login.component';
import { AuthenticationGuard } from '@core/guards';

const routes: Routes = [
    {
        path: '',
        component: LoginComponent
    },
    {
      path: 'update-password',
      component: UpdatePasswordComponent,
      canActivateChild: [AuthenticationGuard],
  }
]

@NgModule({
    imports: [RouterModule.forChild(routes)],
    exports: [RouterModule],
})

export class AuthRoutingModule { }

import { UpdatePasswordComponent } from './update-password/update-password.component';
import { NgModule } from '@angular/core';
import { AuthRoutingModule } from './auth.routing.module';
import { LoginComponent } from './login/login.component';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';


@NgModule({
    imports: [
        AuthRoutingModule,
        ReactiveFormsModule,
        CommonModule,
        FormsModule,
        TranslateModule.forChild(),
    ],
    declarations: [
        LoginComponent,
        UpdatePasswordComponent,
    ]
})
export class AuthModule { }

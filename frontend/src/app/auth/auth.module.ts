import { UpdatePasswordComponent } from './update-password/update-password.component';
import { NgModule } from '@angular/core';
import { AuthRoutingModule } from './auth.routing.module';
import { LoginComponent } from './login/login.component';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';


@NgModule({
    imports: [
        AuthRoutingModule,
        ReactiveFormsModule,
        ReactiveFormsModule,
        CommonModule,
        FormsModule

    ],
    declarations: [
        LoginComponent,
        UpdatePasswordComponent
    ]
})
export class AuthModule { }

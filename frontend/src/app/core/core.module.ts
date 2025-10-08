import {NgModule} from '@angular/core';
import {CommonModule} from '@angular/common';
import {AuthenticationGuard} from './guards';
import {HTTP_INTERCEPTORS, HttpClientModule} from '@angular/common/http';
import { AuthenticationService } from './services/authentication.service';
import { ModuleWithProviders } from '@angular/compiler/src/core';
import { HttpConfigInterceptor } from './interceptors/httpconfig.interceptor';
import { RoleGuard } from './guards/role.guard';


@NgModule({
  declarations: [],
  imports: [
    CommonModule
  ],
  exports: []
})
export class CoreModule {
  static forRoot(): ModuleWithProviders{
    return {
      ngModule: CoreModule,
      providers: [
        AuthenticationService,
        AuthenticationGuard,
        RoleGuard,
        {
          provide: HTTP_INTERCEPTORS,
          useClass: HttpConfigInterceptor,
          multi: true
        }
      ]
    };
  }

  static forChild(): ModuleWithProviders {
    return {
      ngModule: CoreModule,
      providers: [
        {
          provide: HTTP_INTERCEPTORS,
          useClass: HttpConfigInterceptor,
          multi: true
        }
      ]
    };
  }
}

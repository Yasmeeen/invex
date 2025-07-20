import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClientModule } from '@angular/common/http';
import { CoreModule } from '@core/core.module';
import { TranslateModule } from '@ngx-translate/core';
import { FormsModule } from '@angular/forms';
import { GhostLineComponent } from './components/ghost-line/ghost-line.component';
import { Pagination } from './components/pagination/pagination';
import {NgSelectModule} from '@ng-select/ng-select';
import { LoadingBarHttpClientModule } from '@ngx-loading-bar/http-client';
import { VersionCheckService } from '@shared/services/version-check.service';
import { ConfirmationDialogComponent } from './components/confirmation-dialog/confirmation-dialog.component';
import { MultiCheckboxComponent } from './components/multi-checkbox/multi-checkbox.component';
import { UpdateService } from '@shared/services/update.service';
import { OrderByComponent } from './components/order-by/order-by.component';
import { ImagePreloadDirective } from './components/image/image.directive';
import { MatDatepickerModule} from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { NotAuthorizedComponent } from './components/not-authorized/not-authorized.component';



@NgModule({
  declarations: [GhostLineComponent,Pagination,ConfirmationDialogComponent,MultiCheckboxComponent,OrderByComponent,ImagePreloadDirective,NotAuthorizedComponent],
  imports: [
    CommonModule,
    HttpClientModule,
    FormsModule,
    CoreModule.forRoot(),
    NgSelectModule,
    TranslateModule
  ],
  exports: [
    GhostLineComponent,
    NgSelectModule,
    Pagination,
    TranslateModule,
    CommonModule,
    FormsModule,
    LoadingBarHttpClientModule,
    ConfirmationDialogComponent,
    MultiCheckboxComponent,
    OrderByComponent,
    ImagePreloadDirective,
    MatDatepickerModule,
    MatNativeDateModule,
    NotAuthorizedComponent,

  ],
  providers: [VersionCheckService,UpdateService]
})
export class SharedModule { }

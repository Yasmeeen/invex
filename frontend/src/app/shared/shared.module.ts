import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClientModule } from '@angular/common/http';
import { CoreModule } from '@core/core.module';
import { TranslateModule } from '@ngx-translate/core';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
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
import { ReceiptTranslatePipe } from './pipes/receipt-translate.pipe';
import { VixaChatComponent } from './components/vixa-chat/vixa-chat.component';
import { ProductPurchaseApprovalDialogComponent } from './components/product-purchase-approval-dialog/product-purchase-approval-dialog.component';
import { PurchaseReceiptPrintComponent } from './components/purchase-receipt-print/purchase-receipt-print.component';
import { SaleReceiptPrintComponent } from './components/sale-receipt-print/sale-receipt-print.component';
import { BookingReceiptPrintComponent } from './components/booking-receipt-print/booking-receipt-print.component';
import { PaymentReceiptPrintComponent } from './components/payment-receipt-print/payment-receipt-print.component';
import { InvoiceReprintHostComponent } from './components/invoice-reprint-host/invoice-reprint-host.component';
import { BookingReprintHostComponent } from './components/booking-reprint-host/booking-reprint-host.component';



@NgModule({
  declarations: [
    GhostLineComponent,
    Pagination,
    ConfirmationDialogComponent,
    MultiCheckboxComponent,
    OrderByComponent,
    ImagePreloadDirective,
    NotAuthorizedComponent,
    ReceiptTranslatePipe,
    VixaChatComponent,
    ProductPurchaseApprovalDialogComponent,
    PurchaseReceiptPrintComponent,
    SaleReceiptPrintComponent,
    BookingReceiptPrintComponent,
    PaymentReceiptPrintComponent,
    InvoiceReprintHostComponent,
    BookingReprintHostComponent,
  ],
  imports: [
    CommonModule,
    HttpClientModule,
    FormsModule,
    ReactiveFormsModule,
    CoreModule.forRoot(),
    NgSelectModule,
    TranslateModule,
    MatDatepickerModule,
    MatNativeDateModule,
  ],
  exports: [
    GhostLineComponent,
    NgSelectModule,
    Pagination,
    TranslateModule,
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    LoadingBarHttpClientModule,
    ConfirmationDialogComponent,
    MultiCheckboxComponent,
    OrderByComponent,
    ImagePreloadDirective,
    MatDatepickerModule,
    MatNativeDateModule,
    NotAuthorizedComponent,
    ReceiptTranslatePipe,
    VixaChatComponent,
    ProductPurchaseApprovalDialogComponent,
    PurchaseReceiptPrintComponent,
    SaleReceiptPrintComponent,
    BookingReceiptPrintComponent,
    PaymentReceiptPrintComponent,
    InvoiceReprintHostComponent,
    BookingReprintHostComponent,
  ],
  providers: [VersionCheckService,UpdateService]
})
export class SharedModule { }

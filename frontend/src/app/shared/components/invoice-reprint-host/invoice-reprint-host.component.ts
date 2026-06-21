import { ChangeDetectorRef, Component, OnDestroy, ViewEncapsulation } from '@angular/core';
import { Subscription } from 'rxjs';
import {
  InvoiceReprintMode,
  InvoiceReprintService,
} from '@shared/services/invoice-reprint.service';

@Component({
  selector: 'app-invoice-reprint-host',
  templateUrl: './invoice-reprint-host.component.html',
  styleUrls: ['./invoice-reprint-host.component.scss'],
  encapsulation: ViewEncapsulation.None,
})
export class InvoiceReprintHostComponent implements OnDestroy {
  mode: InvoiceReprintMode | null = null;
  data: any = null;
  printDate: Date = new Date();

  private sub?: Subscription;

  constructor(private invoiceReprint: InvoiceReprintService, private cdr: ChangeDetectorRef) {
    this.sub = this.invoiceReprint.reprint$.subscribe((req) => {
      this.mode = req.mode;
      this.data = req.data;
      this.printDate = req.printDate;
      setTimeout(() => {
        this.cdr.detectChanges();
        window.print();
      }, 300);
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }
}

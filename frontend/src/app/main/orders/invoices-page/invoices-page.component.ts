import { Component } from '@angular/core';

export type InvoicesSection = 'sales' | 'purchases';

@Component({
  selector: 'app-invoices-page',
  templateUrl: './invoices-page.component.html',
  styleUrls: ['./invoices-page.component.scss'],
})
export class InvoicesPageComponent {
  activeSection: InvoicesSection = 'sales';

  private readonly storageKey = 'invoices.activeSection';

  constructor() {
    const saved = localStorage.getItem(this.storageKey);
    if (saved === 'sales' || saved === 'purchases') {
      this.activeSection = saved;
    }
  }

  setSection(section: InvoicesSection): void {
    this.activeSection = section;
    localStorage.setItem(this.storageKey, section);
  }
}

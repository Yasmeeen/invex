import { Component } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

export type InvoicesSection = 'sales' | 'purchases';

@Component({
  selector: 'app-invoices-page',
  templateUrl: './invoices-page.component.html',
  styleUrls: ['./invoices-page.component.scss'],
})
export class InvoicesPageComponent {
  activeSection: InvoicesSection = 'sales';

  private readonly storageKey = 'invoices.activeSection';

  constructor(private route: ActivatedRoute) {
    const qp = this.route.snapshot.queryParamMap;
    const section = String(qp.get('section') || '').trim().toLowerCase();

    if (section === 'purchases' || section === 'sales') {
      this.activeSection = section;
      return;
    }

    // Deep-links without explicit section (e.g. serial track) open sales invoices.
    if (qp.get('printOrderId') || qp.get('search')) {
      this.activeSection = 'sales';
      return;
    }

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

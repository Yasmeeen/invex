import { Component, EventEmitter, Output } from '@angular/core';

@Component({
  selector: 'app-report-filters',
  templateUrl: './report-filters.component.html',
  styleUrls: ['./report-filters.component.scss'],
})
export class ReportFiltersComponent {
  @Output() apply = new EventEmitter<any>();

  filters: any = {
    from: this.formatDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1)),
    to: this.formatDate(new Date()),
    branch_id: '',
    product_id: '',
    customer_id: '',
    groupBy: 'daily',
  };

  private formatDate(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  applyFilters() {
    this.apply.emit({ ...this.filters });
  }

  reset() {
    this.filters.branch_id = '';
    this.filters.product_id = '';
    this.filters.customer_id = '';
    this.filters.groupBy = 'daily';
    this.applyFilters();
  }
}


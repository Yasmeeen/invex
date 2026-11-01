import { Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { Globals } from '@core/globals';
import { PaginationData } from '@core/models/users-interfaces.model';
import { formatCairoDateTime } from '@core/utils/date-tz.util';
import { TranslateService } from '@ngx-translate/core';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { ConfirmationDialogComponent } from '@shared/components/confirmation-dialog/confirmation-dialog.component';
import {
  StockCountDto,
  StockCountLine,
  StockCountScanResponse,
  StockCountSection,
  StockCountService,
  stockCountErrorMessage,
} from '@shared/services/stock-count.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-stock-count-session',
  templateUrl: './stock-count-session.component.html',
  styleUrls: ['./stock-count-session.component.scss'],
})
export class StockCountSessionComponent implements OnInit, OnDestroy {
  @ViewChild('scanInput') scanInput?: ElementRef<HTMLInputElement>;

  count: StockCountDto | null = null;
  lines: StockCountLine[] = [];
  section: StockCountSection = 'all';
  loading = true;
  loadingLines = false;
  scanning = false;
  exporting = false;
  isNotAuthorized = false;
  scanCode = '';
  search = '';
  categoryFilter = '';
  menuOpen = false;
  filterOpen = false;
  page = 1;
  paginationPerPage = 8;
  paginationData?: PaginationData;
  feedback: { tone: 'ok' | 'warn' | 'info'; text: string } | null = null;

  private id = '';
  private loadSeq = 0;
  private scanTimer: ReturnType<typeof setTimeout> | null = null;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private burstStart = 0;
  private lastKeyAt = 0;
  private burstEvents = 0;
  private prevLen = 0;
  private didFocusScan = false;
  private subscriptions: Subscription[] = [];

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private stockCounts: StockCountService,
    private dialog: MatDialog,
    private notify: AppNotificationService,
    private translate: TranslateService,
    public globals: Globals
  ) {}

  ngOnInit(): void {
    this.subscriptions.push(
      this.route.paramMap.subscribe((params) => {
        this.id = params.get('id') || '';
        this.page = 1;
        this.section = 'all';
        this.search = '';
        this.categoryFilter = '';
        this.feedback = null;
        this.didFocusScan = false;
        this.load();
      })
    );
  }

  ngOnDestroy(): void {
    if (this.scanTimer != null) clearTimeout(this.scanTimer);
    if (this.searchTimer != null) clearTimeout(this.searchTimer);
    this.subscriptions.forEach((sub) => sub.unsubscribe());
  }

  get canTrack(): boolean {
    return this.globals.currentUser?.role !== 'Cashier';
  }

  get isOpen(): boolean {
    return this.count?.status === 'open';
  }

  @HostListener('document:click')
  closePopovers(): void {
    this.menuOpen = false;
    this.filterOpen = false;
  }

  formatWhen(value?: string | null): string {
    return formatCairoDateTime(value) || '—';
  }

  formatSessionWhen(value?: string | null): string {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const datePart = new Intl.DateTimeFormat('ar-EG-u-nu-latn', {
      timeZone: 'Africa/Cairo',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(date);
    const timePart = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Cairo',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);
    return `${datePart} • ${timePart}`;
  }

  locationLabel(): string {
    if (!this.count) return '';
    const place =
      this.count.locationType === 'warehouse'
        ? this.translate.instant('tr_warehouse')
        : this.count.branchName || this.count.branch?.name || '';
    const categories = this.categoriesLabel();
    if (place && categories) return `${place}: ${categories}`;
    return place || categories || '—';
  }

  get progressPercent(): number {
    const expected = this.count?.summary?.expectedUnits || 0;
    if (!expected) return 0;
    const counted = this.count?.summary?.countedUnits || 0;
    return Math.min(100, Math.round((counted / expected) * 100));
  }

  get showQtyColumns(): boolean {
    return this.section === 'all' || this.section === 'shortage';
  }

  get pageList(): number[] {
    const total = this.paginationData?.totalPages || 0;
    if (total <= 0) return [];
    const end = Math.min(total, Math.max(this.page + 2, 5));
    const start = Math.max(1, end - 4);
    const pages: number[] = [];
    for (let i = start; i <= Math.min(total, start + 4); i += 1) pages.push(i);
    return pages;
  }

  get rangeFrom(): number {
    const total = this.paginationData?.totalCount || 0;
    if (!total) return 0;
    return (this.page - 1) * this.paginationPerPage + 1;
  }

  get rangeTo(): number {
    const total = this.paginationData?.totalCount || 0;
    return Math.min(total, this.page * this.paginationPerPage);
  }

  categoriesLabel(): string {
    const names = (this.count?.categories || [])
      .map((category) => category.name)
      .filter((name) => !!name);
    return names.join('، ');
  }

  reasonLabel(reason?: string): string {
    const key = `tr_stock_count_reason_${reason || 'unknown'}`;
    const text = this.translate.instant(key);
    return text === key ? reason || '' : text;
  }

  emptyKey(): string {
    if (this.section === 'surplus') return 'tr_stock_count_empty_surplus';
    if (this.section === 'scanned') return 'tr_stock_count_empty_scanned';
    if ((this.count?.summary?.expectedUnits || 0) === 0) return 'tr_stock_count_empty_expected';
    if (this.section === 'shortage') return 'tr_stock_count_empty_shortage';
    return 'tr_stock_count_empty_all';
  }

  lineDiff(line: StockCountLine): number {
    if (typeof line.diffQty === 'number') return line.diffQty;
    if (line.expectedQty != null || line.scannedQty != null) {
      return Number(line.scannedQty || 0) - Number(line.expectedQty || 0);
    }
    if (line.shortageQty != null) return -Number(line.shortageQty);
    return 0;
  }

  toggleMenu(event: Event): void {
    event.stopPropagation();
    this.menuOpen = !this.menuOpen;
    this.filterOpen = false;
  }

  toggleFilter(event: Event): void {
    event.stopPropagation();
    this.filterOpen = !this.filterOpen;
    this.menuOpen = false;
  }

  setCategory(name: string): void {
    this.categoryFilter = name;
    this.filterOpen = false;
    this.page = 1;
    this.load();
  }

  onSearchInput(): void {
    if (this.searchTimer != null) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.searchTimer = null;
      this.page = 1;
      this.load();
    }, 300);
  }

  saveDraft(): void {
    this.menuOpen = false;
    this.notify.push(this.translate.instant('tr_stock_count_saved'), 'success');
  }

  exportLines(): void {
    const uid = this.globals.currentUser?._id;
    if (!uid || !this.id || this.exporting) return;
    this.exporting = true;
    this.subscriptions.push(
      this.stockCounts
        .get(this.id, {
          userId: uid,
          section: this.section,
          q: this.search.trim() || undefined,
          category: this.categoryFilter || undefined,
          exportAll: true,
        })
        .subscribe({
          next: (res) => {
            this.exporting = false;
            this.downloadCsv(res.lines || []);
          },
          error: (err) => {
            this.exporting = false;
            this.notify.push(stockCountErrorMessage(this.translate, err), 'error');
          },
        })
    );
  }

  setSection(section: StockCountSection): void {
    if (this.section === section) return;
    this.section = section;
    this.page = 1;
    this.load();
  }

  applySearch(): void {
    this.page = 1;
    this.load();
  }

  paginationUpdate(page: number): void {
    this.page = page;
    this.load();
  }

  onScanInput(): void {
    const now = Date.now();
    const code = (this.scanCode || '').trim();
    const added = code.length - this.prevLen;
    if (!this.burstStart || now - this.lastKeyAt > 250 || added < 0) {
      this.burstStart = now;
      this.burstEvents = 0;
    }
    this.burstEvents += 1;
    this.prevLen = code.length;
    this.lastKeyAt = now;
    if (this.scanTimer != null) clearTimeout(this.scanTimer);
    if (code.length < 3) return;
    const events = this.burstEvents;
    this.scanTimer = setTimeout(() => {
      this.scanTimer = null;
      if ((this.scanCode || '').trim() !== code) return;
      const elapsed = Date.now() - this.burstStart;
      const scannerBurst = elapsed < 600 && (events >= 4 || added >= 4);
      if (scannerBurst) this.submitScan();
    }, 180);
  }

  submitScan(): void {
    if (this.scanning || !this.isOpen || !this.id) return;
    const code = (this.scanCode || '').trim();
    if (!code) return;
    const uid = this.globals.currentUser?._id;
    if (!uid) return;
    if (this.scanTimer != null) {
      clearTimeout(this.scanTimer);
      this.scanTimer = null;
    }
    this.scanning = true;
    this.scanCode = '';
    this.prevLen = 0;
    this.burstStart = 0;
    this.subscriptions.push(
      this.stockCounts.scan(this.id, uid, code).subscribe({
        next: (res) => {
          this.scanning = false;
          if (this.count) this.count.summary = res.summary;
            this.feedback = this.feedbackFrom(res);
            this.load();
            this.focusScan();
        },
        error: (err) => {
          this.scanning = false;
          this.scanCode = code;
          this.prevLen = code.length;
          this.notify.push(stockCountErrorMessage(this.translate, err), 'error');
          this.focusScan();
        },
      })
    );
  }

  removeScan(line: StockCountLine): void {
    if (!this.isOpen || !line.scanId || !this.id) return;
    const uid = this.globals.currentUser?._id;
    if (!uid) return;
    this.subscriptions.push(
      this.stockCounts.removeScan(this.id, line.scanId, uid).subscribe({
        next: (res) => {
          this.count = res.count;
          this.load();
          this.focusScan();
        },
        error: (err) => {
          this.notify.push(stockCountErrorMessage(this.translate, err), 'error');
        },
      })
    );
  }

  confirmFinish(): void {
    if (!this.isOpen) return;
    const ref = this.dialog.open(ConfirmationDialogComponent, {
      width: '450px',
      disableClose: true,
      data: {
        title: this.translate.instant('tr_stock_count_finish_title'),
        message: this.translate.instant('tr_stock_count_finish_message'),
        buttons: [
          {
            label: this.translate.instant('tr_cancel'),
            actionCallback: 'cancel',
            type: 'btn-secondary',
          },
          {
            label: this.translate.instant('tr_stock_count_finish'),
            actionCallback: 'finish',
            type: 'btn-primary',
          },
        ],
      },
    });
    this.subscriptions.push(
      ref.afterClosed().subscribe((result) => {
        if (result === 'finish') this.finish();
      })
    );
  }

  confirmDelete(): void {
    if (!this.isOpen) return;
    const ref = this.dialog.open(ConfirmationDialogComponent, {
      width: '450px',
      disableClose: true,
      data: {
        title: this.translate.instant('tr_stock_count_delete_title'),
        message: this.translate.instant('tr_stock_count_delete_message'),
        buttons: [
          {
            label: this.translate.instant('tr_cancel'),
            actionCallback: 'cancel',
            type: 'btn-secondary',
          },
          {
            label: this.translate.instant('tr_action.delete'),
            actionCallback: 'delete',
            type: 'btn-danger',
          },
        ],
      },
    });
    this.subscriptions.push(
      ref.afterClosed().subscribe((result) => {
        if (result === 'delete') this.deleteCount();
      })
    );
  }

  private finish(): void {
    const uid = this.globals.currentUser?._id;
    if (!uid || !this.id) return;
    this.subscriptions.push(
      this.stockCounts.complete(this.id, uid).subscribe({
        next: (res) => {
          this.count = res.count;
          this.feedback = null;
          this.section = 'all';
          this.page = 1;
          this.load();
        },
        error: (err) => {
          this.notify.push(stockCountErrorMessage(this.translate, err), 'error');
        },
      })
    );
  }

  private deleteCount(): void {
    const uid = this.globals.currentUser?._id;
    if (!uid || !this.id) return;
    this.subscriptions.push(
      this.stockCounts.delete(this.id, uid).subscribe({
        next: () => this.router.navigate(['/stock-count']),
        error: (err) => {
          this.notify.push(stockCountErrorMessage(this.translate, err), 'error');
        },
      })
    );
  }

  load(): void {
    const uid = this.globals.currentUser?._id;
    if (!uid || !this.id) {
      this.loading = false;
      return;
    }
    const seq = ++this.loadSeq;
    this.loadingLines = true;
    if (!this.count) this.loading = true;
    this.subscriptions.push(
      this.stockCounts
        .get(this.id, {
          userId: uid,
          section: this.section,
          page: this.page,
          limit: this.paginationPerPage,
          q: this.search.trim() || undefined,
          category: this.categoryFilter || undefined,
        })
        .subscribe({
          next: (res) => {
            if (seq !== this.loadSeq) return;
            this.count = res.count;
            this.lines = res.lines || [];
            const meta = res.meta;
            this.paginationData = {
              currentPage: meta?.currentPage || 1,
              totalCount: meta?.totalCount || 0,
              totalPages: meta?.totalPages || 0,
              nextPage: meta?.nextPage ?? 0,
              prevPage: meta?.prevPage ?? 0,
            };
            this.loading = false;
            this.loadingLines = false;
            if (!this.didFocusScan && this.isOpen) {
              this.didFocusScan = true;
              this.focusScan();
            }
          },
          error: (err) => {
            if (seq !== this.loadSeq) return;
            this.loading = false;
            this.loadingLines = false;
            this.isNotAuthorized = err?.status === 403;
            if (err?.status === 404) {
              this.router.navigate(['/stock-count']);
              return;
            }
            if (!this.isNotAuthorized) {
              this.notify.push(stockCountErrorMessage(this.translate, err), 'error');
            }
          },
        })
    );
  }

  private feedbackFrom(res: StockCountScanResponse): { tone: 'ok' | 'warn' | 'info'; text: string } {
    const name = res.product?.name || res.product?.code || res.rawCode || '';
    if (res.feedback === 'matched') {
      return {
        tone: 'ok',
        text: this.translate.instant('tr_stock_count_feedback_matched', { name }),
      };
    }
    if (res.feedback === 'already_scanned') {
      return {
        tone: 'info',
        text: this.translate.instant('tr_stock_count_feedback_already', { name }),
      };
    }
    if (res.feedback === 'ambiguous') {
      return {
        tone: 'warn',
        text: this.translate.instant('tr_stock_count_feedback_ambiguous'),
      };
    }
    return {
      tone: 'warn',
      text: this.translate.instant('tr_stock_count_feedback_surplus', {
        name,
        reason: this.reasonLabel(res.reason),
      }),
    };
  }

  private downloadCsv(lines: StockCountLine[]): void {
    const qty = this.showQtyColumns;
    const headers = qty
      ? [
          this.translate.instant('tr_stock_count_product'),
          this.translate.instant('tr_stock_count_code'),
          this.translate.instant('tr_stock_count_categories'),
          this.translate.instant('tr_stock_count_qty_expected'),
          this.translate.instant('tr_stock_count_qty_scanned'),
          this.translate.instant('tr_stock_count_qty_diff'),
        ]
      : [
          this.translate.instant('tr_stock_count_product'),
          this.translate.instant('tr_stock_count_code'),
          this.translate.instant('tr_stock_count_categories'),
          this.section === 'surplus'
            ? this.translate.instant('tr_stock_count_reason')
            : this.translate.instant('tr_stock_count_scanned_at'),
        ];
    const body = lines.map((line) => {
      const base = [
        line.name || '',
        line.code || line.rawCode || '',
        line.categoryName || '',
      ];
      if (qty) {
        base.push(
          String(line.expectedQty ?? ''),
          String(line.scannedQty ?? ''),
          String(this.lineDiff(line))
        );
      } else if (this.section === 'surplus') {
        base.push(this.reasonLabel(line.reason));
      } else {
        base.push(this.formatWhen(line.scannedAt));
      }
      return base.map((cell) => this.csvCell(cell)).join(',');
    });
    const csv = `\uFEFF${headers.map((cell) => this.csvCell(cell)).join(',')}\n${body.join('\n')}`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `stock-count-${this.section}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  private csvCell(value: string): string {
    if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
    return value;
  }

  private focusScan(): void {
    if (!this.isOpen) return;
    setTimeout(() => this.scanInput?.nativeElement?.focus(), 0);
  }
}

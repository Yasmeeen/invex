import { Component, OnDestroy, OnInit } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { ActivatedRoute, Router } from '@angular/router';
import { Globals } from '@core/globals';
import { PaginationData } from '@core/models/users-interfaces.model';
import { TranslateService } from '@ngx-translate/core';
import { AppNotificationService } from '@shared/services/app-notification.service';
import {
  MoneyAccountKind,
  TreasuryAccountsService,
  TreasuryLedgerEntry,
} from '@shared/services/treasury-accounts.service';
import { Subscription } from 'rxjs';
import { TreasuryOpeningDialogComponent } from '../treasury-opening-dialog/treasury-opening-dialog.component';
import { TreasuryTransferDialogComponent } from '../treasury-transfer-dialog/treasury-transfer-dialog.component';

@Component({
  selector: 'app-treasury-account-detail',
  templateUrl: './treasury-account-detail.component.html',
  styleUrls: ['./treasury-account-detail.component.scss'],
})
export class TreasuryAccountDetailComponent implements OnInit, OnDestroy {
  accountKey = '';
  branchId = '';
  label = '';
  kind: MoneyAccountKind = 'treasury';
  channel = '';
  accountNumber = '';
  phone = '';
  expectedBalance = 0;
  openingBalance = 0;
  entries: TreasuryLedgerEntry[] = [];
  loading = true;
  isNotAuthorized = false;
  dateFrom = '';
  dateTo = '';
  paginationData: PaginationData;
  page = 1;
  limit = 30;

  private subscriptions: Subscription[] = [];

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private treasury: TreasuryAccountsService,
    private dialog: MatDialog,
    private notify: AppNotificationService,
    private translate: TranslateService,
    public globals: Globals
  ) {}

  ngOnInit(): void {
    this.subscriptions.push(
      this.route.paramMap.subscribe((pm) => {
        this.accountKey = pm.get('accountKey') || '';
        this.branchId = this.route.snapshot.queryParamMap.get('branch') || '';
        if (!this.branchId) {
          this.branchId = String(this.globals.currentUser?.branch || '');
        }
        this.loadAll();
      })
    );
  }

  get isSettlement(): boolean {
    return this.kind === 'settlement';
  }

  get canSetOpening(): boolean {
    const r = this.globals.currentUser?.role;
    return r === 'Super Admin' || r === 'Co Admin' || r === 'Branch Manager';
  }

  loadAll(): void {
    this.loadHeader();
    this.loadLedger();
  }

  loadHeader(): void {
    const uid = this.globals.currentUser?._id;
    if (!uid || !this.branchId || !this.accountKey) return;
    this.subscriptions.push(
      this.treasury
        .getAccount({ key: this.accountKey, userId: uid, branch: this.branchId })
        .subscribe({
          next: (res) => {
            this.label = res.account?.label || this.accountKey;
            this.kind = res.account?.kind || 'treasury';
            this.channel = res.account?.channel || '';
            this.accountNumber = res.account?.accountNumber || '';
            this.phone = res.account?.phone || '';
            this.expectedBalance = res.expectedBalance;
            this.openingBalance = res.openingBalance;
          },
          error: (err) => {
            this.isNotAuthorized = err.status === 403;
            if (!this.isNotAuthorized) {
              this.notify.push(
                err?.error?.error || this.translate.instant('tr_unexpected_error_message'),
                'error'
              );
            }
          },
        })
    );
  }

  loadLedger(): void {
    const uid = this.globals.currentUser?._id;
    if (!uid || !this.branchId || !this.accountKey) {
      this.loading = false;
      return;
    }
    this.loading = true;
    this.subscriptions.push(
      this.treasury
        .listLedger({
          key: this.accountKey,
          userId: uid,
          branch: this.branchId,
          from: this.dateFrom || undefined,
          to: this.dateTo || undefined,
          page: this.page,
          limit: this.limit,
        })
        .subscribe({
          next: (res) => {
            this.entries = res.entries || [];
            this.paginationData = {
              currentPage: res.page,
              totalCount: res.total,
              totalPages: Math.max(1, Math.ceil(res.total / res.limit)),
              nextPage: res.page + 1,
              prevPage: res.page - 1,
            };
            this.loading = false;
          },
          error: (err) => {
            this.loading = false;
            this.isNotAuthorized = err.status === 403;
            if (!this.isNotAuthorized) {
              this.notify.push(
                err?.error?.error || this.translate.instant('tr_unexpected_error_message'),
                'error'
              );
            }
          },
        })
    );
  }

  applyFilters(): void {
    this.page = 1;
    this.loadLedger();
  }

  onPageChange(page: number): void {
    this.page = page;
    this.loadLedger();
  }

  sourceLabel(t: string): string {
    const key = `tr_treasury_source_${t}`;
    const tr = this.translate.instant(key);
    return tr === key ? t : tr;
  }

  back(): void {
    this.router.navigate(['/treasury']);
  }

  openTransfer(isSettlement = false): void {
    const ref = this.dialog.open(TreasuryTransferDialogComponent, {
      width: '480px',
      panelClass: 'treasury-transfer-dialog-panel',
      data: {
        branchId: this.branchId,
        isSettlement,
        preferFrom: this.accountKey,
      },
    });
    this.subscriptions.push(
      ref.afterClosed().subscribe((ok) => {
        if (ok) this.loadAll();
      })
    );
  }

  openQuickSettle(): void {
    const ref = this.dialog.open(TreasuryTransferDialogComponent, {
      width: '420px',
      panelClass: 'treasury-transfer-dialog-panel',
      data: {
        branchId: this.branchId,
        quickSettle: true,
        preferFrom: this.accountKey,
      },
    });
    this.subscriptions.push(
      ref.afterClosed().subscribe((ok) => {
        if (ok) this.loadAll();
      })
    );
  }

  openOpening(): void {
    const ref = this.dialog.open(TreasuryOpeningDialogComponent, {
      width: '420px',
      panelClass: 'treasury-transfer-dialog-panel',
      data: {
        branchId: this.branchId,
        accountKey: this.accountKey,
        label: this.label,
        currentOpening: this.openingBalance,
      },
    });
    this.subscriptions.push(
      ref.afterClosed().subscribe((ok) => {
        if (ok) this.loadAll();
      })
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach((s) => s.unsubscribe());
  }
}

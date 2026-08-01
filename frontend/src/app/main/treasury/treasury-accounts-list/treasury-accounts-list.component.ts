import { Component, OnDestroy, OnInit } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { Globals } from '@core/globals';
import { Branch } from '@core/models/products.model';
import { canPickBranchRole } from '@core/utils/role-utils';
import { TranslateService } from '@ngx-translate/core';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { BranchesServce } from '@shared/services/branches.service';
import {
  MoneyAccountBalance,
  TreasuryAccountsService,
} from '@shared/services/treasury-accounts.service';
import { Subscription } from 'rxjs';
import { TreasuryTransferDialogComponent } from '../treasury-transfer-dialog/treasury-transfer-dialog.component';

const VIEW_MODE_KEY = 'treasury.viewMode';

@Component({
  selector: 'app-treasury-accounts-list',
  templateUrl: './treasury-accounts-list.component.html',
  styleUrls: ['./treasury-accounts-list.component.scss'],
})
export class TreasuryAccountsListComponent implements OnInit, OnDestroy {
  accounts: MoneyAccountBalance[] = [];
  loading = true;
  isNotAuthorized = false;
  branches: Branch[] = [];
  filterBranchId = '';
  untilDate = '';
  viewMode: 'table' | 'cards' = 'cards';

  private subscriptions: Subscription[] = [];

  constructor(
    private treasury: TreasuryAccountsService,
    private dialog: MatDialog,
    private branchesService: BranchesServce,
    private notify: AppNotificationService,
    private translate: TranslateService,
    private router: Router,
    public globals: Globals
  ) {}

  ngOnInit(): void {
    const saved = localStorage.getItem(VIEW_MODE_KEY);
    this.viewMode = saved === 'table' ? 'table' : 'cards';

    if (canPickBranchRole(this.globals.currentUser?.role)) {
      this.subscriptions.push(
        this.branchesService.getBranchs({ page: 1, limit: 1000 }).subscribe({
          next: (res: any) => {
            this.branches = res?.branches || [];
            if (!this.filterBranchId && this.branches.length) {
              this.filterBranchId = this.branches[0]._id;
              this.load();
            }
          },
          error: () => {
            this.notify.push(this.translate.instant('tr_unexpected_error_message'), 'error');
          },
        })
      );
    } else {
      this.filterBranchId = String(this.globals.currentUser?.branch || '');
      this.load();
    }
  }

  get showBranchFilter(): boolean {
    return canPickBranchRole(this.globals.currentUser?.role);
  }

  setViewMode(mode: 'table' | 'cards'): void {
    this.viewMode = mode;
    localStorage.setItem(VIEW_MODE_KEY, mode);
  }

  load(): void {
    const uid = this.globals.currentUser?._id;
    if (!uid || !this.filterBranchId) {
      this.loading = false;
      return;
    }
    this.loading = true;
    this.subscriptions.push(
      this.treasury
        .listAccounts({
          userId: uid,
          branch: this.filterBranchId,
          until: this.untilDate || undefined,
        })
        .subscribe({
          next: (res) => {
            this.accounts = res.accounts || [];
            this.loading = false;
          },
          error: (err) => {
            this.loading = false;
            this.isNotAuthorized = err.status === 403;
            if (!this.isNotAuthorized) {
              const msg =
                err?.error?.error || this.translate.instant('tr_unexpected_error_message');
              this.notify.push(msg, 'error');
            }
          },
        })
    );
  }

  kindLabel(kind: string): string {
    if (kind === 'cash') return this.translate.instant('tr_treasury_kind_cash');
    if (kind === 'settlement') return this.translate.instant('tr_treasury_kind_settlement');
    return this.translate.instant('tr_treasury_kind_treasury');
  }

  kindIcon(kind: string): string {
    if (kind === 'cash') return 'fa-money';
    if (kind === 'settlement') return 'fa-mobile';
    return 'fa-university';
  }

  openAccount(acc: MoneyAccountBalance): void {
    this.router.navigate(['/treasury', acc.key], {
      queryParams: { branch: this.filterBranchId },
    });
  }

  openTransfer(isSettlement = false): void {
    const ref = this.dialog.open(TreasuryTransferDialogComponent, {
      width: '480px',
      panelClass: 'treasury-transfer-dialog-panel',
      data: {
        branchId: this.filterBranchId,
        accounts: this.accounts,
        isSettlement,
      },
    });
    this.subscriptions.push(
      ref.afterClosed().subscribe((ok) => {
        if (ok) this.load();
      })
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach((s) => s.unsubscribe());
  }
}

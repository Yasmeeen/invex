import { Component, Inject, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { formatDate } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
import { Branch } from '@core/models/products.model';
import { AuthenticationService } from '@core/services/authentication.service';
import { canPickBranchRole } from '@core/utils/role-utils';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { BranchesServce } from '@shared/services/branches.service';
import { DrawerClosePreview, DrawerCloseService } from '@shared/services/drawer-close.service';

export interface DrawerCloseDialogData {
  userId: string;
  forcedBranchId?: string | null;
  businessDate?: string;
}

function round2(n: number): number {
  return Math.round(Number(n || 0) * 100) / 100;
}

@Component({
  selector: 'app-drawer-close-dialog',
  templateUrl: './drawer-close-dialog.component.html',
  styleUrls: ['./drawer-close-dialog.component.scss'],
})
export class DrawerCloseDialogComponent implements OnInit {
  step: 1 | 2 = 1;
  preview: DrawerClosePreview | null = null;
  previewLoading = false;
  previewError = false;
  saving = false;

  branches: Branch[] = [];
  showBranchPicker = false;
  private fixedBranchId: string | null = null;

  businessDateStr = '';

  countForm: FormGroup;
  shortageReasonForm: FormGroup;

  constructor(
    private fb: FormBuilder,
    private dialogRef: MatDialogRef<DrawerCloseDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public data: DrawerCloseDialogData,
    private auth: AuthenticationService,
    private drawerClose: DrawerCloseService,
    private branchesService: BranchesServce,
    private notify: AppNotificationService,
    private translate: TranslateService
  ) {
    const actor = this.auth.getUserFromLocalStorage();
    const forced = data.forcedBranchId ? String(data.forcedBranchId).trim() : '';

    if (forced) {
      this.fixedBranchId = forced;
      this.showBranchPicker = false;
    } else if (canPickBranchRole(actor?.role)) {
      this.showBranchPicker = true;
      this.fixedBranchId = null;
    } else {
      const b = actor?.branch as { _id?: string } | string | undefined;
      const bmBranch =
        typeof b === 'string' ? String(b).trim() : b?._id ? String(b._id).trim() : '';
      this.fixedBranchId = bmBranch || null;
      this.showBranchPicker = false;
    }

    const initialDate =
      data.businessDate?.trim() ||
      formatDate(new Date(), 'yyyy-MM-dd', 'en-US');

    this.businessDateStr = initialDate;

    this.countForm = this.fb.group({
      branchId: [this.fixedBranchId || '', this.showBranchPicker ? Validators.required : []],
      businessDate: [initialDate, Validators.required],
    });

    this.shortageReasonForm = this.fb.group({
      actualCashCounted: ['', [Validators.required, Validators.min(0)]],
      shortageReason: ['', Validators.maxLength(2000)],
    });
  }

  ngOnInit(): void {
    if (this.fixedBranchId) {
      this.countForm.patchValue({ branchId: this.fixedBranchId });
      this.countForm.get('branchId')?.disable();
    }

    if (this.showBranchPicker) {
      this.branchesService.getBranchs({ page: 1, limit: 1000 }).subscribe({
        next: (res: any) => {
          this.branches = res?.branches || [];
          const first = this.branches[0]?._id;
          if (first && !this.countForm.get('branchId')?.value) {
            this.countForm.patchValue({ branchId: first });
          }
          this.loadPreview();
        },
        error: () => {
          this.notify.push(this.translate.instant('tr_unexpected_error_message'), 'error');
        },
      });
      return;
    }

    if (!this.countForm.get('branchId')?.value) {
      this.notify.push(this.translate.instant('tr_branch_required'), 'error');
      this.dialogRef.close(false);
      return;
    }

    this.loadPreview();
  }

  effectiveBranchId(): string {
    const raw = this.countForm.getRawValue();
    return String(raw.branchId || '').trim();
  }

  loadPreview(): void {
    const branchId = this.effectiveBranchId();
    const dateRaw = String(this.countForm.get('businessDate')?.value || '').trim();
    if (!branchId || !dateRaw) {
      return;
    }

    this.previewLoading = true;
    this.previewError = false;
    this.preview = null;

    this.drawerClose
      .preview({
        userId: this.data.userId,
        branch: branchId,
        date: dateRaw,
      })
      .subscribe({
        next: (p) => {
          this.preview = p;
          this.previewLoading = false;
          this.previewError = false;
        },
        error: (err) => {
          this.previewLoading = false;
          this.previewError = true;
          const msg = err?.error?.error || this.translate.instant('tr_unexpected_error_message');
          this.notify.push(msg, 'error');
        },
      });
  }

  onBusinessDateChange(): void {
    this.loadPreview();
  }

  methodEntries(obj: Record<string, number> | undefined): [string, number][] {
    return Object.entries(obj || {})
      .filter(([, v]) => round2(Number(v)) !== 0)
      .sort((a, b) => a[0].localeCompare(b[0]));
  }

  payMethodLabel(method: string): string {
    const m = String(method || '').toLowerCase();
    const key = `tr_pay_${m}`;
    const t = this.translate.instant(key);
    return t !== key ? t : method;
  }

  goToConfirm(): void {
    if (this.previewLoading || !this.preview) {
      if (!this.previewLoading && !this.preview) {
        this.notify.push(this.translate.instant('tr_drawer_close_preview_required'), 'error');
      }
      return;
    }
    this.step = 2;
    const exp = this.preview.expectedCashInDrawer;
    this.shortageReasonForm.patchValue({
      actualCashCounted: round2(exp),
      shortageReason: '',
    });
  }

  goBack(): void {
    this.step = 1;
  }

  variance(): number {
    const exp = this.preview?.expectedCashInDrawer ?? 0;
    const raw = this.shortageReasonForm.get('actualCashCounted')?.value;
    const a = round2(Number(raw));
    if (!Number.isFinite(a)) return 0;
    return round2(a - exp);
  }

  isShortage(): boolean {
    return this.variance() < -0.02;
  }

  isBalanced(): boolean {
    return Math.abs(this.variance()) <= 0.02;
  }

  submit(): void {
    if (!this.preview) return;

    this.shortageReasonForm.markAllAsTouched();
    const actualRaw = this.shortageReasonForm.get('actualCashCounted')?.value;
    const actual = round2(Number(actualRaw));
    if (!Number.isFinite(actual) || actual < 0 || this.shortageReasonForm.get('actualCashCounted')?.invalid) {
      return;
    }

    const short = this.isShortage();
    const reason = String(this.shortageReasonForm.get('shortageReason')?.value || '').trim();
    if (short && !reason) {
      this.shortageReasonForm.get('shortageReason')?.markAsTouched();
      this.notify.push(this.translate.instant('tr_drawer_close_shortage_reason_required'), 'error');
      return;
    }

    const branchId = this.effectiveBranchId();
    const dateStr = String(this.countForm.get('businessDate')?.value || '').trim();
    if (!branchId || !dateStr) {
      this.notify.push(this.translate.instant('tr_branch_required'), 'error');
      return;
    }

    this.saving = true;
    this.drawerClose
      .close({
        branch: branchId,
        businessDate: dateStr,
        userId: this.data.userId,
        actualCashCounted: actual,
        ...(short ? { shortageReason: reason } : {}),
      })
      .subscribe({
        next: () => {
          this.saving = false;
          this.notify.push(this.translate.instant('tr_drawer_close_saved'), 'success');
          this.dialogRef.close(true);
        },
        error: (err) => {
          this.saving = false;
          const msg = err?.error?.error || this.translate.instant('tr_unexpected_error_message');
          this.notify.push(msg, 'error');
        },
      });
  }

  cancel(): void {
    this.dialogRef.close(false);
  }
}

import { Component, OnDestroy, OnInit } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
import { AppNotificationService } from '@shared/services/app-notification.service';
import {
  InstallmentPlan,
  InstallmentPlansService,
} from '@shared/services/installment-plans.service';
import { Subscription } from 'rxjs';
import {
  InstallmentPlanFormDialogComponent,
  InstallmentPlanFormResult,
} from './installment-plan-form-dialog/installment-plan-form-dialog.component';

@Component({
  selector: 'app-installment-plans-settings',
  templateUrl: './installment-plans-settings.component.html',
  styleUrls: ['./installment-plans-settings.component.scss'],
})
export class InstallmentPlansSettingsComponent implements OnInit, OnDestroy {
  plans: InstallmentPlan[] = [];
  loading = false;
  saving = false;

  private subs: Subscription[] = [];

  constructor(
    private plansService: InstallmentPlansService,
    private notify: AppNotificationService,
    private translate: TranslateService,
    private dialog: MatDialog
  ) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.subs.push(
      this.plansService.list(false).subscribe({
        next: (res) => {
          this.loading = false;
          this.plans = res?.plans || [];
        },
        error: () => {
          this.loading = false;
          this.notify.push(this.translate.instant('tr_unexpected_error_message'), 'error');
        },
      })
    );
  }

  openAdd(): void {
    this.openFormDialog('add');
  }

  openEdit(plan: InstallmentPlan): void {
    this.openFormDialog('edit', plan);
  }

  private openFormDialog(mode: 'add' | 'edit', plan?: InstallmentPlan): void {
    if (this.saving) return;
    const ref = this.dialog.open(InstallmentPlanFormDialogComponent, {
      width: '480px',
      maxWidth: '95vw',
      panelClass: 'installment-plan-form-dialog-panel',
      backdropClass: 'installment-plan-form-dialog-backdrop',
      data: {
        mode,
        plan,
        defaultSortOrder: this.plans.length,
      },
    });

    this.subs.push(
      ref.afterClosed().subscribe((result: InstallmentPlanFormResult | false | undefined) => {
        if (!result) return;
        this.persist(mode, result, plan?._id);
      })
    );
  }

  private persist(
    mode: 'add' | 'edit',
    payload: InstallmentPlanFormResult,
    editingId?: string
  ): void {
    if (this.saving) return;
    this.saving = true;
    const req$ =
      mode === 'edit' && editingId
        ? this.plansService.update(editingId, payload)
        : this.plansService.create(payload);

    this.subs.push(
      req$.subscribe({
        next: () => {
          this.saving = false;
          this.notify.push(
            this.translate.instant(
              mode === 'edit' ? 'tr_installment_plan_update_ok' : 'tr_installment_plan_create_ok'
            ),
            'success'
          );
          this.load();
        },
        error: (err) => {
          this.saving = false;
          const msg =
            err?.error?.error || err?.error?.message || this.translate.instant('tr_unexpected_error_message');
          this.notify.push(msg, 'error');
        },
      })
    );
  }

  remove(plan: InstallmentPlan): void {
    if (!plan?._id || this.saving) return;
    const ok = window.confirm(this.translate.instant('tr_installment_plan_delete_confirm'));
    if (!ok) return;
    this.saving = true;
    this.subs.push(
      this.plansService.delete(plan._id).subscribe({
        next: () => {
          this.saving = false;
          this.notify.push(this.translate.instant('tr_installment_plan_delete_ok'), 'success');
          this.load();
        },
        error: (err) => {
          this.saving = false;
          const msg =
            err?.error?.error || err?.error?.message || this.translate.instant('tr_unexpected_error_message');
          this.notify.push(msg, 'error');
        },
      })
    );
  }

  ngOnDestroy(): void {
    this.subs.forEach((s) => s && s.unsubscribe());
  }
}

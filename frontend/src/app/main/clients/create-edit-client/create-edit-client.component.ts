import { Component, Inject, OnInit, ViewChild } from '@angular/core';
import { NgForm } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Branch } from '@core/models/products.model';
import { TranslateService } from '@ngx-translate/core';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { BranchesServce } from '@shared/services/branches.service';
import { UserSerivce } from '@shared/services/user.service';

@Component({
  selector: 'app-create-edit-client',
  templateUrl: './create-edit-client.component.html',
  styleUrls: ['./create-edit-client.component.scss'],
})
export class CreateEditClientComponent implements OnInit {
  @ViewChild('clientForm') clientForm: NgForm;

  isSubmitting = false;
  branches: Branch[] = [];

  constructor(
    private dialogRef: MatDialogRef<CreateEditClientComponent>,
    private users: UserSerivce,
    private branchesService: BranchesServce,
    private notify: AppNotificationService,
    private translate: TranslateService,
    @Inject(MAT_DIALOG_DATA) public data: Record<string, never>
  ) {}

  ngOnInit(): void {
    this.branchesService.getBranchs({ page: 1, limit: 1000 }).subscribe({
      next: (res: any) => {
        this.branches = res?.branches || [];
      },
      error: () => {
        this.notify.push(this.translate.instant('tr_unexpected_error_message'), 'error');
      },
    });
  }

  submit(): void {
    if (this.isSubmitting) return;
    this.clientForm.form.markAllAsTouched();
    if (!this.clientForm.valid) return;

    const v = this.clientForm.form.getRawValue();
    this.isSubmitting = true;
    this.users
      .createClient({
        name: String(v.name || '').trim(),
        phoneNumber: String(v.phoneNumber || '').trim(),
        address: String(v.address || '').trim(),
        branches: v.branches || [],
      })
      .subscribe({
        next: () => {
          this.isSubmitting = false;
          this.notify.push(this.translate.instant('tr_client_create_ok'), 'success');
          this.dialogRef.close(true);
        },
        error: (err) => {
          this.isSubmitting = false;
          const msg =
            err?.error?.error || err?.error?.message || this.translate.instant('tr_unexpected_error_message');
          this.notify.push(msg, 'error');
        },
      });
  }

  closeModal(): void {
    this.dialogRef.close(false);
  }
}

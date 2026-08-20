import { Component, Inject, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { NgForm } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Branch } from '@core/models/products.model';
import { Client } from '@core/models/users-interfaces.model';
import { TranslateService } from '@ngx-translate/core';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { BranchesServce } from '@shared/services/branches.service';
import { CloudinaryUploadService } from '@shared/services/cloudinary-upload.service';
import { CollectionsService, CollectorUser } from '@shared/services/collections.service';
import { UserSerivce } from '@shared/services/user.service';
import { Subscription } from 'rxjs';

type ClientFormTab = 'basic' | 'guarantor';

@Component({
  selector: 'app-create-edit-client',
  templateUrl: './create-edit-client.component.html',
  styleUrls: ['./create-edit-client.component.scss'],
})
export class CreateEditClientComponent implements OnInit, OnDestroy {
  @ViewChild('clientForm') clientForm: NgForm;

  clientId = '';
  isEdit = false;
  isSubmitting = false;
  branches: Branch[] = [];
  collectors: CollectorUser[] = [];
  selectedCollectorId: string | null = null;
  activeTab: ClientFormTab = 'basic';

  additionalPhones: string[] = [];
  additionalAddresses: string[] = [];
  nationalIdImageUrl = '';
  guarantorNationalIdImageUrl = '';
  isUploadingClientId = false;
  isUploadingGuarantorId = false;

  private subscriptions: Subscription[] = [];

  constructor(
    private dialogRef: MatDialogRef<CreateEditClientComponent>,
    private users: UserSerivce,
    private branchesService: BranchesServce,
    private collections: CollectionsService,
    private notify: AppNotificationService,
    private translate: TranslateService,
    private cloudinaryUpload: CloudinaryUploadService,
    @Inject(MAT_DIALOG_DATA) public data: { isEdit?: boolean; client?: Client; clientId?: string }
  ) {}

  ngOnInit(): void {
    this.clientId = this.data?.clientId || this.data?.client?._id || '';
    this.isEdit = this.data?.isEdit || false;

    this.subscriptions.push(
      this.collections.listCollectors().subscribe({
        next: (res) => {
          this.collectors = res?.collectors || [];
        },
      })
    );

    this.subscriptions.push(
      this.branchesService.getBranchs({ page: 1, limit: 1000 }).subscribe({
        next: (res: any) => {
          this.branches = res?.branches || [];
          if (this.isEdit && this.clientId) {
            this.loadClientData();
          }
        },
        error: () => {
          this.notify.push(this.translate.instant('tr_unexpected_error_message'), 'error');
        },
      })
    );
  }

  setTab(tab: ClientFormTab): void {
    this.activeTab = tab;
  }

  addPhone(): void {
    this.additionalPhones = [...this.additionalPhones, ''];
  }

  removePhone(index: number): void {
    this.additionalPhones = this.additionalPhones.filter((_, i) => i !== index);
  }

  trackByIndex(index: number): number {
    return index;
  }

  addAddress(): void {
    this.additionalAddresses = [...this.additionalAddresses, ''];
  }

  removeAddress(index: number): void {
    this.additionalAddresses = this.additionalAddresses.filter((_, i) => i !== index);
  }

  onClientIdSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input?.files?.[0];
    if (!file) return;
    this.isUploadingClientId = true;
    this.subscriptions.push(
      this.cloudinaryUpload.uploadProductImage(file, 'clients/national-id').subscribe({
        next: (url) => {
          this.isUploadingClientId = false;
          this.nationalIdImageUrl = url || '';
          this.notify.push(this.translate.instant('tr_client_id_image_upload_ok'), 'success');
          input.value = '';
        },
        error: () => {
          this.isUploadingClientId = false;
          this.notify.push(this.translate.instant('tr_client_id_image_upload_failed'), 'error');
          input.value = '';
        },
      })
    );
  }

  clearClientIdImage(): void {
    this.nationalIdImageUrl = '';
  }

  onGuarantorIdSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input?.files?.[0];
    if (!file) return;
    this.isUploadingGuarantorId = true;
    this.subscriptions.push(
      this.cloudinaryUpload.uploadProductImage(file, 'clients/guarantor-id').subscribe({
        next: (url) => {
          this.isUploadingGuarantorId = false;
          this.guarantorNationalIdImageUrl = url || '';
          this.notify.push(this.translate.instant('tr_client_id_image_upload_ok'), 'success');
          input.value = '';
        },
        error: () => {
          this.isUploadingGuarantorId = false;
          this.notify.push(this.translate.instant('tr_client_id_image_upload_failed'), 'error');
          input.value = '';
        },
      })
    );
  }

  clearGuarantorIdImage(): void {
    this.guarantorNationalIdImageUrl = '';
  }

  private loadClientData(): void {
    this.subscriptions.push(
      this.users.getClient(this.clientId).subscribe({
        next: (client: any) => {
          const branchIds = (client.branches || []).map((b: string | { _id: string }) =>
            typeof b === 'string' ? b : b._id
          );
          this.additionalPhones = [...(client.additionalPhoneNumbers || [])];
          this.additionalAddresses = [...(client.additionalAddresses || [])];
          this.nationalIdImageUrl = String(client.nationalIdImageUrl || '');
          this.selectedCollectorId = client.collectorId
            ? String(
                typeof client.collectorId === 'object'
                  ? (client.collectorId as any)._id
                  : client.collectorId
              )
            : null;
          const g = client.guarantor || {};
          this.guarantorNationalIdImageUrl = String(g.nationalIdImageUrl || '');
          this.clientForm.form.patchValue({
            name: client.name,
            phoneNumber: client.phoneNumber,
            address: client.address,
            branches: branchIds,
            collectorId: this.selectedCollectorId,
            guarantorName: g.name || '',
            guarantorPhone: g.phoneNumber || '',
            guarantorNationalId: g.nationalId || '',
            guarantorAddress: g.address || '',
            guarantorNotes: g.notes || '',
          });
        },
        error: () => {
          this.notify.push(this.translate.instant('tr_unexpected_error_message'), 'error');
        },
      })
    );
  }

  private buildPayload(v: any) {
    const phones = this.additionalPhones.map((p) => String(p || '').trim()).filter(Boolean);
    const addresses = this.additionalAddresses.map((a) => String(a || '').trim()).filter(Boolean);
    return {
      name: String(v.name || '').trim(),
      phoneNumber: String(v.phoneNumber || '').trim(),
      address: String(v.address || '').trim(),
      branches: v.branches || [],
      additionalPhoneNumbers: phones,
      additionalAddresses: addresses,
      nationalIdImageUrl: this.nationalIdImageUrl || '',
      collectorId: v.collectorId || this.selectedCollectorId || null,
      guarantor: {
        name: String(v.guarantorName || '').trim(),
        phoneNumber: String(v.guarantorPhone || '').trim(),
        nationalId: String(v.guarantorNationalId || '').trim(),
        address: String(v.guarantorAddress || '').trim(),
        nationalIdImageUrl: this.guarantorNationalIdImageUrl || '',
        notes: String(v.guarantorNotes || '').trim(),
      },
    };
  }

  submit(): void {
    if (this.isSubmitting || this.isUploadingClientId || this.isUploadingGuarantorId) return;
    this.clientForm.form.markAllAsTouched();
    if (!this.clientForm.valid) {
      this.activeTab = 'basic';
      return;
    }

    const payload = this.buildPayload(this.clientForm.form.getRawValue());
    this.isSubmitting = true;

    if (this.isEdit) {
      this.users.updateClient(this.clientId, payload).subscribe({
        next: () => {
          this.isSubmitting = false;
          this.notify.push(this.translate.instant('tr_client_update_ok'), 'success');
          this.dialogRef.close(true);
        },
        error: (err) => {
          this.isSubmitting = false;
          const msg =
            err?.error?.error || err?.error?.message || this.translate.instant('tr_unexpected_error_message');
          this.notify.push(msg, 'error');
        },
      });
      return;
    }

    this.users.createClient(payload).subscribe({
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

  ngOnDestroy(): void {
    this.subscriptions.forEach((s) => s && s.unsubscribe());
  }
}

import { Component, Inject, OnInit, ViewChild } from '@angular/core';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { BranchesServce } from '@shared/services/branches.service';
import { TranslateService } from '@ngx-translate/core';
import { Branch } from '@core/models/products.model';
import { NgForm } from '@angular/forms';
import { OpeningCelebrationService } from '@shared/services/opening-celebration.service';
import { StoreSettingsService } from '@shared/services/store-settings.service';

type BranchFormTabId = 'general' | 'salespeople' | 'delivery';

@Component({
  selector: 'app-create-edit-branch',
  templateUrl: './create-edit-branch.component.html',
  styleUrls: ['./create-edit-branch.component.scss']
})
export class CreateEditBranchComponent implements OnInit {
  branch: Branch ;
  branchId: string;
  isEdit: boolean;
  salespeople: { name: string }[] = [{ name: '' }];
  deliveryStaff: { name: string }[] = [{ name: '' }];
  deliveryOrdersEnabled = false;
  openingDate: Date | null = null;
  activeTab: BranchFormTabId = 'general';
  readonly generalTab = { id: 'general' as const, labelKey: 'tr_branch_tab_general', icon: 'fa-building' };
  readonly salespeopleTab = { id: 'salespeople' as const, labelKey: 'tr_branch_tab_salespeople', icon: 'fa-users' };
  readonly deliveryTab = { id: 'delivery' as const, labelKey: 'tr_branch_tab_delivery', icon: 'fa-truck' };
  @ViewChild('branchForm') branchForm: NgForm;

  constructor(
    private dialogRef: MatDialogRef<CreateEditBranchComponent>,
    private branchesService: BranchesServce,
    private appNotificationService: AppNotificationService,
    private translateService: TranslateService,
    private openingCelebration: OpeningCelebrationService,
    private storeSettings: StoreSettingsService,
    @Inject(MAT_DIALOG_DATA) public data: any
  ) {}

  closeModal(): void {
    this.dialogRef.close();
  }
  ngOnInit() {

    this.branchId = this.data.branchId
    this.isEdit = this.data.isEdit
    this.deliveryOrdersEnabled = Boolean(this.storeSettings.snapshot.deliveryOrdersEnabled);

    
    if(this.isEdit){
      this.getBranchData();
    }

  }

  getBranchData(){
    this.branchesService.getBranch(this.branchId).subscribe((response:any)=> {
      this.branchId = response._id
      this.openingDate = response.openingDate ? new Date(response.openingDate) : null;
      this.branchForm.form.patchValue({
        ...response,
        openingDate: this.openingDate,
      });
      const list = Array.isArray(response.salespeople) ? response.salespeople : [];
      this.salespeople = list.length
        ? list
            .filter((sp: { active?: boolean; name?: string }) => sp.active !== false)
            .map((sp: { name?: string }) => ({ name: sp.name || '' }))
        : [{ name: '' }];
      const deliveryList = Array.isArray(response.deliveryStaff) ? response.deliveryStaff : [];
      this.deliveryStaff = deliveryList.length
        ? deliveryList
            .filter((sp: { active?: boolean; name?: string }) => sp.active !== false)
            .map((sp: { name?: string }) => ({ name: sp.name || '' }))
        : [{ name: '' }];
    })
  }

  addSalesperson(): void {
    this.salespeople.push({ name: '' });
  }

  removeSalesperson(index: number): void {
    if (this.salespeople.length <= 1) {
      this.salespeople[0].name = '';
      return;
    }
    this.salespeople.splice(index, 1);
  }

  addDeliveryStaff(): void {
    this.deliveryStaff.push({ name: '' });
  }

  removeDeliveryStaff(index: number): void {
    if (this.deliveryStaff.length <= 1) {
      this.deliveryStaff[0].name = '';
      return;
    }
    this.deliveryStaff.splice(index, 1);
  }

  clearOpeningDate(event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    this.openingDate = null;
    this.branchForm?.form.patchValue({ openingDate: null });
    this.branchForm?.form.get('openingDate')?.markAsDirty();
  }

  private buildBranchPayload(): Branch {
    const formValue = this.branchForm.value;
    const openingRaw = formValue?.openingDate;
    const openingDate =
      openingRaw instanceof Date
        ? openingRaw.toLocaleDateString('en-CA')
        : openingRaw
          ? new Date(openingRaw).toLocaleDateString('en-CA')
          : null;
    return {
      ...formValue,
      openingDate,
      salespeople: this.salespeople
        .map((sp) => ({ name: String(sp.name || '').trim(), active: true }))
        .filter((sp) => sp.name.length > 0),
      deliveryStaff: this.deliveryStaff
        .map((sp) => ({ name: String(sp.name || '').trim(), active: true }))
        .filter((sp) => sp.name.length > 0),
    };
  }

  createBranch(){
    this.branch = this.buildBranchPayload();
    if (!this.branchForm.valid) {
      this.appNotificationService.push('Branch data is required.', 'error');
      return;
    }
    this.branchesService.createBranch(this.branch).subscribe({
      next: () => {
        this.appNotificationService.push('Branch created successfully!', 'success');
        this.openingCelebration.load(true);
        this.dialogRef.close(true);
      },
      error: () => {
        this.appNotificationService.push(
          this.translateService.instant('tr_unexpected_error_message'),
          'error'
        );
      }
    });
  }
  updateBranch(){
    this.branch = this.buildBranchPayload();
    if (!this.branchForm.valid) {
      this.appNotificationService.push('Branch data is required.', 'error');
      return;
    }
    this.branchesService.updateBranch(this.branchId, this.branch).subscribe({
      next: () => {
        this.appNotificationService.push('Branch updated successfully!', 'success');
        this.openingCelebration.load(true);
        this.dialogRef.close(true);
      },
      error: () => {
        this.appNotificationService.push(
          this.translateService.instant('tr_unexpected_error_message'),
          'error'
        );
      }
    });
  }

  submitForm(): void {
    this.branchForm.onSubmit(null as any);
    if (!this.branchForm.valid) {
      this.activeTab = 'general';
      return;
    }

    if (this.isEdit) {
      this.updateBranch();
    } else {
      this.createBranch();
    }
  }

}

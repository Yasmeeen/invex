import { Component, Inject, OnInit, ViewChild } from '@angular/core';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { BranchesServce } from '@shared/services/branches.service';
import { TranslateService } from '@ngx-translate/core';
import { Branch } from '@core/models/products.model';
import { NgForm } from '@angular/forms';

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
  @ViewChild('branchForm') branchForm: NgForm;

  constructor(
    private dialogRef: MatDialogRef<CreateEditBranchComponent>,
    private branchesService: BranchesServce,
    private appNotificationService: AppNotificationService,
    private translateService: TranslateService,
    @Inject(MAT_DIALOG_DATA) public data: any
  ) {}

  closeModal(): void {
    this.dialogRef.close();
  }
  ngOnInit() {

    this.branchId = this.data.branchId
    this.isEdit = this.data.isEdit

    
    if(this.isEdit){
      this.getBranchData();
    }

  }

  getBranchData(){
    this.branchesService.getBranch(this.branchId).subscribe((response:any)=> {
      this.branchId = response._id
      this.branchForm.form.patchValue(response);
      const list = Array.isArray(response.salespeople) ? response.salespeople : [];
      this.salespeople = list.length
        ? list
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

  private buildBranchPayload(): Branch {
    const formValue = this.branchForm.value;
    return {
      ...formValue,
      salespeople: this.salespeople
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

    if(this.isEdit){
      this.updateBranch();
    }
    else{
      this.createBranch();
    }

  
  }

}

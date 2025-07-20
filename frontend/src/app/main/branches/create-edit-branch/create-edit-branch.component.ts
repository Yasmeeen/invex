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
  @ViewChild('branchForm') branchForm: NgForm;
  constructor(
    private dialogRef: MatDialogRef<CreateEditBranchComponent>,
    private branchesService: BranchesServce,
    private appNotificationService: AppNotificationService,
    private translateService: TranslateService
  ) {}

  closeModal(): void {
    this.dialogRef.close();
  }
  ngOnInit() {

  }

  submitForm(): void {

    this.branch = this.branchForm.value;
    if (!this.branchForm.valid) {
      this.appNotificationService.push('Branch name is required.', 'error');
      return;
    }
console.log("this.branch",this.branch);


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
}

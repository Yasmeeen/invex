
import { Subscription } from 'rxjs';
import { BranchesServce } from '@shared/services/branches.service';

import { AppNotificationService } from '@shared/services/app-notification.service';
import { UserSerivce } from '@shared/services/user.service';
import { Component, ElementRef, Inject, OnInit, Output, ViewChild, EventEmitter } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { NgForm } from '@angular/forms';
import { TranslateService } from '@ngx-translate/core';
import { User } from '@core/models/users-interfaces.model';
import { Branch } from '@core/models/products.model';
import { isBranchlessUserRole } from '@core/utils/role-utils';

@Component({
  selector: 'app-create-edit-user',
  templateUrl: './create-edit-user.component.html',
  styleUrls: ['./create-edit-user.component.scss']
})
export class CreateEditUserComponent implements OnInit {

  userId: string;
  show: boolean;
  isSubmitting: boolean;
  isEdit: boolean = false;
  branches: Branch [] = [];
  user: User
  roles = [
    'Super Admin',
    'Co Admin',
    'Branch Manager',
    'Cashier',
    'Warehouse',
    'Moderator',
  ];

  /** Show branch picker only when the role is tied to one branch. */
  showBranchField(role: string | null | undefined): boolean {
    return !!role && !isBranchlessUserRole(role);
  }

  onRoleChange(role: string): void {
    if (isBranchlessUserRole(role) && this.basicInfoForm?.form) {
      this.basicInfoForm.form.patchValue({ branchId: null });
    }
  }

  private subscriptions: Subscription[] = [];

  @Output() destroyEmitter: EventEmitter<any> = new EventEmitter();
  @ViewChild('modalContainer') modalContainer: ElementRef;
  @ViewChild('modalContent') modalContent: ElementRef;
  @ViewChild('basicInfoForm') basicInfoForm: NgForm;

  constructor(

    private dialogRef: MatDialogRef<CreateEditUserComponent>,
    private appNotificationService: AppNotificationService,
    private userSerivce: UserSerivce,
    @Inject(MAT_DIALOG_DATA) public data: any,
    private branchesServce: BranchesServce,
    private translateService: TranslateService

  ) {}

  ngOnInit() {
    this.userId = this.data.userId
    this.isEdit = this.data.isEdit
    this.getBranches();
    if(this.isEdit){
    this.getUserData()
    }

  }

  getBranches() {
    let params = {
      'page': 1,
     'per_page': 1000
    }
    this.subscriptions.push(this.branchesServce.getBranchs(params).subscribe((response: any) => {
      this.branches = response.branches
    },(error:any)=> {

      this.appNotificationService.push( this.translateService.instant('tr_unexpected_error_message'), 'error');
    }))
  }


  getUserData() {
    this.userSerivce.getUser(this.userId).subscribe((response: any) => {
      this.userId = response._id;
      const v = { ...response };
      v.branchId = v.branch?._id ?? v.branch;
      const apply = () => {
        if (this.basicInfoForm?.form) {
          this.basicInfoForm.form.patchValue(v);
        }
      };
      apply();
      if (!this.basicInfoForm?.form) {
        setTimeout(apply, 0);
      }
    });
  }

  basicInfoFormSubmitted() {}

  createUser() {
    this.user = this.basicInfoForm.value;
    if (!this.basicInfoForm.valid) {
      return;
    }
    const payload: any = { ...this.user };
    if (isBranchlessUserRole(payload.role)) {
      delete payload.branchId;
    }

    this.userSerivce.createUser(payload).subscribe(() => {
      this.appNotificationService.push('user created successfully', 'sucess');
      this.closeModal(true);
    }, error=> {
      this.appNotificationService.push(error.error.error, 'error');
    });

  }

  updateUser() {
    if (!this.basicInfoForm.valid) {
      return;
    }
    const raw = this.basicInfoForm.value as any;
    this.user = { ...raw };
    const p = this.user.password;
    if (p == null || String(p).trim() === '') {
      delete (this.user as any).password;
    }
    if (isBranchlessUserRole((this.user as any).role)) {
      delete (this.user as any).branchId;
    }

    this.userSerivce.updateUser(this.userId, this.user).subscribe(() => {
      // localStorage.setItem('currentUser', JSON.stringify(this.user));

      this.appNotificationService.push('user updated successfully', 'sucess');
      this.closeModal(true);
    }, error=> {
      this.appNotificationService.push(error.error.error, 'error');
    });

  }

  submitForm(){
    if(this.isEdit){
      this.updateUser();
    }
    else{
      this.createUser();
    }
  }


  ngOnDestroy() {}

  destroyComponent() {
    this.destroyEmitter.emit();
  }
  closeModal(isSubmit?: boolean) {
    this.dialogRef.close(isSubmit);
  }
}

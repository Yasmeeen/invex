
import { Subscription } from 'rxjs';
import { BranchesServce } from '@shared/services/branches.service';

import { AppNotificationService } from '@shared/services/app-notification.service';
import { UserSerivce } from '@shared/services/user.service';
import { Component, ElementRef, Inject, OnInit, Output, ViewChild, EventEmitter } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { NgForm } from '@angular/forms';
import { TranslateService } from '@ngx-translate/core';
import { User } from '@core/models/users-interfaces.model';

@Component({
  selector: 'app-create-edit-user',
  templateUrl: './create-edit-user.component.html',
  styleUrls: ['./create-edit-user.component.scss']
})
export class CreateEditUserComponent implements OnInit {

  userId: string;
  isSubmitting: boolean;
  isEdit: boolean = false;
  user: User
  roles= [
    'Super Admin',
    'Employee'
  ]

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

  ) {}

  ngOnInit() {
    this.userId = this.data.userId
    this.isEdit = this.data.isEdit
    if(this.isEdit){
    this.getUserData()
     
    }

  }


  getUserData() {
    this.userSerivce.getUser(this.userId).subscribe((response:any)=> {
      this.userId = response.id
      this.basicInfoForm.form.patchValue(response);
    })
  }

  basicInfoFormSubmitted() {}

  createUser() {
    this.user = this.basicInfoForm.value;
    if (!this.basicInfoForm.valid) {
      return;
    }

    this.userSerivce.createUser(this.user).subscribe(() => {
      this.appNotificationService.push('user created successfully', 'sucess');
      this.closeModal(true);
    });

  }

  updateUser() {
    this.user = this.basicInfoForm.value;
    if (!this.basicInfoForm.valid) {
      return;
    }

    this.userSerivce.updateUser(this.user,this.userId).subscribe(() => {
      this.appNotificationService.push('user updated successfully', 'sucess');
      this.closeModal(true);
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

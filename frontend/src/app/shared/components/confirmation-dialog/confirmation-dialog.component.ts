import { Component, Injectable, Inject, OnInit } from '@angular/core';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';

@Injectable()
@Component({
    selector: 'confirmation-dialog',
    templateUrl: './confirmation-dialog.component.html',
    styleUrls: ['./confirmation-dialog.component.scss']
})

export class ConfirmationDialogComponent implements OnInit {
    ngOnInit() {
    }
    ngOnDestroy() {

    }
    closeModal(actionCallback?: string){
        this.dialogRef.close(actionCallback);
    }
    constructor(
        public dialogRef: MatDialogRef<ConfirmationDialogComponent>,
        @Inject(MAT_DIALOG_DATA) public data: any,
        ) {}
}

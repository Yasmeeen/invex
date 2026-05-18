import { Component, Injectable, Inject, OnInit } from '@angular/core';
import { MatLegacyDialogRef as MatDialogRef, MAT_LEGACY_DIALOG_DATA as MAT_DIALOG_DATA } from '@angular/material/legacy-dialog';

@Injectable()
@Component({
    selector: 'confirmation-dialog',
    templateUrl: './confirmation-dialog.component.html',
    styleUrls: ['./confirmation-dialog.component.scss'],
    standalone: false
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

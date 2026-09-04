import { Component } from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';
import { Globals } from '@core/globals';
import { TranslateService } from '@ngx-translate/core';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { Factory, FactoryService } from '@shared/services/factory.service';

@Component({
  selector: 'app-add-factory-dialog',
  templateUrl: './add-factory-dialog.component.html',
  styleUrls: ['./add-factory-dialog.component.scss'],
})
export class AddFactoryDialogComponent {
  name = '';
  address = '';
  notes = '';
  saving = false;

  constructor(
    private dialogRef: MatDialogRef<AddFactoryDialogComponent, Factory | null>,
    private factoryService: FactoryService,
    private notify: AppNotificationService,
    private translate: TranslateService,
    private globals: Globals
  ) {}

  close(): void {
    this.dialogRef.close(null);
  }

  submit(): void {
    const name = String(this.name || '').trim();
    if (!name || this.saving) return;
    const userId = this.globals.currentUser?._id || '';
    this.saving = true;
    this.factoryService
      .createFactory({
        userId,
        name,
        address: String(this.address || '').trim(),
        notes: String(this.notes || '').trim(),
      })
      .subscribe({
        next: (res) => {
          this.saving = false;
          this.notify.push(this.translate.instant('tr_factory_created'), 'success');
          this.dialogRef.close(res.factory);
        },
        error: (err) => {
          this.saving = false;
          this.notify.push(
            err?.error?.error || this.translate.instant('tr_factory_create_failed'),
            'error'
          );
        },
      });
  }
}

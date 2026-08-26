import { Component, Inject, OnInit } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { Globals } from '@core/globals';
import { Branch, Product } from '@core/models/products.model';
import { TranslateService } from '@ngx-translate/core';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { ProductsSerivce } from '@shared/services/products.service';
import {
  SlaughterService,
  SlaughterTemplate,
} from '@shared/services/slaughter.service';

export interface SlaughterDialogData {
  branchId: string;
  branches: Branch[];
  showBranchFilter: boolean;
  templates: SlaughterTemplate[];
}

@Component({
  selector: 'app-slaughter-dialog',
  templateUrl: './slaughter-dialog.component.html',
  styleUrls: ['./slaughter-dialog.component.scss'],
})
export class SlaughterDialogComponent implements OnInit {
  saving = false;
  farmAnimals: Product[] = [];

  branchId = '';
  farmProductId = '';
  share = 1;
  liveWeightKg: number | null = null;
  wasteKg: number | null = null;
  notes = '';
  outputRows: Array<{ skuKey: string; label: string; kind?: string; quantity: number }> = [];
  selectedTemplate: SlaughterTemplate | null = null;

  constructor(
    private dialogRef: MatDialogRef<SlaughterDialogComponent, boolean>,
    @Inject(MAT_DIALOG_DATA) public data: SlaughterDialogData,
    private slaughter: SlaughterService,
    private products: ProductsSerivce,
    private notify: AppNotificationService,
    private translate: TranslateService,
    public globals: Globals
  ) {
    this.branchId = data?.branchId || '';
  }

  ngOnInit(): void {
    if (this.branchId) {
      this.loadFarmAnimals();
    }
  }

  get showBranchFilter(): boolean {
    return !!this.data?.showBranchFilter;
  }

  get branches(): Branch[] {
    return this.data?.branches || [];
  }

  get templates(): SlaughterTemplate[] {
    return this.data?.templates || [];
  }

  get selectedTemplateName(): string {
    return this.selectedTemplate ? this.selectedTemplate.name : '';
  }

  kindLabel(kind?: string): string {
    const key =
      kind === 'fridge'
        ? 'tr_slaughter_kind_fridge'
        : kind === 'waste'
          ? 'tr_slaughter_kind_waste'
          : 'tr_slaughter_kind_offal';
    return this.translate.instant(key);
  }

  onBranchChange(): void {
    this.farmProductId = '';
    this.selectedTemplate = null;
    this.outputRows = [];
    this.loadFarmAnimals();
  }

  loadFarmAnimals(): void {
    if (!this.branchId) {
      this.farmAnimals = [];
      return;
    }
    this.products
      .getProducts({
        page: 1,
        limit: 200,
        branchId: this.branchId,
        productType: 'farm',
      })
      .subscribe({
        next: (res: any) => {
          this.farmAnimals = res?.products || res?.data || [];
        },
      });
  }

  onFarmChange(): void {
    const farm = this.farmAnimals.find((p) => String(p._id) === String(this.farmProductId));
    const key = farm?.catalogKey || '';
    this.selectedTemplate = this.templates.find((t) => t.farmSkuKey === key) || null;
    this.outputRows = (this.selectedTemplate?.outputs || []).map((o) => ({
      skuKey: o.skuKey,
      label: o.label || o.skuKey,
      kind: o.kind,
      quantity: 0,
    }));
  }

  cancel(): void {
    this.dialogRef.close(false);
  }

  submit(): void {
    if (!this.branchId || !this.farmProductId || !this.selectedTemplate) {
      this.notify.push(this.translate.instant('tr_slaughter_form_incomplete'), 'error');
      return;
    }
    const outputs = this.outputRows
      .map((o) => ({
        skuKey: o.skuKey,
        kind: o.kind,
        quantity: Number(o.quantity || 0),
      }))
      .filter((o) => o.quantity > 0);
    if (!outputs.length) {
      this.notify.push(this.translate.instant('tr_slaughter_need_output'), 'error');
      return;
    }
    this.saving = true;
    this.slaughter
      .createTicket({
        userId: this.globals.currentUser?._id,
        branchId: this.branchId,
        farmProductId: this.farmProductId,
        templateId: this.selectedTemplate._id,
        share: this.share,
        liveWeightKg: this.liveWeightKg,
        wasteKg: this.wasteKg,
        notes: this.notes,
        outputs,
      })
      .subscribe({
        next: () => {
          this.saving = false;
          this.notify.push(this.translate.instant('tr_slaughter_created'), 'success');
          this.dialogRef.close(true);
        },
        error: (err) => {
          this.saving = false;
          this.notify.push(err?.error?.error || this.translate.instant('tr_slaughter_failed'), 'error');
        },
      });
  }
}

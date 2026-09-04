import { Component, Inject, OnDestroy, OnInit, Optional } from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  FormGroup,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
import { of, Subject, Subscription } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, switchMap } from 'rxjs/operators';
import { Branch, Category, OrderPartyType, Product, ProductAcquiredFrom } from '@core/models/products.model';
import { Globals } from '@core/globals';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { OrdersSerivce } from '@shared/services/orders.service';
import {
  ProductPurchaseRequestsService,
  PurchaseTreasurySplit,
} from '@shared/services/product-purchase-requests.service';
import {
  PaymentMethodShowIn,
  StoreSettingsService,
} from '@shared/services/store-settings.service';
import { VendorsSerivce } from '@shared/services/vendors.service';
import { ProductsSerivce } from '@shared/services/products.service';
import { BranchesServce } from '@shared/services/branches.service';
import { CategoriesServce } from '@shared/services/categories.service';
import {
  canPickBranchRole,
  isBranchManager,
  isWarehouse,
} from '@core/utils/role-utils';
import { resolveSellByWeight } from '@shared/utils/sale-quantity.util';

type PurchaseQtyTab = 'destination' | 'product' | 'source' | 'payment';

export interface PurchaseQuantityDialogData {
  cashierMode?: boolean;
  forcedBranchId?: string;
  forcedBranchLabel?: string;
}

export interface PurchaseQuantityDialogResult {
  ok: boolean;
  purchase?: any;
  pending?: boolean;
}

@Component({
  selector: 'app-purchase-quantity-dialog',
  templateUrl: './purchase-quantity-dialog.component.html',
  styleUrls: ['./purchase-quantity-dialog.component.scss'],
})
export class PurchaseQuantityDialogComponent implements OnInit, OnDestroy {
  activeTab: PurchaseQtyTab = 'destination';
  form: FormGroup;
  sourcePartyForm: FormGroup;
  sourcePartyType: OrderPartyType = 'supplier';
  saving = false;

  destinationType: 'branch' | 'warehouse' = 'branch';
  branches: Branch[] = [];
  categories: Category[] = [];
  categoriesLoading = false;
  products: Product[] = [];
  productsLoading = false;
  selectedCategoryId: string | null = null;
  selectedProductId: string | null = null;

  selectedDeskTreasuryKeys: string[] = ['cash'];
  deskTreasuryAmounts: Record<string, number> = {};
  purchaseTreasuryMethodOptions: Array<{
    key: string;
    label: string;
    showIn: PaymentMethodShowIn;
  }> = [];

  vendorSearchItems: any[] = [];
  selectedSourceVendor: any = null;
  selectedSourceVendorId: string | null = null;
  vendorsLoading = false;
  readonly vendorTypeahead$ = new Subject<string>();
  private vendorTypeaheadSub?: Subscription;
  private subscriptions: Subscription[] = [];
  private lastNotifiedSourcePartyId: string | null = null;
  isExistingSourceClient = false;
  isExistingSourceVendor = false;

  private static readonly DEFERRED_KEY = 'deferred';

  constructor(
    private fb: FormBuilder,
    private dialogRef: MatDialogRef<PurchaseQuantityDialogComponent, PurchaseQuantityDialogResult | boolean>,
    @Optional() @Inject(MAT_DIALOG_DATA) public data: PurchaseQuantityDialogData | null,
    private productPurchaseRequests: ProductPurchaseRequestsService,
    private storeSettings: StoreSettingsService,
    private translate: TranslateService,
    private notify: AppNotificationService,
    private globals: Globals,
    private vendorsSerivce: VendorsSerivce,
    private ordersSerivce: OrdersSerivce,
    private productsService: ProductsSerivce,
    private branchesService: BranchesServce,
    private categoriesService: CategoriesServce
  ) {
    this.form = this.fb.group({
      branchId: [null as string | null, Validators.required],
      quantity: [1, [Validators.required, Validators.min(1)]],
      totalCost: [null as number | null, [Validators.required, Validators.min(0.01)]],
    });
    this.sourcePartyForm = this.fb.group({
      phone: ['', [this.phoneFormatValidator.bind(this)]],
      name: [''],
      address: [''],
    });
  }

  get selectedProduct(): Product | null {
    if (!this.selectedProductId) return null;
    return this.products.find((p) => String(p._id) === String(this.selectedProductId)) || null;
  }

  get isBranchManagerUser(): boolean {
    return isBranchManager(this.globals.currentUser?.role);
  }

  get canPickWarehouse(): boolean {
    const role = this.globals.currentUser?.role;
    return canPickBranchRole(role) || isWarehouse(role);
  }

  get isWeight(): boolean {
    const product = this.selectedProduct;
    if (!product) return false;
    return resolveSellByWeight({
      weightSalesEnabled: !!this.storeSettings.snapshot.weightSalesEnabled,
      category: product.category,
      product,
    });
  }

  get isFarm(): boolean {
    const product = this.selectedProduct;
    if (!product) return false;
    return String(product.productType || '').toLowerCase() === 'farm';
  }

  get minQuantity(): number {
    if (this.isFarm) return 0.25;
    if (this.isWeight) return 0.001;
    return 1;
  }

  get quantityStep(): number {
    if (this.isFarm) return 0.25;
    if (this.isWeight) return 0.001;
    return 1;
  }

  get totalCost(): number {
    const n = Number(this.form.get('totalCost')?.value);
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
  }

  get isDeferredSelected(): boolean {
    return this.selectedDeskTreasuryKeys.includes(PurchaseQuantityDialogComponent.DEFERRED_KEY);
  }

  get isCashierMode(): boolean {
    return !!this.data?.cashierMode;
  }

  get forcedBranchLabel(): string {
    return String(this.data?.forcedBranchLabel || '').trim();
  }

  ngOnInit(): void {
    if (this.isCashierMode) {
      this.activeTab = 'product';
      this.destinationType = 'branch';
      const branchId = String(this.data?.forcedBranchId || '').trim();
      if (branchId) {
        this.form.patchValue({ branchId });
      }
    } else {
      this.initDestinationDefaults();
    }
    this.loadBranches();
    this.loadCategories();
    this.syncTreasuryOptions();
    this.subscriptions.push(
      this.storeSettings.settings$.subscribe(() => this.syncTreasuryOptions())
    );
    this.subscriptions.push(
      this.form.valueChanges.subscribe(() => {
        this.ensureDefaultDeskTreasuryAmounts();
        this.syncQuantityValidators();
      })
    );
    this.initSourcePartyPhoneLookup();
    this.initVendorTypeahead();
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach((s) => s.unsubscribe());
    this.vendorTypeaheadSub?.unsubscribe();
  }

  private initDestinationDefaults(): void {
    const role = this.globals.currentUser?.role;
    if (isWarehouse(role)) {
      this.destinationType = 'warehouse';
      this.form.get('branchId')?.clearValidators();
      this.form.get('branchId')?.updateValueAndValidity();
    } else if (isBranchManager(role)) {
      this.destinationType = 'branch';
      const myBranch = this.globals.currentUser?.branch?._id;
      if (myBranch) {
        this.form.patchValue({ branchId: String(myBranch) });
      }
    }
  }

  private loadBranches(): void {
    this.branchesService.getBranchs({ page: 1, limit: 1000 }).subscribe({
      next: (res: any) => {
        this.branches = Array.isArray(res?.branches) ? res.branches : [];
      },
      error: () => {},
    });
  }

  private loadCategories(): void {
    this.categoriesLoading = true;
    this.categoriesService.getCategorys({ page: 1, limit: 1000 }).subscribe({
      next: (res: any) => {
        this.categories = Array.isArray(res?.categories) ? res.categories : [];
        this.categoriesLoading = false;
      },
      error: () => {
        this.categoriesLoading = false;
      },
    });
  }

  onDestinationTypeChange(type: 'branch' | 'warehouse'): void {
    if (this.destinationType === type) return;
    this.destinationType = type;
    const branchCtrl = this.form.get('branchId');
    if (type === 'warehouse') {
      if (this.isBranchManagerUser) {
        return;
      }
      branchCtrl?.setValidators(this.canPickWarehouse ? [Validators.required] : []);
      branchCtrl?.setValue(null);
    } else {
      branchCtrl?.setValidators([Validators.required]);
      if (this.isBranchManagerUser && this.globals.currentUser?.branch?._id) {
        branchCtrl?.setValue(String(this.globals.currentUser.branch._id));
      }
    }
    branchCtrl?.updateValueAndValidity();
  }

  onCategoryChange(categoryId: string | null): void {
    this.selectedCategoryId = categoryId ? String(categoryId) : null;
    this.selectedProductId = null;
    this.products = [];
    if (this.selectedCategoryId) {
      this.loadProductsForCategory();
    }
  }

  onProductChange(productId: string | null): void {
    this.selectedProductId = productId ? String(productId) : null;
    this.syncQuantityValidators();
  }

  private loadProductsForCategory(): void {
    if (!this.selectedCategoryId) return;

    this.productsLoading = true;
    // Product is a template; backend resolveOrCreateProductAtDestination clones/adds
    // stock at the chosen branch/warehouse. Do not filter by destination location or
    // hide removedWhenOutOfStock rows — otherwise the dropdown stays empty.
    const params: Record<string, string | number | boolean> = {
      page: 1,
      limit: 1000,
      categoryId: this.selectedCategoryId,
      includeRemoved: true,
    };

    this.productsService.getProducts(params).subscribe({
      next: (res: any) => {
        const list: Product[] = Array.isArray(res?.products) ? res.products : [];
        this.products = this.dedupeProductsByCode(list);
        if (
          this.selectedProductId &&
          !this.products.some((p) => String(p._id) === String(this.selectedProductId))
        ) {
          this.selectedProductId = null;
        }
        this.productsLoading = false;
      },
      error: () => {
        this.products = [];
        this.productsLoading = false;
      },
    });
  }

  private dedupeProductsByCode(products: Product[]): Product[] {
    const seen = new Set<string>();
    const out: Product[] = [];
    for (const p of products) {
      const code = String(p.code || '').trim();
      if (!code || seen.has(code)) continue;
      if (String(p.productType || '').toLowerCase() === 'service') continue;
      seen.add(code);
      out.push(p);
    }
    return out.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ar'));
  }

  private syncQuantityValidators(): void {
    const qtyCtrl = this.form.get('quantity');
    if (!qtyCtrl) return;
    qtyCtrl.setValidators([Validators.required, Validators.min(this.minQuantity)]);
    qtyCtrl.updateValueAndValidity({ emitEvent: false });
  }

  close(): void {
    this.dialogRef.close(false);
  }

  setTab(tab: PurchaseQtyTab): void {
    this.activeTab = tab;
    if (tab === 'payment') {
      this.ensureDefaultDeskTreasuryAmounts();
    }
  }

  showInLabelKey(showIn: PaymentMethodShowIn): string {
    if (showIn === 'sale') return 'tr_pay_show_in_sale';
    if (showIn === 'purchase') return 'tr_pay_show_in_purchase';
    return 'tr_pay_show_in_both';
  }

  treasuryOptionLabel(key: string): string {
    return this.purchaseTreasuryMethodOptions.find((o) => o.key === key)?.label || key;
  }

  treasuryOptionShowIn(key: string): PaymentMethodShowIn {
    return this.purchaseTreasuryMethodOptions.find((o) => o.key === key)?.showIn || 'purchase';
  }

  onSelectedDeskTreasuryChange(ids: string[] | null): void {
    const raw = Array.isArray(ids) ? ids.filter((x) => !!String(x || '').trim()) : [];
    if (!raw.length) {
      this.selectedDeskTreasuryKeys = ['cash'];
      this.reconcileDeskTreasuryAmountsKeys(['cash']);
      this.ensureDefaultDeskTreasuryAmounts();
      return;
    }
    this.reconcileDeskTreasuryAmountsKeys(raw);
    this.ensureDefaultDeskTreasuryAmounts();
  }

  trackDeskTreasuryKey(_i: number, key: string): string {
    return key;
  }

  deskTreasurySplitsTotal(): number {
    const sum = this.selectedDeskTreasuryKeys.reduce(
      (acc, key) => acc + (Number(this.deskTreasuryAmounts[key]) || 0),
      0
    );
    return Math.round(sum * 100) / 100;
  }

  deskTreasuryRemaining(): number {
    return Math.round((this.totalCost - this.deskTreasurySplitsTotal()) * 100) / 100;
  }

  deskTreasuryOverAllocated(): boolean {
    return this.deskTreasurySplitsTotal() > this.totalCost + 0.001;
  }

  onSourcePartyTypeChange(type: OrderPartyType): void {
    if (this.sourcePartyType === type) return;
    this.sourcePartyType = type;
    this.lastNotifiedSourcePartyId = null;
    this.selectedSourceVendor = null;
    this.selectedSourceVendorId = null;
    this.vendorSearchItems = [];
    this.isExistingSourceClient = false;
    this.isExistingSourceVendor = false;
    this.sourcePartyForm.patchValue({ phone: '', name: '', address: '' }, { emitEvent: false });
    this.sourcePartyForm.get('name')?.enable({ emitEvent: false });
    this.sourcePartyForm.get('address')?.enable({ emitEvent: false });
  }

  sourcePartyInfoTitleKey(): string {
    return this.sourcePartyType === 'supplier' ? 'tr_supplier_info' : 'tr_client_info';
  }

  sourcePartyNameLabelKey(): string {
    return this.sourcePartyType === 'supplier' ? 'tr_supplier_contact_name' : 'tr_client_name';
  }

  onVendorSelectOpen(): void {
    if (!this.vendorSearchItems.length) {
      this.vendorTypeahead$.next('');
    }
  }

  onSourceVendorIdChange(id: string | null): void {
    if (!id) {
      this.onSourceVendorPicked(null);
      return;
    }
    const found = this.vendorSearchItems.find((v) => String(v._id) === String(id));
    this.onSourceVendorPicked(found || null);
  }

  onSourceVendorPicked(vendor: any | null): void {
    if (!vendor) {
      this.selectedSourceVendor = null;
      this.selectedSourceVendorId = null;
      this.isExistingSourceVendor = false;
      this.sourcePartyForm.get('name')?.enable({ emitEvent: false });
      this.sourcePartyForm.get('address')?.enable({ emitEvent: false });
      return;
    }
    this.selectedSourceVendor = vendor;
    this.selectedSourceVendorId = String(vendor._id);
    this.isExistingSourceVendor = true;
    this.sourcePartyForm.patchValue(
      {
        phone: vendor.phone || '',
        name: vendor.name || vendor.nameOfcompany || '',
        address: vendor.address || '',
      },
      { emitEvent: false }
    );
    this.sourcePartyForm.get('name')?.disable({ emitEvent: false });
    this.sourcePartyForm.get('address')?.disable({ emitEvent: false });
  }

  submit(): void {
    if (this.saving) return;

    if (this.destinationType === 'branch' && !this.form.get('branchId')?.value) {
      this.activeTab = 'destination';
      this.notify.push(this.translate.instant('tr_purchase_quantity_branch_required'), 'error');
      return;
    }
    if (
      this.destinationType === 'warehouse' &&
      this.canPickWarehouse &&
      !this.isBranchManagerUser &&
      !this.form.get('branchId')?.value &&
      !this.globals.currentUser?.branch?._id
    ) {
      this.activeTab = 'destination';
      this.notify.push(this.translate.instant('tr_purchase_quantity_treasury_branch_required'), 'error');
      return;
    }
    if (!this.selectedProductId) {
      this.activeTab = 'product';
      this.notify.push(this.translate.instant('tr_purchase_quantity_product_required'), 'error');
      return;
    }

    this.form.markAllAsTouched();
    if (this.form.invalid) {
      this.activeTab = 'product';
      this.notify.push(this.translate.instant('tr_fill_required_fields'), 'error');
      return;
    }

    const splits = this.buildTreasurySplits();
    if (!splits) {
      this.activeTab = 'payment';
      return;
    }

    if (this.isDeferredSelected && !this.buildAcquiredFromPayload()) {
      this.activeTab = 'source';
      this.notify.push(
        this.translate.instant('tr_desk_purchase_deferred_party_required'),
        'error'
      );
      return;
    }

    const uid = String(this.globals.currentUser?._id || '').trim();
    if (!uid) {
      this.notify.push(this.translate.instant('tr_unexpected_error_message'), 'error');
      return;
    }

    const qty = Number(this.form.get('quantity')?.value);
    const totalCost = this.totalCost;
    const acquiredFrom = this.buildAcquiredFromPayload();
    const branchId = this.form.get('branchId')?.value
      ? String(this.form.get('branchId')?.value)
      : undefined;
    const treasuryBranchId =
      this.destinationType === 'warehouse'
        ? branchId || String(this.globals.currentUser?.branch?._id || '')
        : branchId;

    this.saving = true;
    this.productPurchaseRequests
      .purchaseQuantity({
        userId: uid,
        productId: String(this.selectedProductId),
        quantity: qty,
        totalCost,
        destinationType: this.destinationType,
        ...(branchId ? { branchId } : {}),
        ...(treasuryBranchId ? { treasuryBranchId } : {}),
        purchaseTreasurySplits: splits,
        ...(acquiredFrom ? { acquiredFrom } : {}),
      })
      .subscribe({
        next: (res) => {
          this.saving = false;
          const pending = !!res?.pending || String(res?.purchase?.status || '').toLowerCase() === 'pending';
          this.notify.push(
            this.translate.instant(pending ? 'tr_purchase_quantity_pending_ok' : 'tr_purchase_quantity_ok'),
            'success'
          );
          this.dialogRef.close({ ok: true, purchase: res?.purchase, pending });
        },
        error: (err) => {
          this.saving = false;
          const msg =
            err?.error?.error ||
            err?.error?.message ||
            err?.error?.details ||
            this.translate.instant('tr_unexpected_error_message');
          this.notify.push(msg, 'error');
        },
      });
  }

  private syncTreasuryOptions(): void {
    const methods = this.storeSettings.snapshot.purchaseTreasuryMethods;
    const catalog = this.storeSettings.snapshot.paymentMethodsCatalog || [];
    const showInByKey = new Map<string, PaymentMethodShowIn>();
    for (const row of catalog) {
      const k = String(row?.key || '')
        .trim()
        .toLowerCase();
      if (k) showInByKey.set(k, (row.showIn as PaymentMethodShowIn) || 'both');
    }

    if (Array.isArray(methods) && methods.length) {
      this.purchaseTreasuryMethodOptions = methods.map((x) => {
        const key = String(x.key || '')
          .trim()
          .toLowerCase();
        return {
          key,
          label: String(x.label || x.key || '').trim(),
          showIn: showInByKey.get(key) || 'purchase',
        };
      });
    } else {
      this.purchaseTreasuryMethodOptions = [
        {
          key: 'cash',
          label: this.translate.instant('tr_pay_cash'),
          showIn: 'both',
        },
      ];
    }

    const deferredKey = PurchaseQuantityDialogComponent.DEFERRED_KEY;
    if (!this.purchaseTreasuryMethodOptions.some((o) => o.key === deferredKey)) {
      this.purchaseTreasuryMethodOptions = [
        ...this.purchaseTreasuryMethodOptions,
        {
          key: deferredKey,
          label: this.translate.instant('tr_payment_deferred'),
          showIn: 'purchase',
        },
      ];
    }

    const keys = new Set(this.purchaseTreasuryMethodOptions.map((o) => o.key));
    const valid = this.selectedDeskTreasuryKeys.filter((k) => keys.has(k));
    if (!valid.length) {
      const cash = this.purchaseTreasuryMethodOptions.find((o) => o.key === 'cash');
      this.selectedDeskTreasuryKeys = [cash ? cash.key : this.purchaseTreasuryMethodOptions[0]?.key || 'cash'];
    } else {
      this.selectedDeskTreasuryKeys = valid;
    }
    this.reconcileDeskTreasuryAmountsKeys(this.selectedDeskTreasuryKeys);
    this.ensureDefaultDeskTreasuryAmounts();
  }

  private reconcileDeskTreasuryAmountsKeys(ids: string[]): void {
    const next: Record<string, number> = {};
    for (const id of ids) {
      next[id] = Number(this.deskTreasuryAmounts[id]) || 0;
    }
    this.deskTreasuryAmounts = next;
    this.selectedDeskTreasuryKeys = ids;
  }

  private ensureDefaultDeskTreasuryAmounts(): void {
    if (this.selectedDeskTreasuryKeys.length !== 1) return;
    const key = this.selectedDeskTreasuryKeys[0];
    const total = this.totalCost;
    const cur = Number(this.deskTreasuryAmounts[key]);
    if (!Number.isFinite(cur) || Math.abs(cur - total) > 0.001) {
      this.deskTreasuryAmounts = { ...this.deskTreasuryAmounts, [key]: Math.max(0, total) };
    }
  }

  private buildTreasurySplits(): PurchaseTreasurySplit[] | null {
    const splits = this.selectedDeskTreasuryKeys
      .map((key) => ({
        key,
        label: this.treasuryOptionLabel(key),
        amount: Math.round((Number(this.deskTreasuryAmounts[key]) || 0) * 100) / 100,
      }))
      .filter((s) => s.amount > 0);
    if (!splits.length) {
      this.notify.push(this.translate.instant('tr_desk_purchase_treasury_required'), 'error');
      return null;
    }
    if (this.totalCost <= 0) {
      this.notify.push(this.translate.instant('tr_desk_purchase_net_required'), 'error');
      return null;
    }
    if (this.deskTreasuryOverAllocated()) {
      this.notify.push(this.translate.instant('tr_desk_purchase_treasury_over'), 'error');
      return null;
    }
    if (Math.abs(this.deskTreasurySplitsTotal() - this.totalCost) > 0.01) {
      this.notify.push(this.translate.instant('tr_desk_purchase_treasury_mismatch'), 'error');
      return null;
    }
    return splits;
  }

  private buildAcquiredFromPayload(): ProductAcquiredFrom | null {
    const raw = this.sourcePartyForm.getRawValue();
    const phone = String(raw.phone || '').trim();
    const name = String(raw.name || '').trim();
    const address = String(raw.address || '').trim();
    if (!phone && !name && !this.selectedSourceVendorId) {
      return null;
    }
    const payload: ProductAcquiredFrom = {
      partyType: this.sourcePartyType,
      phone,
      displayName: name,
      name,
      address,
    };
    if (this.sourcePartyType === 'supplier' && this.selectedSourceVendorId) {
      payload.vendorId = this.selectedSourceVendorId;
    }
    return payload;
  }

  private phoneFormatValidator(control: AbstractControl): ValidationErrors | null {
    const raw = String(control.value ?? '').trim();
    if (!raw) return null;
    const normalized = raw.replace(/[\s\-()]/g, '');
    return /^\+?\d{7,15}$/.test(normalized) ? null : { phoneFormat: true };
  }

  private initSourcePartyPhoneLookup(): void {
    const phoneControl = this.sourcePartyForm.get('phone');
    const nameControl = this.sourcePartyForm.get('name');
    const addressControl = this.sourcePartyForm.get('address');
    this.subscriptions.push(
      phoneControl!.valueChanges
        .pipe(
          debounceTime(400),
          switchMap((phone: string) => {
            const trimmed = String(phone || '').trim();
            if (!trimmed || this.sourcePartyType === 'supplier') {
              return of(null);
            }
            return this.ordersSerivce.getClientByPhone(trimmed).pipe(
              catchError((err) => {
                if (err.status === 404) {
                  this.isExistingSourceClient = false;
                  nameControl?.enable({ emitEvent: false });
                  addressControl?.enable({ emitEvent: false });
                }
                return of(null);
              })
            );
          })
        )
        .subscribe((party: any) => {
          if (!party || this.sourcePartyType !== 'client') return;
          const dedupeKey =
            party._id != null ? String(party._id) : String(party.phoneNumber || '');
          if (dedupeKey && dedupeKey !== this.lastNotifiedSourcePartyId) {
            this.lastNotifiedSourcePartyId = dedupeKey;
            this.notify.push(this.translate.instant('tr_cashier_client_registered'), 'success');
          }
          this.isExistingSourceClient = true;
          nameControl?.setValue(party.name, { emitEvent: false });
          addressControl?.setValue(party.address || '', { emitEvent: false });
          nameControl?.disable({ emitEvent: false });
          addressControl?.disable({ emitEvent: false });
        })
    );
  }

  private initVendorTypeahead(): void {
    this.vendorTypeaheadSub = this.vendorTypeahead$
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        switchMap((term: string) => {
          this.vendorsLoading = true;
          const search = String(term || '').trim();
          const params: Record<string, string | number> = { page: 1, limit: 25 };
          if (search) params.search = search;
          return this.vendorsSerivce.getVendors(params).pipe(
            catchError(() => of({ vendors: [] }))
          );
        })
      )
      .subscribe((res: any) => {
        this.vendorsLoading = false;
        const list = Array.isArray(res?.vendors) ? res.vendors : [];
        this.vendorSearchItems = list.map((v: any) => ({
          ...v,
          label: `${v.nameOfcompany || v.name || ''}${v.phone ? ' · ' + v.phone : ''}`,
        }));
      });
  }
}

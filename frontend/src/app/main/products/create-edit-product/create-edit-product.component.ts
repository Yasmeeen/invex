import { BranchesServce } from '@shared/services/branches.service';
// import { category } from '@core/models/products-interface.model';

import { AppNotificationService } from '@shared/services/app-notification.service';
import { UserSerivce } from '@shared/services/user.service';
import { Component, Inject, OnDestroy, OnInit } from '@angular/core';
import { AbstractControl, FormBuilder, FormGroup, ValidationErrors, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import {
  ViewChild,
  ElementRef,
  Output,
  EventEmitter,
} from '@angular/core';
import { NgForm } from '@angular/forms';
import { Branch, Category, OrderPartyType, Product, ProductAcquiredFrom } from '@core/models/products.model';
import {
  productBarcodeAttributeValues,
  ProductsSerivce,
} from '@shared/services/products.service';
import { forkJoin, Observable, of, Subject, Subscription } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, switchMap, tap } from 'rxjs/operators';
import { CategoriesServce } from '@shared/services/categories.service';
import { TranslateService } from '@ngx-translate/core';
import { CloudinaryUploadService } from '@shared/services/cloudinary-upload.service';
import { environment } from 'src/environments/environment';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { Globals } from '@core/globals';
import { isBranchManager } from '@core/utils/role-utils';
import {
  DeskPurchaseProductPayload,
  ProductPurchaseRequestsService,
} from '@shared/services/product-purchase-requests.service';
import { StoreSettingsService } from '@shared/services/store-settings.service';
import { resolveSellByWeight } from '@shared/utils/sale-quantity.util';
import { OrdersSerivce } from '@shared/services/orders.service';
import { VendorsSerivce } from '@shared/services/vendors.service';
// import { BrowserMultiFormatReader } from '@zxing/browser';


@Component({
  selector: 'app-create-edit-product',
  templateUrl: './create-edit-product.component.html',
  styleUrls: ['./create-edit-product.component.scss']
})
export class CreateEditProductComponent implements OnInit, OnDestroy {
  activeTab: 'basic' | 'units' | 'payment' | 'extra' | 'ecommerce' = 'basic';
  sourcePartyForm: FormGroup;
  sourcePartyType: OrderPartyType = 'client';
  isExistingSourceClient = false;
  isExistingSourceVendor = false;
  selectedSourceVendorId: string | null = null;
  sourceSupplierCompanyName = '';
  /** ng-select typeahead for picking an existing supplier by company / contact / phone. */
  vendorSearchItems: any[] = [];
  selectedSourceVendor: any = null;
  vendorsLoading = false;
  readonly vendorTypeahead$ = new Subject<string>();
  private lastNotifiedSourcePartyId: string | null = null;
  branches: Branch [];
  codeReader = new BrowserMultiFormatReader();
  isCameraActive = false;
  codeValue: string;

  product:Product
  productId: string;
  isSubmitting: boolean;
  isEdit: boolean = false;
  /** When true, product is stored in central warehouse (no branch). */
  storeInWarehouse = false;
  categories: Category [];
  /** Stable array for ng-select `[items]` (do not use a getter — new refs break selection). */
  categoryDropdownItems: Category[] = [];
  /** Bound to category ng-select (category must be chosen before product code). */
  selectedCategory: Category | null = null;
  categoryAttributeDefs: Array<{ key: string; label: string; options: Array<{ value: string; label: string }> }> = [];
  attributeValues: Record<string, string> = {};
  /** Show validation errors on category attribute inputs after a failed submit. */
  attributesAttempted = false;
  private previousCategoryIdForEdit: string | null = null;
  private subscriptions: Subscription[] = [];
  isCodeGenerated = false;
  /** When true (default), sale price is printed on barcode stickers after create. */
  showPriceOnBarcode = true;
  /** When category.multiCodePerPiece and quantity > 1: one editable code per unit (new product only). */
  multiUnitCodes: string[] = [];
  /**
   * When multi-unit and user chooses different data per code:
   * parallel to multiUnitCodes — price / net / discount / attributes per piece.
   */
  multiUnitVariants: Array<{
    price: number | '';
    netPrice: number | '';
    discount: number | '';
    attributes: Record<string, string>;
    imageUrl: string;
  }> = [];
  /**
   * Multi-code qty > 1: do all units share sale/purchase/discount/specs?
   * true = enter once (default); false = per unit.
   */
  unitsShareSameData = true;
  /** Ignore stale barcode API responses when stock quantity changes quickly. */
  private multiUnitCodesGenId = 0;
  private stockQtyDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  /** Saved Cloudinary (or other HTTPS) URL */
  productImageUrl = '';
  isUploadingImage = false;
  /** Show this SKU on the e-commerce website (catalog mode = all). Default off. */
  listedOnEcommerce = false;
  /** Fridge/carcass product this cut deducts from (butcher). */
  selectedSourceProductId: string | null = null;
  sourceStockCandidates: Product[] = [];
  /** Storefront description pushed to the e-commerce catalog. */
  ecommerceDescription = '';
  ecommerceShortDescription = '';
  ecommerceIsFeatured = false;
  /** Index of unit currently uploading an image, or null. */
  uploadingUnitImageIndex: number | null = null;
  /** Cashier desk: resolved branch name when branch selection is fixed by caller. */
  deskPurchaseBranchLabel = '';
  /** Selected purchase treasury keys (multi, like cashier payment methods). */
  selectedDeskTreasuryKeys: string[] = ['cash'];
  /** Amount paid from each treasury key. */
  deskTreasuryAmounts: Record<string, number> = {};
  /** Stable array for ng-select `[items]` (never a getter — new refs break selection). */
  purchaseTreasuryMethodOptions: { key: string; label: string }[] = [];
  readonly maxImageBytes = 5 * 1024 * 1024;
  @Output() destroyEmitter: EventEmitter<any> = new EventEmitter();
  @ViewChild('modalContainer') modalContainer: ElementRef;
  @ViewChild('modalContent') modalContent: ElementRef;
  @ViewChild('basicInfoForm') basicInfoForm: NgForm;

  constructor(

    private dialogRef: MatDialogRef<CreateEditProductComponent>,
    private productsSerivce: ProductsSerivce,
    private appNotificationService: AppNotificationService,
    private categoriesServce: CategoriesServce,
    private translateService: TranslateService,
    private branchesServce:BranchesServce ,
    @Inject(MAT_DIALOG_DATA) public data: any,
    private cloudinaryUpload: CloudinaryUploadService,
    public globals: Globals,
    private productPurchaseRequests: ProductPurchaseRequestsService,
    private storeSettings: StoreSettingsService,
    private fb: FormBuilder,
    private ordersSerivce: OrdersSerivce,
    private vendorsSerivce: VendorsSerivce
  ) {
    this.sourcePartyForm = this.fb.group({
      phone: [''],
      name: [''],
      address: [''],
    });
  }

  private static readonly DESK_PURCHASE_DEFERRED_KEY = 'deferred';

  private syncDeskPurchaseTreasuryKey(): void {
    const m = this.storeSettings.snapshot.purchaseTreasuryMethods;
    if (Array.isArray(m) && m.length) {
      this.purchaseTreasuryMethodOptions = m.map((x) => ({
        key: String(x.key || '').trim().toLowerCase(),
        label: String(x.label || x.key || '').trim(),
      }));
    } else {
      this.purchaseTreasuryMethodOptions = [
        { key: 'cash', label: this.translateService.instant('tr_pay_cash') },
      ];
    }

    if (this.cashDeskPurchase) {
      const deferredKey = CreateEditProductComponent.DESK_PURCHASE_DEFERRED_KEY;
      if (!this.purchaseTreasuryMethodOptions.some((o) => o.key === deferredKey)) {
        this.purchaseTreasuryMethodOptions = [
          ...this.purchaseTreasuryMethodOptions,
          {
            key: deferredKey,
            label: this.translateService.instant('tr_payment_deferred'),
          },
        ];
      }
    }

    const opts = this.purchaseTreasuryMethodOptions;
    const keys = new Set(opts.map((o) => o.key));
    const validSelected = this.selectedDeskTreasuryKeys.filter((k) => keys.has(k));
    if (!validSelected.length) {
      const cash = opts.find((o) => o.key === 'cash');
      this.selectedDeskTreasuryKeys = [cash ? cash.key : opts[0]?.key || 'cash'];
    } else {
      this.selectedDeskTreasuryKeys = validSelected;
    }
    this.reconcileDeskTreasuryAmountsKeys(this.selectedDeskTreasuryKeys);
    this.ensureDefaultDeskTreasuryAmounts();
  }

  get deskPurchaseTotalCost(): number {
    if (this.isPerUnitVariantMode) {
      const sum = this.multiUnitVariants.reduce((acc, row) => {
        const n = Number(row?.netPrice);
        return acc + (Number.isFinite(n) && n >= 0 ? n : 0);
      }, 0);
      return Math.round(sum * 100) / 100;
    }
    const net = Number(this.basicInfoForm?.value?.netPrice);
    if (!Number.isFinite(net) || net < 0) {
      return 0;
    }
    return Math.round(net * this.getStockQty() * 100) / 100;
  }

  get isDeferredDeskPurchaseSelected(): boolean {
    return this.selectedDeskTreasuryKeys.includes(
      CreateEditProductComponent.DESK_PURCHASE_DEFERRED_KEY
    );
  }

  get showOnlineListingOption(): boolean {
    const s = this.storeSettings.snapshot;
    return (
      Boolean(s.ecommerceIntegrationFeatureAvailable) &&
      Boolean(s.ecommerceIntegrationEnabled) &&
      s.ecommerceCatalogMode !== 'online_only'
    );
  }

  get showEcommerceTab(): boolean {
    const s = this.storeSettings.snapshot;
    return (
      Boolean(s.ecommerceIntegrationFeatureAvailable) &&
      Boolean(s.ecommerceIntegrationEnabled)
    );
  }

  treasuryOptionLabel(key: string): string {
    const opt = this.purchaseTreasuryMethodOptions.find((o) => o.key === key);
    return opt?.label || key;
  }

  onDeskTreasuryCostInputsChanged(): void {
    this.ensureDefaultDeskTreasuryAmounts();
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

  private reconcileDeskTreasuryAmountsKeys(ids: string[]): void {
    const next: Record<string, number> = {};
    for (const id of ids) {
      next[id] = Number(this.deskTreasuryAmounts[id]) || 0;
    }
    this.deskTreasuryAmounts = next;
    this.selectedDeskTreasuryKeys = ids;
  }

  trackDeskTreasuryKey(_index: number, key: string): string {
    return key;
  }

  deskTreasuryOverflowTitle(items: readonly { key?: string; label?: string }[] | null | undefined): string {
    if (!items?.length || items.length <= 2) {
      return '';
    }
    return items
      .slice(2)
      .map((row) => String(row?.label || row?.key || '').trim())
      .filter(Boolean)
      .join(', ');
  }

  deskTreasurySplitsTotal(): number {
    const sum = this.selectedDeskTreasuryKeys.reduce(
      (acc, key) => acc + (Number(this.deskTreasuryAmounts[key]) || 0),
      0
    );
    return Math.round(sum * 100) / 100;
  }

  deskTreasuryRemaining(): number {
    return Math.round((this.deskPurchaseTotalCost - this.deskTreasurySplitsTotal()) * 100) / 100;
  }

  deskTreasuryOverAllocated(): boolean {
    return this.deskTreasurySplitsTotal() > this.deskPurchaseTotalCost + 0.001;
  }

  private ensureDefaultDeskTreasuryAmounts(): void {
    if (!this.cashDeskPurchase || this.selectedDeskTreasuryKeys.length !== 1) {
      return;
    }
    const key = this.selectedDeskTreasuryKeys[0];
    const total = this.deskPurchaseTotalCost;
    const cur = Number(this.deskTreasuryAmounts[key]);
    // Always keep the single selected treasury in sync with the purchase total.
    // Otherwise typing netPrice digit-by-digit (9 → 90 → 900 → 9000) freezes cash at the first positive value.
    if (!Number.isFinite(cur) || Math.abs(cur - total) > 0.001) {
      this.deskTreasuryAmounts = { ...this.deskTreasuryAmounts, [key]: Math.max(0, total) };
    }
  }

  /** Call when opening the payment tab so cash/treasury amounts match current prices. */
  onPaymentTabOpened(): void {
    this.syncDeskPurchaseTreasuryKey();
    this.ensureDefaultDeskTreasuryAmounts();
  }

  private buildPurchaseTreasurySplitsPayload():
    | { key: string; label: string; amount: number }[]
    | null {
    const fail = (): null => {
      return null;
    };
    const splits = this.selectedDeskTreasuryKeys
      .map((key) => ({
        key,
        label: this.treasuryOptionLabel(key),
        amount: Math.round((Number(this.deskTreasuryAmounts[key]) || 0) * 100) / 100,
      }))
      .filter((s) => s.amount > 0);
    if (!splits.length) {
      this.appNotificationService.push(
        this.translateService.instant('tr_desk_purchase_treasury_required'),
        'error'
      );
      return fail();
    }
    const total = this.deskPurchaseTotalCost;
    if (total <= 0) {
      this.appNotificationService.push(
        this.translateService.instant('tr_desk_purchase_net_required'),
        'error'
      );
      return fail();
    }
    if (this.deskTreasuryOverAllocated()) {
      this.appNotificationService.push(
        this.translateService.instant('tr_desk_purchase_treasury_over'),
        'error'
      );
      return fail();
    }
    if (Math.abs(this.deskTreasurySplitsTotal() - total) > 0.01) {
      this.appNotificationService.push(
        this.translateService.instant('tr_desk_purchase_treasury_mismatch'),
        'error'
      );
      return fail();
    }
    return splits;
  }

  get deferredDeskPurchaseHintKey(): string {
    return this.sourcePartyType === 'supplier'
      ? 'tr_desk_purchase_deferred_supplier_hint'
      : 'tr_desk_purchase_deferred_client_hint';
  }

  get cashDeskPurchase(): boolean {
    return !!this.data?.cashDeskPurchase;
  }

  get showUnitsTab(): boolean {
    /** Create flow: product data (code, prices, image, attrs) always lives on tab 2. */
    return !this.isEdit;
  }

  get showPaymentTab(): boolean {
    return this.cashDeskPurchase && !this.data?.exchangeFlow;
  }

  private ensureActiveTabValid(): void {
    if (this.activeTab === 'units' && !this.showUnitsTab) {
      this.activeTab = 'basic';
    }
    if (this.activeTab === 'payment' && !this.showPaymentTab) {
      this.activeTab = 'basic';
    }
    if (this.activeTab === 'ecommerce' && !this.showEcommerceTab) {
      this.activeTab = 'basic';
    }
  }

  /** Popup title: desk purchase vs exchange trade-in vs default. */
  get modalHeadingKey(): string {
    if (this.cashDeskPurchase && this.data?.exchangeFlow) {
      return 'tr_exchange_trade_in_form_title';
    }
    if (this.cashDeskPurchase) {
      return 'tr_desk_purchase_new_product';
    }
    return 'tr_new_product';
  }

  /** New product only: Branch Manager adds to assigned branch (no warehouse/branch UI). */
  get isBranchManagerNewProduct(): boolean {
    return !this.isEdit && isBranchManager(this.globals.currentUser?.role);
  }

  hasCategoryCode(c?: Category | null): boolean {
    return !!(c && String(c.code || '').trim());
  }

  get isMultiCodeCategory(): boolean {
    return !!(this.selectedCategory?.multiCodePerPiece);
  }

  get isWeightCategory(): boolean {
    return resolveSellByWeight({
      weightSalesEnabled: !!this.storeSettings.snapshot.weightSalesEnabled,
      category: this.selectedCategory,
    });
  }

  get cutFromSourceEnabled(): boolean {
    return !!this.storeSettings.snapshot.cutFromSourceEnabled;
  }

  get isCutFromSourceSku(): boolean {
    return this.cutFromSourceEnabled && !!this.selectedSourceProductId;
  }

  getStockQty(): number {
    if (this.isCutFromSourceSku) {
      return 0;
    }
    const v = this.basicInfoForm?.value?.stock;
    if (this.isWeightCategory) {
      return Math.max(0, Number(v) || 0);
    }
    const n = Math.floor(Number(v));
    if (this.cashDeskPurchase) {
      return Math.max(1, Number.isFinite(n) ? n : 1);
    }
    return Math.max(0, Number.isFinite(n) ? n : 0);
  }

  /** One SKU per physical unit: category flag + quantity > 1 + new product. */
  get isMultiUnitMode(): boolean {
    return !this.isEdit && this.isMultiCodeCategory && this.getStockQty() > 1;
  }

  /** Multi-unit mode with different price/discount/specs per code. */
  get isPerUnitVariantMode(): boolean {
    return this.isMultiUnitMode && this.unitsShareSameData === false;
  }

  trackByUnitIndex(i: number): number {
    return i;
  }

  onUnitsShareSameDataChange(same: boolean): void {
    this.unitsShareSameData = !!same;
    if (!this.unitsShareSameData) {
      this.seedMultiUnitVariantsFromShared();
    } else {
      this.applyFirstVariantToSharedFields();
      this.multiUnitVariants = [];
    }
    this.onDeskTreasuryCostInputsChanged();
  }

  private emptyUnitVariant(): {
    price: number | '';
    netPrice: number | '';
    discount: number | '';
    attributes: Record<string, string>;
    imageUrl: string;
  } {
    const fv = this.basicInfoForm?.value;
    const priceRaw = fv?.price;
    const netRaw = fv?.netPrice;
    const discRaw = fv?.discount;
    return {
      price: priceRaw === '' || priceRaw == null || Number.isNaN(Number(priceRaw)) ? '' : Number(priceRaw),
      netPrice: netRaw === '' || netRaw == null || Number.isNaN(Number(netRaw)) ? '' : Number(netRaw),
      discount:
        discRaw === '' || discRaw == null || Number.isNaN(Number(discRaw)) ? '' : Number(discRaw),
      attributes: { ...(this.attributeValues || {}) },
      imageUrl: String(this.productImageUrl || '').trim(),
    };
  }

  private seedMultiUnitVariantsFromShared(): void {
    const q = this.getStockQty();
    const base = this.emptyUnitVariant();
    const next = [];
    for (let i = 0; i < q; i++) {
      const prev = this.multiUnitVariants[i];
      next.push(
        prev
          ? {
              price: prev.price,
              netPrice: prev.netPrice,
              discount: prev.discount,
              attributes: { ...(prev.attributes || {}) },
              imageUrl: String(prev.imageUrl || '').trim() || base.imageUrl,
            }
          : {
              price: base.price,
              netPrice: base.netPrice,
              discount: base.discount,
              attributes: { ...base.attributes },
              imageUrl: base.imageUrl,
            }
      );
    }
    this.multiUnitVariants = next;
  }

  private syncMultiUnitVariantsLength(): void {
    if (!this.isPerUnitVariantMode) {
      return;
    }
    const q = this.getStockQty();
    if (this.multiUnitVariants.length === q) {
      return;
    }
    this.seedMultiUnitVariantsFromShared();
  }

  private applyFirstVariantToSharedFields(): void {
    const first = this.multiUnitVariants[0];
    if (!first || !this.basicInfoForm?.form) {
      return;
    }
    const patch: Record<string, unknown> = {};
    if (first.price !== '' && first.price != null) {
      patch.price = first.price;
    }
    if (first.netPrice !== '' && first.netPrice != null) {
      patch.netPrice = first.netPrice;
    }
    if (first.discount !== '' && first.discount != null) {
      patch.discount = first.discount;
    }
    if (Object.keys(patch).length) {
      this.basicInfoForm.form.patchValue(patch);
    }
    if (first.attributes) {
      this.attributeValues = { ...first.attributes };
    }
    if (first.imageUrl) {
      this.productImageUrl = String(first.imageUrl).trim();
    }
  }

  copyUnitVariantFromPrevious(index: number): void {
    if (index <= 0 || !this.multiUnitVariants[index - 1]) {
      return;
    }
    const src = this.multiUnitVariants[index - 1];
    this.multiUnitVariants[index] = {
      price: src.price,
      netPrice: src.netPrice,
      discount: src.discount,
      attributes: { ...(src.attributes || {}) },
      imageUrl: String(src.imageUrl || '').trim(),
    };
    this.onDeskTreasuryCostInputsChanged();
  }

  onUnitVariantCostChanged(): void {
    this.onDeskTreasuryCostInputsChanged();
  }

  private buildAttributesPayloadFromMap(map: Record<string, string> | null | undefined): Record<string, string> {
    const allowed = new Set(this.categoryAttributeDefs.map((d) => d.key));
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(map || {})) {
      const key = this.normalizeAttrKey(k);
      if (!allowed.has(key)) continue;
      const val = String(v ?? '').trim();
      if (!val) continue;
      out[key] = val;
    }
    return out;
  }

  isAttributeMissing(key: string): boolean {
    if (!this.attributesAttempted) {
      return false;
    }
    return !String(this.attributeValues?.[key] ?? '').trim();
  }

  isUnitAttributeMissing(unitIndex: number, key: string): boolean {
    if (!this.attributesAttempted) {
      return false;
    }
    const map = this.multiUnitVariants?.[unitIndex]?.attributes;
    return !String(map?.[key] ?? '').trim();
  }

  private mapHasAllCategoryAttributes(map: Record<string, string> | null | undefined): boolean {
    if (!this.categoryAttributeDefs.length) {
      return true;
    }
    for (const d of this.categoryAttributeDefs) {
      if (!String(map?.[d.key] ?? '').trim()) {
        return false;
      }
    }
    return true;
  }

  private firstMissingAttributeLabel(map: Record<string, string> | null | undefined): string {
    for (const d of this.categoryAttributeDefs) {
      if (!String(map?.[d.key] ?? '').trim()) {
        return d.label || d.key;
      }
    }
    return '';
  }

  /** All category attribute defs must be filled before save. */
  private validateCategoryAttributesRequired(): boolean {
    if (!this.categoryAttributeDefs.length) {
      this.attributesAttempted = false;
      return true;
    }
    this.attributesAttempted = true;

    if (this.isPerUnitVariantMode) {
      const count = Math.max(this.multiUnitCodes.length, this.multiUnitVariants.length);
      for (let i = 0; i < count; i++) {
        const row = this.multiUnitVariants[i];
        if (!this.mapHasAllCategoryAttributes(row?.attributes)) {
          const label = this.firstMissingAttributeLabel(row?.attributes);
          this.appNotificationService.push(
            this.translateService.instant('tr_category_attribute_required_unit', {
              label,
              n: i + 1,
            }),
            'error'
          );
          return false;
        }
      }
      return true;
    }

    if (!this.mapHasAllCategoryAttributes(this.attributeValues)) {
      const label = this.firstMissingAttributeLabel(this.attributeValues);
      this.appNotificationService.push(
        this.translateService.instant('tr_category_attribute_required', { label }),
        'error'
      );
      return false;
    }
    return true;
  }

  private getValidatedUnitDetails():
    | Array<{
        code: string;
        price: number;
        netPrice: number;
        discount: number;
        attributes: Record<string, string>;
        imageUrl: string;
      }>
    | null {
    if (!this.isPerUnitVariantMode) {
      return null;
    }
    const codes = this.getValidatedMultiUnitCodes();
    if (!codes) {
      return null;
    }
    if (this.multiUnitVariants.length !== codes.length) {
      this.seedMultiUnitVariantsFromShared();
    }
    const details = [];
    const sharedImage = String(this.productImageUrl || '').trim();
    for (let i = 0; i < codes.length; i++) {
      const row = this.multiUnitVariants[i] || this.emptyUnitVariant();
      const price = Number(row.price);
      if (row.price === '' || row.price == null || Number.isNaN(price) || price < 0) {
        this.appNotificationService.push(
          this.translateService.instant('tr_product_unit_price_required', { n: i + 1 }),
          'error'
        );
        return null;
      }
      const discountRaw =
        row.discount === '' || row.discount == null ? 0 : Number(row.discount);
      if (Number.isNaN(discountRaw) || discountRaw < 0 || discountRaw > 100) {
        this.appNotificationService.push(
          this.translateService.instant('tr_product_unit_discount_invalid', { n: i + 1 }),
          'error'
        );
        return null;
      }
      let netPrice: number;
      if (row.netPrice === '' || row.netPrice == null) {
        if (this.cashDeskPurchase) {
          this.appNotificationService.push(
            this.translateService.instant('tr_product_unit_net_required', { n: i + 1 }),
            'error'
          );
          return null;
        }
        netPrice = Math.round(price * (1 - discountRaw / 100) * 100) / 100;
      } else {
        netPrice = Number(row.netPrice);
        if (Number.isNaN(netPrice) || netPrice < 0) {
          this.appNotificationService.push(
            this.translateService.instant('tr_product_unit_net_required', { n: i + 1 }),
            'error'
          );
          return null;
        }
      }
      details.push({
        code: codes[i],
        price: Math.round(price * 100) / 100,
        netPrice: Math.round(netPrice * 100) / 100,
        discount: Math.round(discountRaw * 100) / 100,
        attributes: this.buildAttributesPayloadFromMap(row.attributes),
        imageUrl: String(row.imageUrl || '').trim() || sharedImage,
      });
    }
    return details;
  }

  private syncPrimaryCodeFromMultiUnits(): void {
    const first = String(this.multiUnitCodes[0] ?? '').trim();
    this.codeValue = first;
    this.basicInfoForm?.form?.patchValue({ code: first });
  }

  /** When quantity changes: shrink array, or regenerate a full unique block for the new quantity. */
  onStockQuantityChanged(): void {
    if (this.stockQtyDebounceTimer) {
      clearTimeout(this.stockQtyDebounceTimer);
    }
    this.stockQtyDebounceTimer = setTimeout(() => this.applyStockQuantityToMultiUnitCodes(), 350);
  }

  private getMaxCodeSuffix(codes: string[], categoryCode: string): number {
    const base = String(categoryCode || '')
      .trim()
      .replace(/-+$/g, '')
      .toUpperCase();
    if (!base) {
      return 0;
    }
    const re = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)$`, 'i');
    let max = 0;
    for (const c of codes) {
      const m = String(c ?? '').trim().match(re);
      if (m) {
        max = Math.max(max, parseInt(m[1], 10));
      }
    }
    return max;
  }

  private applyStockQuantityToMultiUnitCodes(): void {
    this.stockQtyDebounceTimer = null;
    if (this.isEdit) {
      return;
    }
    if (!this.isMultiCodeCategory) {
      this.multiUnitCodes = [];
      this.multiUnitVariants = [];
      this.unitsShareSameData = true;
      this.ensureActiveTabValid();
      return;
    }
    const q = this.getStockQty();
    if (q <= 1) {
      this.multiUnitCodes = [];
      this.multiUnitVariants = [];
      this.unitsShareSameData = true;
      this.ensureActiveTabValid();
      return;
    }

    if (this.multiUnitCodes.length > q) {
      this.multiUnitCodes = this.multiUnitCodes.slice(0, q);
      this.syncPrimaryCodeFromMultiUnits();
      this.syncMultiUnitVariantsLength();
      this.onDeskTreasuryCostInputsChanged();
      this.ensureActiveTabValid();
      return;
    }

    if (this.multiUnitCodes.length < q) {
      const cat = this.selectedCategory;
      if (!cat?._id || !this.hasCategoryCode(cat)) {
        return;
      }
      const genId = ++this.multiUnitCodesGenId;
      const startFrom = this.getMaxCodeSuffix(this.multiUnitCodes, String(cat.code || '')) + 1;
      this.productsSerivce
        .generateBarcode(String(cat._id), q, startFrom > 1 ? startFrom : undefined)
        .subscribe({
          next: (res: { code?: string; codes?: string[] }) => {
            if (genId !== this.multiUnitCodesGenId) {
              return;
            }
            const codes = res.codes?.length ? res.codes : res.code ? [res.code] : [];
            const targetQ = this.getStockQty();
            this.multiUnitCodes = codes.slice(0, targetQ);
            while (this.multiUnitCodes.length < targetQ) {
              this.multiUnitCodes.push('');
            }
            this.syncPrimaryCodeFromMultiUnits();
            this.syncMultiUnitVariantsLength();
            this.onDeskTreasuryCostInputsChanged();
            this.isCodeGenerated = true;
            this.ensureActiveTabValid();
          },
          error: (err: any) => {
            if (genId !== this.multiUnitCodesGenId) {
              return;
            }
            const msg =
              err?.error?.error ||
              this.translateService.instant('tr_barcode_generate_failed');
            this.appNotificationService.push(msg, 'error');
          },
        });
      return;
    }

    this.syncPrimaryCodeFromMultiUnits();
    this.syncMultiUnitVariantsLength();
    this.ensureActiveTabValid();
  }

  /** Replace every unit code with a fresh block from the server (current quantity). */
  refreshMultiUnitCodes(showToast = false): void {
    const cat = this.selectedCategory;
    const q = this.getStockQty();
    if (!cat?._id || !this.hasCategoryCode(cat) || q <= 1 || this.isEdit) {
      this.multiUnitCodes = [];
      return;
    }
    const genId = ++this.multiUnitCodesGenId;
    this.productsSerivce.generateBarcode(String(cat._id), q).subscribe({
      next: (res: { code?: string; codes?: string[] }) => {
        if (genId !== this.multiUnitCodesGenId) {
          return;
        }
        const codes = res.codes?.length ? res.codes : res.code ? [res.code] : [];
        const targetQ = this.getStockQty();
        this.multiUnitCodes = codes.slice(0, targetQ);
        while (this.multiUnitCodes.length < targetQ) {
          this.multiUnitCodes.push('');
        }
        this.syncPrimaryCodeFromMultiUnits();
        this.syncMultiUnitVariantsLength();
        this.onDeskTreasuryCostInputsChanged();
        this.isCodeGenerated = true;
        if (showToast) {
          this.appNotificationService.push(
            this.translateService.instant('tr_product_code_generated'),
            'success'
          );
        }
      },
      error: (err: any) => {
        if (genId !== this.multiUnitCodesGenId) {
          return;
        }
        const msg =
          err?.error?.error ||
          this.translateService.instant('tr_barcode_generate_failed');
        this.appNotificationService.push(msg, 'error');
      },
    });
  }

  onMultiUnitCodeBlur(index: number): void {
    const cat = this.selectedCategory;
    if (!cat || !this.hasCategoryCode(cat)) {
      return;
    }
    const prefix = String(cat.code || '').trim();
    let v = String(this.multiUnitCodes[index] ?? '').trim();
    if (!v) {
      if (index === 0) {
        this.syncPrimaryCodeFromMultiUnits();
      }
      return;
    }
    const pu = prefix.toUpperCase();
    if (!v.toUpperCase().startsWith(pu)) {
      const join = prefix.endsWith('-') ? '' : '-';
      v = `${prefix}${join}${v}`.replace(/-+/g, '-');
    }
    this.multiUnitCodes[index] = v;
    if (index === 0) {
      this.codeValue = v;
      this.basicInfoForm?.form?.patchValue({ code: v });
    }
  }

  /** Validates per-unit codes before desk/create submit. */
  private getValidatedMultiUnitCodes(): string[] | null {
    if (!this.isMultiUnitMode || !this.selectedCategory) {
      return null;
    }
    const q = this.getStockQty();
    if (this.multiUnitCodes.length !== q) {
      this.appNotificationService.push(
        this.translateService.instant('tr_product_unit_codes_mismatch'),
        'error'
      );
      return null;
    }
    const units = this.multiUnitCodes.map((c) => String(c ?? '').trim());
    if (units.some((c) => !c)) {
      this.appNotificationService.push(
        this.translateService.instant('tr_product_unit_codes_empty'),
        'error'
      );
      return null;
    }
    const seen = new Set(units.map((c) => c.toUpperCase()));
    if (seen.size !== units.length) {
      this.appNotificationService.push(
        this.translateService.instant('tr_product_unit_codes_duplicate'),
        'error'
      );
      return null;
    }
    const prefixU = String(this.selectedCategory.code || '').trim().toUpperCase();
    for (const c of units) {
      if (!c.toUpperCase().startsWith(prefixU)) {
        this.appNotificationService.push(
          this.translateService.instant('tr_product_code_prefix_mismatch'),
          'error'
        );
        return null;
      }
    }
    return units;
  }

  private mergeBarcodePrintDocuments(htmlFragments: string[]): string {
    const first = htmlFragments[0] || '';
    const styleMatch = first.match(/<style[^>]*>([\s\S]*)<\/style>/i);
    const baseStyle = styleMatch ? styleMatch[1] : '';
    const bodies = htmlFragments.map((h) => {
      const m = h.match(/<body[^>]*>([\s\S]*)<\/body>/i);
      return m ? m[1].trim() : '';
    });
    /** Backend template uses row flex on body → multiple stickers sat side‑by‑side. Force a vertical stack with the same 38×25mm slot per code so roll printers feed label after label. */
    const stackOverrides = `
      html.sticker-stack-print-root {
        margin: 0 !important;
        padding: 0 !important;
        height: auto !important;
      }
      body.sticker-stack-print {
        display: flex !important;
        flex-direction: column !important;
        flex-wrap: nowrap !important;
        align-items: center !important;
        justify-content: flex-start !important;
        width: 38mm !important;
        max-width: 38mm !important;
        height: auto !important;
        min-height: 0 !important;
        margin: 0 auto !important;
        padding: 0 !important;
        box-sizing: border-box !important;
      }
      body.sticker-stack-print .sticker-name {
        flex: 0 0 auto !important;
        width: 100% !important;
        max-width: 38mm !important;
        min-height: 25mm !important;
        height: 25mm !important;
        max-height: 25mm !important;
        box-sizing: border-box !important;
        page-break-inside: avoid !important;
        break-inside: avoid !important;
        align-items: stretch !important;
        padding: 0.6mm 1mm !important;
      }
      body.sticker-stack-print .barcode-img {
        width: 100% !important;
        max-width: 100% !important;
        height: 11mm !important;
        object-fit: fill !important;
      }
    `;
    const inner = bodies.join('');
    return `<!DOCTYPE html><html class="sticker-stack-print-root"><head><meta charset="utf-8"/><style>${baseStyle}\n${stackOverrides}</style></head><body class="sticker-stack-print">${inner}</body></html>`;
  }

  private getBarcodePrintPrice(explicitPrice?: unknown): number | undefined {
    if (!this.showPriceOnBarcode) {
      return undefined;
    }
    const candidates = [
      explicitPrice,
      this.basicInfoForm?.form?.get('price')?.value,
      this.basicInfoForm?.value?.price,
      this.product?.price,
    ];
    for (const raw of candidates) {
      if (raw === '' || raw == null) {
        continue;
      }
      const n = Number(raw);
      if (Number.isFinite(n)) {
        return n;
      }
    }
    return undefined;
  }

  private printBarcodeStickers(
    productName: string,
    codes: string[],
    bv: string[],
    onDone?: () => void,
    price?: number
  ): void {
    const cleanCodes = (codes || []).map((c) => String(c ?? '').trim()).filter(Boolean);
    if (!cleanCodes.length) {
      onDone?.();
      return;
    }
    const printPrice = price !== undefined ? price : this.getBarcodePrintPrice();
    const reqs: Observable<string>[] = cleanCodes.map((c) =>
      this.productsSerivce.getBarcodeImage(c, productName, bv, printPrice) as Observable<string>
    );
    forkJoin(reqs).subscribe({
      next: (parts: string[]) => {
        this.printHtml(this.mergeBarcodePrintDocuments(parts));
        onDone?.();
      },
      error: () => {
        this.appNotificationService.push(
          this.translateService.instant('tr_barcode_generate_failed'),
          'error'
        );
        onDone?.();
      },
    });
  }

  /** Print stickers when each unit has its own price / attribute values. */
  private printBarcodeStickersPerUnit(
    productName: string,
    units: Array<{ code: string; price: number; attributes: Record<string, string> }>,
    onDone?: () => void
  ): void {
    const clean = (units || []).filter((u) => String(u?.code || '').trim());
    if (!clean.length) {
      onDone?.();
      return;
    }
    const reqs: Observable<string>[] = clean.map((u) => {
      const bv = productBarcodeAttributeValues(this.selectedCategory!, u.attributes || {});
      const printPrice = this.showPriceOnBarcode ? u.price : undefined;
      return this.productsSerivce.getBarcodeImage(
        String(u.code).trim(),
        productName,
        bv,
        printPrice
      ) as Observable<string>;
    });
    forkJoin(reqs).subscribe({
      next: (parts: string[]) => {
        this.printHtml(this.mergeBarcodePrintDocuments(parts));
        onDone?.();
      },
      error: () => {
        this.appNotificationService.push(
          this.translateService.instant('tr_barcode_generate_failed'),
          'error'
        );
        onDone?.();
      },
    });
  }

  private refreshCategoryDropdownItems(): void {
    if (!this.categories?.length) {
      this.categoryDropdownItems = [];
      return;
    }
    if (this.isEdit) {
      const list = [...this.categories];
      const sel = this.selectedCategory;
      if (sel?._id && !list.some((c) => String(c._id) === String(sel._id))) {
        list.unshift(sel);
      }
      this.categoryDropdownItems = list;
      return;
    }
    this.categoryDropdownItems = [...this.categories];
  }

  get hasAnyCategoryWithCode(): boolean {
    return !!(this.categories?.some((c) => this.hasCategoryCode(c)));
  }

  categoryCompare(a: Category | null, b: Category | null): boolean {
    if (a == null || b == null) {
      return a == null && b == null;
    }
    return String(a._id) === String(b._id);
  }

  get isProductCodeEnabled(): boolean {
    return !!(this.selectedCategory && this.hasCategoryCode(this.selectedCategory));
  }

  ngOnInit() {
    this.initSourcePartyPhoneLookup();
    this.initVendorTypeahead();
    this.productId = this.data.productId
    this.isEdit = this.data.isEdit
    if (this.cashDeskPurchase) {
      this.storeInWarehouse = false;
      this.syncDeskPurchaseTreasuryKey();
      this.subscriptions.push(
        this.storeSettings.settings$.subscribe(() => this.syncDeskPurchaseTreasuryKey())
      );
    }
    this.getCategories();
    this.getBranches();
    if(this.isEdit){
    this.getProductData()
     
    }

  }

  private applyDeskPurchaseBranchLabel(): void {
    this.deskPurchaseBranchLabel = '';
    if (!this.cashDeskPurchase || !this.data?.forcedBranchId || !this.branches?.length) {
      return;
    }
    const b = this.branches.find((x: Branch) => String(x._id) === String(this.data.forcedBranchId));
    this.deskPurchaseBranchLabel = b?.name ? String(b.name) : '';
  }

  private normalizeAttrKey(raw: any): string {
    return String(raw || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_');
  }

  private setCategoryAttributeDefsFromSelected(): void {
    const defs = Array.isArray((this.selectedCategory as any)?.attributeDefs)
      ? ((this.selectedCategory as any).attributeDefs as any[])
      : [];
    this.categoryAttributeDefs = defs
      .map((d) => {
        const key = this.normalizeAttrKey(d?.key);
        const label = String(d?.label || '').trim();
        return { key, label, options: [] };
      })
      .filter((d) => d.key && d.label);

    // Keep only values that still exist in defs
    const allowed = new Set(this.categoryAttributeDefs.map((d) => d.key));
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries(this.attributeValues || {})) {
      const nk = this.normalizeAttrKey(k);
      if (!allowed.has(nk)) continue;
      next[nk] = String(v ?? '');
    }
    this.attributeValues = next;
    this.attributesAttempted = false;
  }

  private buildAttributesPayload(): Record<string, string> {
    const allowed = new Set(this.categoryAttributeDefs.map((d) => d.key));
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(this.attributeValues || {})) {
      const key = this.normalizeAttrKey(k);
      if (!allowed.has(key)) continue;
      const val = String(v ?? '').trim();
      if (!val) continue;
      out[key] = val;
    }
    return out;
  }

  setStorageMode(warehouse: boolean) {
    this.storeInWarehouse = warehouse;
    if (warehouse && this.basicInfoForm?.form) {
      this.basicInfoForm.form.patchValue({ branch: null });
    }
    this.loadSourceStockCandidates();
  }

  onSourceProductChange(id: string | null) {
    this.selectedSourceProductId = id || null;
    if (this.selectedSourceProductId && this.basicInfoForm?.form) {
      this.basicInfoForm.form.patchValue({ stock: 0 });
    }
  }

  loadSourceStockCandidates() {
    if (!this.cutFromSourceEnabled) {
      this.sourceStockCandidates = [];
      return;
    }
    const params: any = { page: 1, limit: 300 };
    if (this.storeInWarehouse) {
      params.warehouseOnly = true;
    } else {
      const b = this.basicInfoForm?.value?.branch;
      const bid = b?._id || b;
      if (bid) {
        params.branchId = String(bid);
      }
    }
    this.productsSerivce.getProducts(params).subscribe({
      next: (res: any) => {
        const rows = (res?.products || []) as Product[];
        this.sourceStockCandidates = rows.filter((p) => {
          if (this.productId && String(p._id) === String(this.productId)) return false;
          const sid = (p as any).sourceProductId;
          if (!sid) return true;
          if (typeof sid === 'object') return false;
          return false;
        });
      },
      error: () => {
        this.sourceStockCandidates = [];
      },
    });
  }

  getCategories() {
    let params = {
      'page': 1,
      'limit': 1000
    }
    this.subscriptions.push(this.categoriesServce.getCategorys(params).subscribe((response: any) => {
      this.categories = response.categories;
      this.refreshCategoryDropdownItems();
    },(error:any)=> {

      this.appNotificationService.push( this.translateService.instant('tr_unexpected_error_message'), 'error');
    }))
  }
  getBranches() {
    let params = {
      'page': 1,
     'limit': 1000
    }
    this.subscriptions.push(this.branchesServce.getBranchs(params).subscribe((response: any) => {
      this.branches = response.branches
      this.applyDeskPurchaseBranchLabel();
    },(error:any)=> {

      this.appNotificationService.push( this.translateService.instant('tr_unexpected_error_message'), 'error');
    }))
  }

  getProductData() {
    this.productsSerivce.getProduct(this.productId).subscribe((response: any) => {
      this.product = response;
      this.productId = response._id;
      this.storeInWarehouse = !!response.inWarehouse;
      this.codeValue = response.code;
      this.selectedCategory = response.category || null;
      this.setCategoryAttributeDefsFromSelected();
      const attrsRaw = response?.attributes;
      if (attrsRaw && typeof attrsRaw === 'object' && !Array.isArray(attrsRaw)) {
        const next: Record<string, string> = {};
        for (const [k, v] of Object.entries(attrsRaw)) {
          next[this.normalizeAttrKey(k)] = String(v ?? '');
        }
        this.attributeValues = next;
      } else {
        this.attributeValues = {};
      }
      this.previousCategoryIdForEdit = this.selectedCategory?._id
        ? String(this.selectedCategory._id)
        : null;
      this.basicInfoForm.form.patchValue({
        name: response.name,
        code: response.code,
        price: response.price,
        netPrice: response.netPrice,
        stock: response.stock,
        discount: response.discount,
        category: response.category,
        branch: response.branch || null,
        addedBy: response.addedBy || '',
      });
      this.productImageUrl = response.imageUrl || '';
      const srcRaw = response.sourceProductId;
      this.selectedSourceProductId =
        srcRaw && typeof srcRaw === 'object' ? String(srcRaw._id) : srcRaw ? String(srcRaw) : null;
      this.loadSourceStockCandidates();
      this.listedOnEcommerce = Boolean(response.listedOnEcommerce);
      this.ecommerceDescription = String(response.ecommerceDescription || '');
      this.ecommerceShortDescription = String(response.ecommerceShortDescription || '');
      this.ecommerceIsFeatured = Boolean(response.ecommerceIsFeatured);
      this.refreshCategoryDropdownItems();
      this.patchSourcePartyFromProduct(response);
    });
  }

  private patchSourcePartyFromProduct(response: any): void {
    const af: ProductAcquiredFrom | null = response?.acquiredFrom || null;
    if (!af?.displayName && !af?.phone && !af?.partyType) {
      return;
    }
    this.sourcePartyType = af.partyType === 'supplier' ? 'supplier' : 'client';
    this.selectedSourceVendorId = af.vendorId ? String(af.vendorId) : null;
    this.isExistingSourceVendor = !!this.selectedSourceVendorId;
    this.isExistingSourceClient = !!af.clientId;
    if (this.isExistingSourceVendor) {
      this.vendorsSerivce.getVendor(this.selectedSourceVendorId!).subscribe({
        next: (v: any) => {
          this.applySelectedVendor(v, false);
        },
        error: () => {},
      });
    }
    this.sourcePartyForm.patchValue(
      {
        phone: af.phone || '',
        name: af.displayName || '',
        address: '',
      },
      { emitEvent: false }
    );
    if (this.isExistingSourceClient || this.isExistingSourceVendor) {
      this.sourcePartyForm.get('name')?.disable({ emitEvent: false });
    }
  }

  private initVendorTypeahead(): void {
    this.subscriptions.push(
      this.vendorTypeahead$
        .pipe(
          debounceTime(300),
          distinctUntilChanged(),
          tap(() => (this.vendorsLoading = true)),
          switchMap((term: string) => {
            const search = String(term || '').trim();
            const params: Record<string, string | number> = { page: 1, limit: 25 };
            if (search) {
              params.search = search;
            }
            return this.vendorsSerivce.getVendors(params).pipe(
              catchError(() => of({ vendors: [] })),
              tap(() => (this.vendorsLoading = false))
            );
          })
        )
        .subscribe((res: any) => {
          const list = Array.isArray(res?.vendors) ? res.vendors : [];
          this.vendorSearchItems = list.map((v: any) => this.withVendorLabel(v));
          // Keep the currently selected vendor visible even if it is outside this page.
          if (
            this.selectedSourceVendor?._id &&
            !this.vendorSearchItems.some(
              (v) => String(v._id) === String(this.selectedSourceVendor._id)
            )
          ) {
            this.vendorSearchItems = [
              this.withVendorLabel(this.selectedSourceVendor),
              ...this.vendorSearchItems,
            ];
          }
        })
    );
  }

  onVendorSelectOpen(): void {
    this.vendorTypeahead$.next('');
  }

  private withVendorLabel(vendor: any): any {
    if (!vendor) {
      return vendor;
    }
    const company = String(vendor.nameOfcompany || '').trim();
    const name = String(vendor.name || '').trim();
    const phone = String(vendor.phone || '').trim();
    return {
      ...vendor,
      label: [company, name, phone].filter(Boolean).join(' — '),
    };
  }

  onSourceVendorPicked(vendor: any): void {
    if (!vendor) {
      this.clearSelectedVendorFields(true);
      return;
    }
    this.applySelectedVendor(vendor, true);
  }

  onSourceVendorIdChange(vendorId: string | null): void {
    if (!vendorId) {
      this.onSourceVendorPicked(null);
      return;
    }
    const found = this.vendorSearchItems.find((v) => String(v._id) === String(vendorId));
    if (found) {
      this.onSourceVendorPicked(found);
      return;
    }
    this.vendorsSerivce.getVendor(String(vendorId)).subscribe({
      next: (v) => this.onSourceVendorPicked(v),
      error: () => this.onSourceVendorPicked(null),
    });
  }

  private applySelectedVendor(vendor: any, notify: boolean): void {
    if (!vendor) {
      return;
    }
    const labeled = this.withVendorLabel(vendor);
    this.selectedSourceVendor = labeled;
    if (
      !this.vendorSearchItems.some((v) => String(v._id) === String(labeled._id))
    ) {
      this.vendorSearchItems = [labeled, ...this.vendorSearchItems];
    }
    this.isExistingSourceVendor = true;
    this.isExistingSourceClient = false;
    this.selectedSourceVendorId = labeled._id ? String(labeled._id) : null;
    this.sourceSupplierCompanyName = labeled.nameOfcompany || '';

    const nameControl = this.sourcePartyForm.get('name');
    const addressControl = this.sourcePartyForm.get('address');
    const phoneControl = this.sourcePartyForm.get('phone');
    phoneControl?.setValue(labeled.phone || '', { emitEvent: false });
    nameControl?.setValue(labeled.name || '', { emitEvent: false });
    addressControl?.setValue(labeled.address || '', { emitEvent: false });
    nameControl?.disable({ emitEvent: false });
    addressControl?.disable({ emitEvent: false });

    if (notify) {
      const dedupeKey = labeled._id != null ? String(labeled._id) : String(labeled.phone || '');
      if (dedupeKey && dedupeKey !== this.lastNotifiedSourcePartyId) {
        this.lastNotifiedSourcePartyId = dedupeKey;
        this.translateService
          .get('tr_cashier_supplier_registered')
          .subscribe((msg) => this.appNotificationService.push(msg, 'success'));
      }
    }
    this.syncDeskPurchaseTreasuryKey();
  }

  private clearSelectedVendorFields(enableManualEntry: boolean): void {
    const nameControl = this.sourcePartyForm.get('name');
    const addressControl = this.sourcePartyForm.get('address');
    const phoneControl = this.sourcePartyForm.get('phone');
    this.selectedSourceVendor = null;
    this.selectedSourceVendorId = null;
    this.isExistingSourceVendor = false;
    this.sourceSupplierCompanyName = '';
    this.lastNotifiedSourcePartyId = null;
    nameControl?.enable({ emitEvent: false });
    addressControl?.enable({ emitEvent: false });
    if (enableManualEntry) {
      phoneControl?.setValue('', { emitEvent: false });
      nameControl?.setValue('', { emitEvent: false });
      addressControl?.setValue('', { emitEvent: false });
    }
    this.syncDeskPurchaseTreasuryKey();
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
            if (!trimmed) {
              this.clearSourcePartyLookupState(nameControl, addressControl, false);
              return of(null);
            }
            // Supplier primary path is the searchable select; phone lookup remains as fallback.
            const lookup$ =
              this.sourcePartyType === 'supplier'
                ? this.vendorsSerivce.getVendorByPhone(trimmed)
                : this.ordersSerivce.getClientByPhone(trimmed);
            return lookup$.pipe(
              catchError((err) => {
                if (err.status === 404) {
                  this.clearSourcePartyLookupState(nameControl, addressControl, true);
                }
                return of(null);
              })
            );
          })
        )
        .subscribe((party: any) => {
          if (!party) {
            this.lastNotifiedSourcePartyId = null;
            return;
          }
          if (this.sourcePartyType === 'supplier') {
            this.applySelectedVendor(party, true);
          } else {
            const dedupeKey =
              party._id != null ? String(party._id) : String(party.phoneNumber || '');
            if (dedupeKey && dedupeKey !== this.lastNotifiedSourcePartyId) {
              this.lastNotifiedSourcePartyId = dedupeKey;
              this.translateService
                .get('tr_cashier_client_registered')
                .subscribe((msg) => this.appNotificationService.push(msg, 'success'));
            }
            this.isExistingSourceClient = true;
            this.isExistingSourceVendor = false;
            this.selectedSourceVendor = null;
            this.selectedSourceVendorId = null;
            this.sourceSupplierCompanyName = '';
            nameControl?.setValue(party.name, { emitEvent: false });
            addressControl?.setValue(party.address || '', { emitEvent: false });
            nameControl?.disable({ emitEvent: false });
            addressControl?.disable({ emitEvent: false });
            this.syncDeskPurchaseTreasuryKey();
          }
        })
    );
  }

  private clearSourcePartyLookupState(
    nameControl: AbstractControl | null,
    addressControl: AbstractControl | null,
    requireNameForNew: boolean
  ): void {
    this.isExistingSourceClient = false;
    this.isExistingSourceVendor = false;
    this.selectedSourceVendorId = null;
    this.selectedSourceVendor = null;
    this.sourceSupplierCompanyName = '';
    nameControl?.enable({ emitEvent: false });
    addressControl?.enable({ emitEvent: false });
    if (requireNameForNew) {
      nameControl?.setValidators([Validators.required]);
    } else {
      nameControl?.clearValidators();
    }
    nameControl?.updateValueAndValidity({ emitEvent: false });
    this.syncDeskPurchaseTreasuryKey();
  }

  onSourcePartyTypeChange(type: OrderPartyType): void {
    this.syncDeskPurchaseTreasuryKey();
    if (this.sourcePartyType === type) return;
    this.sourcePartyType = type;
    this.lastNotifiedSourcePartyId = null;
    this.selectedSourceVendor = null;
    this.vendorSearchItems = [];
    const phone = String(this.sourcePartyForm.get('phone')?.value || '').trim();
    const nameControl = this.sourcePartyForm.get('name');
    const addressControl = this.sourcePartyForm.get('address');
    this.clearSourcePartyLookupState(nameControl, addressControl, !!phone);
    if (type === 'supplier') {
      this.sourcePartyForm.patchValue({ phone: '', name: '', address: '' }, { emitEvent: false });
    } else if (phone) {
      this.sourcePartyForm.get('phone')?.setValue(phone);
    }
  }

  sourcePartyInfoTitleKey(): string {
    return this.sourcePartyType === 'supplier' ? 'tr_supplier_info' : 'tr_client_info';
  }

  sourcePartyNameLabelKey(): string {
    return this.sourcePartyType === 'supplier' ? 'tr_supplier_contact_name' : 'tr_client_name';
  }

  private phoneFormatValidator(control: AbstractControl): ValidationErrors | null {
    const raw = String(control.value ?? '').trim();
    if (!raw) return null;
    const normalized = raw.replace(/[\s\-()]/g, '');
    const ok = /^\+?\d{7,15}$/.test(normalized);
    return ok ? null : { phoneFormat: true };
  }

  private hasSourcePartyInput(): boolean {
    const raw = this.sourcePartyForm.getRawValue();
    return !!(String(raw.phone || '').trim() || String(raw.name || '').trim());
  }

  /**
   * Submit button sits in modal-footer outside `<form>`, so ngSubmit never runs
   * and `basicInfoForm.submitted` stays false — field errors never show.
   */
  private markBasicInfoFormSubmitted(): void {
    if (this.basicInfoForm) {
      this.basicInfoForm.onSubmit(null as any);
    }
  }

  private notifyRequiredFieldsMissing(): void {
    this.appNotificationService.push(
      this.translateService.instant('tr_fill_required_fields'),
      'error'
    );
  }

  private validateSourcePartyOptional(): boolean {
    if (!this.hasSourcePartyInput()) {
      return true;
    }
    const phone = String(this.sourcePartyForm.get('phone')?.value || '').trim();
    const name = String(this.sourcePartyForm.get('name')?.value || '').trim();
    if (phone) {
      const phoneErr = this.phoneFormatValidator(this.sourcePartyForm.get('phone')!);
      if (phoneErr) {
        this.sourcePartyForm.get('phone')?.markAsTouched();
        this.appNotificationService.push(
          this.translateService.instant('tr_client_phone_invalid'),
          'error'
        );
        return false;
      }
      if (!this.isExistingSourceClient && !this.isExistingSourceVendor && !name) {
        this.sourcePartyForm.get('name')?.markAsTouched();
        this.appNotificationService.push(
          this.translateService.instant('tr_product_source_name_required'),
          'error'
        );
        return false;
      }
    }
    return true;
  }

  private buildAcquiredFromPayload(): ProductAcquiredFrom | null {
    if (!this.hasSourcePartyInput()) {
      return null;
    }
    const raw = this.sourcePartyForm.getRawValue();
    const phone = String(raw.phone || '').trim();
    const name = String(raw.name || '').trim();
    const address = String(raw.address || '').trim();
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

  private attachAcquiredFromToPayload(target: Record<string, unknown>): void {
    const acquiredFrom = this.buildAcquiredFromPayload();
    if (acquiredFrom) {
      target.acquiredFrom = acquiredFrom;
    } else if (this.isEdit) {
      target.acquiredFrom = null;
    }
  }

  onProductCategoryChange(cat: Category | null): void {
    this.selectedCategory = cat;
    this.setCategoryAttributeDefsFromSelected();
    if (!cat) {
      if (!this.isEdit) {
        this.codeValue = '';
        this.isCodeGenerated = false;
      }
      this.multiUnitCodes = [];
      this.multiUnitVariants = [];
      this.unitsShareSameData = true;
      this.ensureActiveTabValid();
      return;
    }
    if (!this.hasCategoryCode(cat)) {
      if (!this.isEdit) {
        this.codeValue = '';
        this.isCodeGenerated = false;
      }
      this.multiUnitCodes = [];
      this.multiUnitVariants = [];
      this.unitsShareSameData = true;
      this.ensureActiveTabValid();
      return;
    }
    if (!this.isEdit) {
      this.codeValue = '';
      this.isCodeGenerated = false;
      this.multiUnitCodes = [];
      this.multiUnitVariants = [];
      this.unitsShareSameData = true;
      this.regenerateCodeFromCategory();
      this.ensureActiveTabValid();
      return;
    }
    const newId = String(cat._id);
    if (this.previousCategoryIdForEdit && this.previousCategoryIdForEdit !== newId) {
      this.regenerateCodeFromCategory();
    }
    this.previousCategoryIdForEdit = newId;
    this.ensureActiveTabValid();
  }

  private regenerateCodeFromCategory(): void {
    const cat = this.selectedCategory;
    if (!cat?._id || !this.hasCategoryCode(cat)) {
      return;
    }
    if (!this.isEdit && this.isMultiCodeCategory && this.getStockQty() > 1) {
      this.refreshMultiUnitCodes(false);
      return;
    }
    this.productsSerivce.generateBarcode(String(cat._id)).subscribe({
      next: (res: { code?: string; codes?: string[] }) => {
        const single = res.codes?.length ? res.codes[0] : res.code;
        if (!single) {
          return;
        }
        this.codeValue = single;
        this.isCodeGenerated = true;
        this.basicInfoForm?.form?.patchValue({ code: single });
      },
      error: (err: any) => {
        const msg =
          err?.error?.error ||
          this.translateService.instant('tr_barcode_generate_failed');
        this.appNotificationService.push(msg, 'error');
      },
    });
  }

  enforceProductCodePrefix(): void {
    const cat = this.selectedCategory;
    if (!cat || !this.hasCategoryCode(cat)) {
      return;
    }
    const prefix = String(cat.code).trim();
    let v = (this.codeValue || '').trim();
    if (!v) {
      return;
    }
    const pu = prefix.toUpperCase();
    if (!v.toUpperCase().startsWith(pu)) {
      const join = prefix.endsWith('-') ? '' : '-';
      this.codeValue = `${prefix}${join}${v}`.replace(/-+/g, '-');
    }
  }

  isCloudinaryConfigured(): boolean {
    return !!environment.cloudinary?.cloudName;
  }

  onProductImageSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      return;
    }
    if (!file.type.startsWith('image/')) {
      this.appNotificationService.push(this.translateService.instant('tr_product_image_invalid_type'), 'error');
      input.value = '';
      return;
    }
    if (file.size > this.maxImageBytes) {
      this.appNotificationService.push(this.translateService.instant('tr_product_image_too_large'), 'error');
      input.value = '';
      return;
    }
    if (!this.isCloudinaryConfigured()) {
      this.appNotificationService.push(this.translateService.instant('tr_cloudinary_not_configured'), 'error');
      input.value = '';
      return;
    }
    this.isUploadingImage = true;
    this.subscriptions.push(
      this.cloudinaryUpload.uploadProductImage(file).subscribe(
        (url) => {
          this.isUploadingImage = false;
          this.productImageUrl = url;
          this.appNotificationService.push(this.translateService.instant('tr_product_image_upload_ok'), 'success');
          input.value = '';
        },
        (err) => {
          this.isUploadingImage = false;
          const msg =
            err?.error?.error ||
            err?.error?.message ||
            this.translateService.instant('tr_product_image_upload_failed');
          this.appNotificationService.push(msg, 'error');
          input.value = '';
        }
      )
    );
  }

  clearProductImage(): void {
    this.productImageUrl = '';
  }

  isUploadingUnitImage(index: number): boolean {
    return this.uploadingUnitImageIndex === index;
  }

  onUnitProductImageSelected(index: number, event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || !this.multiUnitVariants[index]) {
      return;
    }
    if (!file.type.startsWith('image/')) {
      this.appNotificationService.push(this.translateService.instant('tr_product_image_invalid_type'), 'error');
      input.value = '';
      return;
    }
    if (file.size > this.maxImageBytes) {
      this.appNotificationService.push(this.translateService.instant('tr_product_image_too_large'), 'error');
      input.value = '';
      return;
    }
    if (!this.isCloudinaryConfigured()) {
      this.appNotificationService.push(this.translateService.instant('tr_cloudinary_not_configured'), 'error');
      input.value = '';
      return;
    }
    this.uploadingUnitImageIndex = index;
    this.subscriptions.push(
      this.cloudinaryUpload.uploadProductImage(file).subscribe(
        (url) => {
          this.uploadingUnitImageIndex = null;
          if (this.multiUnitVariants[index]) {
            this.multiUnitVariants[index] = {
              ...this.multiUnitVariants[index],
              imageUrl: url,
            };
          }
          this.appNotificationService.push(this.translateService.instant('tr_product_image_upload_ok'), 'success');
          input.value = '';
        },
        (err) => {
          this.uploadingUnitImageIndex = null;
          const msg =
            err?.error?.error ||
            err?.error?.message ||
            this.translateService.instant('tr_product_image_upload_failed');
          this.appNotificationService.push(msg, 'error');
          input.value = '';
        }
      )
    );
  }

  clearUnitProductImage(index: number): void {
    if (!this.multiUnitVariants[index]) {
      return;
    }
    this.multiUnitVariants[index] = {
      ...this.multiUnitVariants[index],
      imageUrl: '',
    };
  }






generateBarcode() {
  const cat = this.selectedCategory;
  if (!cat?._id || !this.hasCategoryCode(cat)) {
    this.appNotificationService.push(
      this.translateService.instant('tr_select_category_first_code'),
      'error'
    );
    return;
  }
  const q = this.getStockQty();
  if (!this.isEdit && this.isMultiCodeCategory && q > 1) {
    this.refreshMultiUnitCodes(true);
    return;
  }
  this.productsSerivce.generateBarcode(String(cat._id)).subscribe({
    next: (res: { code?: string; codes?: string[] }) => {
      const single = res.codes?.length ? res.codes[0] : res.code;
      if (!single) {
        return;
      }
      this.codeValue = single;
      this.isCodeGenerated = true;
      this.basicInfoForm?.form?.patchValue({ code: single });
      this.appNotificationService.push(
        this.translateService.instant('tr_product_code_generated'),
        'success'
      );
    },
    error: (err: any) => {
      const msg =
        err?.error?.error ||
        this.translateService.instant('tr_barcode_generate_failed');
      this.appNotificationService.push(msg, 'error');
    },
  });
}

private submitDeskPurchaseRequest(): void {
  if (this.isUploadingImage || this.uploadingUnitImageIndex !== null) {
    return;
  }
  this.syncDeskPurchaseTreasuryKey();
  if (!this.basicInfoForm.valid && !this.isPerUnitVariantMode) {
    this.notifyRequiredFieldsMissing();
    return;
  }
  if (!this.basicInfoForm.valid && this.isPerUnitVariantMode) {
    // Shared price/net fields are optional in per-unit mode; still require name/stock/category.
    const nameOk = String(this.basicInfoForm.value?.name || '').trim();
    const stockOk = Number(this.basicInfoForm.value?.stock) >= 1;
    if (!nameOk || !stockOk) {
      this.notifyRequiredFieldsMissing();
      return;
    }
  }
  if (!this.selectedCategory || !this.hasCategoryCode(this.selectedCategory)) {
    this.appNotificationService.push(
      this.translateService.instant('tr_select_category_first_code'),
      'error'
    );
    return;
  }
  const prefixU = String(this.selectedCategory.code || '').trim().toUpperCase();
  let deskMultiUnits: string[] | null = null;
  let deskUnitDetails:
    | Array<{
        code: string;
        price: number;
        netPrice: number;
        discount: number;
        attributes: Record<string, string>;
        imageUrl: string;
      }>
    | null = null;

  if (this.isPerUnitVariantMode) {
    deskUnitDetails = this.getValidatedUnitDetails();
    if (!deskUnitDetails) {
      return;
    }
    deskMultiUnits = deskUnitDetails.map((d) => d.code);
  } else if (this.isMultiUnitMode) {
    deskMultiUnits = this.getValidatedMultiUnitCodes();
    if (!deskMultiUnits) {
      return;
    }
  } else {
    const codeTrim = String(this.codeValue || '').trim();
    if (!codeTrim.toUpperCase().startsWith(prefixU)) {
      this.appNotificationService.push(
        this.translateService.instant('tr_product_code_prefix_mismatch'),
        'error'
      );
      return;
    }
  }

  const fv = this.basicInfoForm.value;
  let priceNum = Number(fv.price);
  let netNum = Number(fv.netPrice);
  let discountNum =
    fv.discount === undefined || fv.discount === null || fv.discount === '' ? 0 : Number(fv.discount);
  let attributesPayload = this.buildAttributesPayload();

  if (deskUnitDetails?.length) {
    priceNum = deskUnitDetails[0].price;
    netNum = deskUnitDetails[0].netPrice;
    discountNum = deskUnitDetails[0].discount;
    attributesPayload = deskUnitDetails[0].attributes;
  } else if (fv.netPrice === '' || fv.netPrice == null || Number.isNaN(netNum) || netNum < 0) {
    this.appNotificationService.push(
      this.translateService.instant('tr_desk_purchase_net_required'),
      'error'
    );
    return;
  }

  const uid = String(this.globals.currentUser?._id || '');
  if (!uid) {
    this.appNotificationService.push(this.translateService.instant('tr_unexpected_error_message'), 'error');
    return;
  }

  let branchId = '';
  if (this.data?.forcedBranchId) {
    branchId = String(this.data.forcedBranchId);
  } else if (this.isBranchManagerNewProduct) {
    branchId = String(this.globals.currentUser?.branch?._id || '');
  } else if (fv.branch?._id) {
    branchId = String(fv.branch._id);
  }

  if (!branchId) {
    this.appNotificationService.push(this.translateService.instant('tr_branch_required'), 'error');
    return;
  }

  this.syncDeskPurchaseTreasuryKey();

  const qty = Math.max(1, Math.floor(Number(fv.stock) || 1));

  const deskCode = deskMultiUnits?.length
    ? deskMultiUnits[0]
    : String(this.codeValue || '').trim();

  const deskProduct: DeskPurchaseProductPayload = {
    name: String(fv.name || '').trim(),
    code: deskCode,
    categoryId: String(this.selectedCategory._id),
    price: Math.round(priceNum * 100) / 100,
    netPrice: Math.round(netNum * 100) / 100,
    discount: Number.isFinite(discountNum) ? Math.round(discountNum * 100) / 100 : 0,
    attributes: attributesPayload,
    imageUrl: this.productImageUrl || '',
    notes: '',
  };
  if (deskMultiUnits?.length) {
    deskProduct.unitCodes = [...deskMultiUnits];
  }
  if (deskUnitDetails?.length) {
    deskProduct.unitDetails = deskUnitDetails.map((d) => ({ ...d }));
  }
  const acquiredFrom = this.buildAcquiredFromPayload();
  if (acquiredFrom) {
    deskProduct.acquiredFrom = acquiredFrom;
  }
  const addedByTrim = String(fv.addedBy || '').trim();
  if (addedByTrim) {
    deskProduct.addedBy = addedByTrim;
  }
  if (this.showOnlineListingOption) {
    deskProduct.listedOnEcommerce = Boolean(this.listedOnEcommerce);
  }
  if (this.showEcommerceTab) {
    deskProduct.ecommerceDescription = String(this.ecommerceDescription || '').trim();
    deskProduct.ecommerceShortDescription = String(this.ecommerceShortDescription || '').trim();
    deskProduct.ecommerceIsFeatured = Boolean(this.ecommerceIsFeatured);
  }

  const isExchangeTradeIn = !!this.data?.exchangeFlow;
  const appendToPurchaseId = String(this.data?.appendToExchangePurchaseId || '').trim();
  let treasurySplits: { key: string; label?: string; amount: number }[] | undefined;
  if (!isExchangeTradeIn) {
    const built = this.buildPurchaseTreasurySplitsPayload();
    if (!built) {
      return;
    }
    treasurySplits = built;
  }

  this.isSubmitting = true;
  const request$ = appendToPurchaseId
    ? this.productPurchaseRequests.addLine(appendToPurchaseId, {
        userId: uid,
        quantity: qty,
        product: deskProduct,
      })
    : this.productPurchaseRequests.create({
        userId: uid,
        branchId,
        quantity: qty,
        product: deskProduct,
        exchangeTradeIn: isExchangeTradeIn,
        ...(treasurySplits ? { purchaseTreasurySplits: treasurySplits } : {}),
      });

  request$.subscribe({
      next: (res: any) => {
        this.isSubmitting = false;
        const createdProducts = res?.createdProducts;
        const nameStr = String(fv.name || '').trim();
        const finish = () => this.dialogRef.close({ submitted: true, deskPurchaseResult: res });

        if (Array.isArray(createdProducts) && createdProducts.length > 1) {
          if (deskUnitDetails?.length) {
            this.printBarcodeStickersPerUnit(
              nameStr,
              deskUnitDetails,
              finish
            );
            return;
          }
          const bv = productBarcodeAttributeValues(this.selectedCategory!, attributesPayload);
          const deskPrintPrice = this.getBarcodePrintPrice(priceNum);
          const codes = createdProducts.map((p: any) => String(p?.code || '').trim()).filter(Boolean);
          this.printBarcodeStickers(nameStr, codes, bv, finish, deskPrintPrice);
          return;
        }
        const single = res?.createdProduct?.code ? String(res.createdProduct.code).trim() : '';
        if (single) {
          const bv = productBarcodeAttributeValues(
            this.selectedCategory!,
            deskUnitDetails?.[0]?.attributes || attributesPayload
          );
          const deskPrintPrice = this.getBarcodePrintPrice(
            deskUnitDetails?.[0]?.price ?? priceNum
          );
          this.productsSerivce.getBarcodeImage(single, nameStr, bv, deskPrintPrice).subscribe({
            next: (html: any) => {
              this.printHtml(html);
              finish();
            },
            error: () => finish(),
          });
          return;
        }
        finish();
      },
      error: (error: any) => {
        this.isSubmitting = false;
        const apiCode = error?.error?.code;
        const msg =
          apiCode === 'PRODUCT_CODE_CATEGORY_MISMATCH'
            ? this.translateService.instant('tr_product_code_category_mismatch')
            : apiCode === 'PRODUCT_SERIAL_ALREADY_EXISTS'
              ? this.translateService.instant('tr_product_serial_already_exists')
              : apiCode === 'PRODUCT_CODE_ALREADY_EXISTS'
                ? this.translateService.instant('tr_product_code_already_exists')
                : error?.error?.details ||
                  error?.error?.error ||
                  error?.error?.message ||
                  this.translateService.instant('tr_unexpected_error_message');
        this.appNotificationService.push(msg, 'error');
      },
    });
  }

createProduct() {
  if (this.isUploadingImage || this.uploadingUnitImageIndex !== null) {
    return;
  }
  if (!this.basicInfoForm.valid && !this.isPerUnitVariantMode) {
    this.notifyRequiredFieldsMissing();
    return;
  }
  if (!this.basicInfoForm.valid && this.isPerUnitVariantMode) {
    const nameOk = String(this.basicInfoForm.value?.name || '').trim();
    const stockOk = Number(this.basicInfoForm.value?.stock) >= 0;
    if (!nameOk || !stockOk) {
      this.notifyRequiredFieldsMissing();
      return;
    }
  }
  if (!this.selectedCategory || !this.hasCategoryCode(this.selectedCategory)) {
    this.appNotificationService.push(
      this.translateService.instant('tr_select_category_first_code'),
      'error'
    );
    return;
  }
  const prefixU = String(this.selectedCategory.code || '').trim().toUpperCase();
  let createMultiUnits: string[] | null = null;
  let createUnitDetails:
    | Array<{
        code: string;
        price: number;
        netPrice: number;
        discount: number;
        attributes: Record<string, string>;
        imageUrl: string;
      }>
    | null = null;

  if (this.isPerUnitVariantMode) {
    createUnitDetails = this.getValidatedUnitDetails();
    if (!createUnitDetails) {
      return;
    }
    createMultiUnits = createUnitDetails.map((d) => d.code);
  } else if (this.isMultiUnitMode) {
    createMultiUnits = this.getValidatedMultiUnitCodes();
    if (!createMultiUnits) {
      return;
    }
  } else {
    const codeTrim = String(this.codeValue || '').trim();
    if (!codeTrim.toUpperCase().startsWith(prefixU)) {
      this.appNotificationService.push(
        this.translateService.instant('tr_product_code_prefix_mismatch'),
        'error'
      );
      return;
    }
  }

  const inWarehouse = this.isBranchManagerNewProduct ? false : this.storeInWarehouse;
  let branchForPayload = this.basicInfoForm.value.branch;
  if (this.isBranchManagerNewProduct) {
    const ub = this.globals.currentUser?.branch;
    branchForPayload =
      (ub && this.branches?.find((b: Branch) => String(b._id) === String(ub._id))) || ub;
    if (!branchForPayload?._id) {
      this.appNotificationService.push(
        this.translateService.instant('tr_branch_required'),
        'error'
      );
      return;
    }
  } else if (!inWarehouse && !branchForPayload?._id) {
    this.appNotificationService.push(
      this.translateService.instant('tr_branch_required'),
      'error'
    );
    return;
  }

  const payload: any = {
    ...this.basicInfoForm.value,
    stock: this.getStockQty(),
    code: createMultiUnits?.length ? createMultiUnits[0] : this.codeValue,
    inWarehouse,
    imageUrl: this.productImageUrl || '',
    attributes: this.buildAttributesPayload(),
    userId: this.globals.currentUser?._id,
    listedOnEcommerce: this.showOnlineListingOption ? Boolean(this.listedOnEcommerce) : false,
    ecommerceDescription: this.showEcommerceTab ? String(this.ecommerceDescription || '').trim() : '',
    ecommerceShortDescription: this.showEcommerceTab
      ? String(this.ecommerceShortDescription || '').trim()
      : '',
    ecommerceIsFeatured: this.showEcommerceTab ? Boolean(this.ecommerceIsFeatured) : false,
  };
  if (createUnitDetails?.length) {
    payload.price = createUnitDetails[0].price;
    payload.netPrice = createUnitDetails[0].netPrice;
    payload.discount = createUnitDetails[0].discount;
    payload.attributes = createUnitDetails[0].attributes;
    payload.unitDetails = createUnitDetails.map((d) => ({ ...d }));
  }
  if (createMultiUnits?.length) {
    payload.unitCodes = [...createMultiUnits];
  }
  this.attachAcquiredFromToPayload(payload);
  if (this.cutFromSourceEnabled) {
    payload.sourceProductId = this.selectedSourceProductId || null;
  }
  // Let backend compute netPrice when left empty.
  if (payload.netPrice === '' || payload.netPrice == null) {
    delete payload.netPrice;
  }
  // Ensure numeric discount payload (discount is a percentage 0..100).
  if (payload.discount === '' || payload.discount == null) {
    payload.discount = 0;
  }
  if (inWarehouse) {
    delete payload.branch;
  } else if (this.isBranchManagerNewProduct) {
    payload.branch = branchForPayload;
  }

  this.productsSerivce.createProduct(payload).subscribe(
    (res: any) => {
      this.appNotificationService.push('✅ المنتج تم إضافته', 'success');

      const names = String(payload.name || '').trim();
      const codes =
        Array.isArray(res?.createdProducts) && res.createdProducts.length > 1
          ? res.createdProducts.map((p: any) => String(p?.code || '').trim()).filter(Boolean)
          : res?.createdProduct?.code
            ? [String(res.createdProduct.code).trim()]
            : [];

      if (createUnitDetails?.length && codes.length > 1) {
        this.printBarcodeStickersPerUnit(names, createUnitDetails, () => this.closeModal());
      } else {
        const bv = productBarcodeAttributeValues(
          this.selectedCategory,
          payload.attributes
        );
        const printPrice = this.getBarcodePrintPrice(payload.price);
        if (codes.length > 1) {
          this.printBarcodeStickers(names, codes, bv, () => this.closeModal(), printPrice);
        } else if (codes.length === 1) {
          this.productsSerivce.getBarcodeImage(codes[0], names, bv, printPrice).subscribe({
            next: (html: any) => {
              this.printHtml(html);
              this.closeModal();
            },
            error: () => this.closeModal(),
          });
        } else {
          this.closeModal();
        }
      }
    },
    (error) => {
      this.appNotificationService.push(error.error.error, 'error');
    }
  );
}

printHtml(html: string) {
  const printWindow = window.open('', '_blank', 'width=600,height=400');
  
  if (!printWindow) return;

  printWindow.document.open();
  printWindow.document.write(html);


  printWindow.document.write(`
    <script>
      window.onload = function() {
        window.print();
      };
      window.onafterprint = function() {
        window.close();
      };
    </script>
  `);

  printWindow.document.close();
}




updateProduct() {
  if (this.isUploadingImage || this.uploadingUnitImageIndex !== null) {
    return;
  }
  this.product = this.basicInfoForm.value;
  if (!this.basicInfoForm.valid) {
    this.notifyRequiredFieldsMissing();
    return;
  }
  if (!this.selectedCategory || !this.hasCategoryCode(this.selectedCategory)) {
    this.appNotificationService.push(
      this.translateService.instant('tr_category_code_missing_on_category'),
      'error'
    );
    return;
  }
  const codeTrim = String(this.codeValue || '').trim();
  const prefix = String(this.selectedCategory.code || '').trim();
  if (!codeTrim.toUpperCase().startsWith(prefix.toUpperCase())) {
    this.appNotificationService.push(
      this.translateService.instant('tr_product_code_prefix_mismatch'),
      'error'
    );
    return;
  }
  if (!this.storeInWarehouse && !this.basicInfoForm.value.branch?._id) {
    this.appNotificationService.push(
      this.translateService.instant('tr_branch_required'),
      'error'
    );
    return;
  }
  this.product = this.basicInfoForm.value;
  const payload: any = {
    ...this.basicInfoForm.value,
    code: this.codeValue,
    inWarehouse: this.storeInWarehouse,
    imageUrl: this.productImageUrl,
    attributes: this.buildAttributesPayload(),
  };
  // Let backend compute netPrice when left empty.
  if (payload.netPrice === '' || payload.netPrice == null) {
    delete payload.netPrice;
  }
  // Ensure numeric discount payload (discount is a percentage 0..100).
  if (payload.discount === '' || payload.discount == null) {
    payload.discount = 0;
  }
  if (this.storeInWarehouse) {
    delete payload.branch;
  }
  this.attachAcquiredFromToPayload(payload);
  if (this.cutFromSourceEnabled) {
    payload.sourceProductId = this.selectedSourceProductId || null;
  }
  payload.userId = this.globals.currentUser?._id;
  payload.listedOnEcommerce = this.showOnlineListingOption ? Boolean(this.listedOnEcommerce) : false;
  payload.ecommerceDescription = this.showEcommerceTab ? String(this.ecommerceDescription || '').trim() : '';
  payload.ecommerceShortDescription = this.showEcommerceTab
    ? String(this.ecommerceShortDescription || '').trim()
    : '';
  payload.ecommerceIsFeatured = this.showEcommerceTab ? Boolean(this.ecommerceIsFeatured) : false;

  this.productsSerivce.updateProduct(payload, this.productId).subscribe(
    (res: any) => {
      this.appNotificationService.push('✅ المنتج تم تحديثه', 'success');

      const bv = productBarcodeAttributeValues(
        this.selectedCategory,
        payload.attributes
      );
      const names = String(payload.name || '').trim();
      const code = String(this.codeValue || payload.code || '').trim();
      const printPrice = this.getBarcodePrintPrice(payload.price);

      if (code) {
        this.productsSerivce.getBarcodeImage(code, names, bv, printPrice).subscribe({
          next: (html: any) => {
            this.printHtml(html);
            this.closeModal(true);
          },
          error: () => this.closeModal(true),
        });
      } else {
        this.closeModal(true);
      }
    },
    (error) => {
      const code = error?.error?.code;
      const msg =
        code === 'ACTIVE_BOOKING_BLOCKS_WAREHOUSE'
          ? this.translateService.instant('tr_product_warehouse_blocked_active_booking')
          : code === 'PRODUCT_SERIAL_ALREADY_EXISTS'
            ? this.translateService.instant('tr_product_serial_already_exists')
            : code === 'PRODUCT_CODE_ALREADY_EXISTS'
              ? this.translateService.instant('tr_product_code_already_exists')
              : error?.error?.error || this.translateService.instant('tr_unexpected_error_message');
      this.appNotificationService.push(msg, 'error');
    }
  );
}


  // createProduct() {
  //   this.product = this.basicInfoForm.value;
  //   if (!this.basicInfoForm.valid) {
  //     return;
  //   }

  //   this.productsSerivce.createProduct(this.product).subscribe(() => {
  //     this.appNotificationService.push('product created successfully', 'sucess');
  //     this.closeModal(true);
  //   }, error=> {
  //     this.appNotificationService.push(error.error.error, 'error');
  //   });

  // }

  // updateProduct() {
  //   this.product = this.basicInfoForm.value;
  //   if (!this.basicInfoForm.valid) {
  //     return;
  //   }

  //   this.productsSerivce.updateProduct(this.product,this.productId).subscribe(() => {
  //     this.appNotificationService.push('product updated successfully', 'sucess');
  //     this.closeModal(true);
  //   }, error=> {
  //     this.appNotificationService.push(error.error.error, 'error');
  //   });

  // }

  submitForm(){
    this.markBasicInfoFormSubmitted();
    if (!this.validateSourcePartyOptional()) {
      return;
    }
    if (!this.validateCategoryAttributesRequired()) {
      return;
    }
    if(this.isEdit){
      this.updateProduct();
    }
    else if (this.cashDeskPurchase) {
      this.submitDeskPurchaseRequest();
    }
    else{
      this.createProduct();
    }
  }

  toggleCamera() {
    if (!this.isProductCodeEnabled) {
      this.appNotificationService.push(
        this.translateService.instant('tr_select_category_first_code'),
        'error'
      );
      return;
    }
    this.isCameraActive = !this.isCameraActive;
    if (this.isCameraActive) {
      this.startCameraScan();
    }
  }

  startCameraScan() {
    this.codeReader
      .decodeOnceFromVideoDevice(undefined, 'video')
      .then(result => {
        if (result) {
          this.onCodeScanned(result.getText());
          // أقفل الكاميرا بعد أول Scan
          this.isCameraActive = false;
        }
      })
      .catch(err => {
        console.error('Scan error', err);
        this.appNotificationService.push('Unable to scan code', 'error');
        this.isCameraActive = false;
      });
  }

  onCodeScanned(code: string) {
    if (!code) return;

    if (code.length < 3) {
      this.appNotificationService.push('Invalid code', 'error');
      return;
    }

    if (this.selectedCategory && this.hasCategoryCode(this.selectedCategory)) {
      const p = String(this.selectedCategory.code).trim();
      if (!code.toUpperCase().startsWith(p.toUpperCase())) {
        this.appNotificationService.push(
          this.translateService.instant('tr_scan_code_wrong_prefix'),
          'error'
        );
        return;
      }
    }

    this.codeValue = code;
    this.basicInfoForm?.form?.patchValue({ code });
    this.appNotificationService.push('Code scanned successfully', 'success');
  }

  ngOnDestroy() {
    if (this.stockQtyDebounceTimer) {
      clearTimeout(this.stockQtyDebounceTimer);
    }
    this.codeReader.decodeOnceFromVideoDevice();
    this.subscriptions.forEach(s => s.unsubscribe());
  }
  

  destroyComponent() {
    this.destroyEmitter.emit();
  }
  closeModal(result?: any) {
    this.dialogRef.close(result);
  }
}

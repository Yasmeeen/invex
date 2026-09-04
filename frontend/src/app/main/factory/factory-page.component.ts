import { Component, OnDestroy, OnInit } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { Globals } from '@core/globals';
import { Branch, Product } from '@core/models/products.model';
import { PaginationData } from '@core/models/users-interfaces.model';
import { CLIENTS_URL } from '@core/base/urls';
import { BranchesServce } from '@shared/services/branches.service';
import { AppNotificationService } from '@shared/services/app-notification.service';
import { ProductsSerivce } from '@shared/services/products.service';
import { VendorsSerivce } from '@shared/services/vendors.service';
import { CategoriesServce } from '@shared/services/categories.service';
import { TranslateService } from '@ngx-translate/core';
import { Subscription } from 'rxjs';
import {
  Factory,
  FactorySale,
  FactoryService,
  FactoryStockTransfer,
  ManufacturingOrder,
  ManufacturingRecipe,
} from '@shared/services/factory.service';
import { AddFactoryDialogComponent } from './add-factory-dialog/add-factory-dialog.component';

type FactoryTab = 'stock' | 'orders' | 'recipes' | 'transfers' | 'sales';

const TAB_TITLE_KEYS: Record<FactoryTab, string> = {
  stock: 'tr_factory_tab_stock',
  orders: 'tr_factory_tab_orders',
  recipes: 'tr_factory_tab_recipes',
  transfers: 'tr_factory_tab_transfers',
  sales: 'tr_factory_tab_sales',
};

@Component({
  selector: 'app-factory-page',
  templateUrl: './factory-page.component.html',
  styleUrls: ['./factory-page.component.scss'],
})
export class FactoryPageComponent implements OnInit, OnDestroy {
  factories: Factory[] = [];
  factoryId = '';
  activeTab: FactoryTab = 'stock';
  loading = false;

  products: Product[] = [];
  stockPagination: PaginationData | null = null;
  stockSearch = '';

  orders: ManufacturingOrder[] = [];
  ordersPagination: PaginationData | null = null;

  recipes: ManufacturingRecipe[] = [];

  transfers: FactoryStockTransfer[] = [];
  transfersPagination: PaginationData | null = null;

  sales: FactorySale[] = [];
  salesPagination: PaginationData | null = null;

  showManufacture = false;
  manufOutputQty: number | null = null;
  manufWasteQty = 0;
  manufNotes = '';
  manufRecipeId: string | null = null;
  manufOutputProductId: string | null = null;
  manufNewOutput = false;
  manufNewName = '';
  manufNewCode = '';
  manufNewCategoryId: string | null = null;
  manufNewPrice = 0;
  categories: any[] = [];
  manufIngredients: Array<{ productId: string | null; qty: number | null }> = [
    { productId: null, qty: null },
  ];
  manufSaving = false;

  showRecipeForm = false;
  recipeOutputCode = '';
  recipeOutputName = '';
  recipeOutputUnit: 'kg' | 'unit' = 'kg';
  recipeLines: Array<{
    ingredientProductCode: string;
    name: string;
    defaultQtyPerOutputUnit: number | null;
  }> = [{ ingredientProductCode: '', name: '', defaultQtyPerOutputUnit: null }];
  recipeSaving = false;

  showTransfer = false;
  transferDirection: 'to_factory' | 'from_factory' = 'to_factory';
  transferProductId: string | null = null;
  transferQty: number | null = null;
  transferFromBranchId: string | null = null;
  transferFromWarehouse = false;
  transferToBranchId: string | null = null;
  transferSaving = false;
  branchProducts: Product[] = [];
  branches: Branch[] = [];

  showSale = false;
  salePartyType: 'client' | 'vendor' = 'client';
  saleClientId: string | null = null;
  saleVendorId: string | null = null;
  saleLines: Array<{
    productId: string | null;
    quantity: number | null;
    unitPrice: number | null;
  }> = [{ productId: null, quantity: null, unitPrice: null }];
  saleNotes = '';
  saleSaving = false;
  clients: any[] = [];
  vendors: any[] = [];

  private subs: Subscription[] = [];

  constructor(
    private factoryService: FactoryService,
    private branchesService: BranchesServce,
    private productsService: ProductsSerivce,
    private vendorsService: VendorsSerivce,
    private categoriesService: CategoriesServce,
    private http: HttpClient,
    private notify: AppNotificationService,
    private translate: TranslateService,
    private dialog: MatDialog,
    private route: ActivatedRoute,
    private router: Router,
    public globals: Globals
  ) {}

  ngOnInit(): void {
    this.subs.push(
      this.route.data.subscribe((data) => {
        const tab = String(data?.tab || 'stock') as FactoryTab;
        if (['stock', 'orders', 'recipes', 'transfers', 'sales'].includes(tab)) {
          this.activeTab = tab;
          if (this.factoryId) this.reloadTab();
        }
      })
    );
    this.loadFactories();
    this.subs.push(
      this.branchesService.getBranchs({ page: 1, limit: 1000 }).subscribe({
        next: (res: any) => {
          this.branches = res?.branches || res?.data || [];
        },
      })
    );
    this.subs.push(
      this.categoriesService.getCategorys({ page: 1, limit: 500 } as any).subscribe({
        next: (res: any) => {
          this.categories = res?.categories || res?.data || [];
        },
      })
    );
  }

  ngOnDestroy(): void {
    this.subs.forEach((s) => s.unsubscribe());
  }

  get userId(): string {
    return this.globals.currentUser?._id || '';
  }

  get manufCostPreview(): { total: number; unit: number } {
    let total = 0;
    for (const row of this.manufIngredients) {
      const p = this.products.find((x) => String(x._id) === String(row.productId));
      const qty = Number(row.qty) || 0;
      const cost = Number(p?.netPrice) || 0;
      total += qty * cost;
    }
    total = Math.round(total * 100) / 100;
    const out = Number(this.manufOutputQty) || 0;
    return { total, unit: out > 0 ? Math.round((total / out) * 100) / 100 : 0 };
  }

  private toast(key: string, type: 'success' | 'error'): void {
    this.notify.push(this.translate.instant(key), type);
  }

  loadFactories(): void {
    this.loading = true;
    this.factoryService.listFactories(this.userId, true).subscribe({
      next: (res) => {
        this.factories = res.factories || [];
        if (!this.factoryId && this.factories.length) {
          this.factoryId = this.factories[0]._id;
        }
        this.loading = false;
        if (this.factoryId) this.reloadTab();
      },
      error: () => {
        this.loading = false;
        this.toast('tr_factory_load_failed', 'error');
      },
    });
  }

  get pageTitleKey(): string {
    return TAB_TITLE_KEYS[this.activeTab] || 'tr_factory';
  }

  onFactoryChange(): void {
    this.reloadTab();
  }

  setTab(tab: FactoryTab): void {
    void this.router.navigate(['/factory', tab]);
  }

  reloadTab(): void {
    if (!this.factoryId) return;
    switch (this.activeTab) {
      case 'stock':
        this.loadStock();
        break;
      case 'orders':
        this.loadOrders();
        break;
      case 'recipes':
        this.loadRecipes();
        break;
      case 'transfers':
        this.loadTransfers();
        break;
      case 'sales':
        this.loadSales();
        break;
    }
  }

  loadStock(page = 1): void {
    this.loading = true;
    this.factoryService
      .listStock(this.factoryId, {
        userId: this.userId,
        search: this.stockSearch,
        page,
        limit: 50,
      })
      .subscribe({
        next: (res) => {
          this.products = res.products || [];
          this.stockPagination = this.toPagination(res.pagination);
          this.loading = false;
        },
        error: () => {
          this.loading = false;
        },
      });
  }

  loadOrders(page = 1): void {
    this.loading = true;
    this.factoryService
      .listOrders({ userId: this.userId, factoryId: this.factoryId, page, limit: 20 })
      .subscribe({
        next: (res) => {
          this.orders = res.orders || [];
          this.ordersPagination = this.toPagination(res.pagination);
          this.loading = false;
        },
        error: () => {
          this.loading = false;
        },
      });
  }

  loadRecipes(): void {
    this.factoryService.listRecipes({ userId: this.userId, activeOnly: true }).subscribe({
      next: (res) => {
        this.recipes = res.recipes || [];
      },
    });
  }

  loadTransfers(page = 1): void {
    this.loading = true;
    this.factoryService
      .listTransfers({ userId: this.userId, factoryId: this.factoryId, page, limit: 20 })
      .subscribe({
        next: (res) => {
          this.transfers = res.transfers || [];
          this.transfersPagination = this.toPagination(res.pagination);
          this.loading = false;
        },
        error: () => {
          this.loading = false;
        },
      });
  }

  loadSales(page = 1): void {
    this.loading = true;
    this.factoryService
      .listSales({ userId: this.userId, factoryId: this.factoryId, page, limit: 20 })
      .subscribe({
        next: (res) => {
          this.sales = res.sales || [];
          this.salesPagination = this.toPagination(res.pagination);
          this.loading = false;
        },
        error: () => {
          this.loading = false;
        },
      });
  }

  private toPagination(p: any): PaginationData | null {
    if (!p) return null;
    return {
      page: p.page,
      pages: p.pages,
      totalCount: p.total,
      perPage: p.limit,
    } as any;
  }

  openAddFactory(): void {
    const ref = this.dialog.open(AddFactoryDialogComponent, {
      width: '480px',
      maxWidth: '95vw',
      autoFocus: true,
    });
    ref.afterClosed().subscribe((factory: Factory | null) => {
      if (!factory) return;
      this.factories = [...this.factories, factory];
      this.factoryId = factory._id;
      this.reloadTab();
    });
  }

  openManufacture(): void {
    this.showManufacture = true;
    this.manufOutputQty = null;
    this.manufWasteQty = 0;
    this.manufNotes = '';
    this.manufRecipeId = null;
    this.manufOutputProductId = null;
    this.manufNewOutput = false;
    this.manufNewName = '';
    this.manufNewCode = '';
    this.manufNewCategoryId = null;
    this.manufNewPrice = 0;
    this.manufIngredients = [{ productId: null, qty: null }];
    if (!this.products.length) this.loadStock();
    if (!this.recipes.length) this.loadRecipes();
  }

  onRecipePick(): void {
    const recipe = this.recipes.find((r) => r._id === this.manufRecipeId);
    if (!recipe) return;
    const outQty = Number(this.manufOutputQty) || 1;
    const byCode = new Map(this.products.map((p) => [String(p.code), p]));
    const matched = this.products.find((p) => String(p.code) === recipe.outputProductCode);
    if (matched) this.manufOutputProductId = String(matched._id);
    this.manufIngredients = (recipe.lines || []).map((l) => {
      const p = byCode.get(String(l.ingredientProductCode));
      return {
        productId: p ? String(p._id) : null,
        qty: Math.round((Number(l.defaultQtyPerOutputUnit) || 0) * outQty * 1000) / 1000,
      };
    });
    if (!this.manufIngredients.length) {
      this.manufIngredients = [{ productId: null, qty: null }];
    }
  }

  onManufOutputQtyChange(): void {
    if (this.manufRecipeId) this.onRecipePick();
  }

  addManufIngredient(): void {
    this.manufIngredients.push({ productId: null, qty: null });
  }

  removeManufIngredient(i: number): void {
    this.manufIngredients.splice(i, 1);
    if (!this.manufIngredients.length) {
      this.manufIngredients = [{ productId: null, qty: null }];
    }
  }

  submitManufacture(): void {
    if (!this.manufOutputQty || this.manufOutputQty <= 0) {
      this.toast('tr_factory_manuf_incomplete', 'error');
      return;
    }
    if (!this.manufNewOutput && !this.manufOutputProductId) {
      this.toast('tr_factory_manuf_incomplete', 'error');
      return;
    }
    if (
      this.manufNewOutput &&
      (!String(this.manufNewName || '').trim() ||
        !String(this.manufNewCode || '').trim() ||
        !this.manufNewCategoryId)
    ) {
      this.toast('tr_factory_manuf_incomplete', 'error');
      return;
    }
    const ingredients = this.manufIngredients
      .filter((r) => r.productId && Number(r.qty) > 0)
      .map((r) => ({ productId: r.productId, qty: Number(r.qty) }));
    if (!ingredients.length) {
      this.toast('tr_factory_manuf_need_ingredients', 'error');
      return;
    }
    this.manufSaving = true;
    const body: any = {
      userId: this.userId,
      factoryId: this.factoryId,
      outputQty: Number(this.manufOutputQty),
      wasteQty: Number(this.manufWasteQty) || 0,
      recipeId: this.manufRecipeId || undefined,
      ingredients,
      notes: this.manufNotes,
    };
    if (this.manufNewOutput) {
      body.outputProductCode = String(this.manufNewCode).trim();
      body.outputProductName = String(this.manufNewName).trim();
      body.outputCategoryId = this.manufNewCategoryId;
      body.outputPrice = Number(this.manufNewPrice) || 0;
    } else {
      body.outputProductId = this.manufOutputProductId;
    }
    this.factoryService.createOrder(body).subscribe({
      next: () => {
        this.manufSaving = false;
        this.showManufacture = false;
          this.toast('tr_factory_manuf_created', 'success');
          void this.router.navigate(['/factory', 'orders']);
          this.loadOrders();
          this.loadStock();
      },
      error: (err) => {
        this.manufSaving = false;
        this.notify.push(err?.error?.error || this.translate.instant('tr_factory_manuf_failed'), 'error');
      },
    });
  }

  openRecipeForm(): void {
    this.showRecipeForm = true;
    this.recipeOutputCode = '';
    this.recipeOutputName = '';
    this.recipeOutputUnit = 'kg';
    this.recipeLines = [{ ingredientProductCode: '', name: '', defaultQtyPerOutputUnit: null }];
  }

  addRecipeLine(): void {
    this.recipeLines.push({ ingredientProductCode: '', name: '', defaultQtyPerOutputUnit: null });
  }

  removeRecipeLine(i: number): void {
    this.recipeLines.splice(i, 1);
  }

  submitRecipe(): void {
    const lines = this.recipeLines
      .filter((l) => l.ingredientProductCode && Number(l.defaultQtyPerOutputUnit) > 0)
      .map((l) => ({
        ingredientProductCode: String(l.ingredientProductCode).trim(),
        name: String(l.name || '').trim(),
        defaultQtyPerOutputUnit: Number(l.defaultQtyPerOutputUnit),
      }));
    if (!this.recipeOutputCode || !this.recipeOutputName || !lines.length) {
      this.toast('tr_factory_recipe_incomplete', 'error');
      return;
    }
    this.recipeSaving = true;
    this.factoryService
      .createRecipe({
        userId: this.userId,
        outputProductCode: this.recipeOutputCode.trim(),
        outputName: this.recipeOutputName.trim(),
        outputUnit: this.recipeOutputUnit,
        lines,
      })
      .subscribe({
        next: () => {
          this.recipeSaving = false;
          this.showRecipeForm = false;
          this.toast('tr_factory_recipe_created', 'success');
          this.loadRecipes();
        },
        error: (err) => {
          this.recipeSaving = false;
          this.notify.push(err?.error?.error || this.translate.instant('tr_factory_recipe_failed'), 'error');
        },
      });
  }

  openTransfer(direction: 'to_factory' | 'from_factory'): void {
    this.showTransfer = true;
    this.transferDirection = direction;
    this.transferProductId = null;
    this.transferQty = null;
    this.transferFromWarehouse = false;
    this.branchProducts = [];

    const ensureBranchesThenLoad = () => {
      this.transferFromBranchId = this.branches[0]?._id || null;
      this.transferToBranchId = this.branches[0]?._id || null;
      if (direction === 'to_factory') {
        this.loadBranchProducts();
      } else if (!this.products.length) {
        this.loadStock();
      }
    };

    if (!this.branches.length) {
      this.branchesService.getBranchs({ page: 1, limit: 1000 }).subscribe({
        next: (res: any) => {
          this.branches = res?.branches || res?.data || [];
          ensureBranchesThenLoad();
        },
        error: () => ensureBranchesThenLoad(),
      });
      return;
    }
    ensureBranchesThenLoad();
  }

  loadBranchProducts(): void {
    if (this.transferFromWarehouse) {
      this.productsService
        .getProducts({ page: 1, limit: 500, warehouseOnly: true })
        .subscribe({
          next: (res: any) => {
            this.branchProducts = (res?.products || res?.data || []).filter(
              (p: Product) => Number(p.stock) > 0
            );
          },
          error: () => {
            this.branchProducts = [];
          },
        });
      return;
    }
    if (!this.transferFromBranchId) {
      this.branchProducts = [];
      return;
    }
    this.productsService
      .getProducts({
        page: 1,
        limit: 500,
        branchId: this.transferFromBranchId,
        excludeWarehouse: true,
      })
      .subscribe({
        next: (res: any) => {
          this.branchProducts = (res?.products || res?.data || []).filter(
            (p: Product) => Number(p.stock) > 0
          );
        },
        error: () => {
          this.branchProducts = [];
        },
      });
  }

  submitTransfer(): void {
    if (!this.transferProductId || !this.transferQty || this.transferQty <= 0) {
      this.toast('tr_factory_transfer_incomplete', 'error');
      return;
    }
    const body: any = {
      userId: this.userId,
      factoryId: this.factoryId,
      direction: this.transferDirection,
      productId: this.transferProductId,
      quantity: Number(this.transferQty),
    };
    if (this.transferDirection === 'to_factory') {
      if (this.transferFromWarehouse) {
        body.fromWarehouse = true;
      } else {
        body.fromBranchId = this.transferFromBranchId;
      }
    } else {
      body.toBranchId = this.transferToBranchId;
    }
    this.transferSaving = true;
    this.factoryService.createTransfer(body).subscribe({
      next: () => {
        this.transferSaving = false;
        this.showTransfer = false;
        this.toast('tr_factory_transfer_done', 'success');
        void this.router.navigate(['/factory', 'transfers']);
        this.loadTransfers();
        this.loadStock();
      },
      error: (err) => {
        this.transferSaving = false;
        this.notify.push(err?.error?.error || this.translate.instant('tr_factory_transfer_failed'), 'error');
      },
    });
  }

  openSale(): void {
    this.showSale = true;
    this.salePartyType = 'client';
    this.saleClientId = null;
    this.saleVendorId = null;
    this.saleLines = [{ productId: null, quantity: null, unitPrice: null }];
    this.saleNotes = '';
    if (!this.products.length) this.loadStock();
    const params = new HttpParams().set('page', '1').set('limit', '200');
    this.http.get<any>(CLIENTS_URL, { params }).subscribe({
      next: (res) => {
        this.clients = res?.clients || res?.data || [];
      },
    });
    this.vendorsService.getVendors({ page: 1, limit: 200 }).subscribe({
      next: (res: any) => {
        this.vendors = res?.vendors || res?.data || [];
      },
    });
  }

  addSaleLine(): void {
    this.saleLines.push({ productId: null, quantity: null, unitPrice: null });
  }

  removeSaleLine(i: number): void {
    this.saleLines.splice(i, 1);
  }

  onSaleProductPick(row: {
    productId: string | null;
    quantity: number | null;
    unitPrice: number | null;
  }): void {
    const p = this.products.find((x) => String(x._id) === String(row.productId));
    if (p && (row.unitPrice == null || Number.isNaN(Number(row.unitPrice)))) {
      row.unitPrice = Number(p.price) || 0;
    }
  }

  submitSale(): void {
    const lines = this.saleLines
      .filter((l) => l.productId && Number(l.quantity) > 0)
      .map((l) => ({
        productId: l.productId,
        quantity: Number(l.quantity),
        unitPrice: Number(l.unitPrice) || 0,
      }));
    if (!lines.length) {
      this.toast('tr_factory_sale_incomplete', 'error');
      return;
    }
    if (this.salePartyType === 'client' && !this.saleClientId) {
      this.toast('tr_factory_sale_need_party', 'error');
      return;
    }
    if (this.salePartyType === 'vendor' && !this.saleVendorId) {
      this.toast('tr_factory_sale_need_party', 'error');
      return;
    }
    this.saleSaving = true;
    this.factoryService
      .createSale({
        userId: this.userId,
        factoryId: this.factoryId,
        partyType: this.salePartyType,
        clientId: this.salePartyType === 'client' ? this.saleClientId : undefined,
        vendorId: this.salePartyType === 'vendor' ? this.saleVendorId : undefined,
        lines,
        notes: this.saleNotes,
      })
      .subscribe({
        next: () => {
          this.saleSaving = false;
          this.showSale = false;
          this.toast('tr_factory_sale_created', 'success');
          void this.router.navigate(['/factory', 'sales']);
          this.loadSales();
          this.loadStock();
        },
        error: (err) => {
          this.saleSaving = false;
          this.notify.push(err?.error?.error || this.translate.instant('tr_factory_sale_failed'), 'error');
        },
      });
  }

  ingredientsLabel(order: ManufacturingOrder): string {
    return (order.ingredients || [])
      .map((i) => `${i.name || i.code || '—'} (${i.qty})`)
      .join(', ');
  }

  productLabel(p: Product): string {
    return `${p.name} (${p.code}) — ${p.stock}`;
  }
}

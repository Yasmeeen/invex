import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { FACTORY_URL } from '@core/base/urls';

export interface Factory {
  _id: string;
  name: string;
  address?: string;
  isActive?: boolean;
  notes?: string;
}

export interface ManufacturingRecipeLine {
  ingredientProductCode: string;
  ingredientCatalogKey?: string;
  name?: string;
  defaultQtyPerOutputUnit: number;
}

export interface ManufacturingRecipe {
  _id: string;
  outputProductCode: string;
  outputCatalogKey?: string;
  outputName: string;
  outputUnit?: 'kg' | 'unit';
  lines: ManufacturingRecipeLine[];
  notes?: string;
  isActive?: boolean;
}

export interface ManufacturingOrderIngredient {
  productId: string | { _id: string; name?: string; code?: string };
  name?: string;
  code?: string;
  qty: number;
  unitCost?: number;
  lineCost?: number;
}

export interface ManufacturingOrder {
  _id: string;
  factory?: { _id: string; name?: string };
  status?: string;
  outputProductId?: { _id: string; name?: string; code?: string; stock?: number; netPrice?: number };
  outputProductName?: string;
  outputProductCode?: string;
  outputQty: number;
  wasteQty?: number;
  recipeId?: any;
  ingredients: ManufacturingOrderIngredient[];
  totalIngredientCost?: number;
  unitCost?: number;
  notes?: string;
  createdAt?: string;
  createdBy?: { name?: string };
}

export interface FactoryStockTransfer {
  _id: string;
  productNameSnapshot?: string;
  productCodeSnapshot?: string;
  quantity: number;
  unitCost?: number;
  notes?: string;
  fromBranch?: { name?: string };
  toBranch?: { name?: string };
  fromFactory?: { name?: string };
  toFactory?: { name?: string };
  fromWarehouse?: boolean;
  createdAt?: string;
  createdBy?: { name?: string };
}

export interface FactorySale {
  _id: string;
  factory?: { name?: string };
  partyType: 'client' | 'vendor';
  partyName?: string;
  lines: Array<{ name?: string; code?: string; quantity: number; unitPrice: number; lineTotal: number }>;
  totalAmount?: number;
  notes?: string;
  createdAt?: string;
  createdBy?: { name?: string };
}

@Injectable({ providedIn: 'root' })
export class FactoryService {
  constructor(private http: HttpClient) {}

  private params(obj: Record<string, any>): HttpParams {
    let p = new HttpParams();
    Object.keys(obj || {}).forEach((k) => {
      const v = obj[k];
      if (v != null && v !== '') p = p.set(k, String(v));
    });
    return p;
  }

  listFactories(userId?: string, activeOnly = true): Observable<{ factories: Factory[] }> {
    return this.http.get<{ factories: Factory[] }>(`${FACTORY_URL}/factories`, {
      params: this.params({ userId, activeOnly }),
    });
  }

  createFactory(body: {
    userId?: string;
    name: string;
    address?: string;
    notes?: string;
  }): Observable<{ factory: Factory }> {
    return this.http.post<{ factory: Factory }>(`${FACTORY_URL}/factories`, body);
  }

  updateFactory(
    id: string,
    body: Partial<Factory> & { userId?: string }
  ): Observable<{ factory: Factory }> {
    return this.http.patch<{ factory: Factory }>(`${FACTORY_URL}/factories/${id}`, body);
  }

  listStock(
    factoryId: string,
    params: { userId?: string; search?: string; page?: number; limit?: number }
  ): Observable<{ products: any[]; pagination: any }> {
    return this.http.get<{ products: any[]; pagination: any }>(
      `${FACTORY_URL}/factories/${factoryId}/stock`,
      { params: this.params(params) }
    );
  }

  listRecipes(params: {
    userId?: string;
    outputProductCode?: string;
    activeOnly?: boolean;
  }): Observable<{ recipes: ManufacturingRecipe[] }> {
    return this.http.get<{ recipes: ManufacturingRecipe[] }>(`${FACTORY_URL}/recipes`, {
      params: this.params(params),
    });
  }

  createRecipe(body: any): Observable<{ recipe: ManufacturingRecipe }> {
    return this.http.post<{ recipe: ManufacturingRecipe }>(`${FACTORY_URL}/recipes`, body);
  }

  updateRecipe(id: string, body: any): Observable<{ recipe: ManufacturingRecipe }> {
    return this.http.patch<{ recipe: ManufacturingRecipe }>(`${FACTORY_URL}/recipes/${id}`, body);
  }

  listOrders(params: {
    userId?: string;
    factoryId?: string;
    page?: number;
    limit?: number;
  }): Observable<{ orders: ManufacturingOrder[]; pagination: any }> {
    return this.http.get<{ orders: ManufacturingOrder[]; pagination: any }>(`${FACTORY_URL}/orders`, {
      params: this.params(params),
    });
  }

  createOrder(body: any): Observable<{ order: ManufacturingOrder }> {
    return this.http.post<{ order: ManufacturingOrder }>(`${FACTORY_URL}/orders`, body);
  }

  listTransfers(params: {
    userId?: string;
    factoryId?: string;
    page?: number;
    limit?: number;
  }): Observable<{ transfers: FactoryStockTransfer[]; pagination: any }> {
    return this.http.get<{ transfers: FactoryStockTransfer[]; pagination: any }>(
      `${FACTORY_URL}/transfers`,
      { params: this.params(params) }
    );
  }

  createTransfer(body: any): Observable<{ transfer: FactoryStockTransfer }> {
    return this.http.post<{ transfer: FactoryStockTransfer }>(`${FACTORY_URL}/transfers`, body);
  }

  listSales(params: {
    userId?: string;
    factoryId?: string;
    page?: number;
    limit?: number;
  }): Observable<{ sales: FactorySale[]; pagination: any }> {
    return this.http.get<{ sales: FactorySale[]; pagination: any }>(`${FACTORY_URL}/sales`, {
      params: this.params(params),
    });
  }

  createSale(body: any): Observable<{ sale: FactorySale }> {
    return this.http.post<{ sale: FactorySale }>(`${FACTORY_URL}/sales`, body);
  }
}

import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { BASE_URL, PRODUCT_CREATE_PRODUCT_URL, PRODUCT_DELETE_PRODUCT_URL, PRODUCT_STATS, PRODUCT_UPDATE_PRODUCT_URL, PRODUCTS_IMPORT_EXCEL_URL, PRODUCTS_IMPORT_METADATA_URL, PRODUCTS_INVENTORY_AUDIT_URL, PRODUCTS_URL, PURCHASING_URL } from '@core/base/urls';
import { AppNotificationService } from './app-notification.service';
import { Category, Product, ProductHistoryResponse } from '@core/models/products.model';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

export type ProductsImportMetadata = {
  branches: Array<{ _id: string; name: string }>;
  categories: Array<{
    _id: string;
    name: string;
    code: string;
    attributeDefs: Array<{ key: string; label?: string }>;
  }>;
};

export type ProductsImportError = {
  rowNumber: number;
  sheetName: string;
  code?: string;
  field?: string;
  message: string;
};

export type ProductsImportResult = {
  createdCount: number;
  failedCount: number;
  errors: ProductsImportError[];
};

export type ProductsInventoryAuditLocation = {
  inWarehouse: boolean;
  branchId?: string;
  branchName?: string | null;
  productsCount: number;
  totalStock: number;
  totalBooked: number;
  totalTransferReserved: number;
  totalAvailable: number;
};

export type ProductsInventoryAuditResponse = {
  search: string | null;
  totals: {
    productsCount: number;
    totalStock: number;
    totalBooked: number;
    totalTransferReserved: number;
    totalAvailable: number;
  };
  byLocation: ProductsInventoryAuditLocation[];
};

export type BranchTransferItem = {
  _id: string;
  status: 'pending' | 'approved' | 'rejected';
  quantity: number;
  rejectReason?: string;
  createdAt?: string;
  resolvedAt?: string;
  product?: { name?: string; code?: string };
  fromBranch?: { _id?: string; name?: string };
  toBranch?: { _id?: string; name?: string };
  initiatedBy?: { name?: string };
  resolvedBy?: { name?: string };
};

export type ImportExcelRow = {
  sheetBranchName: string;
  categoryName: string;
  name: string;
  code?: string;
  price: any;
  discount?: any;
  netPrice?: any;
  stock: any;
  inWarehouse?: any;
  imageUrl?: string;
  attributes?: Record<string, any>;
};

@Injectable({
  providedIn: 'root',
})
export class ProductsSerivce {

constructor(
  private http: HttpClient,
  private appNotificationService: AppNotificationService
) {}
getProducts(params: any) {
  return this.http.get(PRODUCTS_URL, { params: params });
}
  /**
   * Next suggested code(s) for the category (e.g. ELEC-001).
   * With count > 1 returns `{ codes }`; otherwise `{ code }`.
   */
  generateBarcode(categoryId: string, count?: number): Observable<{ code?: string; codes?: string[] }> {
    let params = new HttpParams().set('categoryId', categoryId);
    if (count != null && count > 1) {
      params = params.set('count', String(count));
    }
    return this.http.get<{ code?: string; codes?: string[] }>(`${PRODUCTS_URL}/generate-barcode`, {
      params,
    });
  }

  getBarcodeImage(code: string, productName: string, barcodeValues?: string[]) {
    let params = new HttpParams().set('name', productName);
    const parts = (barcodeValues || [])
      .map((v) => String(v ?? '').trim())
      .filter(Boolean);
    /** Arabic comma + space — compact horizontal line on the sticker */
    const line = parts.join('\u060c ');
    if (line) {
      params = params.set('bv', line);
    }
    return this.http.get(`${PRODUCTS_URL}/barcode/${encodeURIComponent(code)}`, {
      params,
      responseType: 'text' as 'json',
    });
  }

getPurchasingRequests(params: any) {
    
  return this.http.get(PURCHASING_URL, { params:params });
}
getProduct(productId: any) {
  return this.http.get(PRODUCTS_URL+ `/${productId}`);
}

createProduct(params: any) {
  return this.http.post(PRODUCT_CREATE_PRODUCT_URL, params);
}

getProductsImportMetadata(): Observable<ProductsImportMetadata> {
  return this.http.get<ProductsImportMetadata>(PRODUCTS_IMPORT_METADATA_URL);
}

importProductsFromExcelRows(payload: {
  rows: ImportExcelRow[];
  options?: { allowPartial?: boolean; autoComputeNetPrice?: boolean };
}): Observable<ProductsImportResult> {
  return this.http.post<ProductsImportResult>(PRODUCTS_IMPORT_EXCEL_URL, payload);
}
updateProduct(product: Product, productId: string): Observable<Product> {
  return this.http.put<Product>(PRODUCT_UPDATE_PRODUCT_URL + `/${productId}`, product).pipe(
    tap({
      error: (errorResponse: Error) => {
        this.appNotificationService.push('Update Product Failed', 'error');
      },
    })
  );
}

deleteProduct(productId: string) {
  return this.http.delete( PRODUCT_DELETE_PRODUCT_URL + '/' + productId).pipe(
    tap({
      error: (errorResponse: Error) => {
        this.appNotificationService.push('Delete Product Failed', 'error');
      },
    })
  );
}

transferProductStock(payload: {
  productId: string;
  quantity: number;
  toBranchId: string;
  /** Transfer from central warehouse (inventory). Omit when moving between branches. */
  fromWarehouse?: boolean;
  fromBranchId?: string;
}) {
  return this.http.post(`${PRODUCTS_URL}/transfer-stock`, payload);
}

requestBranchTransfer(payload: {
  userId: string;
  productId: string;
  toBranchId: string;
  quantity: number;
}) {
  return this.http.post<{ message: string; transfer: BranchTransferItem }>(
    `${PRODUCTS_URL}/branch-transfer/request`,
    payload
  );
}

listBranchTransfers(params: { userId: string; status?: string }) {
  let hp = new HttpParams().set('userId', params.userId);
  if (params.status) {
    hp = hp.set('status', params.status);
  }
  return this.http.get<{ transfers: BranchTransferItem[] }>(`${PRODUCTS_URL}/branch-transfers`, {
    params: hp,
  });
}

getPendingBranchTransferCount(userId: string) {
  return this.http.get<{ count: number }>(`${PRODUCTS_URL}/branch-transfers/pending-count`, {
    params: { userId },
  });
}

approveBranchTransfer(transferId: string, userId: string) {
  return this.http.post<{ message: string }>(
    `${PRODUCTS_URL}/branch-transfer/${transferId}/approve`,
    { userId }
  );
}

rejectBranchTransfer(transferId: string, userId: string, rejectReason?: string) {
  return this.http.post<{ message: string }>(
    `${PRODUCTS_URL}/branch-transfer/${transferId}/reject`,
    { userId, rejectReason: rejectReason || '' }
  );
}

getProductsStats(branchId?: any) {
  let params: any = {};
  if (branchId) params.branchId = branchId;
  return this.http.get(PRODUCT_STATS, {params });
}

getProductHistory(productId: string): Observable<ProductHistoryResponse> {
  return this.http.get<ProductHistoryResponse>(`${PRODUCTS_URL}/${productId}/history`);
}

getProductsInventoryAudit(params: any): Observable<ProductsInventoryAuditResponse> {
  return this.http.get<ProductsInventoryAuditResponse>(PRODUCTS_INVENTORY_AUDIT_URL, { params });
}


}

/** Values only (no attribute names), in category attributeDefs order, for barcode sticker text. */
export function productBarcodeAttributeValues(
  category: Category | undefined | null,
  attributes: Record<string, string> | undefined | null
): string[] {
  const defs = category?.attributeDefs;
  if (!Array.isArray(defs) || !defs.length || !attributes) {
    return [];
  }
  const out: string[] = [];
  for (const def of defs) {
    const key = typeof def === 'string' ? def : def?.key;
    const showInBarcode =
      typeof def === 'string' ? false : !!def?.showInBarcode;
    if (!showInBarcode || !key) {
      continue;
    }
    const v = attributes[key];
    if (v != null && String(v).trim() !== '') {
      out.push(String(v).trim());
    }
  }
  return out;
}
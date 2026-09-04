import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { SLAUGHTER_URL } from '@core/base/urls';

export interface SlaughterTemplateOutput {
  skuKey: string;
  label?: string;
  kind?: 'fridge' | 'offal' | 'waste';
}

export interface SlaughterTemplate {
  _id: string;
  code: string;
  name: string;
  farmSkuKey: string;
  outputs: SlaughterTemplateOutput[];
}

export interface SlaughterTicket {
  _id: string;
  branch?: { _id: string; name?: string } | null;
  inWarehouse?: boolean;
  farmProductId?: { _id: string; name?: string; catalogKey?: string; stock?: number };
  farmProductName?: string;
  templateCode?: string;
  share: number;
  liveWeightKg?: number;
  wasteKg?: number;
  farmCostTotal?: number;
  costPerKg?: number;
  outputs: Array<{
    productId?: string;
    skuKey?: string;
    name?: string;
    kind?: string;
    quantity: number;
    unitCost?: number;
  }>;
  notes?: string;
  createdAt?: string;
  createdBy?: { name?: string };
}

@Injectable({ providedIn: 'root' })
export class SlaughterService {
  constructor(private http: HttpClient) {}

  listTemplates(): Observable<{ templates: SlaughterTemplate[] }> {
    return this.http.get<{ templates: SlaughterTemplate[] }>(`${SLAUGHTER_URL}/templates`);
  }

  listOutputProducts(params: {
    branchId?: string;
    inWarehouse?: boolean;
    userId?: string;
  }): Observable<{ products: any[] }> {
    let httpParams = new HttpParams();
    Object.keys(params || {}).forEach((k) => {
      const v = (params as any)[k];
      if (v != null && v !== '') {
        httpParams = httpParams.set(k, String(v));
      }
    });
    return this.http.get<{ products: any[] }>(`${SLAUGHTER_URL}/output-products`, {
      params: httpParams,
    });
  }

  listTickets(params: {
    page?: number;
    limit?: number;
    branch_id?: string;
    inWarehouse?: boolean;
    userId?: string;
  }): Observable<{ tickets: SlaughterTicket[]; pagination: any }> {
    let httpParams = new HttpParams();
    Object.keys(params || {}).forEach((k) => {
      const v = (params as any)[k];
      if (v != null && v !== '') {
        httpParams = httpParams.set(k, String(v));
      }
    });
    return this.http.get<{ tickets: SlaughterTicket[]; pagination: any }>(
      `${SLAUGHTER_URL}/tickets`,
      { params: httpParams }
    );
  }

  createTicket(body: any): Observable<{ ticket: SlaughterTicket }> {
    return this.http.post<{ ticket: SlaughterTicket }>(`${SLAUGHTER_URL}/tickets`, body);
  }
}

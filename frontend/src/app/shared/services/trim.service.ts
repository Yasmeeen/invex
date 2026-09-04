import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { TRIM_URL } from '@core/base/urls';

export interface TrimTicketOutput {
  productId?: string;
  name?: string;
  code?: string;
  quantity: number;
  unitCost?: number;
}

export interface TrimTicket {
  _id: string;
  branch?: { _id: string; name?: string };
  sourceProductId?: { _id: string; name?: string; code?: string; stock?: number };
  sourceProductName?: string;
  sourceProductCode?: string;
  categoryName?: string;
  inputQty: number;
  outputQty?: number;
  wasteQty?: number;
  sourceCostTotal?: number;
  costPerUnit?: number;
  outputs: TrimTicketOutput[];
  notes?: string;
  createdAt?: string;
  createdBy?: { name?: string };
}

@Injectable({ providedIn: 'root' })
export class TrimService {
  constructor(private http: HttpClient) {}

  listTickets(params: {
    page?: number;
    limit?: number;
    branch_id?: string;
    userId?: string;
  }): Observable<{ tickets: TrimTicket[]; pagination: any }> {
    let httpParams = new HttpParams();
    Object.keys(params || {}).forEach((k) => {
      const v = (params as any)[k];
      if (v != null && v !== '') {
        httpParams = httpParams.set(k, String(v));
      }
    });
    return this.http.get<{ tickets: TrimTicket[]; pagination: any }>(`${TRIM_URL}/tickets`, {
      params: httpParams,
    });
  }

  createTicket(body: {
    userId?: string;
    branchId: string;
    sourceProductId: string;
    inputQty: number;
    wasteQty?: number;
    notes?: string;
    outputs: Array<{ productId: string; quantity: number }>;
  }): Observable<{ ticket: TrimTicket }> {
    return this.http.post<{ ticket: TrimTicket }>(`${TRIM_URL}/tickets`, body);
  }
}

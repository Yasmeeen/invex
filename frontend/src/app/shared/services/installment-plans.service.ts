import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { INSTALLMENT_PLANS_URL } from '@core/base/urls';

export interface InstallmentPlan {
  _id?: string;
  name: string;
  months: number;
  interestPercent: number;
  enabled?: boolean;
  sortOrder?: number;
  createdAt?: string;
  updatedAt?: string;
}

@Injectable({ providedIn: 'root' })
export class InstallmentPlansService {
  constructor(private http: HttpClient) {}

  list(enabledOnly = false): Observable<{ plans: InstallmentPlan[] }> {
    let params = new HttpParams();
    if (enabledOnly) {
      params = params.set('enabledOnly', 'true');
    }
    return this.http.get<{ plans: InstallmentPlan[] }>(INSTALLMENT_PLANS_URL, { params });
  }

  get(id: string): Observable<{ plan: InstallmentPlan }> {
    return this.http.get<{ plan: InstallmentPlan }>(`${INSTALLMENT_PLANS_URL}/${id}`);
  }

  create(payload: InstallmentPlan): Observable<{ plan: InstallmentPlan; message?: string }> {
    return this.http.post<{ plan: InstallmentPlan; message?: string }>(INSTALLMENT_PLANS_URL, payload);
  }

  update(
    id: string,
    payload: InstallmentPlan
  ): Observable<{ plan: InstallmentPlan; message?: string }> {
    return this.http.put<{ plan: InstallmentPlan; message?: string }>(
      `${INSTALLMENT_PLANS_URL}/${id}`,
      payload
    );
  }

  delete(id: string): Observable<{ message?: string }> {
    return this.http.delete<{ message?: string }>(`${INSTALLMENT_PLANS_URL}/${id}`);
  }
}

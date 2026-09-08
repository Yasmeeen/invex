import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { FARM_ANIMALS_URL } from '@core/base/urls';
import { FarmAnimal } from '@core/models/products.model';

@Injectable({ providedIn: 'root' })
export class FarmAnimalsService {
  constructor(private http: HttpClient) {}

  list(params: {
    productId?: string;
    status?: string;
    available?: boolean;
    branchId?: string;
    inWarehouse?: boolean;
    search?: string;
  }): Observable<{ animals: FarmAnimal[] }> {
    let httpParams = new HttpParams();
    Object.keys(params).forEach((key) => {
      const value = (params as any)[key];
      if (value !== undefined && value !== null && value !== '') {
        httpParams = httpParams.set(key, String(value));
      }
    });
    return this.http.get<{ animals: FarmAnimal[] }>(FARM_ANIMALS_URL, {
      params: httpParams,
    });
  }

  lookup(serial: string): Observable<{ animal: FarmAnimal }> {
    return this.http.get<{ animal: FarmAnimal }>(
      `${FARM_ANIMALS_URL}/lookup/${encodeURIComponent(String(serial || '').trim())}`
    );
  }

  update(
    id: string,
    body: { currentWeightKg?: number; notes?: string }
  ): Observable<{ animal: FarmAnimal }> {
    return this.http.patch<{ animal: FarmAnimal }>(`${FARM_ANIMALS_URL}/${id}`, body);
  }
}

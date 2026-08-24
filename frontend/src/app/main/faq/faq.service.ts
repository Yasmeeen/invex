import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { isWarehouse } from '@core/utils/role-utils';
import { FaqCategory, FaqFile, FaqFlatItem, FaqItem } from './faq.models';

@Injectable({ providedIn: 'root' })
export class FaqService {
  constructor(private http: HttpClient) {}

  load(lang: string): Observable<FaqFile> {
    const fileLang = lang === 'ar' ? 'ar' : 'en';
    return this.http.get<FaqFile>(`assets/faq/faq.${fileLang}.json`);
  }

  visibleCategories(file: FaqFile | null, role: string | undefined): FaqCategory[] {
    if (!file?.categories) {
      return [];
    }
    return file.categories
      .filter((cat) => this.canSee(cat.roles, role))
      .map((cat) => ({
        ...cat,
        items: (cat.items || []).filter((item) => this.canSee(item.roles || cat.roles, role)),
      }))
      .filter((cat) => cat.items.length > 0);
  }

  search(categories: FaqCategory[], query: string, categoryId: string | null): FaqFlatItem[] {
    const q = (query || '').trim().toLowerCase();
    const rows: FaqFlatItem[] = [];
    categories.forEach((cat) => {
      if (categoryId && cat.id !== categoryId) {
        return;
      }
      cat.items.forEach((item) => {
        if (!q || this.matches(cat, item, q)) {
          rows.push({ categoryId: cat.id, categoryTitle: cat.title, item });
        }
      });
    });
    return rows;
  }

  private matches(cat: FaqCategory, item: FaqItem, q: string): boolean {
    const tags = (item.tags || []).join(' ');
    const hay = `${cat.title} ${item.q} ${item.a} ${tags}`.toLowerCase();
    return hay.indexOf(q) !== -1;
  }

  private canSee(roles: string[] | undefined, userRole: string | undefined): boolean {
    if (!roles || !roles.length) {
      return true;
    }
    if (userRole === 'Super Admin') {
      return true;
    }
    if (!userRole) {
      return false;
    }
    if (roles.indexOf(userRole) !== -1) {
      return true;
    }
    if (isWarehouse(userRole) && roles.indexOf('Warehouse') !== -1) {
      return true;
    }
    return false;
  }
}

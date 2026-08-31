import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { CATEGORY_CREATE_CATEGORY_URL, CATEGORY_DELETE_CATEGORY_URL, CATEGORYS_URL } from '@core/base/urls';
import { AppNotificationService } from './app-notification.service';
// import { Category } from '@core/models/categorys.model';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Category } from '@core/models/products.model';


@Injectable({
  providedIn: 'root',
})
export class CategoriesServce {

constructor(
  private http: HttpClient,
  private appNotificationService: AppNotificationService
) {}
getCategorys(params: any) {
  return this.http.get(CATEGORYS_URL, { params: params });
}
getCategory(categoryId: any) {
  return this.http.get(CATEGORYS_URL+ `/${categoryId}`);
}

createCategory(params: any) {
  return this.http.post(CATEGORY_CREATE_CATEGORY_URL, params);
}
updateCategory(category: Partial<Category>, categoryId: string, userId?: string): Observable<Category> {
  const payload = userId ? { ...category, userId: String(userId) } : category;
  return this.http.put<Category>(`${CATEGORYS_URL}/${categoryId}`, payload).pipe(
    tap({
      error: (errorResponse: Error) => {
        this.appNotificationService.push('Update Category Failed', 'error');
      },
    })
  );
}

deleteCategory(categoryId: string, userId?: string) {
  const options = userId ? { params: { userId: String(userId) } } : {};
  return this.http.delete(CATEGORY_DELETE_CATEGORY_URL + '/' + categoryId, options).pipe(
    tap({
      error: (errorResponse: Error) => {
        this.appNotificationService.push('Delete Category Failed', 'error');
      },
    })
  );
}
}
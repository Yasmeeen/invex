import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BASE_URL, BRANCH_CREATE_BRANCH_URL, BRANCH_DELETE_BRANCH_URL, BRANCH_UPDATE_BRANCH_URL, BRANCHES_URL } from '@core/base/urls';
import { AppNotificationService } from './app-notification.service';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Branch } from '@core/models/products.model';


@Injectable({
  providedIn: 'root',
})
export class BranchesServce {

constructor(
  private http: HttpClient,
  private appNotificationService: AppNotificationService
) {}
getBranchs(params: any) {
  return this.http.get(BRANCHES_URL, { params: params });
}
getBranch(branchId: any) {
  return this.http.get(BRANCHES_URL+ `/${branchId}`);
}

createBranch(params: any) {
  return this.http.post(BRANCH_CREATE_BRANCH_URL, params);
}
updateBranch(branchId: string,branch: Branch): Observable<Branch> {
  return this.http.put<Branch>(BRANCH_UPDATE_BRANCH_URL+`/${branchId}`, branch).pipe(
    tap({
      error: (errorResponse: Error) => {
        this.appNotificationService.push('Update Branch Failed', 'error');
      },
    })
  );
}

deleteBranch(branchId: string) {
  return this.http.delete( BRANCH_DELETE_BRANCH_URL + '/' + branchId).pipe(
    tap({
      error: (errorResponse: Error) => {
        this.appNotificationService.push('Delete Branch Failed', 'error');
      },
    })
  );
}
}
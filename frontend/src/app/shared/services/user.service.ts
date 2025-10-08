import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import {
  USERS_URL,
  USER_CREATE_URL,
  USER_UPDATE_URL,
  USER_DELETE_URL,
} from '@core/base/urls';
import { AppNotificationService } from './app-notification.service';
import { User } from '@core/models/users-interfaces.model';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable({
  providedIn: 'root',
})
export class UserSerivce {
  constructor(
    private http: HttpClient,
    private appNotificationService: AppNotificationService
  ) {}

  getUsers(params: any): Observable<any> {
    return this.http.get(USERS_URL, { params: params });
  }

  getUser(userId: string): Observable<User> {
    return this.http.get<User>(`${USERS_URL}/${userId}`);
  }

  createUser(user: User): Observable<User> {
    return this.http.post<User>(USER_CREATE_URL, user).pipe(
      tap({
        error: () => {
          this.appNotificationService.push('Create User Failed', 'error');
        },
      })
    );
  }

  updateUser( userId: string,params: any): Observable<User> {
    return this.http.put<User>(`${USER_UPDATE_URL}/${userId}`, params).pipe(
      tap({
        error: () => {
          this.appNotificationService.push('Update User Failed', 'error');
        },
      })
    );
  }

  deleteUser(userId: string): Observable<any> {
    return this.http.delete(`${USER_DELETE_URL}/${userId}`).pipe(
      tap({
        error: () => {
          this.appNotificationService.push('Delete User Failed', 'error');
        },
      })
    );
  }
}

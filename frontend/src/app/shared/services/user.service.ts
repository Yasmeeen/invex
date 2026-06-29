import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import {
  USERS_URL,
  USER_CREATE_URL,
  USER_UPDATE_URL,
  USER_DELETE_URL,
  CLIENTS_URL,
} from '@core/base/urls';
import { AppNotificationService } from './app-notification.service';
import { Client, ClientHistoryResponse, User } from '@core/models/users-interfaces.model';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

export interface TreasurySplitPayload {
  key: string;
  label?: string;
  amount: number;
}

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
  getClients(params: any): Observable<any> {
    return this.http.get(CLIENTS_URL, { params: params });
  }

  getClientHistory(clientId: string): Observable<ClientHistoryResponse> {
    return this.http.get<ClientHistoryResponse>(`${CLIENTS_URL}/${clientId}/history`);
  }

  addClientDeposit(
    clientId: string,
    payload: {
      amount: number;
      userId?: string;
      branchId?: string;
      note?: string;
      paymentSplits?: { method: string; amount: number }[];
      paymentFeeAllocations?: {
        forMethod: string;
        feeNet: number;
        paidVia: string;
        feeGrossOnPaidVia: number;
        feePercentSnapshot?: number;
      }[];
    }
  ): Observable<any> {
    return this.http.post(`${CLIENTS_URL}/${clientId}/deposit`, payload);
  }

  setClientOpeningDebitBalance(
    clientId: string,
    payload: { amount: number; note?: string; userId?: string }
  ): Observable<any> {
    return this.http.post(`${CLIENTS_URL}/${clientId}/opening-debit-balance`, payload);
  }

  settleClientBalances(
    clientId: string,
    payload: { userId?: string; note?: string }
  ): Observable<any> {
    return this.http.post(`${CLIENTS_URL}/${clientId}/settle`, payload);
  }

  getClient(clientId: string): Observable<Client> {
    return this.http.get<Client>(`${CLIENTS_URL}/${clientId}`);
  }

  createClient(payload: {
    name: string;
    phoneNumber: string;
    address?: string;
    branches?: string[];
  }): Observable<any> {
    return this.http.post(`${CLIENTS_URL}/create`, payload);
  }

  updateClient(
    clientId: string,
    payload: {
      name: string;
      phoneNumber: string;
      address?: string;
      branches?: string[];
    }
  ): Observable<any> {
    return this.http.put(`${CLIENTS_URL}/update/${clientId}`, payload);
  }

  payClient(
    clientId: string,
    payload: {
      userId?: string;
      branchId?: string;
      note?: string;
      paymentTreasurySplits: TreasurySplitPayload[];
    }
  ): Observable<any> {
    return this.http.post(`${CLIENTS_URL}/${clientId}/pay-client`, payload);
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

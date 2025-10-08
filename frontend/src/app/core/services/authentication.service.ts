import { AppNotificationService } from '@shared/services/app-notification.service';
import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { IUserLogin, User } from '@core/models/users-interfaces.model';
import { USER_LOGIN_URL,USER_REGISTER_URL,USER_UPDATE_PASSWORD_URL  } from '@core/base/urls';
import { tap } from 'rxjs/operators';
import { Router } from '@angular/router';
import { Globals } from '@core/globals';



const USER_KEY = 'currentUser';
@Injectable({
  providedIn: 'root'
})

@Injectable()
export class AuthenticationService {
  private userSubject =
  new BehaviorSubject<User>(this.getUserFromLocalStorage());
  public userObservable:Observable<User>;
  constructor(
     private http:HttpClient,
     private appNotificationService:AppNotificationService,
     private router: Router,
     private globals: Globals
     ) {
    this.userObservable = this.userSubject.asObservable();
  }

  public get currentUser():User{
    return this.userSubject.value;
  }

  login(userLogin:IUserLogin):Observable<User>{
    return this.http.post<User>(USER_LOGIN_URL, userLogin).pipe(
      tap({
        next: (user:any) =>{
          this.setUserToLocalStorage(user.user);
          this.globals.currentUser = user.user
          this.userSubject.next(user.user);
        },
        error: (errorResponse:any) => {
          this.appNotificationService.push(errorResponse.error, 'error');
        }
      })
    );
  }

  updatePassword(userLogin:IUserLogin):Observable<User>{
    return this.http.post<User>(USER_UPDATE_PASSWORD_URL, userLogin).pipe(
      tap({
        next: (user:User) =>{
          this.setUserToLocalStorage(user);
          this.userSubject.next(user);
        },
        error: (errorResponse:any) => {
          this.appNotificationService.push(errorResponse.error, 'error');
        }
      })
    );
  }

  register(userRegiser:User): Observable<User>{
    return this.http.post<User>(USER_REGISTER_URL, userRegiser).pipe(
      tap({
        next: (user:User) => {
          this.setUserToLocalStorage(user);
          this.userSubject.next(user);
        },
        error: (errorResponse:any) => {
          this.appNotificationService.push('Login Failed', 'success');
        }
      })
    )
  }


  logout(){
    this.userSubject.next(new User());
    localStorage.removeItem(USER_KEY);
    this.router.navigate(['login']);
  }

  private setUserToLocalStorage(user:User){
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }

   getUserFromLocalStorage():any{
    const userJson = localStorage.getItem(USER_KEY);
    if(userJson) return JSON.parse(userJson) as User;
    return new User();
  }
}

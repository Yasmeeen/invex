import { Injectable } from '@angular/core';
import { CurrentUser } from '@core/models/users-interfaces.model';
import { TranslateService } from '@ngx-translate/core';
import { Globals } from 'src/app/core/globals';
import { AuthenticationService } from 'src/app/core/services/authentication.service';
import { UserSerivce } from './user.service';


@Injectable({
    providedIn: 'root'
})
export class LanguagesService {
    currentUser: CurrentUser

    constructor(
        private userService: UserSerivce,
        private authenticationService: AuthenticationService,
        private translate: TranslateService,
        private globals: Globals,
    ) {

    }

    switchLanguage(user_id:number, selectedLanguage: string) {
        this.currentUser = this.authenticationService.getCurrentUser();

        let params = {
            id: user_id,
            language: selectedLanguage,
        }
        this.userService.updateUser(user_id, params).subscribe((response: any) => {
            if(user_id === this.currentUser.id) {
                this.translate.use(selectedLanguage);
                this.globals.currentUser = response;
                localStorage.setItem('currentUser', JSON.stringify(this.globals.currentUser))
                document.querySelector('body')?.setAttribute('dir', selectedLanguage == 'ar' ? 'rtl' : 'ltr');
            }
        })
    }
}

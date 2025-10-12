import { Component, OnInit, Inject } from '@angular/core';
import { HeaderComponent } from 'src/app/main/header/header.component';
import { TranslateService } from '@ngx-translate/core';
import { Globals } from '@core/globals';
import { AuthenticationService } from '@core/services/authentication.service';
import { UserSerivce } from '@shared/services/user.service';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { CurrentUser } from '@core/models/users-interfaces.model';



@Component({
    selector: 'app-language-switcher',
    templateUrl: './language-switcher.component.html',
    styleUrls: ['./language-switcher.component.scss']
})
export class LanguageSwitcherComponent implements OnInit {

    currentUser:  CurrentUser;
    selectedLanguage: string;
    user: CurrentUser;
    constructor(
        private authenticationService: AuthenticationService,
        public dialogRef: MatDialogRef<HeaderComponent>,
        @Inject(MAT_DIALOG_DATA) public data: any,
        private translate: TranslateService,
        private userService: UserSerivce,
        private globals: Globals,
    ) { }

    ngOnInit() {
        this.selectedLanguage = this.data;
        this.currentUser = this.authenticationService.getUserFromLocalStorage();
        // this.globals.currentUser = this.authenticationService.getUserFromLocalStorage();
    }

    switchLanguage() {
        let params = {
            id: this.currentUser._id,
            locale: this.selectedLanguage,
        }
        this.userService.updateUser(this.currentUser._id, params).subscribe((response: any) => {
            this.translate.use(this.selectedLanguage);
            this.globals.updateUserLanguage.next(this.selectedLanguage);
            this.globals.currentUser.locale = this.selectedLanguage; // ✅ changed from [0] to direct object
            localStorage.setItem('currentUser', JSON.stringify(this.globals.currentUser));
            document.querySelector('body')?.setAttribute('dir', this.selectedLanguage === 'ar' ? 'rtl' : 'ltr');
            location.reload();
          });

        this.closeModal(this.selectedLanguage);
    }
    closeModal(language: any) {
        this.dialogRef.close(language);
    }

}

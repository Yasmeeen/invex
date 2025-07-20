import { Component, OnInit, Input, Output, EventEmitter } from '@angular/core';
import { Globals } from '@core/globals';
import {Location} from '@angular/common';

@Component({
    selector: '[not-authorized]',
    template: `<div class="bg-white ptb-8" *ngIf="notAuthorized">
      <div class="text-center">
          <div class="not-authorized-img">
              <img src="assets/images/authorized/admin.svg"/>
          </div>
          <p class="text-primary weight-bold not-authorized-text">
                  403
          </p>
          <p class="weight-bold">
                {{'tr_not_authorized' | translate}}
          </p>
          <div class="max-200 max-center mt-4">
          <button  class="s-btn btn-primary btn-block" (click)="callBack()"> {{'tr_go_back' | translate}} </button>
          </div>
          
      </div>
  </div>

  <div [hidden]="notAuthorized ">
      <ng-content></ng-content>
  </div>`,
  styles: [`
  .not-authorized-text{
      font-size: 48px;
  }`]
})
export class NotAuthorizedComponent implements OnInit {

    @Input() notAuthorized: boolean = true;

    constructor(
        public globals: Globals,
        private location: Location
    ) { }
    ngOnInit() {
    }
    callBack(){
        this.location.back(); 
    }

}


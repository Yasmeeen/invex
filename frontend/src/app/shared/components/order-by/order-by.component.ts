import { Component, OnInit, Output, EventEmitter, Input, OnDestroy } from '@angular/core';
import { UpdateService } from '@shared/services/update.service';

@Component({
    selector: '[order-by]',
    templateUrl: './order-by.component.html',
    styleUrls: ['./order-by.component.scss']
})
export class OrderByComponent implements OnInit, OnDestroy {

    @Output() order = new EventEmitter();
    @Input() orderBy = '';
    @Input() type =''
    @Input() current:string = '';
    status = [
        'ascending',
        'descending'
    ];
    orderUpdate: any;
    notMe: boolean = false ;
    onHover: boolean = false;
    constructor(
        private updateService: UpdateService
    ) { }

    ngOnInit() {
        this.orderUpdate = this.updateService.orderUpdate.subscribe(
            event => {
                if(this.orderBy !== event) {
                    this.current = '';
                    this.notMe = true
                    this.order.emit('not-me');
                }
            }
        )
    }

    orderCallback() {
        if(this.status.indexOf(this.current) + 1  == this.status.length) {
            this.current = this.status[0];
            this.onHover = false;

        }  else {
            this.current = this.status[this.status.indexOf(this.current) + 1];
        }
        this.notMe = false ;
        this.order.emit(this.current);
        this.updateService.updateOrder(this.orderBy);
    }
    ngOnDestroy() {
        this.orderUpdate.unsubscribe();
    }

}

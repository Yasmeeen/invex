import { Injectable } from '@angular/core';
import { Subject, BehaviorSubject } from 'rxjs';


@Injectable({
    providedIn: 'root',
})
export class UpdateService {

    orderUpdate: Subject<any> = new Subject<any>();
    paginationStartCell: Subject<number[]> = new Subject<number[]>();
    paginationStartCellNumber: number[]  = [];


    constructor() {
    }


    updateOrder(event:any) {
        this.orderUpdate.next(event);
    }
    updatePaginationStartCell(event:number[]) {
        this.paginationStartCell.next(event);
    }
    getPaginationStartCell(): number[]{
        this.paginationStartCell.subscribe (
            res => {
              this.paginationStartCellNumber = res  
            }
        )
        return this.paginationStartCellNumber
    }
  

};
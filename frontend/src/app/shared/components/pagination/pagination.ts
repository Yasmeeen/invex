import { Component, Injectable, Input, Output, EventEmitter, SimpleChanges, OnChanges, OnInit } from '@angular/core';
import {PaginationData} from '@core/models/users-interfaces.model'
import { UpdateService } from '@shared/services/update.service';

@Injectable()
@Component({
    selector: 'pagination',
    template: `
        <div class="flex-space-between flex-middle flex-wrap pagination-container">
            <div class="s-pagination-info mtb-1 text-left">
                <span class="size-tiny">
                    {{'tr_showing' | translate }} {{this.paginationData.totalCount > 0? perPage * (paginationData.currentPage - 1) + 1 : 0}} {{'tr_to' | translate}} {{perPage * (paginationData.currentPage - 1) + perPage < this.paginationData.totalCount? perPage * (paginationData.currentPage - 1) + perPage : this.paginationData.totalCount}}  {{'tr_of' | translate}} {{this.paginationData.totalCount || 0}}
                </span>
            </div>
            <div class="s-pagination mtb-1 text-right">
                <div class="pagination-btn" [class.btn-disabled]="activeCell <= 1" (click)="goPrev()">
                    {{'tr_previous' | translate}}
                </div>
                <div class="pagination-cells">
                    <span *ngIf="canGoBackward" class="pagination-cell" (click)="fastBackward()"><i class="fa fa-angle-double-left"></i></span>
                    <span
                        *ngFor="let cell of currentCells"
                        class="pagination-cell"
                        [class.active]="cell == activeCell"
                        (click)="cellClicked(cell)">
                        {{cell}}
                    </span>
                    <span *ngIf="canGoForward" class="pagination-cell" (click)="fastForward()"><i class="fa fa-angle-double-right"></i></span>
                </div>
                <div class="pagination-btn" [class.btn-disabled]="!(remainingPages > 0)" (click)="goNext()">
                    {{'tr_next' | translate}}
                </div>
            </div>
        </div>
    `,
    styles: [`

    `]
})

export class Pagination implements OnChanges {
    @Input() paginationData: PaginationData;
    @Input() perPage: number = 0;
    @Output() paginationUpdate = new EventEmitter();
    paginationsStartCell: number[] = []
    @Input() step: number = 10;
    @Input() paginationNumber: number = 0;
    cellsNumber: number = 0;
    activeCell: number = 1;
    canGoBackward: boolean = false;
    canGoForward: boolean = false;
    currentCells: number[] = [];
    remainingPages: number = this.step;
    isLoading: boolean = true;

    constructor(
        private updateService: UpdateService
    ) { }

    ngOnChanges(change: SimpleChanges) {
        this.activeCell = this.paginationData.currentPage;
        this.updateAll();
    }

    cellClicked(cell: number) {
        this.activeCell = cell;
        this.updateAll();
        this.emitValue();
    }

    goNext() {
        if (this.remainingPages > 0) {
            this.cellClicked(this.activeCell + 1)
        }
    }

    goPrev() {
        if (this.activeCell > 1) {
            this.cellClicked(this.activeCell - 1)
        }
    }

    fastForward() {
        this.cellClicked(this.paginationsStartCell[this.paginationNumber]  + this.cellsNumber);
    }

    fastBackward() {
        this.cellClicked(this.paginationsStartCell[this.paginationNumber]  - this.step);
    }

    emitValue() {
        this.paginationUpdate.emit(this.activeCell);
    }

    updateAll() {
        this.updateStartingCell();
        this.updateRemaining();
        this.drawCells();
        this.checkFastButtons();
    }

    checkFastButtons() {
        this.canGoForward = (this.remainingPages + this.activeCell) - (this.paginationsStartCell[this.paginationNumber]  + this.cellsNumber) >= 0 ? true : false;
        this.canGoBackward = this.paginationsStartCell[this.paginationNumber]  > 1 ? true : false;
    }

    drawCells() {
        this.currentCells = [];
        for (let i = 0; i < this.cellsNumber; i++) {
            this.currentCells.push(this.paginationsStartCell[this.paginationNumber]  + i);
        }
    }

    updateStartingCell() {
        this.paginationsStartCell = this.updateService.getPaginationStartCell();
        if (this.activeCell == 1){
            this.paginationsStartCell[this.paginationNumber]  = 1;
        } else{
            if (this.activeCell < this.paginationsStartCell[this.paginationNumber] ) {
                this.paginationsStartCell[this.paginationNumber]  -= this.step;
            }
            if (this.activeCell > this.paginationsStartCell[this.paginationNumber]  - 1 + this.step  ) {
                this.paginationsStartCell[this.paginationNumber]  = this.paginationsStartCell[this.paginationNumber]  + this.step;
            }
        }
        this.updateService.updatePaginationStartCell(this.paginationsStartCell)
    }

    updateRemaining() {
        this.remainingPages = this.paginationData.totalPages - this.activeCell;
        let remainingBlock = this.paginationData.totalPages + 1 - this.paginationsStartCell[this.paginationNumber] ;
        this.cellsNumber = remainingBlock >= this.step ? this.step : remainingBlock;
    }
}


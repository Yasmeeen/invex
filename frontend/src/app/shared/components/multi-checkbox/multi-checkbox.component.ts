import { Component, Input, Output, EventEmitter, AfterContentInit } from '@angular/core';

@Component({
    selector: 'multi-checkbox',
    templateUrl: './multi-checkbox.component.html',
    styleUrls: ['./multi-checkbox.component.scss']
})
export class MultiCheckboxComponent implements AfterContentInit {

    @Input() isParent = false;
    @Input() partiallyChecked = false;
    @Output() partiallyCheckedChange = new EventEmitter();
    @Input() allChecked = false;
    @Output() allCheckedChange = new EventEmitter();
    @Input() cells: number [] = [];
    @Input() checkedCells: number[] = [];
    @Output() checkedCellsChange = new EventEmitter();
    @Input() id: any;

    constructor() { }

    ngAfterContentInit() {
        setTimeout(() => {
            this.checkIfAllChecked();
        }, 0);
    }

    checkIfAllChecked() {
        let allChecked = true, partiallyChecked = false;
        this.cells.forEach(cell => {
            if(!this.checkedCells.includes(cell)) {
                allChecked = false;
            } else {
                partiallyChecked = true;
            }
        });
        this.allChecked = allChecked;
        this.partiallyChecked = partiallyChecked && !this.allChecked;
        this.partiallyCheckedChange.emit(this.partiallyChecked);
        this.allCheckedChange.emit(this.allChecked);
    }

    checkAll(event:any) {
        for (let i = 0; i < this.cells.length; i++) {
            this.checkCell(event, this.cells[i], false, event.target.checked);
        }
    }
    checkCell(event:any, id:any, loop = true, allChecked = true) {
        if (event.target.checked && !this.checkedCells.includes(id)) this.checkedCells.push(id);
        if (!event.target.checked) this.checkedCells.splice(this.checkedCells.indexOf(id), 1);
        let partiallyChecked = false;
        if(loop) {
            this.cells.forEach(cell => {
                if(!this.checkedCells.includes(cell)) {
                    allChecked = false;
                } else {
                    partiallyChecked = true;
                }
            });
        }
        this.allChecked = allChecked;
        this.partiallyChecked = partiallyChecked && !this.allChecked;
        this.checkedCellsChange.emit(this.checkedCells);
        this.partiallyCheckedChange.emit(this.partiallyChecked);
        this.allCheckedChange.emit(this.allChecked);
    }

}

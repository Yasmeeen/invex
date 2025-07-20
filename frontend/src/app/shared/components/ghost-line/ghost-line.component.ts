import { Component, OnInit, Input } from '@angular/core';

@Component({
  selector: 'app-ghost-line',
  templateUrl: './ghost-line.component.html',
  styleUrls: ['./ghost-line.component.scss']
})
export class GhostLineComponent implements OnInit {

  @Input() length: number = 10;
  @Input() height: number;
  @Input() width: number;
  @Input() type: string = 'line';

  constructor() { }

  ngOnInit() {
  }

}

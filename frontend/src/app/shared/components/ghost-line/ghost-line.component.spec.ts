import { async, ComponentFixture, TestBed } from '@angular/core/testing';

import { GhostLineComponent } from './ghost-line.component';

describe('GhostLineComponent', () => {
  let component: GhostLineComponent;
  let fixture: ComponentFixture<GhostLineComponent>;

  beforeEach(async(() => {
    TestBed.configureTestingModule({
      declarations: [ GhostLineComponent ]
    })
    .compileComponents();
  }));

  beforeEach(() => {
    fixture = TestBed.createComponent(GhostLineComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

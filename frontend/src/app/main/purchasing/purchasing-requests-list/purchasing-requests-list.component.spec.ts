import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PurchasingRequestsListComponent } from './purchasing-requests-list.component';

describe('PurchasingRequestsListComponent', () => {
  let component: PurchasingRequestsListComponent;
  let fixture: ComponentFixture<PurchasingRequestsListComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ PurchasingRequestsListComponent ]
    })
    .compileComponents();
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(PurchasingRequestsListComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

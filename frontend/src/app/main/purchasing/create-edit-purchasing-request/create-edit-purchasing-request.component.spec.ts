import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CreateEditPurchasingRequestComponent } from './create-edit-purchasing-request.component';

describe('CreateEditPurchasingRequestComponent', () => {
  let component: CreateEditPurchasingRequestComponent;
  let fixture: ComponentFixture<CreateEditPurchasingRequestComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [ CreateEditPurchasingRequestComponent ]
    })
    .compileComponents();
  });

  beforeEach(() => {
    fixture = TestBed.createComponent(CreateEditPurchasingRequestComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

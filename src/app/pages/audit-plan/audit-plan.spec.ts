import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AuditPlan } from './audit-plan';

describe('AuditPlan', () => {
  let component: AuditPlan;
  let fixture: ComponentFixture<AuditPlan>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AuditPlan]
    })
    .compileComponents();

    fixture = TestBed.createComponent(AuditPlan);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

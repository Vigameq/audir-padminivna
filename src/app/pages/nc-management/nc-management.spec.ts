import { ComponentFixture, TestBed } from '@angular/core/testing';

import { NcManagement } from './nc-management';

describe('NcManagement', () => {
  let component: NcManagement;
  let fixture: ComponentFixture<NcManagement>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NcManagement]
    })
    .compileComponents();

    fixture = TestBed.createComponent(NcManagement);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});

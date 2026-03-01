import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, map, tap } from 'rxjs';

export type InstrumentStatus = 'Active' | 'Inactive' | 'Out of Service';
export type CalibrationResult = 'Pass' | 'Fail' | 'Conditional';

export type InstrumentRecord = {
  id: number;
  code: string;
  name: string;
  instrumentType: string;
  serialNumber: string;
  location: string;
  ownerDepartment: string;
  calibrationFrequencyDays: number;
  lastCalibratedAt: string;
  nextCalibrationDue: string;
  status: InstrumentStatus;
  remarks: string;
  createdAt: string;
  updatedAt: string;
};

export type InstrumentCalibrationRecord = {
  id: number;
  instrumentId: number;
  calibrationDate: string;
  calibratedBy: string;
  result: CalibrationResult;
  certificateNo: string;
  notes: string;
  nextDueDate: string;
  createdAt: string;
};

@Injectable({ providedIn: 'root' })
export class InstrumentService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = '/api';
  private readonly instrumentsSignal = signal<InstrumentRecord[]>([]);

  readonly instruments = this.instrumentsSignal.asReadonly();

  listInstruments(): Observable<InstrumentRecord[]> {
    return this.http.get<unknown[]>(`${this.baseUrl}/instruments`).pipe(
      map((rows) => (Array.isArray(rows) ? rows.map((row) => this.mapInstrument(row)) : [])),
      tap((rows) => this.instrumentsSignal.set(rows))
    );
  }

  createInstrument(payload: {
    name: string;
    instrument_type?: string | null;
    serial_number?: string | null;
    location?: string | null;
    owner_department?: string | null;
    calibration_frequency_days?: number;
    last_calibrated_at?: string | null;
    status?: InstrumentStatus;
    remarks?: string | null;
  }): Observable<InstrumentRecord> {
    return this.http.post<unknown>(`${this.baseUrl}/instruments`, payload).pipe(
      map((row) => this.mapInstrument(row)),
      tap((created) => this.instrumentsSignal.set([created, ...this.instrumentsSignal()]))
    );
  }

  updateInstrument(
    id: number,
    payload: {
      name?: string;
      instrument_type?: string | null;
      serial_number?: string | null;
      location?: string | null;
      owner_department?: string | null;
      calibration_frequency_days?: number;
      last_calibrated_at?: string | null;
      next_calibration_due?: string | null;
      status?: InstrumentStatus;
      remarks?: string | null;
    }
  ): Observable<InstrumentRecord> {
    return this.http.put<unknown>(`${this.baseUrl}/instruments/${id}`, payload).pipe(
      map((row) => this.mapInstrument(row)),
      tap((updated) => {
        this.instrumentsSignal.set(
          this.instrumentsSignal().map((item) => (item.id === updated.id ? updated : item))
        );
      })
    );
  }

  listCalibrations(instrumentId: number): Observable<InstrumentCalibrationRecord[]> {
    return this.http.get<unknown[]>(`${this.baseUrl}/instruments/${instrumentId}/calibrations`).pipe(
      map((rows) => (Array.isArray(rows) ? rows.map((row) => this.mapCalibration(row)) : []))
    );
  }

  addCalibration(
    instrumentId: number,
    payload: {
      calibration_date: string;
      calibrated_by?: string | null;
      result?: CalibrationResult;
      certificate_no?: string | null;
      notes?: string | null;
    }
  ): Observable<InstrumentCalibrationRecord> {
    return this.http.post<unknown>(`${this.baseUrl}/instruments/${instrumentId}/calibrations`, payload).pipe(
      map((row) => this.mapCalibration(row))
    );
  }

  private mapInstrument(payload: any): InstrumentRecord {
    return {
      id: Number(payload?.id ?? 0),
      code: String(payload?.code ?? ''),
      name: String(payload?.name ?? ''),
      instrumentType: String(payload?.instrument_type ?? ''),
      serialNumber: String(payload?.serial_number ?? ''),
      location: String(payload?.location ?? ''),
      ownerDepartment: String(payload?.owner_department ?? ''),
      calibrationFrequencyDays: Number(payload?.calibration_frequency_days ?? 0),
      lastCalibratedAt: String(payload?.last_calibrated_at ?? ''),
      nextCalibrationDue: String(payload?.next_calibration_due ?? ''),
      status: String(payload?.status ?? 'Active') as InstrumentStatus,
      remarks: String(payload?.remarks ?? ''),
      createdAt: String(payload?.created_at ?? ''),
      updatedAt: String(payload?.updated_at ?? ''),
    };
  }

  private mapCalibration(payload: any): InstrumentCalibrationRecord {
    return {
      id: Number(payload?.id ?? 0),
      instrumentId: Number(payload?.instrument_id ?? 0),
      calibrationDate: String(payload?.calibration_date ?? ''),
      calibratedBy: String(payload?.calibrated_by ?? ''),
      result: String(payload?.result ?? 'Pass') as CalibrationResult,
      certificateNo: String(payload?.certificate_no ?? ''),
      notes: String(payload?.notes ?? ''),
      nextDueDate: String(payload?.next_due_date ?? ''),
      createdAt: String(payload?.created_at ?? ''),
    };
  }
}

import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map } from 'rxjs/operators';
import { Observable } from 'rxjs';
import { Appuntamento } from '../models/appuntamento.model';
import { environment } from '../../environments/environment';

export interface CreaAppuntamentoPayload {
  idCliente?: number | null;
  idOperatore: number | null;
  idServizio: number | null;
  dataOraInizio: string;
  dataOraFine: string;
  prezzoPersonalizzato?: number | null;
  durataPersonalizzata?: number | null;
  note?: string | null;
}

export interface CreaSlotVuotoPayload {
  idOperatore: number;
  dataOraInizio: string;
  dataOraFine: string;
  note?: string | null;
}

export interface AggiornaAppuntamentoPayload {
  dataOraInizio: string;
  dataOraFine: string;
  idServizio?: number | null;
  durataPersonalizzata?: number | null;
  note?: string | null;
  stato?: string;
}

export interface AggiornaFeriePayload {
  dataInizio: string;
  dataFine: string;
  note?: string | null;
}

@Injectable({
  providedIn: 'root',
})
export class AppuntamentoService {
  private api = `${environment.apiUrl}/appuntamenti`;

  constructor(private http: HttpClient) {}

  getAppuntamenti(idOperatore: number): Observable<Appuntamento[]> {
    return this.http
      .get<{ appuntamenti: Appuntamento[] }>(`${this.api}?idOperatore=${idOperatore}`)
      .pipe(map((res) => res.appuntamenti));
  }

  creaAppuntamento(appuntamento: CreaAppuntamentoPayload): Observable<Appuntamento> {
    return this.http.post<Appuntamento>(this.api, appuntamento);
  }

  creaSlotVuoto(payload: CreaSlotVuotoPayload): Observable<Appuntamento> {
    return this.http.post<Appuntamento>(`${this.api}/slot-vuoto`, payload);
  }

  aggiornaAppuntamento(
    idAppuntamento: number,
    payload: AggiornaAppuntamentoPayload
  ): Observable<Appuntamento> {
    return this.http.put<Appuntamento>(`${this.api}/${idAppuntamento}`, payload);
  }

  eliminaAppuntamento(idAppuntamento: number): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.api}/${idAppuntamento}`);
  }

  eliminaIntervalloFerie(idAppuntamento: number): Observable<{ message: string; deletedCount: number }> {
    return this.http.delete<{ message: string; deletedCount: number }>(`${this.api}/ferie/${idAppuntamento}`);
  }

  aggiornaIntervalloFerie(
    idAppuntamento: number,
    payload: AggiornaFeriePayload
  ): Observable<{ message: string; ferie: Appuntamento[] }> {
    return this.http.put<{ message: string; ferie: Appuntamento[] }>(`${this.api}/ferie/${idAppuntamento}`, payload);
  }

  getAppuntamentiCount(data: string): Observable<number> {
    return this.http
      .get<{ totale: number }>(`${this.api}/count?data=${encodeURIComponent(data)}`)
      .pipe(map((res) => res.totale));
  }
}

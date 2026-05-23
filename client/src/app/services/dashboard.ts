import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface DashboardStats {
  data: string;
  slotCorrente: {
    inizio: string;
    fine: string;
  };
  appuntamentiOggi: number;
  incassoGiornaliero: number;
  incassoPrevistoAppuntamenti: number;
  prodottiInRiordino: number;
  clientiInSalone: number;
  sogliaRiordino: number;
  promemoria?: {
    appuntamenti: DashboardAppointmentReminder[];
    prodotti: DashboardProductReminder[];
  };
}

export interface DashboardAppointmentReminder {
  idAppuntamento: number;
  clienteNome: string;
  operatoreNome: string;
  ora: string;
  oraFine: string;
  servizio: string;
  stato: 'in_corso' | 'in_arrivo';
}

export interface DashboardProductReminder {
  idProdotto: number;
  nome: string;
  quantita: number;
}

@Injectable({
  providedIn: 'root'
})
export class DashboardService {
  private api = 'http://localhost:3000/api/dashboard';

  constructor(private http: HttpClient) {}

  getStats(): Observable<DashboardStats> {
    return this.http.get<DashboardStats>(`${this.api}/stats`);
  }
}

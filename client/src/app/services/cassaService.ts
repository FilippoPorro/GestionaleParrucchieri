import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface AppuntamentoDaIncassare {
  idAppuntamento: number;
  idCliente: number;
  idOperatore: number;
  dataOraInizio: string;
  dataOraFine: string;
  stato: string | null;
  note: string | null;
  clienteNome: string;
  clienteEmail: string;
  operatoreNome: string;
  totalePrevisto: number;
  servizi: Array<{
    idServizio: number;
    nome: string;
    prezzo: number;
    durataPersonalizzata?: number | null;
  }>;
}

@Injectable({
  providedIn: 'root'
})
export class CassaService {
  private api = `${environment.apiUrl}/cassa`;

  constructor(private http: HttpClient) {}

  getStats(): Observable<{ incassoOggi: number; scontriniOggi: number }> {
    return this.http.get<{ incassoOggi: number; scontriniOggi: number }>(`${this.api}/stats`);
  }

  getAppuntamentiDaIncassare(): Observable<{ appuntamenti: AppuntamentoDaIncassare[] }> {
    return this.http.get<{ appuntamenti: AppuntamentoDaIncassare[] }>(`${this.api}/appuntamenti-da-incassare`);
  }

  registraPagamento(payload: {
    idCliente: number | null;
    idOperatore: number | null;
    idAppuntamento?: number | null;
    totale: number;
    metodo: 'carta' | 'contanti';
    prodotti: Array<{ idProdotto: number; quantita: number; prezzoUnitario: number }>;
    servizi: Array<{ idServizio: number; prezzoUnitario: number }>;
  }): Observable<{ message: string; idVendita: number }> {
    return this.http.post<{ message: string; idVendita: number }>(`${this.api}/registra`, payload);
  }
}

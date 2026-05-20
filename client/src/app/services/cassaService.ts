import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class CassaService {
  private api = 'http://localhost:3000/api/cassa';

  constructor(private http: HttpClient) {}

  getStats(): Observable<{ incassoOggi: number; scontriniOggi: number }> {
    return this.http.get<{ incassoOggi: number; scontriniOggi: number }>(`${this.api}/stats`);
  }

  registraPagamento(payload: {
    idCliente: number | null;
    idOperatore: number | null;
    totale: number;
    metodo: 'carta' | 'contanti';
    prodotti: Array<{ idProdotto: number; quantita: number; prezzoUnitario: number }>;
  }): Observable<{ message: string; idVendita: number }> {
    return this.http.post<{ message: string; idVendita: number }>(`${this.api}/registra`, payload);
  }
}

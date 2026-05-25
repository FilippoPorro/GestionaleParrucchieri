import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map } from 'rxjs/operators';
import { Observable } from 'rxjs';
import { Utente } from '../models/utente.model';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root',
})


export class UtentiService {
  constructor(private http: HttpClient) {}
  private api = `${environment.apiUrl}/utenti`;

  private normalizeUtentiResponse(response: Utente[] | { clienti?: Utente[]; operatori?: Utente[] }): Utente[] {
    if (Array.isArray(response)) {
      return response;
    }

    return response.clienti ?? response.operatori ?? [];
  }

  getOperatori(): Observable<Utente[]> {
    return this.http.get<Utente[] | { operatori: Utente[] }>(
      `${this.api}/operatori`
    ).pipe(
      map((res) => this.normalizeUtentiResponse(res))
    );
  }

  getClienti(): Observable<Utente[]> {
    return this.http.get<Utente[] | { clienti: Utente[] }>(
      `${this.api}/clienti`
    ).pipe(
      map((res) => this.normalizeUtentiResponse(res))
    );
  }

  createCliente(cliente: Partial<Utente>): Observable<Utente> {
    return this.http.post<Utente>(`${this.api}/clienti`, cliente);
  }

  updateCliente(idUtente: number, cliente: Partial<Utente>): Observable<Utente> {
    return this.http.put<Utente>(`${this.api}/clienti/${idUtente}`, cliente);
  }

  deleteCliente(idUtente: number): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.api}/clienti/${idUtente}`);
  }
}

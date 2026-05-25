import { Injectable, signal, WritableSignal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Servizio } from '../models/servizio.model';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class ServiziService {
  cart: WritableSignal<Servizio[]> = signal([]);
  private apiUrl = `${environment.apiUrl}/servizi`;

  constructor(private http: HttpClient) { }

  private normalizeBookingType(raw: unknown): 'sito' | 'telefono' | 'consulenza' {
    const value = String(raw ?? '')
      .trim()
      .toLowerCase();

    if (value === 'telefono') return 'telefono';
    if (value === 'consulenza') return 'consulenza';
    return 'sito';
  }

  private normalizeText(raw: unknown): string {
    return String(raw ?? '').trim();
  }

  private normalizeDuration(raw: unknown): string | null {
    if (raw === null || raw === undefined) {
      return null;
    }

    const value = String(raw).trim();
    return value ? value : null;
  }

  getServizi(all = false): Observable<Servizio[]> {
    const url = all ? `${this.apiUrl}?all=true` : this.apiUrl;
    return this.http.get<any[]>(url).pipe(
      map(servizi =>
        servizi.map(s => this.mapServizio(s))
      )
    );
  }

  createServizio(servizio: Partial<Servizio>): Observable<Servizio> {
    return this.http.post<any>(this.apiUrl, servizio).pipe(
      map(s => this.mapServizio(s))
    );
  }

  updateServizio(idServizio: number, servizio: Partial<Servizio>): Observable<Servizio> {
    return this.http.put<any>(`${this.apiUrl}/${idServizio}`, servizio).pipe(
      map(s => this.mapServizio(s))
    );
  }

  deleteServizio(idServizio: number): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.apiUrl}/${idServizio}`);
  }

  getServiziPrenotabiliByOperatore(idOperatore: number): Observable<Servizio[]> {
    return this.http.get<any[]>(`${this.apiUrl}?idOperatore=${idOperatore}`).pipe(
      map(servizi =>
        servizi.map(s => this.mapServizio(s))
      )
    );
  }

  getServiceById(id: number): Observable<Servizio | undefined> {
    return this.getServizi().pipe(
      map(servizi => servizi.find(s => s.idServizio == id))
    );
  }

  addServiceToCart(serv: Servizio) {
    this.cart.update(curCart => [...curCart, serv]);
  }

  getCart(): Servizio[] {
    return this.cart();
  }

  getCartItemCount(): number {
    return this.cart().length;
  }

  clearCart(): void {
    this.cart.set([]);
  }

  removeServiceFromCart(serviceId: number | string): void {
    this.cart.update(curCart => curCart.filter(service => service.idServizio != serviceId));
  }

  private mapServizio(s: any): Servizio {
    const vis = s['visualizzazione sito'] ?? s.visualizzazioneSito ?? s.visualizzazione_sito ?? s.visualizzazione;
    return {
      idServizio: s.idServizio ?? s.id,
      nome: s.nome,
      descrizione: s.descrizione,
      durata: this.normalizeDuration(s.durata),
      prezzo: Number(s.prezzo ?? s.prezzoRivendita ?? 0),
      categoria: this.normalizeText(
        s.categoria ?? s.Categoria
      ),
      sottocategoria: this.normalizeText(
        s['sottocategoria'] ?? s.sottoCategoria ?? s.sottocategoria_nome
      ),
      tipoPrenotazione: this.normalizeBookingType(
        s['tipo prenotazione'] ?? s.tipoPrenotazione ?? s.tipo_prenotazione ?? s.prenotazione
      ),
      visualizzazioneSito: vis === undefined ? true : (vis === true || vis === 1 || vis === "true" || vis === "t")
    };
  }
}

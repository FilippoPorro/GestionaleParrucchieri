import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map } from 'rxjs/operators';
import { Observable } from 'rxjs';
import { Fornitore } from '../models/fornitore.model';

@Injectable({
  providedIn: 'root',
})
export class FornitoriService {
  private api = 'http://localhost:3000/api/fornitori';

  constructor(private http: HttpClient) {}

  private normalizeFornitoriResponse(response: Fornitore[] | { fornitori?: Fornitore[] }): Fornitore[] {
    if (Array.isArray(response)) {
      return response;
    }

    return response.fornitori ?? [];
  }

  getFornitori(): Observable<Fornitore[]> {
    return this.http.get<Fornitore[] | { fornitori: Fornitore[] }>(this.api).pipe(
      map((res) => this.normalizeFornitoriResponse(res))
    );
  }

  createFornitore(fornitore: Partial<Fornitore>): Observable<Fornitore> {
    return this.http.post<Fornitore>(this.api, fornitore);
  }

  updateFornitore(idFornitore: number, fornitore: Partial<Fornitore>): Observable<Fornitore> {
    return this.http.put<Fornitore>(`${this.api}/${idFornitore}`, fornitore);
  }

  deleteFornitore(idFornitore: number): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.api}/${idFornitore}`);
  }
}

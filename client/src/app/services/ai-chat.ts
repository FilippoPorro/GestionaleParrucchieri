import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ServiceCard {
  idServizio: number;
  nome: string;
  descrizione: string;
  durata: number;
  prezzo: number;
  categoria?: string;
  sottocategoria?: string;
  tipoPrenotazione?: 'sito' | 'telefono' | 'consulenza' | '';
}

export interface ProductCard {
  idProdotto: number;
  nome: string;
  descrizione: string;
  prezzo: number;
  marca: string;
  formato: string;
  categoria: string;
  foto: string;
}

@Injectable({ providedIn: 'root' })
export class AiChatService {
  private apiBaseUrl = environment.apiBaseUrl;

  constructor(private http: HttpClient) {}

  async send(messages: ChatMessage[]): Promise<{ reply: string; services: ServiceCard[]; products: ProductCard[] }> {
    const request = firstValueFrom(
      this.http.post<{ reply?: string; services?: ServiceCard[]; products?: ProductCard[] }>(
        `${environment.apiUrl}/chat`,
        { messages }
      )
    );

    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('TIMEOUT')), 30000)
    );

    try {
      const res = await Promise.race([request, timeout]);

      return {
        reply: res?.reply || 'Nessuna risposta disponibile',
        services: Array.isArray(res?.services) ? res.services : [],
        products: Array.isArray(res?.products)
          ? res.products.map(product => ({
              ...product,
              foto: this.buildImageUrl(product.foto)
            }))
          : []
      };
    } catch (error: any) {

      if (error?.message === 'TIMEOUT') {
        return {
          reply: 'Sto impiegando troppo tempo a rispondere. Riprova tra qualche secondo.',
          services: [],
          products: []
        };
      }

      if (error?.status) {
        return {
          reply: `Errore server (${error.status}). Controlla il backend.`,
          services: [],
          products: []
        };
      }

      return {
        reply: 'Errore di connessione. Controlla che il server sia attivo.',
        services: [],
        products: []
      };
    }
  }

  private buildImageUrl(foto?: string | null): string {
    if (!foto) {
      return '';
    }

    return /^https?:\/\//i.test(foto) ? foto : '';
  }
}

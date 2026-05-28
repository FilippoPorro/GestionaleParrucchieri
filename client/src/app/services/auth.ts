import { Injectable, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { tap } from 'rxjs/operators';
import { Observable } from 'rxjs';
import { ProdottoService } from './prodotto';
import { environment } from '../../environments/environment';

interface LoginResponse {
  token: string;
  message?: string;
  user?: {
    id: number;
    email: string;
    ruolo: string;
    mustChangePassword?: boolean;
  };
}

interface GenericResponse {
  message: string;
}

export interface AuthUserSummary {
  id: number | null;
  nome: string;
  cognome: string;
  email: string;
  ruolo: string;
}

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private api = `${environment.apiUrl}/auth`;
  private readonly TOKEN_KEY = 'login_token';

  private _token = signal<string | null>(this.getStoredToken());

  isLoggedIn = computed(() => this.isTokenUsable(this._token()));

  userRole = computed(() => {
    const token = this.getToken();
    if (!token) return null;

    try {
      const decodedPayload = this.decodeTokenPayload(token);
      return decodedPayload['ruolo'] ?? null;
    } catch (e) {
      console.error('Errore decodifica token', e);
      return null;
    }
  });

  isTitolare = computed(() => this.userRole() === 'titolare');

  isOperatore = computed(() => this.userRole() === 'operatore' || this.userRole() === 'titolare');

  currentUser = computed<AuthUserSummary | null>(() => this.getUserSummaryFromToken());

  mustChangePassword = computed(() => {
    const token = this.getToken();
    if (!token) return false;

    try {
      const decodedPayload = this.decodeTokenPayload(token);
      return !!decodedPayload['mustChangePassword'];
    } catch (e) {
      console.error('Errore decodifica stato password dal token', e);
      return false;
    }
  });

  constructor(
    private http: HttpClient,
    private router: Router,
    private prodottoService: ProdottoService
  ) {}

  login(
    email: string,
    password: string,
    rememberMe: boolean
  ): Observable<LoginResponse> {
    return this.http.post<LoginResponse>(`${this.api}/login`, {
      email,
      password,
    }).pipe(
      tap((response) => {
        if (response?.token) {
          this.saveToken(response.token, rememberMe);
        }
      })
    );
  }

  loginWithGoogle(): void {
    const authApi = this.getGoogleAuthApiUrl();
    const frontendUrl = encodeURIComponent(window.location.origin);
    window.location.href = `${authApi}/google?frontendUrl=${frontendUrl}`;
  }

  saveToken(token: string, rememberMe: boolean = true): void {
    if (rememberMe) {
      localStorage.setItem(this.TOKEN_KEY, token);
      sessionStorage.removeItem(this.TOKEN_KEY);
    } else {
      sessionStorage.setItem(this.TOKEN_KEY, token);
      localStorage.removeItem(this.TOKEN_KEY);
    }

    this._token.set(token);
  }

  getToken(): string | null {
    const token = this._token();

    if (!this.isTokenUsable(token)) {
      if (token) {
        this.clearToken();
      }

      return null;
    }

    return token;
  }

  clearToken(): void {
    localStorage.removeItem(this.TOKEN_KEY);
    sessionStorage.removeItem(this.TOKEN_KEY);
    this._token.set(null);
  }

  logout(): void {
    this.clearCartStorage();
    this.clearToken();
    localStorage.removeItem('rememberedEmail');
    this.router.navigate(['/login']);
  }

  get token(): string | null {
    return this.getToken();
  }

  register(user: {
    nome: string,
    cognome: string,
    email: string,
    password: string,
    telefono: string,
    data_nascita: string,
    sesso: 'm' | 'f',
    ruolo: string
  }) {
    return this.http.post<LoginResponse>(`${this.api}/register`, user)
      .pipe(
        tap((response) => {
          if (response?.token) {
            this.saveToken(response.token);
          }
        })
      );
  }

  forgotPassword(email: string): Observable<GenericResponse> {
    return this.http.post<GenericResponse>(`${this.api}/forgot-password`, {
      email
    });
  }

  getUserEmailFromToken(): string | null {
    const token = this.getToken();

    if (!token) {
      return null;
    }

    try {
      const decodedPayload = this.decodeTokenPayload(token);
      return typeof decodedPayload['email'] === 'string' ? decodedPayload['email'] : null;
    } catch (e) {
      console.error('Errore decodifica email dal token', e);
      return null;
    }
  }

  getUserSummaryFromToken(): AuthUserSummary | null {
    const token = this.getToken();

    if (!token) {
      return null;
    }

    try {
      const decodedPayload = this.decodeTokenPayload(token);
      const id = Number(decodedPayload['userId'] ?? decodedPayload['idUtente'] ?? decodedPayload['id']);

      return {
        id: Number.isFinite(id) ? id : null,
        nome: typeof decodedPayload['nome'] === 'string' ? decodedPayload['nome'] : '',
        cognome: typeof decodedPayload['cognome'] === 'string' ? decodedPayload['cognome'] : '',
        email: typeof decodedPayload['email'] === 'string' ? decodedPayload['email'] : '',
        ruolo: typeof decodedPayload['ruolo'] === 'string' ? decodedPayload['ruolo'] : ''
      };
    } catch (e) {
      console.error('Errore decodifica utente dal token', e);
      return null;
    }
  }

  resetPassword(
    token: string,
    newPassword: string,
    confirmPassword: string
  ): Observable<GenericResponse> {
    return this.http.post<GenericResponse>(`${this.api}/reset-password`, {
      token,
      newPassword,
      confirmPassword
    });
  }

  private getStoredToken(): string | null {
    const token = localStorage.getItem(this.TOKEN_KEY) || sessionStorage.getItem(this.TOKEN_KEY);

    if (!this.isTokenUsable(token)) {
      localStorage.removeItem(this.TOKEN_KEY);
      sessionStorage.removeItem(this.TOKEN_KEY);
      return null;
    }

    return token;
  }

  private getUserIdFromToken(token: string | null): number | null {
    if (!token) {
      return null;
    }

    try {
      const decodedPayload = this.decodeTokenPayload(token);
      const id = Number(decodedPayload['userId'] ?? decodedPayload['idUtente'] ?? decodedPayload['id']);
      return Number.isFinite(id) ? id : null;
    } catch {
      return null;
    }
  }

  private decodeTokenPayload(token: string): Record<string, any> {
    const payloadBase64 = token.split('.')[1];

    if (!payloadBase64) {
      throw new Error('Payload token mancante');
    }

    const normalizedPayload = payloadBase64
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(payloadBase64.length / 4) * 4, '=');

    return JSON.parse(atob(normalizedPayload));
  }

  private isTokenUsable(token: string | null): boolean {
    if (!token) {
      return false;
    }

    try {
      const decodedPayload = this.decodeTokenPayload(token);
      const exp = Number(decodedPayload['exp']);

      if (Number.isFinite(exp) && exp * 1000 <= Date.now()) {
        return false;
      }

      return true;
    } catch {
      return false;
    }
  }

  private clearCartStorage(): void {
    localStorage.removeItem('cart');
    localStorage.removeItem('cart_id');
    localStorage.removeItem('cart_expires_at');
    localStorage.removeItem('cart_total');
  }

  private getGoogleAuthApiUrl(): string {
    const hostname = window.location.hostname;
    const isLocalFrontend = hostname === 'localhost' || hostname === '127.0.0.1';

    if (isLocalFrontend) {
      return 'http://localhost:3000/api/auth';
    }

    return this.api;
  }
}

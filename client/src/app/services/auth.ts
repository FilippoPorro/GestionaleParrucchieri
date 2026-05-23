import { Injectable, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { tap } from 'rxjs/operators';
import { Observable } from 'rxjs';

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
  private api = 'http://localhost:3000/api/auth';
  private readonly TOKEN_KEY = 'login_token';

  private _token = signal<string | null>(this.getStoredToken());

  isLoggedIn = computed(() => !!this._token());

  userRole = computed(() => {
    const token = this._token();
    if (!token) return null;

    try {
      const payloadBase64 = token.split('.')[1];
      if (!payloadBase64) return null;

      const decodedPayload = JSON.parse(atob(payloadBase64));
      return decodedPayload.ruolo ?? null;
    } catch (e) {
      console.error('Errore decodifica token', e);
      return null;
    }
  });

  isAdmin = computed(() => this.userRole() === 'admin');

  isOperatore = computed(() => this.userRole() === 'operatore' || this.userRole() === 'admin');

  currentUser = computed<AuthUserSummary | null>(() => this.getUserSummaryFromToken());

  mustChangePassword = computed(() => {
    const token = this._token();
    if (!token) return false;

    try {
      const payloadBase64 = token.split('.')[1];
      if (!payloadBase64) return false;

      const decodedPayload = JSON.parse(atob(payloadBase64));
      return !!decodedPayload.mustChangePassword;
    } catch (e) {
      console.error('Errore decodifica stato password dal token', e);
      return false;
    }
  });

  constructor(
    private http: HttpClient,
    private router: Router
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
    window.location.href = `${this.api}/google`;
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
    return this._token();
  }

  clearToken(): void {
    localStorage.removeItem(this.TOKEN_KEY);
    sessionStorage.removeItem(this.TOKEN_KEY);
    this._token.set(null);
  }

  logout(): void {
    this.clearToken();
    localStorage.removeItem('rememberedEmail');
    this.router.navigate(['/login']);
  }

  get token(): string | null {
    return this._token();
  }

  register(user: {
    nome: string,
    cognome: string,
    email: string,
    password: string,
    telefono: string,
    data_nascita: string,
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
    const token = this._token();

    if (!token) {
      return null;
    }

    try {
      const payloadBase64 = token.split('.')[1];

      if (!payloadBase64) {
        return null;
      }

      const decodedPayload = JSON.parse(atob(payloadBase64));
      return typeof decodedPayload.email === 'string' ? decodedPayload.email : null;
    } catch (e) {
      console.error('Errore decodifica email dal token', e);
      return null;
    }
  }

  getUserSummaryFromToken(): AuthUserSummary | null {
    const token = this._token();

    if (!token) {
      return null;
    }

    try {
      const payloadBase64 = token.split('.')[1];

      if (!payloadBase64) {
        return null;
      }

      const decodedPayload = JSON.parse(atob(payloadBase64));

      return {
        id: Number.isFinite(Number(decodedPayload.idUtente ?? decodedPayload.id))
          ? Number(decodedPayload.idUtente ?? decodedPayload.id)
          : null,
        nome: typeof decodedPayload.nome === 'string' ? decodedPayload.nome : '',
        cognome: typeof decodedPayload.cognome === 'string' ? decodedPayload.cognome : '',
        email: typeof decodedPayload.email === 'string' ? decodedPayload.email : '',
        ruolo: typeof decodedPayload.ruolo === 'string' ? decodedPayload.ruolo : ''
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
    return localStorage.getItem(this.TOKEN_KEY) || sessionStorage.getItem(this.TOKEN_KEY);
  }
}

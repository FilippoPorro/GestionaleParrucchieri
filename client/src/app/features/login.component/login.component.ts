import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { AuthService } from '../../services/auth';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';

type AlertType = 'success' | 'error' | 'warning';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule, RouterLink, CommonModule],
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.css']
})
export class LoginComponent implements OnInit {
  private readonly GOOGLE_REMEMBER_KEY = 'oauth_remember_me';
  email: string = '';
  password: string = '';
  rememberMe: boolean = false;

  showPassword: boolean = false;

  isLoading: boolean = false;

  alertMessage: string = '';
  alertType: AlertType = 'error';

  constructor(
    private auth: AuthService,
    private router: Router,
    private route: ActivatedRoute,
    private cdr: ChangeDetectorRef
  ) { }

  ngOnInit(): void {

    const resetSuccess = this.route.snapshot.queryParamMap.get('resetSuccess');

    if (resetSuccess === '1') {
      this.showAlert('Password aggiornata con successo. Ora puoi accedere.', 'success');

      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: {},
        replaceUrl: true
      });
    }

    const postLoginRedirect = localStorage.getItem('postLoginRedirect');

    if (this.auth.isLoggedIn()) {
      if (
        postLoginRedirect &&
        postLoginRedirect !== '/login' &&
        postLoginRedirect !== '/'
      ) {
        this.redirectAfterLogin();
      } else {
        this.router.navigate(['/account']);
      }
      return;
    }

    const savedEmail = localStorage.getItem('rememberedEmail');

    if (savedEmail) {
      this.email = savedEmail;
      this.rememberMe = true;
      this.cdr.detectChanges();
    }

    this.route.queryParams.subscribe(params => {
      const token = params['token'];
      const googleError = params['googleError'];

      if (token) {
        const rememberGoogleLogin = localStorage.getItem(this.GOOGLE_REMEMBER_KEY) === '1';
        this.auth.saveToken(token, rememberGoogleLogin);
        localStorage.removeItem(this.GOOGLE_REMEMBER_KEY);
        this.isLoading = false;
        this.showAlert('Accesso con Google effettuato con successo!', 'success');

        this.router.navigate([], {
          relativeTo: this.route,
          queryParams: {},
          replaceUrl: true
        });

        setTimeout(() => {
          this.redirectAfterLogin();
        }, 800);
      }

      if (googleError) {
        localStorage.removeItem(this.GOOGLE_REMEMBER_KEY);
        this.isLoading = false;
        this.showAlert('Errore durante l’accesso con Google.', 'error');

        this.router.navigate([], {
          relativeTo: this.route,
          queryParams: {},
          replaceUrl: true
        });

        this.cdr.detectChanges();
      }
    });
  }

  showAlert(message: string, type: AlertType = 'error'): void {
    this.alertMessage = message;
    this.alertType = type;
    this.cdr.detectChanges();

    setTimeout(() => {
      this.alertMessage = '';
      this.cdr.detectChanges();
    }, 4000);
  }

  redirectAfterLogin(): void {
    if (this.auth.mustChangePassword()) {
      localStorage.removeItem('postLoginRedirect');
      this.router.navigate(['/account']);
      return;
    }

    const returnUrl = localStorage.getItem('postLoginRedirect');

    localStorage.removeItem('postLoginRedirect');

    if (returnUrl && returnUrl !== '/login' && returnUrl !== '/') {
      this.router.navigateByUrl(returnUrl);
    } else {
      this.router.navigate(['/home']);
    }
  }

  goBack(): void {
    const backUrl = localStorage.getItem('loginBackUrl');

    localStorage.removeItem('loginBackUrl');
    localStorage.removeItem('postLoginRedirect');

    if (backUrl && backUrl !== '/login' && backUrl !== '/') {
      this.router.navigateByUrl(backUrl);
    } else {
      this.router.navigate(['/home']);
    }
  }

  login(): void {
    if (!this.email.trim() || !this.password.trim()) {
      this.showAlert('Inserisci email e password.', 'warning');
      return;
    }

    this.isLoading = true;
    this.alertMessage = '';
    this.cdr.detectChanges();

    this.auth.login(this.email, this.password, this.rememberMe).subscribe({
      next: (res) => {
        console.log(res);

        if (this.rememberMe) {
          localStorage.setItem('rememberedEmail', this.email);
        } else {
          localStorage.removeItem('rememberedEmail');
        }

        this.isLoading = false;
        this.showAlert('Accesso effettuato con successo!', 'success');
        this.cdr.detectChanges();

        setTimeout(() => {
          this.redirectAfterLogin();
        }, 800);
      },
      error: (err) => {
        console.error('Errore login:', err);
        this.isLoading = false;

        if (err.status === 404) {
          this.showAlert('Utente non trovato.', 'error');
        } else if (err.status === 401) {
          this.showAlert('Email o password non validi.', 'error');
        } else if (err.status === 400) {
          this.showAlert(err.error?.message || 'Dati non validi.', 'error');
        } else if (err.status === 0) {
          this.showAlert('Impossibile contattare il server.', 'error');
        } else {
          this.showAlert('Errore durante il login.', 'error');
        }

        this.cdr.detectChanges();
      },
      complete: () => {
        this.isLoading = false;
        this.cdr.detectChanges();
      }
    });
  }

  loginWithGoogle(): void {
    this.alertMessage = '';
    this.isLoading = true;
    localStorage.setItem(this.GOOGLE_REMEMBER_KEY, this.rememberMe ? '1' : '0');

    const savedReturnUrl = localStorage.getItem('postLoginRedirect');

    if (!savedReturnUrl || savedReturnUrl === '/login' || savedReturnUrl === '/') {
      localStorage.removeItem('postLoginRedirect');
    }

    this.cdr.detectChanges();
    this.auth.loginWithGoogle();
  }
}

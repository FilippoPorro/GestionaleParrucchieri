import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth';

type AlertType = 'success' | 'error' | 'warning';

@Component({
  selector: 'app-reset-password',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './reset-password.component.html',
  styleUrls: ['./reset-password.component.css']
})
export class ResetPasswordComponent implements OnInit {
  token: string = '';
  newPassword: string = '';
  confirmPassword: string = '';

  showNewPassword: boolean = false;
  showConfirmPassword: boolean = false;

  isLoading: boolean = false;
  isCheckingToken: boolean = true;
  isLinkInvalid: boolean = false;
  invalidLinkMessage: string = '';

  alertMessage: string = '';
  alertType: AlertType = 'error';

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private auth: AuthService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.route.queryParams.subscribe(params => {
      this.token = params['token'] || '';

      if (!this.token) {
        this.showInvalidLink('Link non valido o incompleto.');
        return;
      }

      this.validateToken();
    });
  }

  private validateToken(): void {
    this.isCheckingToken = true;
    this.isLinkInvalid = false;
    this.invalidLinkMessage = '';
    this.cdr.detectChanges();

    this.auth.validateResetPasswordToken(this.token.trim()).subscribe({
      next: () => {
        this.isCheckingToken = false;
        this.isLinkInvalid = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.isCheckingToken = false;
        this.showInvalidLink(
          err?.error?.message || 'Il link non e piu valido. Richiedi un nuovo recupero password.'
        );
      }
    });
  }

  private showInvalidLink(message: string): void {
    this.isCheckingToken = false;
    this.isLinkInvalid = true;
    this.invalidLinkMessage = message;
    this.showAlert(message, 'error');
  }

  showAlert(message: string, type: AlertType = 'error'): void {
    this.alertMessage = message;
    this.alertType = type;
    this.cdr.detectChanges();
  }

  getPasswordChecklist() {
    return [
      {
        label: 'Almeno 6 caratteri',
        valid: this.newPassword.length >= 6
      },
      {
        label: 'Almeno una lettera maiuscola',
        valid: /[A-Z]/.test(this.newPassword)
      },
      {
        label: 'Almeno un numero o carattere speciale',
        valid: /[0-9!@#$%^&*(),.?":{}|<>]/.test(this.newPassword)
      },
      {
        label: 'Le password coincidono',
        valid:
          this.newPassword.length > 0 &&
          this.confirmPassword.length > 0 &&
          this.newPassword === this.confirmPassword
      }
    ];
  }

  isPasswordValid(): boolean {
    return this.getPasswordChecklist().every(item => item.valid);
  }

  isResetFormValid(): boolean {
    return !this.isCheckingToken && !this.isLinkInvalid && this.token.trim() !== '' && this.isPasswordValid();
  }

  resetPasswordAction(): void {
    if (!this.token.trim()) {
      this.showInvalidLink('Token di reset mancante.');
      return;
    }

    if (this.isLinkInvalid) {
      return;
    }

    if (!this.newPassword.trim()) {
      this.showAlert('Inserisci la nuova password.', 'warning');
      return;
    }

    if (!this.isPasswordValid()) {
      this.showAlert('La password deve rispettare tutti i requisiti e coincidere con la conferma.', 'warning');
      return;
    }

    this.isLoading = true;
    this.alertMessage = '';
    this.cdr.detectChanges();

    this.auth.resetPassword(
      this.token.trim(),
      this.newPassword.trim(),
      this.confirmPassword.trim()
    ).subscribe({
      next: (res) => {
        this.isLoading = false;
        this.showAlert(
          res?.message || 'Password aggiornata con successo.',
          'success'
        );
        this.cdr.detectChanges();

        setTimeout(() => {
          this.router.navigate(['/login'], {
            queryParams: { resetSuccess: '1' }
          });
        }, 1400);
      },
      error: (err) => {
        console.error('Errore reset password:', err);
        this.isLoading = false;
        const message = err?.error?.message || 'Impossibile aggiornare la password.';

        if (err?.status === 400 || err?.status === 404 || err?.status === 410) {
          this.showInvalidLink(message);
          return;
        }

        this.showAlert(
          message,
          'error'
        );
        this.cdr.detectChanges();
      }
    });
  }
}

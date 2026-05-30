import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth';

type AlertType = 'success' | 'error' | 'warning';

@Component({
  selector: 'app-forgot-password',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './password-dimenticata.component.html',
  styleUrls: ['./password-dimenticata.component.css']
})
export class PasswordDimenticataComponent implements OnInit {
  email: string = '';
  isLoading: boolean = false;
  formSubmitted: boolean = false;

  alertMessage: string = '';
  alertType: AlertType = 'error';

  constructor(
    private auth: AuthService,
    private router: Router,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    if (!this.auth.isLoggedIn()) {
      return;
    }

    const loggedEmail = this.auth.getUserEmailFromToken();

    if (loggedEmail) {
      this.email = loggedEmail;
      this.cdr.detectChanges();
    }
  }

  showAlert(message: string, type: AlertType = 'error'): void {
    this.alertMessage = message;
    this.alertType = type;
    this.cdr.detectChanges();

    setTimeout(() => {
      this.alertMessage = '';
      this.cdr.detectChanges();
    }, 5000);
  }

  goBack(): void {
    window.history.back();
  }

  sendResetLink(): void {
    this.formSubmitted = true;

    const cleanedEmail = this.email.trim();

    if (!cleanedEmail) {
      this.showAlert('Inserisci la tua email.', 'warning');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailRegex.test(cleanedEmail)) {
      this.showAlert('Inserisci un indirizzo email valido.', 'warning');
      return;
    }

    this.isLoading = true;
    this.alertMessage = '';
    this.cdr.detectChanges();

    this.auth.forgotPassword(cleanedEmail).subscribe({
      next: (res) => {
        this.isLoading = false;
        this.showAlert(
          res?.message || 'Se l’email esiste, ti invieremo un link di reset.',
          'success'
        );
        this.email = '';
        this.formSubmitted = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.isLoading = false;
        this.showAlert(
          err?.error?.message || 'Errore durante l’invio del link di reset.',
          'error'
        );
        this.cdr.detectChanges();
      }
    });
  }
}

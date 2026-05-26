import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectorRef,
  Component,
  HostListener,
  OnInit
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { IntlTelInputComponent } from 'intl-tel-input/angularWithUtils';

import { AuthService } from '../../services/auth';
import { NavbarComponent } from '../navbar.component/navbar.component';
import { environment } from '../../../environments/environment';

interface UserProfile {
  idUtente: number;
  nome: string;
  cognome: string;
  email: string;
  telefono: string;
  data_nascita: string;
  sesso: '' | 'm' | 'f';
  ruolo: string;
  hasPassword?: boolean;
  mustChangePassword?: boolean;
  photoURL?: string | null;
}

interface PasswordChecklistItem {
  label: string;
  valid: boolean;
}

interface CalendarPickerDay {
  date: Date;
  label: number;
  currentMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
}

@Component({
  selector: 'app-info-utente',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    NavbarComponent,
    RouterLink,
    IntlTelInputComponent
  ],
  templateUrl: './info-utente.component.html',
  styleUrls: ['./info-utente.component.css']
})
export class InfoUtenteComponent implements OnInit {
  private api = `${environment.apiUrl}/auth`;
  private changePasswordMessageTimeout: ReturnType<typeof setTimeout> | null = null;
  private changePasswordMessageHideTimeout: ReturnType<typeof setTimeout> | null = null;
  private birthDatePickerCloseTimeout: ReturnType<typeof setTimeout> | null = null;

  user: UserProfile | null = null;
  isProfilePhotoBroken = false;

  password = '';
  confirmPassword = '';
  completionPasswordChecklist: PasswordChecklistItem[] = [];
  completionPasswordValid = false;

  isLoading = true;
  isSaving = false;
  isEditMode = false;

  errorMessage = '';
  successMessage = '';

  missingRequiredFields = false;
  passwordRequired = false;
  showCompletionWarning = false;
  disableCancelButton = false;
  completionMessage = '';
  requirePasswordForCompletion = false;

  showPassword = false;
  showConfirmPassword = false;

  showChangePasswordPanel = false;

  currentPasswordChange = '';
  newPasswordChange = '';
  confirmNewPasswordChange = '';

  showCurrentPasswordChange = false;
  showNewPasswordChange = false;
  showConfirmNewPasswordChange = false;

  isChangingPassword = false;
  changePasswordMessage = '';
  changePasswordError = '';
  changePasswordErrorShake = false;
  changePasswordMessageHiding = false;

  isPhoneValid = true;
  selectedCountryIso2 = 'it';
  birthDatePickerOpen = false;
  birthDatePickerClosing = false;
  birthDatePickerOpenUpward = true;
  birthDatePickerMode: 'days' | 'years' = 'days';
  birthDatePickerMonth = new Date();
  birthDatePickerDays: CalendarPickerDay[] = [];
  sexDropdownOpen = false;
  sexDropdownClosing = false;
  private sexDropdownCloseTimeout: ReturnType<typeof setTimeout> | null = null;

  readonly calendarPickerWeekdays = ['Lu', 'Ma', 'Me', 'Gi', 'Ve', 'Sa', 'Do'];
  readonly calendarPickerMonthFormatter = new Intl.DateTimeFormat('it-IT', {
    month: 'long'
  });
  readonly birthDatePickerYears = this.buildBirthDatePickerYears();

  preferredCountries = ['it', 'gb', 'fr', 'de', 'es', 'us'];

  initTelOptions = {
    initialCountry: 'auto' as const,
    geoIpLookup: (
      success: (iso2: any) => void,
      failure: () => void
    ) => {
      fetch('https://ipapi.co/json/')
        .then((res) => res.json())
        .then((data) => {
          const code = String(data?.country_code || 'it').toLowerCase();
          success(code as any);
        })
        .catch(() => {
          success('it' as any);
          failure();
        });
    },
    preferredCountries: ['it', 'gb', 'fr', 'de', 'es', 'us'],
    separateDialCode: true,
    nationalMode: false,
    strictMode: true,
    formatOnDisplay: true,
    autoPlaceholder: 'polite' as const
  };

  constructor(
    private http: HttpClient,
    private auth: AuthService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.loadUserData();
  }

  get canRegisterUsers(): boolean {
    return this.isManagementUser;
  }

  get isManagementUser(): boolean {
    const role = String(this.user?.ruolo ?? '').trim().toLowerCase();
    return role === 'operatore' || role === 'titolare';
  }

  get accessModeLabel(): string {
    return this.user?.photoURL ? 'Google' : 'Credenziali';
  }

  get birthDateDisplayValue(): string {
    const parsedDate = this.parseInputDate(this.user?.data_nascita ?? '');
    if (!parsedDate) {
      return 'gg/mm/aaaa';
    }

    return parsedDate.toLocaleDateString('it-IT');
  }

  get birthDatePickerMonthLabel(): string {
    const label = this.calendarPickerMonthFormatter.format(this.birthDatePickerMonth);
    const month = label.charAt(0).toUpperCase() + label.slice(1);
    return `${month} ${this.birthDatePickerYear}`;
  }

  get birthDatePickerYear(): number {
    return this.birthDatePickerMonth.getFullYear();
  }

  private resetCompletionPasswordFields(): void {
    this.password = '';
    this.confirmPassword = '';
    this.showPassword = false;
    this.showConfirmPassword = false;
    this.updateCompletionPasswordState();
  }

  private resetChangePasswordFields(): void {
    this.currentPasswordChange = '';
    this.newPasswordChange = '';
    this.confirmNewPasswordChange = '';

    this.showCurrentPasswordChange = false;
    this.showNewPasswordChange = false;
    this.showConfirmNewPasswordChange = false;
  }

  private clearChangePasswordMessageLater(): void {
    if (this.changePasswordMessageTimeout) {
      clearTimeout(this.changePasswordMessageTimeout);
    }

    if (this.changePasswordMessageHideTimeout) {
      clearTimeout(this.changePasswordMessageHideTimeout);
    }

    this.changePasswordMessageHiding = false;

    this.changePasswordMessageTimeout = setTimeout(() => {
      this.changePasswordMessageHiding = true;
      this.cdr.detectChanges();

      this.changePasswordMessageHideTimeout = setTimeout(() => {
        this.changePasswordMessage = '';
        this.changePasswordMessageHiding = false;
        this.cdr.detectChanges();
      }, 350);
    }, 3200);
  }

  private computeProfileCompletionState(): void {
    if (!this.user) {
      this.missingRequiredFields = false;
      this.passwordRequired = false;
      this.showCompletionWarning = false;
      this.disableCancelButton = false;
      this.completionMessage = '';
      return;
    }

    const nome = String(this.user.nome ?? '').trim();
    const cognome = String(this.user.cognome ?? '').trim();
    const telefono = String(this.user.telefono ?? '').trim();
    const dataNascita = String(this.user.data_nascita ?? '').trim();
    const sesso = String(this.user.sesso ?? '').trim();
    const hasPassword = !!this.user.hasPassword;

    this.missingRequiredFields = !nome || !cognome || !telefono || !dataNascita || !sesso;

    this.requirePasswordForCompletion = !hasPassword || !!this.user.mustChangePassword;
    this.passwordRequired = this.requirePasswordForCompletion;

    this.showCompletionWarning =
      this.missingRequiredFields || this.requirePasswordForCompletion;

    this.disableCancelButton =
      this.missingRequiredFields || this.requirePasswordForCompletion;

    if (this.missingRequiredFields && this.requirePasswordForCompletion) {
      this.completionMessage =
        'Completa i dati mancanti e imposta una nuova password per terminare la registrazione.';
    } else if (this.missingRequiredFields) {
      this.completionMessage =
        'Completa i dati mancanti per terminare la registrazione.';
    } else if (this.requirePasswordForCompletion) {
      this.completionMessage = this.user.mustChangePassword
        ? 'Per sicurezza devi impostare una nuova password prima di continuare.'
        : 'Imposta una password per terminare la registrazione.';
    } else {
      this.completionMessage = '';
    }
  }

  loadUserData(): void {
    this.isLoading = true;
    this.errorMessage = '';
    this.successMessage = '';
    this.cdr.detectChanges();

    this.http.get<any>(`${this.api}/me`).subscribe({
      next: (res) => {
        if (!res) {
          this.errorMessage = 'Il server non ha restituito dati utente.';
          this.isLoading = false;
          this.cdr.detectChanges();
          return;
        }

        this.user = {
          idUtente: res.idUtente,
          nome: res.nome ?? '',
          cognome: res.cognome ?? '',
          email: res.email ?? '',
          telefono: res.telefono != null ? String(res.telefono) : '',
          data_nascita: res.data_nascita
            ? String(res.data_nascita).substring(0, 10)
            : '',
          sesso: res.sesso === 'm' || res.sesso === 'f' ? res.sesso : '',
          ruolo: res.ruolo ?? '',
          hasPassword: !!res.hasPassword,
          mustChangePassword: !!res.mustChangePassword,
          photoURL:
            res.photoURL ??
            res.picture ??
            res.avatar_url ??
            res.avatar ??
            null
        };
        this.isProfilePhotoBroken = false;
        this.syncBirthDatePickerMonth(
          this.parseInputDate(this.user.data_nascita) ?? new Date()
        );

        this.computeProfileCompletionState();
        this.isEditMode = this.showCompletionWarning;
        this.isLoading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Errore recupero profilo:', err);
        this.errorMessage =
          err?.error?.message || 'Impossibile recuperare i dati utente.';
        this.isLoading = false;
        this.cdr.detectChanges();
      }
    });
  }

  getProfilePhotoUrl(): string | null {
    if (!this.user?.photoURL || this.isProfilePhotoBroken) {
      return null;
    }

    const rawUrl = String(this.user.photoURL).trim();
    if (!rawUrl) {
      return null;
    }

    const normalizedUrl = rawUrl.startsWith('//') ? `https:${rawUrl}` : rawUrl;

    if (normalizedUrl.includes('googleusercontent.com')) {
      return normalizedUrl.replace(/=s\d+-c$/, '=s256-c');
    }

    return normalizedUrl;
  }

  onProfilePhotoError(): void {
    this.isProfilePhotoBroken = true;
    this.cdr.detectChanges();
  }

  enableEditMode(): void {
    this.isEditMode = true;
    this.errorMessage = '';
    this.successMessage = '';
    this.cdr.detectChanges();
  }

  cancelEditMode(): void {
    this.errorMessage = '';
    this.successMessage = '';

    if (this.disableCancelButton) {
      this.cdr.detectChanges();
      return;
    }

    this.isEditMode = false;
    this.resetCompletionPasswordFields();
    this.cdr.detectChanges();

    this.loadUserData();
  }

  onFieldChange(): void {
    this.computeProfileCompletionState();
    this.cdr.detectChanges();
  }

  toggleBirthDatePicker(): void {
    if (this.birthDatePickerClosing) {
      return;
    }

    if (this.birthDatePickerCloseTimeout) {
      clearTimeout(this.birthDatePickerCloseTimeout);
      this.birthDatePickerCloseTimeout = null;
    }

    if (this.birthDatePickerOpen) {
      this.closeBirthDatePicker();
      return;
    }

    this.birthDatePickerMonth =
      this.parseInputDate(this.user?.data_nascita ?? '') ?? new Date();
    this.birthDatePickerMode = 'days';
    this.birthDatePickerDays = this.buildCalendarPickerDays(
      this.birthDatePickerMonth
    );
    this.updateBirthDatePickerDirection();
    this.birthDatePickerOpen = true;
    this.birthDatePickerClosing = false;
    this.cdr.detectChanges();
    this.ensureBirthDatePickerVisibleSoon();
  }

  closeBirthDatePicker(): void {
    if (!this.birthDatePickerOpen || this.birthDatePickerClosing) {
      return;
    }

    this.birthDatePickerClosing = true;
    this.cdr.detectChanges();

    this.birthDatePickerCloseTimeout = setTimeout(() => {
      this.birthDatePickerOpen = false;
      this.birthDatePickerClosing = false;
      this.birthDatePickerMode = 'days';
      this.birthDatePickerCloseTimeout = null;
      this.cdr.detectChanges();
    }, 220);
  }

  toggleBirthDatePickerYears(): void {
    this.birthDatePickerMode = this.birthDatePickerMode === 'years' ? 'days' : 'years';
    this.cdr.detectChanges();
  }

  previousBirthDatePickerMonth(): void {
    this.birthDatePickerMonth = new Date(
      this.birthDatePickerMonth.getFullYear(),
      this.birthDatePickerMonth.getMonth() - 1,
      1
    );
    this.birthDatePickerDays = this.buildCalendarPickerDays(
      this.birthDatePickerMonth
    );
    this.cdr.detectChanges();
  }

  nextBirthDatePickerMonth(): void {
    this.birthDatePickerMonth = new Date(
      this.birthDatePickerMonth.getFullYear(),
      this.birthDatePickerMonth.getMonth() + 1,
      1
    );
    this.birthDatePickerDays = this.buildCalendarPickerDays(
      this.birthDatePickerMonth
    );
    this.cdr.detectChanges();
  }

  selectBirthDatePickerDay(day: CalendarPickerDay): void {
    if (!this.user) {
      return;
    }

    this.user.data_nascita = this.formatDateForInput(day.date);
    this.syncBirthDatePickerMonth(day.date);
    this.onFieldChange();
    this.closeBirthDatePicker();
  }

  get sexDisplayValue(): string {
    if (this.user?.sesso === 'm') {
      return 'Maschio';
    }

    if (this.user?.sesso === 'f') {
      return 'Femmina';
    }

    return 'Seleziona';
  }

  toggleSexDropdown(): void {
    if (this.sexDropdownOpen) {
      this.closeSexDropdown();
      return;
    }

    this.clearSexDropdownTimer();
    this.sexDropdownClosing = false;
    this.sexDropdownOpen = true;
    this.cdr.detectChanges();
  }

  selectBirthDatePickerYear(year: number | string): void {
    const parsedYear = Number(year);

    if (!Number.isFinite(parsedYear)) {
      return;
    }

    this.birthDatePickerMonth = new Date(
      parsedYear,
      this.birthDatePickerMonth.getMonth(),
      1
    );
    this.birthDatePickerDays = this.buildCalendarPickerDays(
      this.birthDatePickerMonth
    );
    this.birthDatePickerMode = 'days';
    this.cdr.detectChanges();
  }

  closeSexDropdown(immediate = false): void {
    if (!this.sexDropdownOpen && !this.sexDropdownClosing) {
      return;
    }

    this.clearSexDropdownTimer();

    if (immediate) {
      this.sexDropdownOpen = false;
      this.sexDropdownClosing = false;
      return;
    }

    this.sexDropdownClosing = true;
    this.sexDropdownCloseTimeout = setTimeout(() => {
      this.sexDropdownOpen = false;
      this.sexDropdownClosing = false;
      this.sexDropdownCloseTimeout = null;
      this.cdr.detectChanges();
    }, 180);
  }

  selectSex(value: 'm' | 'f'): void {
    if (!this.user) {
      return;
    }

    this.user.sesso = value;
    this.onFieldChange();
    this.closeSexDropdown();
  }

  private clearSexDropdownTimer(): void {
    if (this.sexDropdownCloseTimeout) {
      clearTimeout(this.sexDropdownCloseTimeout);
      this.sexDropdownCloseTimeout = null;
    }
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (!target?.closest('.profile-birthdate-picker')) {
      this.closeBirthDatePicker();
    }

    if (!target?.closest('.profile-sex-picker')) {
      this.closeSexDropdown();
    }
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    if (!this.birthDatePickerOpen) {
      return;
    }

    this.updateBirthDatePickerDirection();
    this.cdr.detectChanges();
    this.ensureBirthDatePickerVisibleSoon();
  }

  onCompletionPasswordChange(): void {
    this.updateCompletionPasswordState();
    this.cdr.detectChanges();
  }

  onPhoneNumberChange(phoneNumber: string): void {
    if (!this.user) {
      return;
    }

    this.user.telefono = phoneNumber || '';
    this.onFieldChange();
  }

  onPhoneValidityChange(isValid: boolean): void {
    this.isPhoneValid = isValid;
    this.cdr.detectChanges();
  }

  onCountryChange(countryIso2: string): void {
    this.selectedCountryIso2 = countryIso2;
    this.cdr.detectChanges();
  }

  private updateCompletionPasswordState(): void {
    this.completionPasswordChecklist = [
      {
        label: 'Almeno 5 caratteri',
        valid: this.password.length >= 5
      },
      {
        label: 'Almeno una lettera maiuscola',
        valid: /[A-Z]/.test(this.password)
      },
      {
        label: 'Almeno un numero o carattere speciale',
        valid: /[0-9!@#$%^&*(),.?":{}|<>]/.test(this.password)
      },
      {
        label: 'Le password coincidono',
        valid:
          this.password.length > 0 &&
          this.confirmPassword.length > 0 &&
          this.password === this.confirmPassword
      }
    ];
    this.completionPasswordValid = this.completionPasswordChecklist.every(
      (item: PasswordChecklistItem) => item.valid
    );
  }

  getUserInitials(): string {
    if (!this.user) {
      return 'U';
    }

    const nome = this.user.nome ? this.user.nome.charAt(0) : 'U';
    const cognome = this.user.cognome ? this.user.cognome.charAt(0) : '';

    return `${nome}${cognome}`.toUpperCase();
  }

  getFullName(): string {
    if (!this.user) {
      return 'Utente';
    }

    const fullName = `${this.user.nome || ''} ${this.user.cognome || ''}`.trim();
    return fullName || 'Utente';
  }

  toggleChangePasswordPanel(): void {
    this.showChangePasswordPanel = !this.showChangePasswordPanel;

    if (this.showChangePasswordPanel) {
      this.changePasswordMessage = '';
      this.changePasswordError = '';
    } else {
      this.resetChangePasswordFields();
      this.changePasswordMessage = '';
      this.changePasswordError = '';
    }

    this.cdr.detectChanges();
  }

  onChangePasswordFieldChange(): void {
    if (this.changePasswordError) {
      const currentValidationError = this.getChangePasswordValidationError();

      if (currentValidationError) {
        this.changePasswordError = currentValidationError;
      } else {
        this.changePasswordError = '';
        this.changePasswordErrorShake = false;
      }
    }

    this.cdr.detectChanges();
  }

  private getChangePasswordValidationError(): string {
    if (!this.currentPasswordChange.trim()) {
      return 'Inserisci la password attuale.';
    }

    if (!this.newPasswordChange.trim()) {
      return 'Inserisci una nuova password.';
    }

    if (this.newPasswordChange.trim().length < 6) {
      return 'La nuova password deve contenere almeno 6 caratteri.';
    }

    if (!this.confirmNewPasswordChange.trim()) {
      return 'Conferma la nuova password.';
    }

    if (this.newPasswordChange !== this.confirmNewPasswordChange) {
      return 'Le nuove password non coincidono.';
    }

    if (this.currentPasswordChange === this.newPasswordChange) {
      return 'La nuova password deve essere diversa da quella attuale.';
    }

    return '';
  }

  private showChangePasswordError(message: string): void {
    this.changePasswordError = message;
    this.changePasswordErrorShake = false;
    this.cdr.detectChanges();

    setTimeout(() => {
      this.changePasswordErrorShake = true;
      this.cdr.detectChanges();
    }, 10);
  }

  changePasswordAction(): void {
    if (this.isChangingPassword) {
      return;
    }

    this.changePasswordMessage = '';
    this.changePasswordError = '';
    this.changePasswordErrorShake = false;

    if (!this.currentPasswordChange.trim()) {
      this.showChangePasswordError('Inserisci la password attuale.');
      return;
    }

    if (!this.newPasswordChange.trim()) {
      this.showChangePasswordError('Inserisci una nuova password.');
      return;
    }

    if (this.newPasswordChange.trim().length < 6) {
      this.showChangePasswordError(
        'La nuova password deve contenere almeno 6 caratteri.'
      );
      return;
    }

    if (!this.confirmNewPasswordChange.trim()) {
      this.showChangePasswordError('Conferma la nuova password.');
      return;
    }

    if (this.newPasswordChange !== this.confirmNewPasswordChange) {
      this.showChangePasswordError('Le nuove password non coincidono.');
      return;
    }

    if (this.currentPasswordChange === this.newPasswordChange) {
      this.showChangePasswordError(
        'La nuova password deve essere diversa da quella attuale.'
      );
      return;
    }

    this.isChangingPassword = true;
    this.cdr.detectChanges();

    this.http.post(
      `${this.api}/change-password`,
      {
        currentPassword: this.currentPasswordChange.trim(),
        newPassword: this.newPasswordChange.trim(),
        confirmNewPassword: this.confirmNewPasswordChange.trim()
      }
    ).subscribe({
      next: (res: any) => {
        this.isChangingPassword = false;
        this.changePasswordMessage =
          res?.message || 'Password aggiornata con successo.';
        this.changePasswordError = '';
        this.changePasswordErrorShake = false;

        this.resetChangePasswordFields();
        this.showChangePasswordPanel = false;
        this.clearChangePasswordMessageLater();

        if (this.user) {
          this.user.hasPassword = true;
          this.user.mustChangePassword = false;
        }

        this.computeProfileCompletionState();
        this.cdr.detectChanges();
        this.loadUserData();
      },
      error: (err) => {
        console.error('Errore modifica password:', err);
        this.isChangingPassword = false;
        this.changePasswordMessage = '';
        this.showChangePasswordError(
          err?.error?.message || 'Impossibile aggiornare la password.'
        );
      }
    });
  }

  saveUserData(): void {
    if (!this.user || this.isSaving) {
      return;
    }

    const wasPasswordRequired = this.passwordRequired;

    this.errorMessage = '';
    this.successMessage = '';

    const nome = String(this.user.nome).trim();
    const cognome = String(this.user.cognome).trim();
    const telefono = String(this.user.telefono).trim();
    const dataNascita = String(this.user.data_nascita).trim();
    const sesso = String(this.user.sesso ?? '').trim();

    if (!nome || !cognome || !telefono || !dataNascita || !sesso) {
      this.errorMessage = 'Compila tutti i campi obbligatori.';
      this.cdr.detectChanges();
      return;
    }

    if (!this.isPhoneValid) {
      this.errorMessage = 'Inserisci un numero di telefono valido.';
      this.cdr.detectChanges();
      return;
    }

    if (this.passwordRequired) {
      if (!this.password.trim()) {
        this.errorMessage = 'Inserisci una password.';
        this.cdr.detectChanges();
        return;
      }

      if (!this.completionPasswordValid) {
        this.errorMessage =
          'La password deve rispettare tutti i requisiti e coincidere con la conferma.';
        this.cdr.detectChanges();
        return;
      }
    }

    this.isSaving = true;
    this.cdr.detectChanges();

    const payload: {
      nome: string;
      cognome: string;
      telefono: string;
      data_nascita: string;
      sesso: 'm' | 'f';
      password?: string;
    } = {
      nome,
      cognome,
      telefono,
      data_nascita: dataNascita,
      sesso: sesso as 'm' | 'f'
    };

    if (this.passwordRequired) {
      payload.password = this.password.trim();
    }

    this.http.put(`${this.api}/me`, payload).subscribe({
      next: (res: any) => {
        this.isSaving = false;
        this.successMessage = wasPasswordRequired
          ? 'Informazioni salvate correttamente. Profilo completato con successo.'
          : (res?.message || 'Informazioni salvate correttamente.');
        this.errorMessage = '';
        this.isEditMode = false;

        if (this.passwordRequired && this.user) {
          this.user.hasPassword = true;
          this.user.mustChangePassword = false;
        }

        this.resetCompletionPasswordFields();
        this.computeProfileCompletionState();
        this.cdr.detectChanges();

        this.loadUserData();
      },
      error: (err) => {
        console.error('Errore aggiornamento profilo:', err);
        this.isSaving = false;
        this.errorMessage =
          err?.error?.message || 'Errore durante il salvataggio dei dati.';
        this.cdr.detectChanges();
      }
    });
  }

  logout(): void {
    this.auth.logout();
  }

  private syncBirthDatePickerMonth(baseDate: Date): void {
    this.birthDatePickerMonth = new Date(
      baseDate.getFullYear(),
      baseDate.getMonth(),
      1
    );
    this.birthDatePickerDays = this.buildCalendarPickerDays(
      this.birthDatePickerMonth
    );
  }

  private updateBirthDatePickerDirection(): void {
    if (typeof window === 'undefined') {
      this.birthDatePickerOpenUpward = true;
      return;
    }

    const pickerTrigger = document.querySelector(
      '.profile-birthdate-picker .profile-date-trigger'
    ) as HTMLElement | null;

    if (!pickerTrigger) {
      this.birthDatePickerOpenUpward = true;
      return;
    }

    const triggerRect = pickerTrigger.getBoundingClientRect();
    const estimatedPanelHeight = 360;
    const viewportPadding = 20;
    const spaceAbove = triggerRect.top - viewportPadding;
    const spaceBelow = window.innerHeight - triggerRect.bottom - viewportPadding;

    if (spaceBelow >= estimatedPanelHeight) {
      this.birthDatePickerOpenUpward = false;
      return;
    }

    if (spaceAbove >= estimatedPanelHeight) {
      this.birthDatePickerOpenUpward = true;
      return;
    }

    this.birthDatePickerOpenUpward = spaceAbove > spaceBelow;
  }

  private ensureBirthDatePickerVisibleSoon(): void {
    if (typeof window === 'undefined') {
      return;
    }

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        this.ensureBirthDatePickerFullyVisible();
      });
    });
  }

  private ensureBirthDatePickerFullyVisible(): void {
    const panel = document.querySelector(
      '.profile-birthdate-picker .profile-date-picker-panel'
    ) as HTMLElement | null;

    if (!panel) {
      return;
    }

    const viewportPadding = 16;
    const panelRect = panel.getBoundingClientRect();
    const overflowTop = viewportPadding - panelRect.top;
    const overflowBottom = panelRect.bottom - (window.innerHeight - viewportPadding);

    if (overflowTop > 0) {
      window.scrollBy({
        top: -overflowTop,
        behavior: 'smooth'
      });
      return;
    }

    if (overflowBottom > 0) {
      window.scrollBy({
        top: overflowBottom,
        behavior: 'smooth'
      });
    }
  }

  private buildCalendarPickerDays(monthDate: Date): CalendarPickerDay[] {
    const monthStart = new Date(
      monthDate.getFullYear(),
      monthDate.getMonth(),
      1
    );
    const gridStart = new Date(monthStart);
    const startOffset = (monthStart.getDay() + 6) % 7;
    gridStart.setDate(monthStart.getDate() - startOffset);

    const today = new Date();
    const selectedDate = this.parseInputDate(this.user?.data_nascita ?? '');

    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(gridStart);
      date.setDate(gridStart.getDate() + index);

      return {
        date,
        label: date.getDate(),
        currentMonth: date.getMonth() === monthDate.getMonth(),
        isToday: date.toDateString() === today.toDateString(),
        isSelected: !!selectedDate && date.toDateString() === selectedDate.toDateString()
      };
    });
  }

  private buildBirthDatePickerYears(): number[] {
    const currentYear = new Date().getFullYear();
    const years: number[] = [];

    for (let year = currentYear; year >= 1900; year--) {
      years.push(year);
    }

    return years;
  }

  private parseInputDate(value: string): Date | null {
    const normalizedValue = String(value ?? '').trim();
    if (!normalizedValue) {
      return null;
    }

    const parts = normalizedValue.split('-').map((part) => Number(part));
    if (parts.length !== 3 || parts.some((part) => Number.isNaN(part))) {
      return null;
    }

    const [year, month, day] = parts;
    const parsedDate = new Date(year, month - 1, day);

    if (
      parsedDate.getFullYear() !== year ||
      parsedDate.getMonth() !== month - 1 ||
      parsedDate.getDate() !== day
    ) {
      return null;
    }

    return parsedDate;
  }

  private formatDateForInput(date: Date): string {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  formatDate(date: string | null): string {
    if (!date) {
      return '-';
    }

    const d = new Date(date);
    if (isNaN(d.getTime())) {
      return date;
    }

    return d.toLocaleDateString('it-IT');
  }
}

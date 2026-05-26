import { Component, HostListener, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth';
import { ChangeDetectorRef } from '@angular/core';
import { IntlTelInputComponent } from 'intl-tel-input/angularWithUtils';

interface CalendarPickerDay {
  date: Date;
  label: number;
  currentMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
}

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, IntlTelInputComponent],
  templateUrl: './register.component.html',
  styleUrl: './register.component.css'
})
export class RegisterComponent implements OnInit {

  userData = {
    nome: '',
    cognome: '',
    email: '',
    password: '',
    telefono: '',
    data_nascita: '',
    sesso: '' as '' | 'm' | 'f',
    ruolo: 'cliente'
  };

  confirmPassword = '';
  showPassword = false;
  showConfirmPassword = false;
  isLoading = false;
  isSuccess = false;
  isPhoneValid = false;
  isManagementRegistration = false;
  alertMessage: string | null = null;
  alertType: 'success' | 'error' | 'warning' = 'error';
  birthDatePickerOpen = false;
  birthDatePickerClosing = false;
  birthDatePickerMode: 'days' | 'years' = 'days';
  birthDatePickerMonth = new Date();
  birthDatePickerDays: CalendarPickerDay[] = [];
  birthDatePickerYears = this.buildBirthDatePickerYears();
  readonly calendarPickerWeekdays = ['Lu', 'Ma', 'Me', 'Gi', 'Ve', 'Sa', 'Do'];
  readonly calendarPickerMonthFormatter = new Intl.DateTimeFormat('it-IT', { month: 'long' });
  private birthDatePickerCloseTimeout: ReturnType<typeof setTimeout> | null = null;
  sexDropdownOpen = false;
  sexDropdownClosing = false;
  private sexDropdownCloseTimeout: ReturnType<typeof setTimeout> | null = null;

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

  constructor(public auth: AuthService, private router: Router, private route: ActivatedRoute,
    private cdr: ChangeDetectorRef) { }

  ngOnInit(): void {
    this.isManagementRegistration =
      this.route.snapshot.queryParamMap.get('from') === 'management' || !!this.auth.getToken();
    this.syncBirthDatePickerMonth(this.parseInputDate(this.userData.data_nascita) ?? new Date());
  }


  isPasswordMatch(): boolean {
    return this.userData.password === this.confirmPassword && this.confirmPassword.length > 0;
  }

  getPasswordErrors(): string[] {
    const errors: string[] = [];

    if (!this.userData.password || this.userData.password.length < 5) {
      errors.push('La password deve avere almeno 5 caratteri');
    }

    if (this.confirmPassword && this.userData.password !== this.confirmPassword) {
      errors.push('Le password non coincidono');
    }

    return errors;
  }

  getPasswordChecklist() {
    return [
      {
        label: 'Almeno 5 caratteri',
        valid: this.userData.password.length >= 5
      },
      {
        label: 'Almeno una lettera maiuscola',
        valid: /[A-Z]/.test(this.userData.password)
      },
      {
        label: 'Almeno un numero o carattere speciale',
        valid: /[0-9!@#$%^&*(),.?":{}|<>]/.test(this.userData.password)
      },
      {
        label: 'Le password coincidono',
        valid:
          this.userData.password.length > 0 &&
          this.confirmPassword.length > 0 &&
          this.userData.password === this.confirmPassword
      }
    ];
  }

  isPasswordValid(): boolean {
    return this.getPasswordChecklist().every(item => item.valid);
  }

  isValidPhone(): boolean {
    return this.isPhoneValid && this.userData.telefono.trim() !== '';
  }

  onPhoneNumberChange(phoneNumber: string): void {
    this.userData.telefono = phoneNumber || '';
  }

  onPhoneValidityChange(isValid: boolean): void {
    this.isPhoneValid = isValid;
  }

  isAdult(): boolean {
    if (!this.userData.data_nascita) return false;

    const today = new Date();
    const birth = new Date(this.userData.data_nascita);

    let age = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();

    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) {
      age--;
    }

    return age >= 18;
  }

  isFormValid(): boolean {
    return (
      this.userData.nome.trim() !== '' &&
      this.userData.cognome.trim() !== '' &&
      this.userData.email.trim() !== '' &&

      this.isPasswordValid() &&

      this.isValidPhone() &&
      this.userData.sesso !== '' &&
      this.isAdult()
    );
  }

  register() {
    if (!this.isFormValid()) return;

    this.isLoading = true;
    this.isSuccess = false; 
    this.alertMessage = '';  
    this.alertType = 'success';

    this.auth.register({
      ...this.userData,
      sesso: this.userData.sesso as 'm' | 'f'
    }).subscribe({
      next: () => {
        this.isLoading = false;
        this.isSuccess = true;
        this.alertMessage = 'Registrazione completata e accesso effettuato. Stai per essere reindirizzato alla home...';
        this.alertType = 'success';

        this.cdr.detectChanges(); 
        setTimeout(() => {
          this.router.navigate(['/home']);
        }, 1500);
      },
      error: (err) => {
        this.isLoading = false;
        this.isSuccess = false;
        this.alertMessage = err.error?.message || 'Errore nella registrazione';
        this.alertType = 'error';

        this.cdr.detectChanges(); 
        setTimeout(() => {
          this.alertMessage = null;
          this.cdr.detectChanges();
        }, 5000);
      }
    });
  }

  goBack() {
    if (this.isManagementRegistration) {
      this.router.navigate(['/account']);
      return;
    }

    this.router.navigate(['/login']);
  }

  get birthDateDisplayValue(): string {
    const date = this.parseInputDate(this.userData.data_nascita);

    if (!date) {
      return 'gg/mm/aaaa';
    }

    return new Intl.DateTimeFormat('it-IT', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    }).format(date);
  }

  get birthDatePickerMonthLabel(): string {
    const label = this.calendarPickerMonthFormatter.format(this.birthDatePickerMonth);
    const month = label.charAt(0).toUpperCase() + label.slice(1);
    return `${month} ${this.birthDatePickerYear}`;
  }

  get birthDatePickerYear(): number {
    return this.birthDatePickerMonth.getFullYear();
  }

  get sexDisplayValue(): string {
    if (this.userData.sesso === 'm') {
      return 'Maschio';
    }

    if (this.userData.sesso === 'f') {
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
    this.userData.sesso = value;
    this.closeSexDropdown();
  }

  toggleBirthDatePicker(): void {
    if (this.birthDatePickerOpen) {
      this.closeBirthDatePicker();
      return;
    }

    this.clearBirthDatePickerTimer();
    this.birthDatePickerClosing = false;
    this.birthDatePickerOpen = true;
    this.birthDatePickerMode = 'days';
    this.syncBirthDatePickerMonth(this.parseInputDate(this.userData.data_nascita) ?? new Date());
  }

  closeBirthDatePicker(immediate = false): void {
    if (!this.birthDatePickerOpen && !this.birthDatePickerClosing) {
      return;
    }

    this.clearBirthDatePickerTimer();

    if (immediate) {
      this.birthDatePickerOpen = false;
      this.birthDatePickerClosing = false;
      this.birthDatePickerMode = 'days';
      return;
    }

    this.birthDatePickerClosing = true;
    this.birthDatePickerCloseTimeout = setTimeout(() => {
      this.birthDatePickerOpen = false;
      this.birthDatePickerClosing = false;
      this.birthDatePickerMode = 'days';
      this.birthDatePickerCloseTimeout = null;
      this.cdr.detectChanges();
    }, 180);
  }

  toggleBirthDatePickerYears(): void {
    this.birthDatePickerMode = this.birthDatePickerMode === 'years' ? 'days' : 'years';
  }

  previousBirthDatePickerMonth(): void {
    const next = new Date(this.birthDatePickerMonth);
    next.setMonth(next.getMonth() - 1, 1);
    this.syncBirthDatePickerMonth(next);
  }

  nextBirthDatePickerMonth(): void {
    const next = new Date(this.birthDatePickerMonth);
    next.setMonth(next.getMonth() + 1, 1);
    this.syncBirthDatePickerMonth(next);
  }

  selectBirthDatePickerYear(year: number | string): void {
    const parsedYear = Number(year);

    if (!Number.isFinite(parsedYear)) {
      return;
    }

    const next = new Date(this.birthDatePickerMonth);
    next.setFullYear(parsedYear, next.getMonth(), 1);
    this.syncBirthDatePickerMonth(next);
    this.birthDatePickerMode = 'days';
  }

  selectBirthDatePickerDay(day: CalendarPickerDay): void {
    this.userData.data_nascita = this.formatDateForInput(day.date);
    this.syncBirthDatePickerMonth(day.date);
    this.closeBirthDatePicker();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;

    if (!target?.closest('.birthdate-picker')) {
      this.closeBirthDatePicker();
    }

    if (!target?.closest('.register-sex-picker')) {
      this.closeSexDropdown();
    }
  }

  private buildBirthDatePickerYears(): number[] {
    const currentYear = new Date().getFullYear();
    const years: number[] = [];

    for (let year = currentYear; year >= 1900; year--) {
      years.push(year);
    }

    return years;
  }

  private clearBirthDatePickerTimer(): void {
    if (this.birthDatePickerCloseTimeout) {
      clearTimeout(this.birthDatePickerCloseTimeout);
      this.birthDatePickerCloseTimeout = null;
    }
  }

  private clearSexDropdownTimer(): void {
    if (this.sexDropdownCloseTimeout) {
      clearTimeout(this.sexDropdownCloseTimeout);
      this.sexDropdownCloseTimeout = null;
    }
  }

  private syncBirthDatePickerMonth(baseDate: Date): void {
    this.birthDatePickerMonth = new Date(baseDate.getFullYear(), baseDate.getMonth(), 1);
    this.birthDatePickerDays = this.buildCalendarPickerDays(this.birthDatePickerMonth);
  }

  private buildCalendarPickerDays(monthDate: Date): CalendarPickerDay[] {
    const firstDayOfMonth = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
    const start = new Date(firstDayOfMonth);
    const firstWeekday = (firstDayOfMonth.getDay() + 6) % 7;
    start.setDate(start.getDate() - firstWeekday);

    const selectedValue = this.userData.data_nascita;
    const todayValue = this.formatDateForInput(new Date());
    const days: CalendarPickerDay[] = [];

    for (let i = 0; i < 42; i++) {
      const current = new Date(start);
      current.setDate(start.getDate() + i);
      const currentValue = this.formatDateForInput(current);

      days.push({
        date: current,
        label: current.getDate(),
        currentMonth: current.getMonth() === monthDate.getMonth(),
        isToday: currentValue === todayValue,
        isSelected: currentValue === selectedValue
      });
    }

    return days;
  }

  private parseInputDate(value: string): Date | null {
    if (!value) {
      return null;
    }

    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private formatDateForInput(date: Date): string {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  getPasswordStatus(): { valid: boolean; message: string } {

    if (!this.userData.password && !this.confirmPassword) {
      return { valid: false, message: '' };
    }

    if (this.userData.password.length < 6) {
      return { valid: false, message: 'La password deve avere almeno 6 caratteri' };
    }

    if (this.confirmPassword.length === 0) {
      return { valid: false, message: 'Conferma la password' };
    }

    if (this.userData.password !== this.confirmPassword) {
      return { valid: false, message: 'Le password non coincidono' };
    }

    return { valid: true, message: 'Password corretta ✓' };
  }
}

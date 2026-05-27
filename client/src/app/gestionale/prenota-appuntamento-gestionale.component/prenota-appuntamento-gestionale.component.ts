import { ChangeDetectorRef, Component, HostListener, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule, ActivatedRoute } from '@angular/router';
import { NavbarComponent } from '../../features/navbar.component/navbar.component';
import { UtentiService } from '../../services/utentiService';
import { AppuntamentoService } from '../../services/appuntamentoService';
import { Appuntamento } from '../../models/appuntamento.model';
import { Utente } from '../../models/utente.model';
import { Servizio } from '../../models/servizio.model';
import { AuthService } from '../../services/auth';
import { ServiziService } from '../../services/servizio';
import { forkJoin } from 'rxjs';

interface OpeningInterval {
  start: string;
  end: string;
}

interface DailySchedule {
  name: string;
  intervals: OpeningInterval[];
}

@Component({
  selector: 'app-prenota-appuntamento-gestionale',
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    NavbarComponent
  ],
  templateUrl: './prenota-appuntamento-gestionale.component.html',
  styleUrls: ['./prenota-appuntamento-gestionale.component.css'],
})
export class PrenotaAppuntamentoGestionaleComponent implements OnInit {
  operatori: Utente[] = [];
  clienti: Utente[] = [];
  servizi: Servizio[] = [];
  appuntamentiOperatore: Appuntamento[] = [];
  minDateTime = '';
  availabilityMessage = '';
  bookingAlertTitle = '';
  bookingAlertMessage = '';
  bookingAlertType: 'success' | 'error' | null = null;
  isLoadingData = true;
  isSubmitting = false;
  serviceSearchTerm = '';
  clienteSearchTerm = '';
  operatoreSearchTerm = '';
  isOperatoreOpen = false;
  isServizioOpen = false;
  isClienteOpen = false;
  isManagementBooking = true; // Always true for management booking component!
  returnRoute = '/gestionale/appuntamenti';
  private selectedServizioFromQuery: number | null = null;
  private hasLoadedManagementClienti = false;
  private readonly minimumAppointmentDurationMinutes = 30;
  private readonly openingSchedule: Record<number, DailySchedule> = {
    0: { name: 'Domenica', intervals: [] },
    1: { name: 'Lunedi', intervals: [] },
    2: { name: 'Martedi', intervals: [{ start: '08:00', end: '12:30' }, { start: '14:00', end: '19:30' }] },
    3: { name: 'Mercoledi', intervals: [{ start: '13:00', end: '21:30' }] },
    4: { name: 'Giovedi', intervals: [{ start: '08:00', end: '12:30' }, { start: '14:00', end: '19:30' }] },
    5: { name: 'Venerdi', intervals: [{ start: '07:00', end: '19:30' }] },
    6: { name: 'Sabato', intervals: [{ start: '07:00', end: '18:00' }] }
  };

  constructor(
    private utentiService: UtentiService,
    private appuntamentoService: AppuntamentoService,
    private router: Router,
    private route: ActivatedRoute,
    private authService: AuthService,
    private cdr: ChangeDetectorRef,
    private servizioService: ServiziService
  ) { }

  form = {
    idCliente: null as number | null,
    idOperatore: null as number | null,
    idServizio: null as number | null,
    dataOraInizio: '',
    dataOraFine: '',
    prezzoPersonalizzato: null as number | null,
    durataPersonalizzata: null as number | null
  };

  // Custom Date Picker properties
  isCustomDatePickerOpen = false;
  customDatePickerNavDate = new Date();
  customDatePickerDays: any[] = [];
  customDatePickerMonthLabel = '';
  customDatePickerWeekdays = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];

  // Time selection state
  customDatePickerHours: string[] = [];
  customDatePickerMinutes: string[] = ['00', '15', '30', '45'];
  selectedHour = '14';
  selectedMinute = '00';

  ngOnInit(): void {
    this.minDateTime = this.getCurrentDateTimeLocal();

    if (!this.authService.isLoggedIn()) {
      this.showBookingAlert(
        'Effettua il login prima di prenotare un appuntamento.',
        'error',
        'Login richiesto'
      );
    }

    this.route.queryParamMap.subscribe((params) => {
      const selectedDate = params.get('data');
      const selectedOperator = params.get('operatore');
      const selectedServizio = params.get('servizio');
      const selectedCliente = params.get('cliente');
      this.isManagementBooking = true; // Always true for this component!
      this.returnRoute = params.get('ritorno') || '/gestionale/appuntamenti';

      this.loadManagementClienti();

      if (selectedDate) {
        this.form.dataOraInizio = this.toDateTimeLocalValue(selectedDate);
      }

      if (selectedServizio) {
        const parsedServizio = Number(selectedServizio);
        this.selectedServizioFromQuery = Number.isFinite(parsedServizio) ? parsedServizio : null;
      } else {
        this.selectedServizioFromQuery = null;
      }

      if (selectedOperator) {
        const parsedOperatore = Number(selectedOperator);
        this.form.idOperatore = Number.isFinite(parsedOperatore) ? parsedOperatore : null;
      }

      if (selectedCliente) {
        const parsedCliente = Number(selectedCliente);
        this.form.idCliente = Number.isFinite(parsedCliente) ? parsedCliente : null;
      }

      if (this.operatori.length > 0) {
        this.loadServiziDisponibili();
        this.cdr.detectChanges();
      }
    });

    this.utentiService.getOperatori().subscribe({
      next: (operatori) => {
        this.operatori = operatori;
        if (!this.form.idOperatore && this.operatori.length > 0) {
          this.form.idOperatore = this.operatori[0].idUtente;
        }

        this.loadServiziDisponibili();
        this.cdr.detectChanges();
      },
      error: (err) => console.error(err)
    });

    this.loadManagementClienti();
    this.initCustomDatePicker();
  }

  onOperatoreChange(): void {
    this.isOperatoreOpen = false;
    this.resetOperatoreSearchTerm();
    this.loadServiziDisponibili();
  }

  toggleOperatoreDropdown(): void {
    if (this.isLoadingData || this.isSubmitting) {
      return;
    }

    this.isOperatoreOpen = !this.isOperatoreOpen;
    if (this.isOperatoreOpen) {
      this.isServizioOpen = false;
      this.isClienteOpen = false;
      this.resetServiceSearchTerm();
      this.resetClienteSearchTerm();
      return;
    }

    this.resetOperatoreSearchTerm();
  }

  toggleClienteDropdown(): void {
    if (this.isLoadingData || this.isSubmitting) {
      return;
    }

    this.isClienteOpen = !this.isClienteOpen;
    if (this.isClienteOpen) {
      this.isOperatoreOpen = false;
      this.isServizioOpen = false;
      this.resetOperatoreSearchTerm();
      this.resetServiceSearchTerm();
      return;
    }

    this.resetClienteSearchTerm();
  }

  toggleServizioDropdown(): void {
    if (this.isLoadingData || this.isSubmitting || this.servizi.length === 0) {
      return;
    }

    this.isServizioOpen = !this.isServizioOpen;
    if (this.isServizioOpen) {
      this.isOperatoreOpen = false;
      this.isClienteOpen = false;
      this.resetOperatoreSearchTerm();
      this.resetClienteSearchTerm();
      return;
    }

    this.resetServiceSearchTerm();
  }

  onServizioTriggerKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.isServizioOpen = false;
      this.resetServiceSearchTerm();
      return;
    }

    if (event.key === 'ArrowDown' && !this.isServizioOpen) {
      event.preventDefault();
      this.isServizioOpen = true;
      this.isOperatoreOpen = false;
      this.isClienteOpen = false;
      this.resetOperatoreSearchTerm();
      this.resetClienteSearchTerm();
      return;
    }

    if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }

    event.preventDefault();
    this.isServizioOpen = true;
    this.isOperatoreOpen = false;
    this.isClienteOpen = false;
    this.resetOperatoreSearchTerm();
    this.resetClienteSearchTerm();
    const nextSearchTerm = this.normalizeSearchTerm(event.key);

    if (!nextSearchTerm) {
      return;
    }

    const hasMatchingServices = this.servizi.some((servizio) => this.doesServizioMatchSearch(servizio, nextSearchTerm));

    if (hasMatchingServices) {
      this.serviceSearchTerm = nextSearchTerm;
    }
  }

  selectOperatore(idOperatore: number): void {
    if (this.isLoadingData || this.isSubmitting) {
      return;
    }

    this.form.idOperatore = idOperatore;
    this.onOperatoreChange();
  }

  selectCliente(idCliente: number): void {
    if (this.isLoadingData || this.isSubmitting) {
      return;
    }

    this.form.idCliente = idCliente;
    this.isClienteOpen = false;
    this.resetClienteSearchTerm();
  }

  selectServizio(idServizio: number): void {
    if (this.isLoadingData || this.isSubmitting) {
      return;
    }

    const servizio = this.servizi.find((item) => item.idServizio === idServizio);

    if (!servizio || this.isServiceDisabled(servizio)) {
      return;
    }

    this.form.idServizio = idServizio;
    this.syncCustomServiceValues(servizio);
    this.isServizioOpen = false;
    this.resetServiceSearchTerm();
    this.onServizioChange();
  }

  getSelectedOperatoreLabel(): string {
    const operatore = this.operatori.find((item) => item.idUtente === this.form.idOperatore);
    return operatore ? `${operatore.nome} ${operatore.cognome}` : 'Seleziona operatore';
  }

  getSelectedClienteLabel(): string {
    const cliente = this.clienti.find((item) => item.idUtente === this.form.idCliente);
    return cliente ? `${cliente.nome} ${cliente.cognome}` : 'Seleziona cliente';
  }

  getSelectedServizioLabel(): string {
    const servizio = this.servizi.find((item) => item.idServizio === this.form.idServizio);
    return servizio ? `${servizio.nome} | ${servizio.prezzo} €` : 'Seleziona servizio';
  }

  isServiceDisabled(servizio: Servizio): boolean {
    return false;
  }

  getSelectedServizioNome(): string {
    const servizio = this.servizi.find((s) => s.idServizio === this.form.idServizio);
    return servizio?.nome ?? '';
  }

  get filteredServizi(): Servizio[] {
    const search = this.normalizeSearchTerm(this.serviceSearchTerm);

    if (!search) {
      return this.servizi;
    }

    return this.servizi.filter((servizio) => this.doesServizioMatchSearch(servizio, search));
  }

  get filteredOperatori(): Utente[] {
    const search = this.normalizeSearchTerm(this.operatoreSearchTerm);

    if (!search) {
      return this.operatori;
    }

    return this.operatori.filter((operatore) => {
      const nomeCompleto = this.normalizeSearchTerm(`${operatore.nome} ${operatore.cognome}`);
      const cognomeNome = this.normalizeSearchTerm(`${operatore.cognome} ${operatore.nome}`);
      const email = this.normalizeSearchTerm(operatore.email ?? '');

      return nomeCompleto.includes(search) ||
        cognomeNome.includes(search) ||
        email.includes(search);
    });
  }

  get filteredClienti(): Utente[] {
    const search = this.normalizeSearchTerm(this.clienteSearchTerm);

    if (!search) {
      return this.clienti;
    }

    return this.clienti.filter((cliente) => {
      const nomeCompleto = this.normalizeSearchTerm(`${cliente.nome} ${cliente.cognome}`);
      const cognomeNome = this.normalizeSearchTerm(`${cliente.cognome} ${cliente.nome}`);
      const email = this.normalizeSearchTerm(cliente.email ?? '');

      return nomeCompleto.includes(search) ||
        cognomeNome.includes(search) ||
        email.includes(search);
    });
  }

  get servizioTriggerLabel(): string {
    return this.getSelectedServizioLabel();
  }

  get summaryStartDateLabel(): string {
    const value = this.form.dataOraInizio;
    if (!value) {
      return 'Seleziona dalla fascia scelta';
    }

    const [datePart] = value.split('T');
    return datePart || 'Seleziona dalla fascia scelta';
  }

  get summaryStartTimeLabel(): string {
    const value = this.form.dataOraInizio;
    if (!value) {
      return '';
    }

    const [, timePart] = value.split('T');
    return (timePart || '').slice(0, 5);
  }

  get summaryEndTimeLabel(): string {
    return this.form.dataOraFine ? this.form.dataOraFine.slice(0, 5) : '';
  }

  get startDateTimeDisplayLabel(): string {
    if (!this.form.dataOraInizio) {
      return 'Non disponibile';
    }

    const date = new Date(this.form.dataOraInizio);

    if (Number.isNaN(date.getTime())) {
      return this.form.dataOraInizio;
    }

    return new Intl.DateTimeFormat('it-IT', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  }

  get endTimeDisplayLabel(): string {
    return this.summaryEndTimeLabel || 'Calcolata automaticamente';
  }

  get selectedServiceBasePriceLabel(): string {
    const servizio = this.getSelectedService();
    return servizio ? `${Number(servizio.prezzo || 0).toFixed(2)} EUR` : '-';
  }

  get selectedServiceBaseDurationLabel(): string {
    const servizio = this.getSelectedService();
    return servizio?.durata ? `${servizio.durata} min` : '-';
  }

  get isLoginAlert(): boolean {
    return this.bookingAlertTitle === 'Login richiesto';
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;

    if (!target.closest('.booking-dropdown') && !target.closest('.booking-custom-datepicker-trigger') && !target.closest('.booking-custom-datepicker-panel')) {
      this.isOperatoreOpen = false;
      this.isServizioOpen = false;
      this.isClienteOpen = false;
      this.isCustomDatePickerOpen = false;
      this.resetServiceSearchTerm();
      this.resetClienteSearchTerm();
      this.resetOperatoreSearchTerm();
    }
  }

  // --- Custom Date Picker Methods ---
  initCustomDatePicker(): void {
    this.customDatePickerHours = [];
    for (let h = 7; h <= 21; h++) {
      this.customDatePickerHours.push(h.toString().padStart(2, '0'));
    }

    if (this.form.dataOraInizio) {
      const date = new Date(this.form.dataOraInizio);
      if (!Number.isNaN(date.getTime())) {
        this.customDatePickerNavDate = new Date(date);
        this.selectedHour = date.getHours().toString().padStart(2, '0');
        this.selectedMinute = date.getMinutes().toString().padStart(2, '0');
      }
    }

    this.generateCustomDatePickerDays();
  }

  generateCustomDatePickerDays(): void {
    const year = this.customDatePickerNavDate.getFullYear();
    const month = this.customDatePickerNavDate.getMonth();

    const monthNames = [
      'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
      'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'
    ];
    this.customDatePickerMonthLabel = `${monthNames[month]} ${year}`;

    const days: any[] = [];
    const firstDay = new Date(year, month, 1);
    let startDayOfWeek = firstDay.getDay() - 1;
    if (startDayOfWeek < 0) {
      startDayOfWeek = 6;
    }

    const prevMonthEnd = new Date(year, month, 0);
    const prevMonthDaysCount = prevMonthEnd.getDate();
    for (let i = startDayOfWeek - 1; i >= 0; i--) {
      const d = new Date(year, month - 1, prevMonthDaysCount - i);
      days.push(this.createCustomDatePickerDayObj(d, false));
    }

    const currentMonthEnd = new Date(year, month + 1, 0);
    const currentMonthDaysCount = currentMonthEnd.getDate();
    for (let i = 1; i <= currentMonthDaysCount; i++) {
      const d = new Date(year, month, i);
      days.push(this.createCustomDatePickerDayObj(d, true));
    }

    const remaining = 42 - days.length;
    for (let i = 1; i <= remaining; i++) {
      const d = new Date(year, month + 1, i);
      days.push(this.createCustomDatePickerDayObj(d, false));
    }

    this.customDatePickerDays = days;
  }

  createCustomDatePickerDayObj(date: Date, currentMonth: boolean): any {
    const today = new Date();
    const isToday =
      date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear();

    let isSelected = false;
    if (this.form.dataOraInizio) {
      const currentSel = new Date(this.form.dataOraInizio);
      isSelected =
        date.getDate() === currentSel.getDate() &&
        date.getMonth() === currentSel.getMonth() &&
        date.getFullYear() === currentSel.getFullYear();
    }

    const compareToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const compareDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const isSelectable = compareDate >= compareToday;

    return {
      date,
      label: date.getDate(),
      currentMonth,
      isToday,
      isSelected,
      isSelectable
    };
  }

  toggleCustomDatePicker(): void {
    if (this.isLoadingData || this.isSubmitting) {
      return;
    }
    this.isCustomDatePickerOpen = !this.isCustomDatePickerOpen;
    if (this.isCustomDatePickerOpen) {
      this.isOperatoreOpen = false;
      this.isServizioOpen = false;
      this.isClienteOpen = false;
      this.resetOperatoreSearchTerm();
      this.resetServiceSearchTerm();
      this.resetClienteSearchTerm();
      this.initCustomDatePicker();
    }
  }

  navCustomDatePickerMonth(direction: number): void {
    const current = this.customDatePickerNavDate;
    this.customDatePickerNavDate = new Date(current.getFullYear(), current.getMonth() + direction, 1);
    this.generateCustomDatePickerDays();
  }

  selectCustomDatePickerDay(day: any): void {
    if (!day.isSelectable) {
      return;
    }

    const year = day.date.getFullYear();
    const month = day.date.getMonth();
    const dateNum = day.date.getDate();

    const hours = parseInt(this.selectedHour, 10) || 12;
    const minutes = parseInt(this.selectedMinute, 10) || 0;

    const newDate = new Date(year, month, dateNum, hours, minutes);
    this.form.dataOraInizio = this.toDateTimeLocalValue(newDate.toISOString());
    this.onStartDateTimeChange();
    this.generateCustomDatePickerDays();
  }

  onCustomTimeChange(): void {
    if (!this.form.dataOraInizio) {
      const today = new Date();
      const hours = parseInt(this.selectedHour, 10) || 12;
      const minutes = parseInt(this.selectedMinute, 10) || 0;
      const newDate = new Date(today.getFullYear(), today.getMonth(), today.getDate(), hours, minutes);
      this.form.dataOraInizio = this.toDateTimeLocalValue(newDate.toISOString());
    } else {
      const current = new Date(this.form.dataOraInizio);
      const hours = parseInt(this.selectedHour, 10) || 12;
      const minutes = parseInt(this.selectedMinute, 10) || 0;
      const newDate = new Date(current.getFullYear(), current.getMonth(), current.getDate(), hours, minutes);
      this.form.dataOraInizio = this.toDateTimeLocalValue(newDate.toISOString());
    }
    this.onStartDateTimeChange();
  }

  onStartDateTimeChange(): void {
    this.form.dataOraFine = '';
    if (this.form.idServizio) {
      this.onServizioChange();
    }
    this.updateAvailabilityMessage();
  }

  prenotaAppuntamento(): void {
    if (this.isSubmitting || this.isLoadingData) {
      return;
    }

    this.clearBookingAlert();

    if (!this.authService.isLoggedIn()) {
      this.showBookingAlert(
        'Effettua il login prima di prenotare un appuntamento.',
        'error',
        'Login richiesto'
      );
      this.scrollToBookingAlert();
      return;
    }

    if (!this.isOraFineSuccessiva()) {
      this.showBookingAlert(
        'L\'orario di fine deve essere successivo all\'orario di inizio.',
        'error'
      );
      return;
    }

    const idCliente = this.form.idCliente;
    const note = this.getSelectedServizioNome();

    if (!idCliente) {
      this.showBookingAlert(
        'Seleziona un cliente prima di confermare l\'appuntamento.',
        'error'
      );
      return;
    }

    const validationMessage = this.validateAppointmentWindow();

    if (validationMessage) {
      this.showBookingAlert(validationMessage, 'error');
      return;
    }

    const selectedService = this.getSelectedService();
    if (selectedService && !this.isServiceAvailableForSelectedSlot(selectedService)) {
      this.showBookingAlert(
        'Questa durata crea una sovrapposizione con un altro appuntamento. Modifica la durata o scegli un altro orario.',
        'error'
      );
      return;
    }

    const payload = {
      ...this.form,
      idCliente,
      note
    };

    this.isSubmitting = true;

    this.appuntamentoService.creaAppuntamento(payload)
      .subscribe({
        next: () => {
          this.isSubmitting = false;
          this.showBookingAlert(
            'Appuntamento prenotato con successo',
            'success',
            'Prenotazione completata'
          );
          this.cdr.detectChanges();

          setTimeout(() => {
            const queryParams: Record<string, string | number> = {};
            if (this.form.idOperatore != null) {
              queryParams['operatore'] = this.form.idOperatore;
            }
            if (this.form.dataOraInizio) {
              queryParams['data'] = this.form.dataOraInizio;
            }

            this.router.navigate([this.returnRoute], {
              queryParams,
              replaceUrl: true
            });
          }, 1500);
        },
        error: (err: any) => {
          console.error(err);
          this.isSubmitting = false;
          if (err?.status === 401) {
            this.showBookingAlert(
              'La sessione e scaduta. Effettua di nuovo il login prima di prenotare.',
              'error',
              'Login richiesto'
            );
          } else {
            this.showBookingAlert(
              err?.error?.message || 'Prenotazione dell\'appuntamento non riuscita',
              'error'
            );
          }
          this.cdr.detectChanges();
        }
      });
  }

  private toDateTimeLocalValue(value: string): string {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return '';
    }

    const pad = (part: number) => part.toString().padStart(2, '0');

    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  private getCurrentDateTimeLocal(): string {
    return this.toDateTimeLocalValue(new Date().toISOString());
  }

  private isOraFineSuccessiva(): boolean {
    if (!this.form.dataOraInizio || !this.form.dataOraFine) {
      return true;
    }

    const oraInizio = this.extractMinutesFromDateTime(this.form.dataOraInizio);
    const oraFine = this.extractMinutesFromDateTime(this.form.dataOraFine);

    if (oraInizio === null || oraFine === null) {
      return true;
    }

    return oraFine > oraInizio;
  }

  private extractMinutesFromDateTime(value: string): number | null {
    const timePart = value.split('T')[1];

    if (!timePart) {
      return null;
    }

    const [hours, minutes] = timePart.split(':').map(Number);

    if (Number.isNaN(hours) || Number.isNaN(minutes)) {
      return null;
    }

    return hours * 60 + minutes;
  }

  private validateAppointmentWindow(): string | null {
    const start = new Date(this.form.dataOraInizio);
    const end = this.getNormalizedEndDate();

    if (Number.isNaN(start.getTime()) || !end || Number.isNaN(end.getTime())) {
      return 'Inserisci una data di inizio e una di fine valide.';
    }

    if (start < new Date()) {
      return 'Non puoi prenotare in un orario gia passato.';
    }

    if (end <= start) {
      return 'L\'orario di fine deve essere successivo all\'inizio.';
    }

    if (!this.isWithinOpeningHours(start, end)) {
      const daySchedule = this.openingSchedule[start.getDay()];

      if (!daySchedule || daySchedule.intervals.length === 0) {
        return 'Il salone e chiuso nel giorno selezionato.';
      }

      return `Puoi prenotare solo negli orari di apertura del ${daySchedule.name}.`;
    }

    return null;
  }

  private isWithinOpeningHours(start: Date, end: Date): boolean {
    if (start.toDateString() !== end.toDateString()) {
      return false;
    }

    const daySchedule = this.openingSchedule[start.getDay()];

    if (!daySchedule || daySchedule.intervals.length === 0) {
      return false;
    }

    const startMinutes = start.getHours() * 60 + start.getMinutes();
    const endMinutes = end.getHours() * 60 + end.getMinutes();

    return daySchedule.intervals.some((interval) => {
      const intervalStart = this.timeToMinutes(interval.start);
      const intervalEnd = this.timeToMinutes(interval.end);
      return startMinutes >= intervalStart && endMinutes <= intervalEnd;
    });
  }

  private timeToMinutes(value: string): number {
    const [hours, minutes] = value.split(':').map(Number);
    return hours * 60 + minutes;
  }

  onServizioChange(): void {
    if (!this.form.idServizio || !this.form.dataOraInizio) return;

    const servizio = this.servizi.find(
      s => s.idServizio === this.form.idServizio
    );

    if (!servizio) return;

    const end = this.calculateServiceEnd(servizio);

    if (!end) return;

    this.form.dataOraFine = this.formatTime(end);

    if (!this.isServiceAvailableForSelectedSlot(servizio)) {
      this.availabilityMessage =
        'Questa durata crea una sovrapposizione con un altro appuntamento. Modifica la durata o scegli un altro orario.';
      this.cdr.detectChanges();
      return;
    }

    this.availabilityMessage = '';

    this.cdr.detectChanges();
  }

  onCustomServiceValueChange(): void {
    if (!this.form.idServizio) {
      return;
    }

    const prezzo = Number(this.form.prezzoPersonalizzato);
    this.form.prezzoPersonalizzato = Number.isFinite(prezzo) && prezzo >= 0 ? prezzo : null;

    const durata = Number(this.form.durataPersonalizzata);
    this.form.durataPersonalizzata = Number.isFinite(durata) && durata > 0 ? Math.trunc(durata) : null;

    if (this.form.dataOraInizio) {
      this.onServizioChange();
    }
  }

  private loadServiziDisponibili(): void {
    this.isLoadingData = true;

    if (!this.form.idOperatore) {
      this.servizi = [];
      this.appuntamentiOperatore = [];
      this.form.idServizio = null;
      this.form.dataOraFine = '';
      this.availabilityMessage = '';
      this.resetServiceSearchTerm();
      this.isServizioOpen = false;
      this.isLoadingData = false;
      this.cdr.detectChanges();
      return;
    }

    forkJoin({
      servizi: this.servizioService.getServizi(true),
      appuntamenti: this.appuntamentoService.getAppuntamenti(this.form.idOperatore)
    }).subscribe({
      next: ({ servizi, appuntamenti }) => {
        this.appuntamentiOperatore = appuntamenti;
        this.servizi = servizi;
        const firstAvailableService = this.servizi.find((servizio) => !this.isServiceDisabled(servizio)) ?? null;

        const queryServiceId = this.selectedServizioFromQuery;
        const hasQueryService =
          queryServiceId != null &&
          this.servizi.some(
            (servizio) => servizio.idServizio === queryServiceId && !this.isServiceDisabled(servizio)
          );

        if (hasQueryService) {
          this.form.idServizio = queryServiceId;
        } else if (!this.servizi.some((servizio) => servizio.idServizio === this.form.idServizio)) {
          this.form.idServizio = firstAvailableService?.idServizio ?? null;
        } else {
          const selectedService = this.servizi.find((servizio) => servizio.idServizio === this.form.idServizio);
          if (selectedService && this.isServiceDisabled(selectedService)) {
            this.form.idServizio = firstAvailableService?.idServizio ?? null;
          }
        }

        this.selectedServizioFromQuery = null;

        const selectedService = this.getSelectedService();
        if (selectedService) {
          this.syncCustomServiceValues(selectedService);
        } else {
          this.form.prezzoPersonalizzato = null;
          this.form.durataPersonalizzata = null;
        }

        if (this.form.dataOraInizio && this.form.idServizio) {
          this.onServizioChange();
        } else if (!this.form.idServizio) {
          this.form.dataOraFine = '';
        }

        this.isServizioOpen = false;
        this.resetServiceSearchTerm();
        this.updateAvailabilityMessage();
        this.isLoadingData = false;

        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error(err);
        this.servizi = [];
        this.appuntamentiOperatore = [];
        this.form.idServizio = null;
        this.form.dataOraFine = '';
        this.availabilityMessage = '';
        this.resetServiceSearchTerm();
        this.isServizioOpen = false;
        this.isLoadingData = false;
        this.cdr.detectChanges();
      }
    });
  }

  private loadManagementClienti(): void {
    if (this.hasLoadedManagementClienti) {
      return;
    }

    this.hasLoadedManagementClienti = true;

    this.utentiService.getClienti().subscribe({
      next: (clienti) => {
        this.clienti = clienti;
        if (!this.form.idCliente && clienti.length > 0) {
          this.form.idCliente = clienti[0].idUtente;
        }
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error(err);
        this.hasLoadedManagementClienti = false;
      }
    });
  }

  private isServiceAvailableForSelectedSlot(servizio: Servizio): boolean {
    const start = new Date(this.form.dataOraInizio);
    const end = this.calculateServiceCalendarHoldEnd(servizio);

    if (Number.isNaN(start.getTime()) || !end) {
      return true;
    }

    return !this.appuntamentiOperatore.some((appuntamento) => {
      const appointmentStart = new Date(appuntamento.dataOraInizio);
      const appointmentEnd = new Date(appuntamento.dataOraFine);

      if (Number.isNaN(appointmentStart.getTime()) || Number.isNaN(appointmentEnd.getTime())) {
        return false;
      }

      return start < this.getMinimumAppointmentEnd(appointmentStart, appointmentEnd) && end > appointmentStart;
    });
  }

  private calculateServiceEnd(servizio: Servizio): Date | null {
    const start = new Date(this.form.dataOraInizio);

    if (Number.isNaN(start.getTime())) {
      return null;
    }

    const end = new Date(start);
    const durationMinutes = this.getSelectedServiceDuration(servizio);

    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
      return null;
    }

    end.setMinutes(end.getMinutes() + this.roundDurationToCalendarBlock(durationMinutes));
    return end;
  }

  private getSelectedService(): Servizio | undefined {
    return this.servizi.find((servizio) => servizio.idServizio === this.form.idServizio);
  }

  private syncCustomServiceValues(servizio: Servizio): void {
    this.form.prezzoPersonalizzato = Number(servizio.prezzo || 0);
    this.form.durataPersonalizzata = Number(servizio.durata || 0) || null;
  }

  private getSelectedServiceDuration(servizio: Servizio): number {
    if (servizio.idServizio === this.form.idServizio) {
      const customDuration = Number(this.form.durataPersonalizzata);

      if (Number.isFinite(customDuration) && customDuration > 0) {
        return customDuration;
      }
    }

    return Number(servizio.durata || 0);
  }

  private calculateServiceCalendarHoldEnd(servizio: Servizio): Date | null {
    const actualEnd = this.calculateServiceEnd(servizio);
    const start = new Date(this.form.dataOraInizio);

    if (!actualEnd || Number.isNaN(start.getTime())) {
      return null;
    }

    return actualEnd;
  }

  private getMinimumAppointmentEnd(start: Date, end: Date): Date {
    const durationMinutes = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 60000));
    const roundedEnd = new Date(start);
    roundedEnd.setMinutes(roundedEnd.getMinutes() + this.roundDurationToCalendarBlock(durationMinutes));
    return roundedEnd;
  }

  private roundDurationToCalendarBlock(durationMinutes: number): number {
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
      return this.minimumAppointmentDurationMinutes;
    }

    return Math.ceil(durationMinutes / this.minimumAppointmentDurationMinutes) * this.minimumAppointmentDurationMinutes;
  }

  private getNormalizedEndDate(): Date | null {
    if (!this.form.dataOraInizio || !this.form.dataOraFine) {
      return null;
    }

    const endValue = this.form.dataOraFine.includes('T')
      ? this.form.dataOraFine
      : `${this.form.dataOraInizio.split('T')[0]}T${this.form.dataOraFine}`;

    const end = new Date(endValue);
    return Number.isNaN(end.getTime()) ? null : end;
  }

  private updateAvailabilityMessage(): void {
    if (!this.form.dataOraInizio) {
      this.availabilityMessage = '';
      return;
    }

    if (this.servizi.length === 0) {
      this.availabilityMessage =
        'Nessun servizio e disponibile in questo orario per l\'operatore selezionato.';
      return;
    }

    this.availabilityMessage = '';
  }

  private formatTime(date: Date): string {
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  private resetServiceSearchTerm(): void {
    this.serviceSearchTerm = '';
  }

  private resetClienteSearchTerm(): void {
    this.clienteSearchTerm = '';
  }

  private resetOperatoreSearchTerm(): void {
    this.operatoreSearchTerm = '';
  }

  private doesServizioMatchSearch(servizio: Servizio, search: string): boolean {
    const searchableValues = [
      servizio.nome,
      servizio.categoria,
      servizio.sottocategoria,
      servizio.descrizione
    ];

    return searchableValues.some((value) =>
      this.normalizeSearchTerm(value ?? '').includes(search)
    );
  }

  private normalizeSearchTerm(value: string): string {
    return value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
  }

  private clearBookingAlert(): void {
    this.bookingAlertTitle = '';
    this.bookingAlertMessage = '';
    this.bookingAlertType = null;
  }

  private showBookingAlert(
    message: string,
    type: 'success' | 'error',
    title?: string
  ): void {
    this.bookingAlertType = type;
    this.bookingAlertTitle = title ?? (type === 'success' ? 'Prenotazione completata' : 'Prenotazione non riuscita');
    this.bookingAlertMessage = message;
  }

  private scrollToBookingAlert(): void {
    if (typeof document === 'undefined') {
      return;
    }

    requestAnimationFrame(() => {
      const alertElement = document.querySelector('.booking-alert');

      if (alertElement instanceof HTMLElement) {
        alertElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  }
}

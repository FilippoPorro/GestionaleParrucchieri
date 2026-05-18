import { ChangeDetectorRef, Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { SidenavComponent } from '../sidenav.component/sidenav.component';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { FullCalendarComponent, FullCalendarModule } from '@fullcalendar/angular';
import { CalendarOptions, EventInput } from '@fullcalendar/core';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import itLocale from '@fullcalendar/core/locales/it';
import { Appuntamento } from '../../models/appuntamento.model';
import { Utente } from '../../models/utente.model';
import { AppuntamentoService } from '../../services/appuntamentoService';
import { UtentiService } from '../../services/utentiService';
import { forkJoin } from 'rxjs';

@Component({
  selector: 'app-appuntamenti-gestionale.component',
  standalone: true,
  imports: [CommonModule, FormsModule, FullCalendarModule, SidenavComponent],
  templateUrl: './appuntamenti-gestionale.component.html',
  styleUrls: [
    './appuntamenti-gestionale.component.css',
    '../../features/appuntamenti.component/appuntamenti.component.css'
  ],
})
export class AppuntamentiGestionaleComponent implements OnInit, OnDestroy {
  @ViewChild('calendar') calendarComponent?: FullCalendarComponent;

  isSidenavCollapsed = false;
  operatori: Utente[] = [];
  clienti: Utente[] = [];
  selectedOperator: number | null = null;
  isOperatorDropdownOpen = false;
  isLoading = true;
  calendarMessage = '';
  events: EventInput[] = [];
  selectedAppointment: Appuntamento | null = null;
  selectedAppointmentLabel = '';
  isAppointmentDetailOpen = false;
  isAppointmentDetailClosing = false;
  appointmentDetailToneClass = 'tone-my';
  isCalendarDatePickerOpen = false;
  calendarPickerDate = '';
  private appointmentDetailCloseTimeout: ReturnType<typeof setTimeout> | null = null;
  private disabledSlotEvents: EventInput[] = [];
  private visibleRangeStart: Date | null = null;
  private visibleRangeEnd: Date | null = null;
  private calendarTitleElement: HTMLElement | null = null;
  private readonly calendarTitleClickHandler = (event: Event): void => {
    event.preventDefault();
    event.stopPropagation();
    this.toggleCalendarDatePicker();
  };
  private readonly calendarTitleKeydownHandler = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.toggleCalendarDatePicker();
  };

  calendarOptions: CalendarOptions = {
    plugins: [timeGridPlugin, interactionPlugin],
    initialView: 'timeGridWeek',
    locale: itLocale,
    firstDay: 1,
    allDaySlot: false,
    expandRows: true,
    height: 'auto',
    slotMinTime: '08:00:00',
    slotMaxTime: '21:30:00',
    slotDuration: '00:30:00',
    snapDuration: '00:30:00',
    nowIndicator: true,
    selectable: true,
    businessHours: [
      { daysOfWeek: [2, 4], startTime: '08:00', endTime: '12:30' },
      { daysOfWeek: [2, 4], startTime: '14:00', endTime: '19:30' },
      { daysOfWeek: [3], startTime: '13:00', endTime: '21:30' },
      { daysOfWeek: [5], startTime: '08:00', endTime: '19:30' },
      { daysOfWeek: [6], startTime: '08:00', endTime: '18:00' }
    ],
    headerToolbar: {
      left: 'prev,next today',
      center: 'title',
      right: 'timeGridWeek,timeGridDay'
    },
    buttonText: {
      today: 'Oggi',
      week: 'Settimana',
      day: 'Giorno'
    },
    slotLabelFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
    dayHeaderFormat: { weekday: 'short', day: 'numeric', omitCommas: true },
    datesSet: this.handleDatesSet.bind(this),
    dateClick: this.handleDateClick.bind(this),
    eventClick: this.handleEventClick.bind(this),
    eventOverlap: false,
    slotEventOverlap: false,
    displayEventTime: false,
    events: []
  };

  constructor(
    private readonly appuntamentoService: AppuntamentoService,
    private readonly utentiService: UtentiService,
    private readonly router: Router,
    private readonly cdr: ChangeDetectorRef,
    private readonly elementRef: ElementRef<HTMLElement>
  ) {}

  ngOnInit(): void {
    forkJoin({
      operatori: this.utentiService.getOperatori(),
      clienti: this.utentiService.getClienti()
    }).subscribe({
      next: ({ operatori, clienti }) => {
        this.operatori = operatori;
        this.clienti = clienti;
        this.selectedOperator = operatori[0]?.idUtente ?? null;
        this.cdr.detectChanges();
        this.loadAppointments();
      },
      error: (error) => {
        console.error('Errore caricamento dati calendario gestionale:', error);
        this.isLoading = false;
        this.calendarMessage = 'Non riesco a caricare operatori e clienti.';
        this.cdr.detectChanges();
      }
    });
  }

  ngOnDestroy(): void {
    this.detachCalendarTitleHandlers();

    if (this.appointmentDetailCloseTimeout) {
      clearTimeout(this.appointmentDetailCloseTimeout);
      this.appointmentDetailCloseTimeout = null;
    }
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;

    if (
      target?.closest('.management-calendar-date-popover') ||
      target?.closest('.fc-toolbar-title')
    ) {
      return;
    }

    this.isCalendarDatePickerOpen = false;
  }

  toggleSidenav(): void {
    this.isSidenavCollapsed = !this.isSidenavCollapsed;
  }

  selectOperator(idOperatore: number | null): void {
    this.isOperatorDropdownOpen = false;

    if (this.selectedOperator === idOperatore) {
      return;
    }

    this.selectedOperator = idOperatore;
    this.loadAppointments();
  }

  toggleOperatorDropdown(): void {
    if (this.operatori.length === 0) {
      return;
    }

    this.isOperatorDropdownOpen = !this.isOperatorDropdownOpen;
  }

  get selectedOperatorLabel(): string {
    const operatore = this.operatori.find((item) => item.idUtente === this.selectedOperator);
    return operatore ? `${operatore.nome} ${operatore.cognome}` : 'Seleziona operatore';
  }

  private loadAppointments(): void {
    if (!this.selectedOperator) {
      this.events = [];
      this.syncCalendarEvents();
      this.isLoading = false;
      this.calendarMessage = 'Seleziona un operatore per visualizzare il calendario.';
      this.cdr.detectChanges();
      return;
    }

    this.isLoading = true;
    this.calendarMessage = '';
    this.cdr.detectChanges();

    this.appuntamentoService.getAppuntamenti(this.selectedOperator).subscribe({
      next: (appointments) => {
        this.events = appointments.map((appointment) => this.mapAppointmentToEvent(appointment));
        this.syncCalendarEvents();
        this.isLoading = false;
        this.cdr.detectChanges();
      },
      error: (error) => {
        console.error('Errore caricamento appuntamenti gestionale:', error);
        this.isLoading = false;
        this.calendarMessage = 'Non riesco a caricare gli appuntamenti.';
        this.cdr.detectChanges();
      }
    });
  }

  private handleDateClick(arg: any): void {
    const clickedDate = arg.date instanceof Date ? arg.date : new Date(arg.date);

    if (!this.selectedOperator) {
      this.calendarMessage = 'Seleziona un operatore prima di inserire un appuntamento.';
      this.cdr.detectChanges();
      return;
    }

    if (!this.isBookableSlot(clickedDate)) {
      this.calendarMessage = 'Non puoi inserire appuntamenti in una fascia oraria gia iniziata o passata.';
      this.cdr.detectChanges();
      return;
    }

    this.router.navigate(['/prenotazione'], {
      queryParams: {
        data: arg.dateStr,
        operatore: this.selectedOperator,
        gestionale: 1,
        ritorno: '/gestionale/appuntamenti'
      }
    });
  }

  private handleEventClick(arg: any): void {
    if (arg.event?.display === 'background') {
      this.calendarMessage = 'Non puoi inserire appuntamenti in una fascia oraria gia iniziata o passata.';
      this.cdr.detectChanges();
      return;
    }

    const appointment = arg.event?.extendedProps?.['appointment'] as Appuntamento | undefined;

    if (!appointment) {
      return;
    }

    this.openAppointmentDetail(appointment);
  }

  private handleDatesSet(arg: { start: Date; end: Date }): void {
    this.visibleRangeStart = arg.start;
    this.visibleRangeEnd = arg.end;
    this.calendarPickerDate = this.toDateInputValue(arg.start);
    this.setupClickableCalendarTitle();
    this.syncCalendarEvents();
  }

  toggleCalendarDatePicker(): void {
    this.isCalendarDatePickerOpen = !this.isCalendarDatePickerOpen;
    this.cdr.detectChanges();
  }

  goToCalendarPickerDate(): void {
    if (!this.calendarPickerDate) {
      return;
    }

    this.isCalendarDatePickerOpen = false;

    const calendarApi = this.calendarComponent?.getApi();
    if (!calendarApi) {
      return;
    }

    calendarApi.gotoDate(`${this.calendarPickerDate}T12:00:00`);
  }

  private mapAppointmentToEvent(appointment: Appuntamento): EventInput {
    const isPermission = this.isPermissionAppointment(appointment);
    const label = isPermission ? 'Permesso' : this.getAppointmentServiceLabel(appointment);
    const eventEnd = this.getVisualEventEnd(appointment.dataOraInizio, appointment.dataOraFine);
    const classNames = [
      isPermission ? 'permission-appointment' : `appointment-status-${appointment.stato?.replace(/\s+/g, '-') || 'prenotato'}`
    ];

    if (this.isPastAppointment(appointment)) {
      classNames.push('appointment-is-past');
    }

    return {
      id: String(appointment.idAppuntamento),
      title: label,
      start: appointment.dataOraInizio,
      end: eventEnd,
      classNames,
      extendedProps: {
        appointment
      }
    };
  }

  openAppointmentDetail(appointment: Appuntamento): void {
    if (this.appointmentDetailCloseTimeout) {
      clearTimeout(this.appointmentDetailCloseTimeout);
      this.appointmentDetailCloseTimeout = null;
    }

    this.selectedAppointment = appointment;
    this.selectedAppointmentLabel = this.buildAppointmentLabel(appointment);
    this.appointmentDetailToneClass = this.getAppointmentToneClass(appointment);
    this.isAppointmentDetailClosing = false;
    this.isAppointmentDetailOpen = true;
    this.cdr.detectChanges();
  }

  closeAppointmentDetail(): void {
    if (!this.isAppointmentDetailOpen || this.isAppointmentDetailClosing) {
      return;
    }

    this.isAppointmentDetailClosing = true;
    this.cdr.detectChanges();

    this.appointmentDetailCloseTimeout = setTimeout(() => {
      this.isAppointmentDetailOpen = false;
      this.isAppointmentDetailClosing = false;
      this.selectedAppointment = null;
      this.selectedAppointmentLabel = '';
      this.appointmentDetailCloseTimeout = null;
      this.cdr.detectChanges();
    }, 220);
  }

  onAppointmentModalOverlayClick(event: MouseEvent): void {
    if (event.target !== event.currentTarget) {
      return;
    }

    this.closeAppointmentDetail();
  }

  private getVisualEventEnd(startValue: string, endValue: string): string {
    const start = new Date(startValue);
    const end = new Date(endValue);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return endValue;
    }

    const minimumEnd = new Date(start);
    minimumEnd.setMinutes(minimumEnd.getMinutes() + 30);

    return end < minimumEnd ? this.toLocalDateTimeString(minimumEnd) : endValue;
  }

  private toLocalDateTimeString(date: Date): string {
    const pad = (part: number) => String(part).padStart(2, '0');

    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  private toDateInputValue(date: Date): string {
    const pad = (part: number) => String(part).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  private buildAppointmentLabel(appointment: Appuntamento): string {
    return this.getAppointmentServiceLabel(appointment);
  }

  getSelectedAppointmentServiceLabel(): string {
    return this.selectedAppointment
      ? this.getAppointmentServiceLabel(this.selectedAppointment)
      : 'Servizio non indicato';
  }

  private getAppointmentServiceLabel(appointment: Appuntamento): string {
    if (this.isPermissionAppointment(appointment)) {
      return 'Permesso';
    }

    return appointment.servizioNome?.trim()
      || appointment.note?.trim()
      || 'Servizio non indicato';
  }

  private getAppointmentToneClass(appointment: Appuntamento): string {
    if (this.isPastAppointment(appointment) || appointment.stato === 'completato') {
      return 'tone-past';
    }

    return 'tone-my';
  }

  getSelectedAppointmentClientLabel(): string {
    if (!this.selectedAppointment) {
      return '';
    }

    if (!this.selectedAppointment.idCliente) {
      return this.isPermissionAppointment(this.selectedAppointment) ? 'Permesso' : 'Slot riservato';
    }

    const cliente = this.clienti.find(
      (item) => item.idUtente === this.selectedAppointment?.idCliente
    );

    return cliente
      ? `${cliente.nome} ${cliente.cognome}`
      : `Cliente #${this.selectedAppointment.idCliente}`;
  }

  getSelectedAppointmentOperatorLabel(): string {
    if (!this.selectedAppointment) {
      return '';
    }

    const operatore = this.operatori.find(
      (item) => item.idUtente === this.selectedAppointment?.idOperatore
    );

    return operatore
      ? `${operatore.nome} ${operatore.cognome}`
      : `Operatore #${this.selectedAppointment.idOperatore}`;
  }

  formatAppointmentDateTime(value: string | undefined): string {
    if (!value) {
      return 'Non indicato';
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return new Intl.DateTimeFormat('it-IT', {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(date);
  }

  getSelectedAppointmentDurationLabel(): string {
    if (!this.selectedAppointment) {
      return 'Non indicata';
    }

    const start = new Date(this.selectedAppointment.dataOraInizio);
    const end = new Date(this.selectedAppointment.dataOraFine);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      return 'Non indicata';
    }

    return `${Math.round((end.getTime() - start.getTime()) / 60000)} min`;
  }

  private isPastAppointment(appointment: Appuntamento): boolean {
    const appointmentEnd = new Date(appointment.dataOraFine);
    return !Number.isNaN(appointmentEnd.getTime()) && appointmentEnd.getTime() < Date.now();
  }

  private isPermissionAppointment(appointment: Appuntamento): boolean {
    return !appointment.idCliente &&
      !appointment.idServizio &&
      !appointment.servizioNome &&
      !appointment.note &&
      !appointment.stato;
  }

  private isBookableSlot(slotStart: Date): boolean {
    if (Number.isNaN(slotStart.getTime())) {
      return false;
    }

    return slotStart >= this.getCurrentHalfHourEnd();
  }

  private getCurrentHalfHourEnd(): Date {
    const now = new Date();
    const currentSlotStart = new Date(now);
    currentSlotStart.setMinutes(now.getMinutes() < 30 ? 0 : 30, 0, 0);

    const currentSlotEnd = new Date(currentSlotStart);
    currentSlotEnd.setMinutes(currentSlotEnd.getMinutes() + 30);

    return currentSlotEnd;
  }

  private buildDisabledSlotEvents(): EventInput[] {
    if (!this.visibleRangeStart || !this.visibleRangeEnd) {
      return [];
    }

    const disabledUntil = this.getCurrentHalfHourEnd();
    const start = new Date(this.visibleRangeStart);
    const end = new Date(Math.min(this.visibleRangeEnd.getTime(), disabledUntil.getTime()));

    if (end <= start) {
      return [];
    }

    return [{
      start: this.toLocalDateTimeString(start),
      end: this.toLocalDateTimeString(end),
      display: 'background',
      classNames: ['management-disabled-slot-background']
    }];
  }

  private syncCalendarEvents(): void {
    this.disabledSlotEvents = this.buildDisabledSlotEvents();
    const calendarEvents = [
      ...this.disabledSlotEvents,
      ...this.events
    ];

    this.calendarOptions = {
      ...this.calendarOptions,
      events: calendarEvents
    };

    const calendarApi = this.calendarComponent?.getApi();
    if (!calendarApi) {
      return;
    }

    calendarApi.removeAllEvents();
    calendarApi.addEventSource(calendarEvents);
    this.setupClickableCalendarTitle();
  }

  private setupClickableCalendarTitle(): void {
    setTimeout(() => {
      const titleElement = this.elementRef.nativeElement.querySelector(
        '.fc-toolbar-title'
      ) as HTMLElement | null;

      if (!titleElement || titleElement === this.calendarTitleElement) {
        return;
      }

      this.detachCalendarTitleHandlers();
      this.calendarTitleElement = titleElement;
      this.calendarTitleElement.classList.add('management-calendar-title-trigger');
      this.calendarTitleElement.setAttribute('role', 'button');
      this.calendarTitleElement.setAttribute('tabindex', '0');
      this.calendarTitleElement.setAttribute('title', 'Scegli una data');
      this.calendarTitleElement.addEventListener('click', this.calendarTitleClickHandler);
      this.calendarTitleElement.addEventListener('keydown', this.calendarTitleKeydownHandler);
    });
  }

  private detachCalendarTitleHandlers(): void {
    if (!this.calendarTitleElement) {
      return;
    }

    this.calendarTitleElement.removeEventListener('click', this.calendarTitleClickHandler);
    this.calendarTitleElement.removeEventListener('keydown', this.calendarTitleKeydownHandler);
    this.calendarTitleElement = null;
  }
}


import { ChangeDetectorRef, Component, HostListener, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { SidenavComponent } from '../sidenav.component/sidenav.component';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { FullCalendarComponent, FullCalendarModule } from '@fullcalendar/angular';
import { CalendarOptions, EventContentArg, EventInput } from '@fullcalendar/core';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import itLocale from '@fullcalendar/core/locales/it';
import { Appuntamento } from '../../models/appuntamento.model';
import { Utente } from '../../models/utente.model';
import { AppuntamentoService } from '../../services/appuntamentoService';
import { UtentiService } from '../../services/utentiService';
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

interface CalendarPickerDay {
  date: Date;
  label: number;
  currentMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
}

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

  private readonly mobileBreakpoint = 768;
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
  isMobileCalendar = false;
  calendarDatePickerValue = '';
  calendarPickerOpen = false;
  calendarPickerClosing = false;
  calendarPickerMonth = new Date();
  calendarPickerDays: CalendarPickerDay[] = [];
  calendarPickerPanelStyle: Record<string, string> = {};
  readonly calendarPickerWeekdays = ['Lu', 'Ma', 'Me', 'Gi', 'Ve', 'Sa', 'Do'];
  readonly calendarPickerMonthFormatter = new Intl.DateTimeFormat('it-IT', { month: 'long', year: 'numeric' });
  private appointmentDetailCloseTimeout: ReturnType<typeof setTimeout> | null = null;
  private calendarPickerCloseTimeout: ReturnType<typeof setTimeout> | null = null;
  private calendarScrollTimeout: ReturnType<typeof setTimeout> | null = null;
  private availabilityMaskEvents: EventInput[] = [];
  private loadedAppointments: Appuntamento[] = [];
  private serviceDescriptionByName = new Map<string, string>();
  private visibleRangeStart: Date | null = null;
  private visibleRangeEnd: Date | null = null;

  calendarOptions: CalendarOptions = {
    plugins: [timeGridPlugin, interactionPlugin],
    initialView: this.getResponsiveCalendarView(),
    locale: itLocale,
    firstDay: 1,
    allDaySlot: false,
    slotMinTime: '07:00:00',
    slotMaxTime: '21:30:00',
    slotDuration: '00:30:00',
    slotLabelInterval: '00:30',
    scrollTime: '07:00:00',
    scrollTimeReset: false,
    displayEventTime: true,
    displayEventEnd: true,
    expandRows: false,
    height: '82vh',
    nowIndicator: true,
    stickyHeaderDates: true,
    selectable: true,
    businessHours: [
      { daysOfWeek: [2, 4], startTime: '08:00', endTime: '12:30' },
      { daysOfWeek: [2, 4], startTime: '14:00', endTime: '19:30' },
      { daysOfWeek: [3], startTime: '13:00', endTime: '21:30' },
      { daysOfWeek: [5], startTime: '07:00', endTime: '19:30' },
      { daysOfWeek: [6], startTime: '07:00', endTime: '18:00' }
    ],
    datesSet: this.handleDatesSet.bind(this),
    dateClick: this.handleDateClick.bind(this),
    eventClick: this.handleEventClick.bind(this),
    eventContent: this.renderAppointmentEvent.bind(this),
    eventOverlap: false,
    slotEventOverlap: false,
    eventMinHeight: 0,
    eventShortHeight: 0,
    headerToolbar: {
      left: 'prev,next today',
      center: 'title',
      right: this.getResponsiveToolbarRight()
    },
    buttonText: {
      today: 'Oggi',
      week: 'Settimana',
      day: 'Giorno'
    },
    slotLabelFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
    dayHeaderFormat: { weekday: 'short', day: 'numeric', omitCommas: true },
    events: []
  };

  constructor(
    private readonly appuntamentoService: AppuntamentoService,
    private readonly utentiService: UtentiService,
    private readonly serviziService: ServiziService,
    private readonly router: Router,
    private readonly cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.syncCalendarResponsiveMode();
    this.calendarDatePickerValue = this.formatDateForInput(new Date());
    this.syncCalendarPickerMonth(new Date());

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
    if (this.appointmentDetailCloseTimeout) {
      clearTimeout(this.appointmentDetailCloseTimeout);
      this.appointmentDetailCloseTimeout = null;
    }

    if (this.calendarPickerCloseTimeout) {
      clearTimeout(this.calendarPickerCloseTimeout);
      this.calendarPickerCloseTimeout = null;
    }

    if (this.calendarScrollTimeout) {
      clearTimeout(this.calendarScrollTimeout);
      this.calendarScrollTimeout = null;
    }
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;

    if (target?.closest('.fc-toolbar-title')) {
      this.toggleCalendarPicker();
      this.isOperatorDropdownOpen = false;
      return;
    }

    if (target?.closest('.appointments-date-picker-panel')) {
      return;
    }

    if (target?.closest('.appointments-select-wrapper')) {
      this.closeCalendarPicker();
      return;
    }

    this.closeCalendarPicker();
    this.isOperatorDropdownOpen = false;
  }

  @HostListener('document:keydown.escape')
  onEscapePressed(): void {
    if (this.isAppointmentDetailOpen) {
      this.closeAppointmentDetail();
      return;
    }

    this.closeCalendarPicker();
    this.isOperatorDropdownOpen = false;
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    this.syncCalendarResponsiveMode();
    this.updateCalendarPickerPosition();
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

  get availableOperators(): Utente[] {
    return this.operatori.filter((operatore) => operatore.idUtente !== this.selectedOperator);
  }

  private loadAppointments(): void {
    if (!this.selectedOperator) {
      this.events = [];
      this.loadedAppointments = [];
      this.refreshCalendarEvents();
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
        this.loadedAppointments = appointments;
        this.loadServiceDetailsForOperator(this.selectedOperator!);
        this.rebuildCalendarEvents();
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

    if (!this.isBookableDateTime(clickedDate)) {
      this.calendarMessage = this.getInvalidSlotMessage(clickedDate);
      this.cdr.detectChanges();
      return;
    }

    this.router.navigate(['/gestionale/prenotazione'], {
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
      const startDate = arg.event.start instanceof Date ? arg.event.start : new Date(arg.event.start);
      this.calendarMessage = this.getInvalidSlotMessage(startDate);
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
    this.syncDatePickerValue(arg.start);
    this.syncCalendarTitleState();
    this.updateCalendarPickerPosition();
    this.refreshCalendarEvents();
    this.scrollCalendarToCurrentTimeIfNeeded(arg.start, arg.end);
  }

  toggleCalendarPicker(): void {
    if (this.calendarPickerOpen) {
      this.closeCalendarPicker();
      return;
    }

    if (this.calendarPickerCloseTimeout) {
      clearTimeout(this.calendarPickerCloseTimeout);
      this.calendarPickerCloseTimeout = null;
    }

    this.calendarPickerClosing = false;
    this.calendarPickerOpen = true;
    this.syncCalendarPickerMonth(this.parseInputDate(this.calendarDatePickerValue) ?? new Date());
    this.syncCalendarTitleState();
    this.cdr.detectChanges();
    this.updateCalendarPickerPosition();
  }

  closeCalendarPicker(): void {
    if (!this.calendarPickerOpen || this.calendarPickerClosing) {
      return;
    }

    this.calendarPickerClosing = true;
    this.syncCalendarTitleState();
    this.calendarPickerCloseTimeout = setTimeout(() => {
      this.calendarPickerOpen = false;
      this.calendarPickerClosing = false;
      this.calendarPickerCloseTimeout = null;
      this.syncCalendarTitleState();
      this.cdr.detectChanges();
    }, 180);
  }

  previousCalendarPickerMonth(): void {
    const next = new Date(this.calendarPickerMonth);
    next.setMonth(next.getMonth() - 1, 1);
    this.syncCalendarPickerMonth(next);
  }

  nextCalendarPickerMonth(): void {
    const next = new Date(this.calendarPickerMonth);
    next.setMonth(next.getMonth() + 1, 1);
    this.syncCalendarPickerMonth(next);
  }

  selectCalendarPickerDay(day: CalendarPickerDay): void {
    this.calendarDatePickerValue = this.formatDateForInput(day.date);

    if (!this.calendarComponent) {
      this.closeCalendarPicker();
      return;
    }

    const calendarApi = this.calendarComponent.getApi();
    const value = this.calendarDatePickerValue;
    calendarApi.gotoDate(value);

    if (this.isMobileCalendar) {
      calendarApi.changeView('timeGridDay', value);
    }

    this.syncCalendarPickerMonth(day.date);
    this.closeCalendarPicker();
  }

  get calendarPickerMonthLabel(): string {
    const label = this.calendarPickerMonthFormatter.format(this.calendarPickerMonth);
    return label.charAt(0).toUpperCase() + label.slice(1);
  }

  private mapAppointmentToEvent(appointment: Appuntamento): EventInput {
    const isPermission = this.isPermissionAppointment(appointment);
    const normalizedStart = this.normalizeDateTimeForCalendar(appointment.dataOraInizio);
    const normalizedEnd = this.normalizeDateTimeForCalendar(appointment.dataOraFine);
    const eventEnd = this.getCalendarEventEnd(normalizedStart, normalizedEnd);
    const serviceName = isPermission ? '' : this.getAppointmentServiceLabel(appointment);
    const normalizedServiceName = serviceName.trim().toLowerCase();
    const displayTitle = isPermission ? 'Permesso' : (serviceName || 'Servizio prenotato');
    const appointmentEnd = new Date(normalizedEnd);
    const isPastAppointment =
      !Number.isNaN(appointmentEnd.getTime()) &&
      appointmentEnd.getTime() < Date.now();
    const classNames = [
      isPastAppointment ? 'past-appointment' : 'my-appointment',
      isPermission ? 'permission-appointment' : ''
    ].filter(Boolean);

    return {
      id: String(appointment.idAppuntamento),
      title: displayTitle,
      start: normalizedStart,
      end: eventEnd,
      classNames,
      extendedProps: {
        appointment,
        idAppuntamento: appointment.idAppuntamento,
        actualStart: normalizedStart,
        actualEnd: normalizedEnd,
        canManage: false,
        canModify: false,
        canDelete: false,
        isVisible: true,
        displayTitle,
        serviceName,
        serviceDescription: this.serviceDescriptionByName.get(normalizedServiceName) || '',
        operatorName: this.selectedOperatorLabel
      }
    };
  }

  private rebuildCalendarEvents(): void {
    this.events = this.loadedAppointments.map((appointment) => this.mapAppointmentToEvent(appointment));
    this.refreshCalendarEvents();
  }

  private loadServiceDetailsForOperator(operatorId: number): void {
    this.serviziService.getServiziPrenotabiliByOperatore(operatorId).subscribe({
      next: (services) => {
        this.serviceDescriptionByName = new Map(
          services.map((service) => [
            (service.nome || '').trim().toLowerCase(),
            (service.descrizione || '').trim()
          ])
        );
        this.rebuildCalendarEvents();
      },
      error: () => {
        this.serviceDescriptionByName.clear();
      }
    });
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

  private normalizeDateTimeForCalendar(value: string): string {
    const parsed = new Date(value);

    if (Number.isNaN(parsed.getTime())) {
      return value;
    }

    parsed.setSeconds(0, 0);
    return this.toLocalDateTimeInput(parsed.toISOString());
  }

  private getCalendarEventEnd(startValue: string, endValue: string): string {
    const start = new Date(startValue);
    const end = new Date(endValue);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      return endValue;
    }

    const durationMinutes = Math.round((end.getTime() - start.getTime()) / 60000);

    if (durationMinutes >= this.minimumAppointmentDurationMinutes) {
      return endValue;
    }

    const minimumEnd = new Date(start);
    minimumEnd.setMinutes(minimumEnd.getMinutes() + this.minimumAppointmentDurationMinutes);
    return this.toLocalDateTimeInput(minimumEnd.toISOString());
  }

  private toLocalDateTimeInput(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return '';
    }

    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    const hours = `${date.getHours()}`.padStart(2, '0');
    const minutes = `${date.getMinutes()}`.padStart(2, '0');

    return `${year}-${month}-${day}T${hours}:${minutes}`;
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

  private isBookableDateTime(date: Date): boolean {
    if (Number.isNaN(date.getTime())) {
      return false;
    }

    if (date < new Date()) {
      return false;
    }

    return this.isWithinOpeningHours(date);
  }

  private isWithinOpeningHours(date: Date): boolean {
    const daySchedule = this.openingSchedule[date.getDay()];

    if (!daySchedule || daySchedule.intervals.length === 0) {
      return false;
    }

    const minutes = date.getHours() * 60 + date.getMinutes();

    return daySchedule.intervals.some((interval) => {
      const start = this.timeToMinutes(interval.start);
      const end = this.timeToMinutes(interval.end);
      return minutes >= start && minutes < end;
    });
  }

  private getInvalidSlotMessage(date: Date): string {
    if (date < new Date()) {
      return 'Non puoi prenotare in un orario gia passato.';
    }

    const daySchedule = this.openingSchedule[date.getDay()];

    if (!daySchedule || daySchedule.intervals.length === 0) {
      return 'Il salone e chiuso in questo giorno.';
    }

    return `Puoi prenotare solo negli orari di apertura del ${daySchedule.name}.`;
  }

  private timeToMinutes(value: string): number {
    const [hours, minutes] = value.split(':').map(Number);
    return hours * 60 + minutes;
  }

  private buildAvailabilityMaskEvents(): EventInput[] {
    if (!this.visibleRangeStart || !this.visibleRangeEnd) {
      return [];
    }

    const maskEvents: EventInput[] = [];
    const viewStart = new Date(this.visibleRangeStart);
    const viewEnd = new Date(this.visibleRangeEnd);
    const now = new Date();

    for (const day = new Date(viewStart); day < viewEnd; day.setDate(day.getDate() + 1)) {
      const currentDay = new Date(day);
      const slotStart = this.withTime(currentDay, '07:00');
      const slotEnd = this.withTime(currentDay, '22:00');
      const daySchedule = this.openingSchedule[currentDay.getDay()];

      if (this.startOfDay(currentDay) < this.startOfDay(now)) {
        maskEvents.push(this.createMaskEvent(slotStart, slotEnd, ['invalid-slot-background', 'is-past-slot']));
        continue;
      }

      if (!daySchedule || daySchedule.intervals.length === 0) {
        maskEvents.push(this.createMaskEvent(slotStart, slotEnd, ['invalid-slot-background']));
        continue;
      }

      let cursor = new Date(slotStart);

      for (const interval of daySchedule.intervals) {
        const intervalStart = this.withTime(currentDay, interval.start);
        const intervalEnd = this.withTime(currentDay, interval.end);

        if (cursor < intervalStart) {
          maskEvents.push(this.createMaskEvent(cursor, intervalStart, ['invalid-slot-background']));
        }

        cursor = new Date(intervalEnd);
      }

      if (cursor < slotEnd) {
        maskEvents.push(this.createMaskEvent(cursor, slotEnd, ['invalid-slot-background']));
      }

      if (currentDay.toDateString() === now.toDateString()) {
        const pastEnd = new Date(now);

        if (pastEnd > slotStart) {
          maskEvents.push(this.createMaskEvent(slotStart, pastEnd, ['invalid-slot-background', 'is-past-slot']));
        }
      }
    }

    return maskEvents;
  }

  private createMaskEvent(start: Date, end: Date, classNames: string[]): EventInput {
    return {
      start,
      end,
      display: 'background',
      overlap: false,
      classNames
    };
  }

  private withTime(baseDate: Date, time: string): Date {
    const [hours, minutes] = time.split(':').map(Number);
    const date = new Date(baseDate);
    date.setHours(hours, minutes, 0, 0);
    return date;
  }

  private startOfDay(date: Date): Date {
    const day = new Date(date);
    day.setHours(0, 0, 0, 0);
    return day;
  }

  private refreshCalendarEvents(): void {
    this.availabilityMaskEvents = this.buildAvailabilityMaskEvents();
    const calendarEvents = [
      ...this.availabilityMaskEvents,
      ...this.events
    ];

    const calendarApi = this.calendarComponent?.getApi();
    if (!calendarApi) {
      this.calendarOptions = {
        ...this.calendarOptions,
        events: calendarEvents
      };
      return;
    }

    calendarApi.removeAllEvents();
    calendarApi.addEventSource(calendarEvents);
    this.forceViewRefresh(true);
  }

  private forceViewRefresh(resizeCalendar = false): void {
    this.cdr.detectChanges();

    if (resizeCalendar && this.calendarComponent) {
      this.calendarComponent.getApi().updateSize();
    }
  }

  private syncCalendarResponsiveMode(): void {
    const nextIsMobile = typeof window !== 'undefined' && window.innerWidth <= this.mobileBreakpoint;

    if (this.isMobileCalendar === nextIsMobile && this.calendarComponent) {
      return;
    }

    this.isMobileCalendar = nextIsMobile;
    const nextView = this.getResponsiveCalendarView();
    const nextToolbarRight = this.getResponsiveToolbarRight();

    this.calendarOptions = {
      ...this.calendarOptions,
      initialView: nextView,
      headerToolbar: {
        ...this.calendarOptions.headerToolbar,
        left: 'prev,next today',
        center: 'title',
        right: nextToolbarRight
      }
    };

    if (this.calendarComponent) {
      const calendarApi = this.calendarComponent.getApi();
      calendarApi.setOption('headerToolbar', {
        left: 'prev,next today',
        center: 'title',
        right: nextToolbarRight
      });
      calendarApi.changeView(nextView);
    }

    this.cdr.detectChanges();
  }

  private getResponsiveCalendarView(): 'timeGridWeek' | 'timeGridDay' {
    return this.isMobileCalendar ? 'timeGridDay' : 'timeGridWeek';
  }

  private getResponsiveToolbarRight(): string {
    return this.isMobileCalendar ? '' : 'timeGridWeek,timeGridDay';
  }

  private syncDatePickerValue(fallbackDate: Date): void {
    const activeDate = this.calendarComponent ? this.calendarComponent.getApi().getDate() : fallbackDate;
    this.calendarDatePickerValue = this.formatDateForInput(activeDate);
    this.syncCalendarPickerMonth(activeDate);
  }

  private scrollCalendarToCurrentTimeIfNeeded(rangeStart: Date, rangeEnd: Date): void {
    if (!this.calendarComponent) {
      return;
    }

    const now = new Date();
    if (now < rangeStart || now >= rangeEnd) {
      return;
    }

    if (this.calendarScrollTimeout) {
      clearTimeout(this.calendarScrollTimeout);
    }

    this.calendarScrollTimeout = setTimeout(() => {
      if (!this.calendarComponent) {
        return;
      }

      this.calendarComponent.getApi().scrollToTime(this.getCalendarScrollTimeForNow());
    }, 60);
  }

  private getCalendarScrollTimeForNow(): string {
    const now = new Date();
    const minutesNow = now.getHours() * 60 + now.getMinutes();
    const minMinutes = 7 * 60;
    const maxMinutes = 21 * 60;
    const targetMinutes = Math.max(minMinutes, Math.min(maxMinutes, minutesNow - 30));
    const hours = `${Math.floor(targetMinutes / 60)}`.padStart(2, '0');
    const minutes = `${targetMinutes % 60}`.padStart(2, '0');

    return `${hours}:${minutes}:00`;
  }

  private formatDateForInput(date: Date): string {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private parseInputDate(value: string): Date | null {
    if (!value) {
      return null;
    }

    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private syncCalendarPickerMonth(baseDate: Date): void {
    this.calendarPickerMonth = new Date(baseDate.getFullYear(), baseDate.getMonth(), 1);
    this.calendarPickerDays = this.buildCalendarPickerDays(this.calendarPickerMonth, this.calendarDatePickerValue);
  }

  private buildCalendarPickerDays(monthDate: Date, selectedValue: string): CalendarPickerDay[] {
    const firstDayOfMonth = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
    const start = new Date(firstDayOfMonth);
    const firstWeekday = (firstDayOfMonth.getDay() + 6) % 7;
    start.setDate(start.getDate() - firstWeekday);

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

  private syncCalendarTitleState(): void {
    if (typeof document === 'undefined') {
      return;
    }

    const title = document.querySelector('.fc-toolbar-title');

    if (!title) {
      return;
    }

    title.classList.toggle('is-picker-open', this.calendarPickerOpen && !this.calendarPickerClosing);
  }

  private updateCalendarPickerPosition(): void {
    if (typeof document === 'undefined') {
      return;
    }

    const wrapper = document.querySelector('.management-appointments-section .calendar-wrapper') as HTMLElement | null;
    const title = wrapper?.querySelector('.fc-toolbar-title') as HTMLElement | null;

    if (!wrapper || !title) {
      this.calendarPickerPanelStyle = {};
      return;
    }

    const wrapperRect = wrapper.getBoundingClientRect();
    const titleRect = title.getBoundingClientRect();
    const panelWidth = Math.min(Math.max(wrapperRect.width - 32, 280), 394);
    const minLeft = 16 + panelWidth / 2;
    const maxLeft = Math.max(minLeft, wrapperRect.width - 16 - panelWidth / 2);
    const centeredLeft = titleRect.left - wrapperRect.left + titleRect.width / 2;
    const left = Math.min(Math.max(centeredLeft, minLeft), maxLeft);
    const top = Math.max(titleRect.bottom - wrapperRect.top + 14, 92);

    this.calendarPickerPanelStyle = {
      top: `${top}px`,
      left: `${left}px`,
      width: `${panelWidth}px`
    };
  }

  private renderAppointmentEvent(arg: EventContentArg): { html: string } {
    if (arg.event.display === 'background') {
      return { html: '' };
    }

    const durationMinutes = this.getEventDurationMinutes(arg);
    const isCompactEvent = durationMinutes > 0 && durationMinutes <= 20;
    const isTinyEvent = durationMinutes > 0 && durationMinutes <= 12;
    const title = this.escapeHtml(String(arg.event.extendedProps['displayTitle'] ?? arg.event.title ?? '').trim());
    const serviceName = this.escapeHtml(String(arg.event.extendedProps['serviceName'] ?? '').trim());
    const serviceDescription = this.escapeHtml(String(arg.event.extendedProps['serviceDescription'] ?? '').trim());
    const operatorName = this.escapeHtml(String(arg.event.extendedProps['operatorName'] ?? '').trim());
    const timeText = this.escapeHtml(this.buildEventTimeText(arg));

    return {
      html: `
        <div class="appointment-event-shell${isCompactEvent ? ' is-compact' : ''}${isTinyEvent ? ' is-tiny' : ''}">
          <div class="appointment-event-head">
            <span class="appointment-event-title">${title || 'Appuntamento'}</span>
          </div>
          <div class="appointment-event-expand">
            <span class="appointment-event-time">${timeText}</span>
            ${isCompactEvent ? `<div class="appointment-event-compact-row">${serviceName ? `<span class="appointment-event-service-inline">${serviceName}</span>` : ''}</div>` : (serviceName ? `<span class="appointment-event-info"><strong>Servizio:</strong> ${serviceName}</span>` : '')}
            ${serviceDescription ? `<span class="appointment-event-info"><strong>Descrizione:</strong> ${serviceDescription}</span>` : ''}
            ${operatorName ? `<span class="appointment-event-info"><strong>Operatore:</strong> ${operatorName}</span>` : ''}
          </div>
        </div>
      `
    };
  }

  private getEventDurationMinutes(arg: EventContentArg): number {
    const start = arg.event.start;
    const end = arg.event.end;

    if (!(start instanceof Date) || !(end instanceof Date)) {
      return 0;
    }

    const diffMs = end.getTime() - start.getTime();
    if (!Number.isFinite(diffMs) || diffMs <= 0) {
      return 0;
    }

    return Math.round(diffMs / 60000);
  }

  private buildEventTimeText(arg: EventContentArg): string {
    const actualStart = this.parseEventDateValue(arg.event.extendedProps['actualStart']) ?? arg.event.start;
    const actualEnd = this.parseEventDateValue(arg.event.extendedProps['actualEnd']) ?? arg.event.end;

    if (!(actualStart instanceof Date) || !(actualEnd instanceof Date)) {
      return arg.timeText || '';
    }

    if (Number.isNaN(actualStart.getTime()) || Number.isNaN(actualEnd.getTime())) {
      return arg.timeText || '';
    }

    const formatter = new Intl.DateTimeFormat('it-IT', {
      hour: '2-digit',
      minute: '2-digit'
    });

    return `${formatter.format(actualStart)} - ${formatter.format(actualEnd)}`;
  }

  private parseEventDateValue(value: unknown): Date | null {
    if (typeof value !== 'string' || !value) {
      return null;
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}


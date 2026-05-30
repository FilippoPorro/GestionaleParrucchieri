import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FullCalendarComponent, FullCalendarModule } from '@fullcalendar/angular';
import { CalendarOptions, EventContentArg, EventInput } from '@fullcalendar/core';
import interactionPlugin from '@fullcalendar/interaction';
import itLocale from '@fullcalendar/core/locales/it';
import timeGridPlugin from '@fullcalendar/timegrid';
import { timeout } from 'rxjs/operators';
import { Appuntamento } from '../../models/appuntamento.model';
import { Utente } from '../../models/utente.model';
import { AppuntamentoService } from '../../services/appuntamentoService';
import { AuthService } from '../../services/auth';
import { UtentiService } from '../../services/utentiService';
import { SidenavComponent } from '../sidenav.component/sidenav.component';

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

interface PermissionSlotForm {
  date: string;
  endDate: string;
  startTime: string;
  endTime: string;
  note: string;
}

@Component({
  selector: 'app-staff.component',
  standalone: true,
  imports: [CommonModule, FormsModule, FullCalendarModule, SidenavComponent],
  templateUrl: './staff.component.html',
  styleUrls: [
    '../clienti.component/clienti.component.css',
    '../appuntamenti-gestionale.component/appuntamenti-gestionale.component.css',
    '../../features/appuntamenti.component/appuntamenti.component.css',
    './staff.component.css'
  ],
})
export class StaffComponent implements OnInit, OnDestroy {
  @ViewChild('calendar') calendarComponent?: FullCalendarComponent;
  @ViewChild('calendarSection') calendarSection?: ElementRef<HTMLElement>;
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
  staff: Utente[] = [];
  selectedOperator: number | null = null;
  searchTerm = '';
  isLoadingStaff = true;
  isLoadingCalendar = false;
  isCreatingEmptySlot = false;
  feedbackMessage = '';
  feedbackType: 'success' | 'error' | '' = '';
  feedbackTitle = '';
  calendarMessage = '';
  calendarDatePickerValue = '';
  calendarPickerOpen = false;
  calendarPickerClosing = false;
  calendarPickerMonth = new Date();
  calendarPickerDays: CalendarPickerDay[] = [];
  calendarPickerPanelStyle: Record<string, string> = {};
  readonly calendarPickerWeekdays = ['Lu', 'Ma', 'Me', 'Gi', 'Ve', 'Sa', 'Do'];
  readonly calendarPickerMonthFormatter = new Intl.DateTimeFormat('it-IT', { month: 'long', year: 'numeric' });
  isMobileCalendar = false;
  events: EventInput[] = [];
  availabilityMaskEvents: EventInput[] = [];
  selectedAppointment: Appuntamento | null = null;
  selectedAppointmentLabel = '';
  isAppointmentDetailOpen = false;
  isAppointmentDetailClosing = false;
  appointmentDetailToneClass = 'tone-my';
  isPermissionModalOpen = false;
  isFerieModalOpen = false;
  ferieForm = {
    startDate: '',
    endDate: ''
  };
  permissionSlotForm: PermissionSlotForm = {
    date: '',
    endDate: '',
    startTime: '',
    endTime: '',
    note: ''
  };
  availableStartTimes: string[] = [];
  availableEndTimes: string[] = [];
  minDate = '';
  private feedbackTimeout: ReturnType<typeof setTimeout> | null = null;
  private calendarMessageTimeout: ReturnType<typeof setTimeout> | null = null;
  private calendarPickerCloseTimeout: ReturnType<typeof setTimeout> | null = null;
  private calendarScrollTimeout: ReturnType<typeof setTimeout> | null = null;
  private appointmentDetailCloseTimeout: ReturnType<typeof setTimeout> | null = null;
  private calendarDayRolloverTimeout: ReturnType<typeof setTimeout> | null = null;
  private visibleRangeStart: Date | null = null;
  private visibleRangeEnd: Date | null = null;
  private calendarTitleElement: HTMLElement | null = null;
  private readonly calendarTitleClickHandler = (event: Event): void => {
    event.preventDefault();
    event.stopPropagation();
    this.toggleCalendarPicker();
  };
  private readonly calendarTitleKeydownHandler = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.toggleCalendarPicker();
  };

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
    selectMirror: false,
    selectAllow: this.handleSelectAllow.bind(this),
    businessHours: [
      { daysOfWeek: [2, 4], startTime: '08:00', endTime: '12:30' },
      { daysOfWeek: [2, 4], startTime: '14:00', endTime: '19:30' },
      { daysOfWeek: [3], startTime: '13:00', endTime: '21:30' },
      { daysOfWeek: [5], startTime: '07:00', endTime: '19:30' },
      { daysOfWeek: [6], startTime: '07:00', endTime: '18:00' }
    ],
    datesSet: this.handleDatesSet.bind(this),
    dateClick: this.handleDateClick.bind(this),
    select: this.handleSlotSelect.bind(this),
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
    private readonly utentiService: UtentiService,
    private readonly appuntamentoService: AppuntamentoService,
    private readonly authService: AuthService,
    private readonly cdr: ChangeDetectorRef,
    private readonly elementRef: ElementRef<HTMLElement>
  ) {}

  ngOnInit(): void {
    this.syncCalendarResponsiveMode();
    this.calendarDatePickerValue = this.formatDateForInput(new Date());
    this.minDate = this.formatDateForInput(new Date());
    this.syncCalendarPickerMonth(new Date());
    this.scheduleCalendarDayRollover();
    this.loadStaff();
  }

  ngOnDestroy(): void {
    this.detachCalendarTitleHandlers();

    if (this.feedbackTimeout) {
      clearTimeout(this.feedbackTimeout);
      this.feedbackTimeout = null;
    }

    this.clearCalendarMessageTimer();

    if (this.calendarPickerCloseTimeout) {
      clearTimeout(this.calendarPickerCloseTimeout);
      this.calendarPickerCloseTimeout = null;
    }

    if (this.calendarScrollTimeout) {
      clearTimeout(this.calendarScrollTimeout);
      this.calendarScrollTimeout = null;
    }

    if (this.appointmentDetailCloseTimeout) {
      clearTimeout(this.appointmentDetailCloseTimeout);
      this.appointmentDetailCloseTimeout = null;
    }

    this.clearCalendarDayRollover();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;

    if (
      target?.closest('.appointments-date-picker-panel') ||
      target?.closest('.fc-toolbar-title')
    ) {
      return;
    }

    this.closeCalendarPicker();
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    this.syncCalendarResponsiveMode();
    this.updateCalendarPickerPosition();
  }

  get filteredStaff(): Utente[] {
    const term = this.searchTerm.trim().toLowerCase();

    if (!term) {
      return this.staff;
    }

    return this.staff.filter((utente) =>
      [
        utente.nome,
        utente.cognome,
        utente.email,
        utente.telefono,
        utente.ruolo,
        String(utente.idUtente)
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term))
    );
  }

  get titolariCount(): number {
    return this.staff.filter((utente) => this.normalizeRole(utente.ruolo) === 'titolare').length;
  }

  get operatoriCount(): number {
    return this.staff.filter((utente) => this.normalizeRole(utente.ruolo) === 'operatore').length;
  }

  get selectedOperatorLabel(): string {
    const operatore = this.staff.find((item) => item.idUtente === this.selectedOperator);
    return operatore ? `${operatore.nome} ${operatore.cognome}` : 'Seleziona staff';
  }

  toggleSidenav(): void {
    this.isSidenavCollapsed = !this.isSidenavCollapsed;
  }

  loadStaff(): void {
    this.isLoadingStaff = true;
    this.clearFeedback();
    this.refreshView();

    this.utentiService.getOperatori().pipe(timeout(8000)).subscribe({
      next: (staff) => {
        this.staff = staff;
        this.selectedOperator = this.selectedOperator ?? staff[0]?.idUtente ?? null;
        this.isLoadingStaff = false;
        this.refreshView();
        this.loadAppointments();
      },
      error: (error) => {
        this.isLoadingStaff = false;
        this.showFeedback(
          'Impossibile caricare lo staff. Controlla che backend e database siano disponibili.',
          'error',
          'Caricamento non riuscito'
        );
        this.refreshView();
      }
    });
  }

  selectOperator(utente: Utente): void {
    if (this.selectedOperator === utente.idUtente) {
      this.scrollToCalendarSection();
      return;
    }

    this.selectedOperator = utente.idUtente;
    this.loadAppointments();
    this.scrollToCalendarSection();
  }

  private loadAppointments(): void {
    if (!this.selectedOperator) {
      this.events = [];
      this.availabilityMaskEvents = [];
      this.syncCalendarEvents();
      return;
    }

    this.isLoadingCalendar = true;
    this.refreshView();

    this.appuntamentoService.getAppuntamenti(this.selectedOperator).subscribe({
      next: (appointments) => {
        this.events = appointments
          .map((appointment) => this.mapAppointmentToEvent(appointment));
        this.isLoadingCalendar = false;
        this.availabilityMaskEvents = this.buildAvailabilityMaskEvents();
        this.syncCalendarEvents();
        this.refreshView();
      },
      error: (error) => {
        this.isLoadingCalendar = false;
        this.showFeedback('Non riesco a caricare gli appuntamenti dello staff selezionato.', 'error', 'Calendario non disponibile');
        this.refreshView();
      }
    });
  }

  private handleDateClick(arg: any): void {
    const clickedDate = arg.date instanceof Date ? arg.date : new Date(arg.date);

    if (!this.isBookableDateTime(clickedDate)) {
      this.calendarComponent?.getApi()?.unselect();
      this.showCalendarMessage(this.getInvalidSlotMessage(clickedDate));
      return;
    }

    const end = new Date(clickedDate);
    end.setMinutes(end.getMinutes() + this.minimumAppointmentDurationMinutes);
    this.openPermissionModal(clickedDate, end);
  }

  private handleSlotSelect(arg: any): void {
    const start = arg.start instanceof Date ? arg.start : new Date(arg.start);
    const end = arg.end instanceof Date ? arg.end : new Date(arg.end);
    
    const calendarApi = this.calendarComponent?.getApi();
    if (calendarApi) {
      calendarApi.unselect();
    }
    
    this.openPermissionModal(start, end);
  }

  private handleSelectAllow(selectInfo: { start: Date; end: Date }): boolean {
    return this.isBookableDateTime(selectInfo.start) && this.isRangeWithinOpeningHours(selectInfo.start, selectInfo.end);
  }

  private handleDatesSet(arg: { start: Date; end: Date }): void {
    this.visibleRangeStart = arg.start;
    this.visibleRangeEnd = arg.end;
    this.syncDatePickerValue(arg.start);
    this.setupClickableCalendarTitle();
    this.updateCalendarPickerPosition();
    this.availabilityMaskEvents = this.buildAvailabilityMaskEvents();
    this.syncCalendarEvents();
    this.scrollCalendarToCurrentTimeIfNeeded(arg.start, arg.end);
  }

  private handleEventClick(arg: any): void {
    if (arg.event?.display === 'background') {
      const startDate = arg.event.start instanceof Date ? arg.event.start : new Date(arg.event.start);
      this.showCalendarMessage(this.getInvalidSlotMessage(startDate));
      return;
    }

    const appointment = arg.event?.extendedProps?.['appointment'] as Appuntamento | undefined;

    if (appointment) {
      this.openAppointmentDetail(appointment);
    }
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
    this.refreshView();
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
      this.refreshView();
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

    const calendarApi = this.calendarComponent?.getApi();
    if (calendarApi) {
      calendarApi.gotoDate(this.calendarDatePickerValue);

      if (this.isMobileCalendar) {
        calendarApi.changeView('timeGridDay', this.calendarDatePickerValue);
      }
    }

    this.syncCalendarPickerMonth(day.date);
    this.closeCalendarPicker();
  }

  get calendarPickerMonthLabel(): string {
    const label = this.calendarPickerMonthFormatter.format(this.calendarPickerMonth);
    return label.charAt(0).toUpperCase() + label.slice(1);
  }

  private mapAppointmentToEvent(appointment: Appuntamento): EventInput {
    const normalizedStart = this.normalizeDateTimeForCalendar(appointment.dataOraInizio);
    const normalizedEnd = this.normalizeDateTimeForCalendar(appointment.dataOraFine);
    const calendarEnd = this.getCalendarEventEnd(normalizedStart, normalizedEnd);
    const isPastAppointment = this.isPastAppointment(appointment);
    const isPermission = this.isPermissionAppointment(appointment);
    const isFerie = isPermission && appointment.note === 'Ferie';
    const serviceName = isFerie ? 'Ferie' : (isPermission ? 'Permesso' : this.getAppointmentLabel(appointment));

    return {
      id: String(appointment.idAppuntamento),
      title: serviceName,
      start: normalizedStart,
      end: calendarEnd,
      classNames: [
        isFerie ? 'ferie-appointment' : (isPermission ? 'permission-appointment' : (isPastAppointment ? 'past-appointment' : 'my-appointment'))
      ],
      extendedProps: {
        appointment,
        actualStart: normalizedStart,
        actualEnd: normalizedEnd,
        displayTitle: serviceName,
        serviceName,
        serviceDescription: appointment.note || '',
        operatorName: this.selectedOperatorLabel,
        isVisible: true
      }
    };
  }

  isPermissionAppointment(appointment: Appuntamento): boolean {
    return !appointment.idCliente;
  }

  openPermissionModal(start: Date, end: Date): void {
    if (!this.authService.isTitolare()) {
      this.showFeedback('Solo i titolari possono aggiungere un permesso.', 'error', 'Permesso negato');
      return;
    }

    if (!this.selectedOperator) {
      this.showFeedback('Seleziona una persona del personale prima di aggiungere un permesso.', 'error', 'Persona non selezionata');
      return;
    }

    if (!this.isBookableDateTime(start) || Number.isNaN(end.getTime()) || end <= start) {
      this.showFeedback('Seleziona una fascia futura valida.', 'error', 'Fascia non valida');
      return;
    }

    this.permissionSlotForm = {
      date: this.formatDateForInput(start),
      endDate: this.formatDateForInput(start),
      startTime: this.formatTimeForInput(start),
      endTime: this.formatTimeForInput(end),
      note: ''
    };
    this.updateAvailableTimes();
    this.isPermissionModalOpen = true;
    this.refreshView();
  }

  closePermissionModal(): void {
    if (this.isCreatingEmptySlot) {
      return;
    }

    this.isPermissionModalOpen = false;
    this.permissionSlotForm = {
      date: '',
      endDate: '',
      startTime: '',
      endTime: '',
      note: ''
    };
    this.refreshView();
  }

  confirmPermissionSlot(): void {
    const dateVal = this.permissionSlotForm.date;
    const start = this.buildDateFromPermissionForm(dateVal, this.permissionSlotForm.startTime);
    const end = this.buildDateFromPermissionForm(dateVal, this.permissionSlotForm.endTime);

    if (!start || !end || end <= start) {
      this.showFeedback('Completa i campi della data e delle ore del permesso.', 'error', 'Campi mancanti');
      return;
    }

    this.createEmptySlots([{ start, end }], this.permissionSlotForm.note || null);
  }

  openFerieModal(): void {
    if (!this.authService.isTitolare()) {
      this.showFeedback('Solo i titolari possono aggiungere le ferie.', 'error', 'Permesso negato');
      return;
    }

    if (!this.selectedOperator) {
      this.showFeedback('Seleziona una persona del personale prima di aggiungere le ferie.', 'error', 'Persona non selezionata');
      return;
    }

    const todayStr = this.formatDateForInput(new Date());
    this.ferieForm = {
      startDate: todayStr,
      endDate: todayStr
    };
    this.isFerieModalOpen = true;
    this.refreshView();
  }

  closeFerieModal(): void {
    if (this.isCreatingEmptySlot) {
      return;
    }
    this.isFerieModalOpen = false;
    this.ferieForm = {
      startDate: '',
      endDate: ''
    };
    this.refreshView();
  }

  onFerieModalOverlayClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.closeFerieModal();
    }
  }

  onFerieStartDateChange(): void {
    if (!this.ferieForm.endDate || this.ferieForm.endDate < this.ferieForm.startDate) {
      this.ferieForm.endDate = this.ferieForm.startDate;
    }
  }

  confirmFerie(): void {
    const startDateVal = this.ferieForm.startDate;
    const endDateVal = this.ferieForm.endDate || startDateVal;

    const startDay = new Date(`${startDateVal}T00:00:00`);
    const endDay = new Date(`${endDateVal}T00:00:00`);

    if (Number.isNaN(startDay.getTime()) || Number.isNaN(endDay.getTime()) || endDay < startDay) {
      this.showFeedback('Completa la data inizio e data fine delle ferie.', 'error', 'Campi mancanti');
      return;
    }

    const datesToCreate: { start: Date; end: Date }[] = [];
    const current = new Date(startDay);

    while (current <= endDay) {
      const year = current.getFullYear();
      const month = current.getMonth();
      const date = current.getDate();

      const dayStart = new Date(year, month, date, 0, 0, 0);
      const dayEnd = new Date(year, month, date, 23, 59, 59);
      
      datesToCreate.push({ start: dayStart, end: dayEnd });
      current.setDate(current.getDate() + 1);
    }

    this.createEmptySlots(datesToCreate, 'Ferie', () => {
      this.closeFerieModal();
    });
  }

  private createEmptySlots(slots: { start: Date; end: Date }[], note: string | null = null, onSuccess?: () => void): void {
    if (!this.authService.isTitolare()) {
      this.showFeedback('Solo i titolari possono aggiungere uno spazio vuoto.', 'error', 'Permesso negato');
      return;
    }

    if (!this.selectedOperator) {
      this.showFeedback('Seleziona una persona del personale prima di aggiungere un permesso.', 'error', 'Persona non selezionata');
      return;
    }

    if (slots.length === 0) {
      this.showFeedback('Nessun giorno lavorativo selezionato nel periodo indicato o il salone è chiuso.', 'error', 'Periodo non valido');
      return;
    }

    this.isCreatingEmptySlot = true;
    this.clearFeedback();
    this.refreshView();

    const requests = slots.map(slot => 
      this.appuntamentoService.creaSlotVuoto({
        idOperatore: this.selectedOperator!,
        dataOraInizio: this.toLocalDateTimeString(slot.start),
        dataOraFine: this.toLocalDateTimeString(slot.end),
        note: note
      })
    );

    import('rxjs').then(({ forkJoin }) => {
      forkJoin(requests).subscribe({
        next: () => {
          const successMsg = slots.length > 1
            ? `${slots.length} fasce orarie bloccate con successo.`
            : 'Permesso creato con successo.';
          this.showFeedback(successMsg, 'success', 'Salvataggio completato');
          this.isCreatingEmptySlot = false;
          
          if (onSuccess) {
            onSuccess();
          } else {
            this.closePermissionModal();
          }
          this.loadAppointments();
        },
        error: (error) => {
          this.isCreatingEmptySlot = false;
          this.showFeedback(
            error?.error?.message || 'Non riesco ad aggiungere i permessi o ferie selezionati.',
            'error',
            'Spazio non salvato'
          );
          this.refreshView();
        }
      });
    }).catch(err => {
      this.isCreatingEmptySlot = false;
      this.refreshView();
    });
  }

  onPermissionDateChange(): void {
    if (!this.permissionSlotForm.endDate || this.permissionSlotForm.endDate < this.permissionSlotForm.date) {
      this.permissionSlotForm.endDate = this.permissionSlotForm.date;
    }
    this.updateAvailableTimes();
  }

  updateAvailableTimes(): void {
    const selectedDate = this.parseInputDate(this.permissionSlotForm.date);
    if (!selectedDate) {
      this.availableStartTimes = [];
      this.availableEndTimes = [];
      return;
    }

    const daySchedule = this.openingSchedule[selectedDate.getDay()];
    if (!daySchedule || daySchedule.intervals.length === 0) {
      this.availableStartTimes = [];
      this.availableEndTimes = [];
      return;
    }

    const now = new Date();
    const isToday = selectedDate.toDateString() === now.toDateString();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    const starts: string[] = [];
    const ends: string[] = [];

    for (const interval of daySchedule.intervals) {
      const startMin = this.timeToMinutes(interval.start);
      const endMin = this.timeToMinutes(interval.end);

      for (let min = startMin; min < endMin; min += 30) {
        if (isToday && min <= currentMinutes) {
          continue;
        }
        starts.push(this.minutesToTime(min));
      }

      for (let min = startMin + 30; min <= endMin; min += 30) {
        if (isToday && min <= currentMinutes + 15) {
          continue;
        }
        ends.push(this.minutesToTime(min));
      }
    }

    this.availableStartTimes = starts;
    this.availableEndTimes = ends;

    if (!this.availableStartTimes.includes(this.permissionSlotForm.startTime)) {
      this.permissionSlotForm.startTime = this.availableStartTimes[0] || '';
    }

    this.onStartTimeChange();
  }

  onStartTimeChange(): void {
    const startMin = this.timeToMinutes(this.permissionSlotForm.startTime);
    const selectedDate = this.parseInputDate(this.permissionSlotForm.date);
    
    if (!selectedDate) {
      return;
    }

    const daySchedule = this.openingSchedule[selectedDate.getDay()];
    if (!daySchedule) {
      return;
    }

    const validEnds: string[] = [];
    for (const interval of daySchedule.intervals) {
      const intervalStart = this.timeToMinutes(interval.start);
      const intervalEnd = this.timeToMinutes(interval.end);

      if (startMin >= intervalStart && startMin < intervalEnd) {
        for (let min = startMin + 30; min <= intervalEnd; min += 30) {
          validEnds.push(this.minutesToTime(min));
        }
        break;
      }
    }

    this.availableEndTimes = validEnds;

    if (!this.availableEndTimes.includes(this.permissionSlotForm.endTime)) {
      this.permissionSlotForm.endTime = this.availableEndTimes[0] || '';
    }
  }

  private minutesToTime(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
  }

  private getAppointmentLabel(appointment: Appuntamento): string {
    return appointment.servizioNome?.trim()
      || appointment.note?.trim()
      || 'Permesso';
  }

  private buildDateFromPermissionForm(dateValue: string, timeValue: string): Date | null {
    if (!dateValue || !timeValue) {
      return null;
    }

    const date = new Date(`${dateValue}T${timeValue}`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private normalizeDateTimeForCalendar(value: string): string {
    const parsed = new Date(value);

    if (Number.isNaN(parsed.getTime())) {
      return value;
    }

    parsed.setSeconds(0, 0);
    return this.toLocalDateTimeString(parsed);
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

    return this.toLocalDateTimeString(minimumEnd);
  }

  private syncCalendarEvents(): void {
    const calendarEvents = [
      ...this.events,
      ...this.availabilityMaskEvents
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
    this.refreshView();

    setTimeout(() => {
      this.calendarComponent?.getApi()?.updateSize();
    }, 0);
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
    this.refreshView();
  }

  closeAppointmentDetail(): void {
    if (!this.isAppointmentDetailOpen || this.isAppointmentDetailClosing) {
      return;
    }

    this.isAppointmentDetailClosing = true;
    this.refreshView();

    this.appointmentDetailCloseTimeout = setTimeout(() => {
      this.isAppointmentDetailOpen = false;
      this.isAppointmentDetailClosing = false;
      this.selectedAppointment = null;
      this.selectedAppointmentLabel = '';
      this.appointmentDetailCloseTimeout = null;
      this.refreshView();
    }, 220);
  }

  isDeleteConfirmModalOpen = false;

  openDeleteConfirmModal(): void {
    this.isDeleteConfirmModalOpen = true;
    this.refreshView();
  }

  closeDeleteConfirmModal(): void {
    this.isDeleteConfirmModalOpen = false;
    this.refreshView();
  }

  confirmDeletePermission(): void {
    if (!this.selectedAppointment) {
      return;
    }

    this.isDeleteConfirmModalOpen = false;
    this.isLoadingCalendar = true;
    this.refreshView();

    this.appuntamentoService.eliminaAppuntamento(this.selectedAppointment.idAppuntamento).subscribe({
      next: () => {
        this.showFeedback('Permesso eliminato con successo.', 'success', 'Permesso eliminato');
        this.closeAppointmentDetail();
        this.loadAppointments();
      },
      error: (error) => {
        this.isLoadingCalendar = false;
        this.showFeedback('Impossibile eliminare il permesso.', 'error', 'Errore eliminazione');
        this.refreshView();
      }
    });
  }

  onAppointmentModalOverlayClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.closeAppointmentDetail();
    }
  }

  getSelectedAppointmentServiceLabel(): string {
    return this.selectedAppointment ? this.getAppointmentLabel(this.selectedAppointment) : 'Servizio non indicato';
  }

  getSelectedAppointmentOperatorLabel(): string {
    return this.selectedAppointment ? this.selectedOperatorLabel : '';
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

  getInitials(utente: Pick<Utente, 'nome' | 'cognome'>): string {
    const initials = `${utente.nome?.[0] ?? ''}${utente.cognome?.[0] ?? ''}`.trim();
    return initials ? initials.toUpperCase() : 'ST';
  }

  formatDate(value?: string | null): string {
    if (!value) {
      return '-';
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? value
      : new Intl.DateTimeFormat('it-IT').format(date);
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

  private toLocalDateTimeString(date: Date): string {
    const pad = (part: number) => String(part).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  private formatDateForInput(date: Date): string {
    const pad = (part: number) => String(part).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  private formatTimeForInput(date: Date): string {
    const pad = (part: number) => String(part).padStart(2, '0');
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  private parseInputDate(value: string): Date | null {
    if (!value) {
      return null;
    }

    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private normalizeRole(role?: string | null): string {
    return String(role ?? '').trim().toLowerCase();
  }

  private showFeedback(message: string, type: 'success' | 'error', title: string): void {
    if (this.feedbackTimeout) {
      clearTimeout(this.feedbackTimeout);
      this.feedbackTimeout = null;
    }

    this.feedbackMessage = message;
    this.feedbackType = type;
    this.feedbackTitle = title;

    this.feedbackTimeout = setTimeout(() => {
      this.clearFeedback();
      this.refreshView();
    }, 5000);
  }

  clearFeedback(): void {
    if (this.feedbackTimeout) {
      clearTimeout(this.feedbackTimeout);
      this.feedbackTimeout = null;
    }

    this.feedbackMessage = '';
    this.feedbackType = '';
    this.feedbackTitle = '';
  }

  private showCalendarMessage(message: string, autoHideMs = 3200): void {
    this.clearCalendarMessageTimer();
    this.calendarMessage = message;

    if (autoHideMs > 0) {
      this.calendarMessageTimeout = setTimeout(() => {
        this.calendarMessage = '';
        this.calendarMessageTimeout = null;
        this.refreshView();
      }, autoHideMs);
    }

    this.refreshView();
  }

  private clearCalendarMessage(): void {
    this.clearCalendarMessageTimer();
    this.calendarMessage = '';
  }

  private clearCalendarMessageTimer(): void {
    if (this.calendarMessageTimeout) {
      clearTimeout(this.calendarMessageTimeout);
      this.calendarMessageTimeout = null;
    }
  }

  private refreshView(): void {
    this.cdr.detectChanges();
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

    const calendarApi = this.calendarComponent?.getApi();
    if (calendarApi) {
      calendarApi.setOption('headerToolbar', {
        left: 'prev,next today',
        center: 'title',
        right: nextToolbarRight
      });
      calendarApi.changeView(nextView);
    }

    this.refreshView();
  }

  private getResponsiveCalendarView(): 'timeGridWeek' | 'timeGridDay' {
    return this.isMobileCalendar ? 'timeGridDay' : 'timeGridWeek';
  }

  private getResponsiveToolbarRight(): string {
    return this.isMobileCalendar ? '' : 'timeGridWeek,timeGridDay';
  }

  private scheduleCalendarDayRollover(): void {
    this.clearCalendarDayRollover();
    this.calendarDayRolloverTimeout = setTimeout(() => {
      const todayValue = this.formatDateForInput(new Date());
      const calendarApi = this.calendarComponent?.getApi();

      this.calendarDatePickerValue = todayValue;
      this.minDate = todayValue;
      this.syncCalendarPickerMonth(new Date());

      if (calendarApi) {
        calendarApi.gotoDate(todayValue);

        if (this.isMobileCalendar) {
          calendarApi.changeView('timeGridDay', todayValue);
        }
      }

      this.loadAppointments();
      this.scheduleCalendarDayRollover();
      this.refreshView();
    }, this.getMillisecondsUntilNextDay());
  }

  private clearCalendarDayRollover(): void {
    if (this.calendarDayRolloverTimeout) {
      clearTimeout(this.calendarDayRolloverTimeout);
      this.calendarDayRolloverTimeout = null;
    }
  }

  private getMillisecondsUntilNextDay(now = new Date()): number {
    const next = this.startOfDay(now);
    next.setDate(next.getDate() + 1);

    return Math.max(next.getTime() - now.getTime() + 1000, 1000);
  }

  private syncDatePickerValue(fallbackDate: Date): void {
    const activeDate = this.calendarComponent?.getApi()?.getDate() ?? fallbackDate;
    this.calendarDatePickerValue = this.formatDateForInput(activeDate);
    this.syncCalendarPickerMonth(activeDate);
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
    const title = this.elementRef.nativeElement.querySelector('.fc-toolbar-title');

    if (!title) {
      return;
    }

    title.classList.toggle('is-picker-open', this.calendarPickerOpen && !this.calendarPickerClosing);
  }

  private setupClickableCalendarTitle(): void {
    setTimeout(() => {
      const titleElement = this.elementRef.nativeElement.querySelector('.fc-toolbar-title') as HTMLElement | null;

      if (!titleElement) {
        return;
      }

      if (titleElement !== this.calendarTitleElement) {
        this.detachCalendarTitleHandlers();
        this.calendarTitleElement = titleElement;
        this.calendarTitleElement.setAttribute('role', 'button');
        this.calendarTitleElement.setAttribute('tabindex', '0');
        this.calendarTitleElement.setAttribute('title', 'Scegli una data');
        this.calendarTitleElement.addEventListener('click', this.calendarTitleClickHandler);
        this.calendarTitleElement.addEventListener('keydown', this.calendarTitleKeydownHandler);
      }

      this.syncCalendarTitleState();
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

  private updateCalendarPickerPosition(): void {
    const wrapper = this.elementRef.nativeElement.querySelector('.calendar-wrapper') as HTMLElement | null;
    const title = this.elementRef.nativeElement.querySelector('.fc-toolbar-title') as HTMLElement | null;

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

  private scrollCalendarToCurrentTimeIfNeeded(rangeStart: Date, rangeEnd: Date): void {
    const calendarApi = this.calendarComponent?.getApi();
    if (!calendarApi) {
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
      this.calendarComponent?.getApi()?.scrollToTime(this.getCalendarScrollTimeForNow());
    }, 60);
  }

  private scrollToCalendarSection(): void {
    setTimeout(() => {
      this.calendarSection?.nativeElement.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
    }, 80);
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

  private isRangeWithinOpeningHours(startDate: Date, endDate: Date): boolean {
    if (
      Number.isNaN(startDate.getTime()) ||
      Number.isNaN(endDate.getTime()) ||
      startDate.toDateString() !== endDate.toDateString()
    ) {
      return false;
    }

    const daySchedule = this.openingSchedule[startDate.getDay()];

    if (!daySchedule || daySchedule.intervals.length === 0) {
      return false;
    }

    const startMinutes = startDate.getHours() * 60 + startDate.getMinutes();
    const endMinutes = endDate.getHours() * 60 + endDate.getMinutes();

    return daySchedule.intervals.some((interval) => {
      const intervalStart = this.timeToMinutes(interval.start);
      const intervalEnd = this.timeToMinutes(interval.end);
      return startMinutes >= intervalStart && endMinutes <= intervalEnd;
    });
  }

  private getInvalidSlotMessage(date: Date): string {
    if (date < new Date()) {
      return 'Non puoi assegnare permessi in date passate.';
    }

    const daySchedule = this.openingSchedule[date.getDay()];

    if (!daySchedule || daySchedule.intervals.length === 0) {
      return 'Non puoi assegnare permessi quando il negozio e chiuso.';
    }

    return 'Non puoi assegnare permessi quando il negozio e chiuso.';
  }

  private timeToMinutes(value: string): number {
    const [hours, minutes] = value.split(':').map(Number);
    return hours * 60 + minutes;
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

  private isPastAppointment(appointment: Appuntamento): boolean {
    const appointmentEnd = new Date(appointment.dataOraFine);
    return !Number.isNaN(appointmentEnd.getTime()) && appointmentEnd.getTime() < Date.now();
  }

  private getAppointmentToneClass(appointment: Appuntamento): string {
    return this.isPastAppointment(appointment) || appointment.stato === 'completato'
      ? 'tone-past'
      : 'tone-my';
  }

  private buildAppointmentLabel(appointment: Appuntamento): string {
    return this.getAppointmentLabel(appointment);
  }

  private renderAppointmentEvent(arg: EventContentArg): { html: string } {
    if (arg.event.display === 'background') {
      return { html: '' };
    }
    const props = arg.event.extendedProps as {
      displayTitle?: string;
      serviceName?: string;
      serviceDescription?: string;
      operatorName?: string;
      actualStart?: string;
      actualEnd?: string;
    };
    const title = this.escapeHtml(props.displayTitle || arg.event.title || 'Appuntamento');
    const start = props.actualStart || arg.event.start?.toISOString() || '';
    const end = props.actualEnd || arg.event.end?.toISOString() || '';
    const time = this.formatEventTimeRange(start, end);
    const description = this.escapeHtml(props.serviceDescription || props.operatorName || '');

    return {
      html: `
        <div class="appointment-event-shell">
          <div class="appointment-event-head">
            <span class="appointment-event-title">${title}</span>
            <span class="appointment-event-expand"><i class="bi bi-arrows-angle-expand"></i></span>
          </div>
          <div class="appointment-event-time">${time}</div>
          ${description ? `<div class="appointment-event-info">${description}</div>` : ''}
        </div>
      `
    };
  }

  private formatEventTimeRange(startValue: string, endValue: string): string {
    const start = new Date(startValue);
    const end = new Date(endValue);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return '';
    }

    const formatter = new Intl.DateTimeFormat('it-IT', {
      hour: '2-digit',
      minute: '2-digit'
    });

    return `${formatter.format(start)} - ${formatter.format(end)}`;
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}

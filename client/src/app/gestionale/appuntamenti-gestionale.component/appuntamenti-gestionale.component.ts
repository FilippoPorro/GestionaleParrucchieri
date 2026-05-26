import { AfterViewInit, ChangeDetectorRef, Component, HostListener, OnDestroy, OnInit, ViewChild } from '@angular/core';
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
import { Servizio } from '../../models/servizio.model';
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

interface AppointmentEditForm {
  dataOraInizio: string;
  dataOraFine: string;
  idServizio: number | null;
  durataPersonalizzata: number | null;
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
export class AppuntamentiGestionaleComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('calendar') calendarComponent?: FullCalendarComponent;

  private readonly mobileBreakpoint = 768;
  private readonly minimumAppointmentDurationMinutes = 30;
  private readonly calendarViewStorageKey = 'gestionale_appointments_calendar_view';
  private readonly calendarDateStorageKey = 'gestionale_appointments_calendar_date';
  private readonly operatorDaySelectionStorageKey = 'gestionale_appointments_operator_day_selection';
  private readonly operatorDayOrderStorageKey = 'gestionale_appointments_operator_day_order';
  private readonly openingSchedule: Record<number, DailySchedule> = {
    0: { name: 'Domenica', intervals: [] },
    1: { name: 'Lunedi', intervals: [] },
    2: { name: 'Martedi', intervals: [{ start: '08:00', end: '12:30' }, { start: '14:00', end: '19:30' }] },
    3: { name: 'Mercoledi', intervals: [{ start: '13:00', end: '21:30' }] },
    4: { name: 'Giovedi', intervals: [{ start: '08:00', end: '12:30' }, { start: '14:00', end: '19:30' }] },
    5: { name: 'Venerdi', intervals: [{ start: '07:00', end: '19:30' }] },
    6: { name: 'Sabato', intervals: [{ start: '07:00', end: '18:00' }] }
  };
  private readonly initialCalendarView = this.getInitialCalendarView();
  private readonly initialCalendarDate = this.getSavedCalendarDate() ?? new Date();

  isSidenavCollapsed = false;
  operatori: Utente[] = [];
  clienti: Utente[] = [];
  selectedOperator: number | null = null;
  selectedOperatorDayIds = new Set<number>();
  operatorDayOrderIds: number[] = [];
  draggedOperatorDayId: number | null = null;
  suppressNextOperatorClick = false;
  isOperatorDropdownOpen = false;
  isOperatorDayView = this.initialCalendarView === 'operatorDay';
  isLoading = true;
  calendarMessage = '';
  events: EventInput[] = [];
  selectedAppointment: Appuntamento | null = null;
  selectedAppointmentLabel = '';
  isAppointmentDetailOpen = false;
  isAppointmentDetailClosing = false;
  appointmentDetailToneClass = 'tone-my';
  isEditingAppointment = false;
  private isEditingFromCalendarAction = false;
  isAppointmentActionLoading = false;
  isEditFormLoading = false;
  appointmentActionError = '';
  isDeleteConfirmOpen = false;
  deleteConfirmAppointment: Appuntamento | null = null;
  deleteConfirmKeepDetailOpen = false;
  editableServices: Servizio[] = [];
  appointmentEditForm: AppointmentEditForm = {
    dataOraInizio: '',
    dataOraFine: '',
    idServizio: null,
    durataPersonalizzata: null
  };
  private originalAppointmentEditForm: AppointmentEditForm = {
    dataOraInizio: '',
    dataOraFine: '',
    idServizio: null,
    durataPersonalizzata: null
  };
  editStartDate = '';
  editStartTime = '';
  editDatePickerOpen = false;
  editDatePickerClosing = false;
  editDatePickerMonth = new Date();
  editDatePickerDays: CalendarPickerDay[] = [];
  editServicesOpen = false;
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
  private editDatePickerCloseTimeout: ReturnType<typeof setTimeout> | null = null;
  private calendarMessageTimeout: ReturnType<typeof setTimeout> | null = null;
  private calendarDayRolloverTimeout: ReturnType<typeof setTimeout> | null = null;
  private calendarResizeObserver: ResizeObserver | null = null;
  private availabilityMaskEvents: EventInput[] = [];
  private loadedAppointments: Appuntamento[] = [];
  private serviceDescriptionByName = new Map<string, string>();
  private visibleRangeStart: Date | null = null;
  private visibleRangeEnd: Date | null = null;
  private operatorDayDate = this.startOfDay(this.initialCalendarDate);
  private operatorDayAnchorDate = this.startOfDay(this.initialCalendarDate);

  calendarOptions: CalendarOptions = {
    plugins: [timeGridPlugin, interactionPlugin],
    initialView: this.initialCalendarView,
    initialDate: this.formatDateForInput(this.initialCalendarDate),
    views: this.getOperatorDayViewsOption(),
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
    nowIndicator: this.initialCalendarView !== 'operatorDay' || this.isSameLocalDay(this.initialCalendarDate, new Date()),
    stickyHeaderDates: true,
    selectable: false,
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
    dayHeaderContent: this.renderDayHeader.bind(this),
    eventOverlap: false,
    slotEventOverlap: false,
    eventMinHeight: 0,
    eventShortHeight: 0,
    headerToolbar: {
      left: 'managementPrev,managementNext managementToday',
      center: 'title',
      right: this.getResponsiveToolbarRight()
    },
    customButtons: {
      managementPrev: {
        icon: 'chevron-left',
        hint: 'Periodo precedente',
        click: this.goToPreviousCalendarPeriod.bind(this)
      },
      managementNext: {
        icon: 'chevron-right',
        hint: 'Periodo successivo',
        click: this.goToNextCalendarPeriod.bind(this)
      },
      managementToday: {
        text: 'Oggi',
        click: this.goToToday.bind(this)
      }
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
    this.calendarDatePickerValue = this.formatDateForInput(this.initialCalendarDate);
    this.syncCalendarPickerMonth(this.initialCalendarDate);
    this.scheduleCalendarDayRollover();

    forkJoin({
      operatori: this.utentiService.getOperatori(),
      clienti: this.utentiService.getClienti()
    }).subscribe({
      next: ({ operatori, clienti }) => {
        this.operatori = this.sortOperatorsById(operatori);
        this.clienti = clienti;
        const savedOperator = localStorage.getItem('gestionale_selected_operator');
        if (savedOperator && operatori.some(o => o.idUtente === Number(savedOperator))) {
          this.selectedOperator = Number(savedOperator);
        } else {
          this.selectedOperator = operatori[0]?.idUtente ?? null;
        }
        this.syncOperatorDaySelectionWithOperators();
        this.updateOperatorDayViewDuration();
        this.cdr.detectChanges();
        this.loadAppointments();
      },
      error: (error) => {
        console.error('Errore caricamento dati calendario gestionale:', error);
        this.isLoading = false;
        this.showCalendarMessage('Non riesco a caricare operatori e clienti.');
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

    if (this.editDatePickerCloseTimeout) {
      clearTimeout(this.editDatePickerCloseTimeout);
      this.editDatePickerCloseTimeout = null;
    }

    this.clearCalendarDayRollover();
    this.clearCalendarMessageTimer();

    if (this.calendarResizeObserver) {
      this.calendarResizeObserver.disconnect();
      this.calendarResizeObserver = null;
    }
  }

  ngAfterViewInit(): void {
    this.observeCalendarWrapperResize();
    this.resizeCalendarAroundLayoutChange();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;

    if (target?.closest('.management-appointments-section .calendar-wrapper .fc-toolbar-title')) {
      this.toggleCalendarPicker();
      this.isOperatorDropdownOpen = false;
      return;
    }

    if (target?.closest('.appointments-date-picker-panel')) {
      return;
    }

    if (target?.closest('.appointment-edit-date-wrap')) {
      this.closeCalendarPicker();
      return;
    }

    if (target?.closest('.appointment-services-picker-wrap')) {
      this.closeCalendarPicker();
      return;
    }

    if (target?.closest('.appointments-select-wrapper')) {
      this.closeCalendarPicker();
      return;
    }

    this.closeCalendarPicker();
    this.closeEditDatePicker();
    this.closeEditServicesPicker();
    this.isOperatorDropdownOpen = false;
  }

  @HostListener('document:keydown.escape')
  onEscapePressed(): void {
    if (this.isDeleteConfirmOpen) {
      this.cancelDeleteConfirmation();
      return;
    }

    if (this.editServicesOpen) {
      this.closeEditServicesPicker();
      return;
    }

    if (this.editDatePickerOpen) {
      this.closeEditDatePicker();
      return;
    }

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
    this.setSidenavCollapsed(!this.isSidenavCollapsed);
  }

  setSidenavCollapsed(isCollapsed: boolean): void {
    if (this.isSidenavCollapsed === isCollapsed) {
      this.resizeCalendarAroundLayoutChange();
      return;
    }

    this.isSidenavCollapsed = isCollapsed;
    this.resizeCalendarAroundLayoutChange();
  }

  selectOperator(idOperatore: number | null): void {
    this.isOperatorDropdownOpen = false;

    if (this.selectedOperator === idOperatore) {
      return;
    }

    this.selectedOperator = idOperatore;
    if (idOperatore) {
      localStorage.setItem('gestionale_selected_operator', idOperatore.toString());
    } else {
      localStorage.removeItem('gestionale_selected_operator');
    }
    this.loadAppointments();
  }

  onOperatorOptionClick(operatore: Utente): void {
    if (this.suppressNextOperatorClick) {
      this.suppressNextOperatorClick = false;
      return;
    }

    if (this.isOperatorDayView) {
      this.toggleOperatorDayVisibility(operatore.idUtente);
      return;
    }

    this.selectOperator(operatore.idUtente);
  }

  toggleOperatorDayVisibility(operatorId: number): void {
    if (!this.isOperatorDayView) {
      return;
    }

    const nextSelection = new Set(this.selectedOperatorDayIds);

    if (nextSelection.has(operatorId)) {
      if (nextSelection.size <= 1) {
        this.showCalendarMessage('Deve rimanere visibile almeno un operatore.');
        return;
      }

      nextSelection.delete(operatorId);
    } else {
      nextSelection.add(operatorId);
    }

    this.selectedOperatorDayIds = nextSelection;
    this.persistOperatorDaySelection();
    this.updateOperatorDayViewDuration();

    const calendarApi = this.calendarComponent?.getApi();
    if (calendarApi) {
      calendarApi.changeView('operatorDay', this.operatorDayAnchorDate);
      this.syncCalendarTitleStateSoon();
    }

    this.loadAppointments();
  }

  toggleOperatorDropdown(): void {
    if (this.isOperatorDropdownDisabled) {
      return;
    }

    this.isOperatorDropdownOpen = !this.isOperatorDropdownOpen;
  }

  get isOperatorDropdownDisabled(): boolean {
    return this.operatori.length === 0;
  }

  get selectedOperatorLabel(): string {
    if (this.isOperatorDayView) {
      const visibleCount = this.getOperatorDayColumnOperators().length;

      if (visibleCount === this.operatori.length) {
        return 'Tutti';
      }

      if (visibleCount === 1) {
        return this.getOperatorLabel(this.getOperatorDayColumnOperators()[0].idUtente);
      }

      return `${visibleCount} operatori`;
    }

    const operatore = this.operatori.find((item) => item.idUtente === this.selectedOperator);
    return operatore ? `${operatore.nome} ${operatore.cognome}` : 'Seleziona operatore';
  }

  get availableOperators(): Utente[] {
    return this.operatori.filter((operatore) => operatore.idUtente !== this.selectedOperator);
  }

  isOperatorVisibleInDay(operatorId: number): boolean {
    return this.selectedOperatorDayIds.has(operatorId);
  }

  get operatorDropdownItems(): Utente[] {
    return this.isOperatorDayView ? this.getOrderedOperatorDayOperators() : this.operatori;
  }

  onOperatorDragStart(event: DragEvent, operatore: Utente): void {
    if (!this.isOperatorDayView) {
      return;
    }

    this.draggedOperatorDayId = operatore.idUtente;
    event.dataTransfer?.setData('text/plain', String(operatore.idUtente));
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
    }
  }

  onOperatorDragOver(event: DragEvent): void {
    if (!this.isOperatorDayView || this.draggedOperatorDayId === null) {
      return;
    }

    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  }

  onOperatorDrop(event: DragEvent, targetOperator: Utente): void {
    if (!this.isOperatorDayView || this.draggedOperatorDayId === null) {
      return;
    }

    event.preventDefault();
    const draggedId = this.draggedOperatorDayId;
    this.draggedOperatorDayId = null;

    if (draggedId === targetOperator.idUtente) {
      this.suppressOperatorClickAfterDrag();
      return;
    }

    const nextOrder = this.getOrderedOperatorDayOperators()
      .map((operatore) => operatore.idUtente)
      .filter((operatorId) => operatorId !== draggedId);
    const targetIndex = nextOrder.indexOf(targetOperator.idUtente);
    nextOrder.splice(targetIndex >= 0 ? targetIndex : nextOrder.length, 0, draggedId);
    this.operatorDayOrderIds = nextOrder;
    this.persistOperatorDayOrder();
    this.updateOperatorDayViewDuration();

    const calendarApi = this.calendarComponent?.getApi();
    if (calendarApi) {
      calendarApi.changeView('operatorDay', this.operatorDayAnchorDate);
      this.syncCalendarTitleStateSoon();
    }

    this.rebuildCalendarEvents();
    this.suppressOperatorClickAfterDrag();
    this.forceViewRefresh(true);
  }

  onOperatorDragEnd(): void {
    this.draggedOperatorDayId = null;
    this.suppressOperatorClickAfterDrag();
  }

  private loadAppointments(): void {
    if (this.isOperatorDayView) {
      this.loadAllOperatorAppointments();
      return;
    }

    if (!this.selectedOperator) {
      this.events = [];
      this.loadedAppointments = [];
      this.refreshCalendarEvents();
      this.isLoading = false;
      this.showCalendarMessage('Seleziona un operatore per visualizzare il calendario.');
      this.cdr.detectChanges();
      return;
    }

    this.isLoading = true;
    this.clearCalendarMessage();
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
        this.showCalendarMessage('Non riesco a caricare gli appuntamenti.');
        this.cdr.detectChanges();
      }
    });
  }

  private showCalendarMessage(message: string, autoHideMs = 3200): void {
    this.clearCalendarMessageTimer();
    this.calendarMessage = message;

    if (autoHideMs > 0) {
      this.calendarMessageTimeout = setTimeout(() => {
        this.calendarMessage = '';
        this.calendarMessageTimeout = null;
        this.cdr.detectChanges();
      }, autoHideMs);
    }

    this.cdr.detectChanges();
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

  private handleDateClick(arg: any): void {
    const syntheticClickedDate = arg.date instanceof Date ? arg.date : new Date(arg.date);
    const targetOperator = this.isOperatorDayView
      ? this.getOperatorFromSyntheticDate(syntheticClickedDate)?.idUtente ?? null
      : this.selectedOperator;
    const clickedDate = this.isOperatorDayView
      ? this.mapSyntheticDateToOperatorDay(syntheticClickedDate)
      : syntheticClickedDate;

    if (!targetOperator) {
      this.showCalendarMessage('Seleziona un operatore prima di inserire un appuntamento.');
      this.cdr.detectChanges();
      return;
    }

    if (!this.isBookableDateTime(clickedDate)) {
      this.calendarComponent?.getApi()?.unselect();
      this.showCalendarMessage(this.getInvalidSlotMessage(clickedDate));
      this.cdr.detectChanges();
      return;
    }

    this.router.navigate(['/gestionale/prenotazione'], {
      queryParams: {
        data: this.toLocalDateTimeInput(clickedDate.toISOString()),
        operatore: targetOperator,
        gestionale: 1,
        ritorno: '/gestionale/appuntamenti'
      }
    });
  }

  private handleEventClick(arg: any): void {
    if (arg.event?.display === 'background') {
      const eventStart = arg.event.start instanceof Date ? arg.event.start : new Date(arg.event.start);
      const startDate = this.isOperatorDayView ? this.mapSyntheticDateToOperatorDay(eventStart) : eventStart;
      this.showCalendarMessage(this.getInvalidSlotMessage(startDate));
      this.cdr.detectChanges();
      return;
    }

    const appointment = arg.event?.extendedProps?.['appointment'] as Appuntamento | undefined;

    if (!appointment) {
      return;
    }

    const clickedElement = arg.jsEvent?.target as HTMLElement | null;
    const isEditClick = Boolean(clickedElement?.closest('.appointment-icon-btn.edit'));
    const isDeleteClick = Boolean(clickedElement?.closest('.appointment-icon-btn.delete'));

    if (isEditClick) {
      if (this.canModifyAppointment(appointment)) {
        this.openAppointmentDetail(appointment, true);
      }
      return;
    }

    if (isDeleteClick) {
      if (this.canDeleteAppointment(appointment)) {
        this.openDeleteConfirmation(appointment, false);
      }
      return;
    }

    this.openAppointmentDetail(appointment);
  }

  private handleDatesSet(arg: { start: Date; end: Date; view?: { type?: string; title?: string } }): void {
    const nextIsOperatorDayView = arg.view?.type === 'operatorDay';
    const changedOperatorMode = this.isOperatorDayView !== nextIsOperatorDayView;
    this.isOperatorDayView = nextIsOperatorDayView;

    if (this.isOperatorDayView) {
      this.setOperatorDayDate(arg.start);
    }

    this.visibleRangeStart = arg.start;
    this.visibleRangeEnd = arg.end;
    this.syncCalendarNowIndicator();
    this.syncDatePickerValue(arg.start);
    this.persistCalendarState(arg);
    this.syncCalendarTitleState(arg.view?.title);
    this.syncCalendarTitleStateSoon(arg.view?.title);
    this.syncTodayButtonStateSoon();
    this.updateCalendarPickerPosition();

    if (changedOperatorMode) {
      this.loadAppointments();
    } else if (this.isOperatorDayView) {
      this.rebuildCalendarEvents();
    } else {
      this.refreshCalendarEvents();
    }

    const scrollRangeStart = this.isOperatorDayView ? this.operatorDayDate : arg.start;
    const scrollRangeEnd = this.isOperatorDayView ? this.addDays(this.operatorDayDate, 1) : arg.end;
    this.scrollCalendarToCurrentTimeIfNeeded(scrollRangeStart, scrollRangeEnd);
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

    if (this.isOperatorDayView) {
      this.setOperatorDayDate(day.date);
      calendarApi.changeView('operatorDay', this.operatorDayAnchorDate);
      this.syncCalendarTitleStateSoon();
    } else {
      calendarApi.gotoDate(value);
      this.syncCalendarTitleStateSoon();
    }

    if (this.isMobileCalendar && !this.isOperatorDayView) {
      calendarApi.changeView('timeGridDay', value);
      this.syncCalendarTitleStateSoon();
    }

    this.syncCalendarPickerMonth(day.date);
    this.closeCalendarPicker();
  }

  get calendarPickerMonthLabel(): string {
    const label = this.calendarPickerMonthFormatter.format(this.calendarPickerMonth);
    return label.charAt(0).toUpperCase() + label.slice(1);
  }

  get editDatePickerMonthLabel(): string {
    const label = this.calendarPickerMonthFormatter.format(this.editDatePickerMonth);
    return label.charAt(0).toUpperCase() + label.slice(1);
  }

  get editDateLabel(): string {
    const date = this.parseInputDate(this.editStartDate);
    if (!date) {
      return 'Seleziona data';
    }

    return new Intl.DateTimeFormat('it-IT', {
      weekday: 'short',
      day: '2-digit',
      month: 'long',
      year: 'numeric'
    }).format(date);
  }

  toggleEditDatePicker(): void {
    if (!this.isEditingAppointment || this.isEditFormLoading) {
      return;
    }

    if (this.editDatePickerOpen) {
      this.closeEditDatePicker();
      return;
    }

    if (this.editDatePickerCloseTimeout) {
      clearTimeout(this.editDatePickerCloseTimeout);
      this.editDatePickerCloseTimeout = null;
    }

    this.editDatePickerClosing = false;
    this.editDatePickerOpen = true;
    this.syncEditDatePickerMonthFromStart();
    this.forceViewRefresh();
  }

  closeEditDatePicker(immediate = false): void {
    if (!this.editDatePickerOpen || this.editDatePickerClosing) {
      return;
    }

    if (immediate) {
      if (this.editDatePickerCloseTimeout) {
        clearTimeout(this.editDatePickerCloseTimeout);
        this.editDatePickerCloseTimeout = null;
      }
      this.editDatePickerOpen = false;
      this.editDatePickerClosing = false;
      this.forceViewRefresh();
      return;
    }

    this.editDatePickerClosing = true;
    this.editDatePickerCloseTimeout = setTimeout(() => {
      this.editDatePickerOpen = false;
      this.editDatePickerClosing = false;
      this.editDatePickerCloseTimeout = null;
      this.forceViewRefresh();
    }, 180);
  }

  previousEditDatePickerMonth(): void {
    const next = new Date(this.editDatePickerMonth);
    next.setMonth(next.getMonth() - 1, 1);
    this.editDatePickerMonth = next;
    this.editDatePickerDays = this.buildCalendarPickerDays(next, this.editStartDate);
  }

  nextEditDatePickerMonth(): void {
    const next = new Date(this.editDatePickerMonth);
    next.setMonth(next.getMonth() + 1, 1);
    this.editDatePickerMonth = next;
    this.editDatePickerDays = this.buildCalendarPickerDays(next, this.editStartDate);
  }

  selectEditDatePickerDay(day: CalendarPickerDay): void {
    this.editStartDate = this.formatDateForInput(day.date);
    this.applyEditStartParts();
    this.syncEditDatePickerMonthFromStart();
    this.closeEditDatePicker();
  }

  private mapAppointmentToEvent(appointment: Appuntamento): EventInput | null {
    const isPermission = this.isPermissionAppointment(appointment);
    const normalizedStart = this.normalizeDateTimeForCalendar(appointment.dataOraInizio);
    const normalizedEnd = this.normalizeDateTimeForCalendar(appointment.dataOraFine);
    const actualStart = new Date(normalizedStart);
    const actualEnd = new Date(normalizedEnd);

    if (Number.isNaN(actualStart.getTime()) || Number.isNaN(actualEnd.getTime())) {
      return null;
    }

    let eventStart = normalizedStart;
    let eventEnd = this.getCalendarEventEnd(normalizedStart, normalizedEnd);

    if (this.isOperatorDayView) {
      if (!this.isSameLocalDay(actualStart, this.operatorDayDate)) {
        return null;
      }

      const operatorColumnDate = this.getOperatorDayDateForOperator(appointment.idOperatore);

      if (!operatorColumnDate) {
        return null;
      }

      const syntheticStart = this.moveDateKeepingTime(actualStart, operatorColumnDate);
      const syntheticEnd = this.moveDateKeepingTime(actualEnd, operatorColumnDate);
      eventStart = this.toLocalDateTimeInput(syntheticStart.toISOString());
      eventEnd = this.getCalendarEventEnd(eventStart, this.toLocalDateTimeInput(syntheticEnd.toISOString()));
    }

    const isFerie = isPermission && appointment.note === 'Ferie';
    const serviceName = isPermission ? '' : this.getAppointmentServiceLabel(appointment);
    const normalizedServiceName = serviceName.trim().toLowerCase();
    const clientDetails = isPermission ? null : this.getAppointmentClientDetails(appointment);
    const clientName = clientDetails?.name ?? '';
    const displayTitle = isFerie ? 'Ferie' : (isPermission ? (appointment.note || 'Permesso') : (serviceName || 'Servizio prenotato'));
    const appointmentEnd = new Date(normalizedEnd);
    const isPastAppointment =
      !Number.isNaN(appointmentEnd.getTime()) &&
      appointmentEnd.getTime() < Date.now();
    const classNames = [
      isFerie ? 'ferie-appointment' : (isPermission ? 'permission-appointment' : (isPastAppointment ? 'past-appointment' : 'my-appointment'))
    ].filter(Boolean);

    return {
      id: String(appointment.idAppuntamento),
      title: displayTitle,
      start: eventStart,
      end: eventEnd,
      classNames,
      extendedProps: {
        appointment,
        idAppuntamento: appointment.idAppuntamento,
        actualStart: normalizedStart,
        actualEnd: normalizedEnd,
        canManage: this.canUserManageAppointment(appointment),
        canModify: this.canModifyAppointment(appointment),
        canDelete: this.canDeleteAppointment(appointment),
        isVisible: true,
        displayTitle,
        serviceName,
        serviceDescription: this.serviceDescriptionByName.get(normalizedServiceName) || '',
        clientName,
        clientPhone: clientDetails?.phone ?? '',
        clientEmail: clientDetails?.email ?? '',
        operatorName: this.getOperatorLabel(appointment.idOperatore)
      }
    };
  }

  private rebuildCalendarEvents(): void {
    this.events = this.loadedAppointments
      .map((appointment) => this.mapAppointmentToEvent(appointment))
      .filter((event): event is EventInput => Boolean(event));
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

  openAppointmentDetail(appointment: Appuntamento, startInEditMode = false): void {
    if (this.appointmentDetailCloseTimeout) {
      clearTimeout(this.appointmentDetailCloseTimeout);
      this.appointmentDetailCloseTimeout = null;
    }

    this.selectedAppointment = appointment;
    this.selectedAppointmentLabel = this.buildAppointmentLabel(appointment);
    this.appointmentDetailToneClass = this.getAppointmentToneClass(appointment);
    this.isEditingAppointment = false;
    this.isEditingFromCalendarAction = startInEditMode;
    this.isAppointmentActionLoading = false;
    this.isEditFormLoading = false;
    this.appointmentActionError = '';
    this.appointmentEditForm = {
      dataOraInizio: this.normalizeDateTimeForCalendar(appointment.dataOraInizio),
      dataOraFine: this.normalizeDateTimeForCalendar(appointment.dataOraFine),
      idServizio: appointment.idServizio ?? null,
      durataPersonalizzata: this.getInitialAppointmentDuration(appointment)
    };
    this.originalAppointmentEditForm = {
      dataOraInizio: this.appointmentEditForm.dataOraInizio,
      dataOraFine: this.appointmentEditForm.dataOraFine,
      idServizio: this.appointmentEditForm.idServizio,
      durataPersonalizzata: this.appointmentEditForm.durataPersonalizzata
    };
    this.syncEditStartPartsFromForm();
    this.closeEditDatePicker(true);
    this.closeEditServicesPicker();
    this.editableServices = [];
    this.loadEditableServicesForSelectedAppointment();

    if (startInEditMode) {
      if (!this.canModifySelectedAppointment) {
        this.appointmentActionError = "Puoi modificare solo appuntamenti futuri e gestibili.";
      } else {
        this.isEditingAppointment = true;
      }
    }

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
      this.isEditingAppointment = false;
      this.isEditingFromCalendarAction = false;
      this.isAppointmentActionLoading = false;
      this.isEditFormLoading = false;
      this.appointmentActionError = '';
      this.isDeleteConfirmOpen = false;
      this.deleteConfirmAppointment = null;
      this.deleteConfirmKeepDetailOpen = false;
      this.selectedAppointment = null;
      this.selectedAppointmentLabel = '';
      this.editableServices = [];
      this.appointmentEditForm = {
        dataOraInizio: '',
        dataOraFine: '',
        idServizio: null,
        durataPersonalizzata: null
      };
      this.originalAppointmentEditForm = {
        dataOraInizio: '',
        dataOraFine: '',
        idServizio: null,
        durataPersonalizzata: null
      };
      this.editStartDate = '';
      this.editStartTime = '';
      this.closeEditDatePicker(true);
      this.closeEditServicesPicker();
      this.appointmentDetailCloseTimeout = null;
      this.cdr.detectChanges();
    }, 220);
  }

  beginAppointmentEdit(): void {
    if (!this.selectedAppointment || this.isEditFormLoading) {
      return;
    }

    if (!this.canModifySelectedAppointment) {
      this.appointmentActionError = "Puoi modificare solo appuntamenti futuri e gestibili.";
      return;
    }

    this.isEditingAppointment = true;
    this.isEditingFromCalendarAction = false;
    this.appointmentActionError = '';
    this.syncEditStartPartsFromForm();
    this.closeEditDatePicker(true);
    this.closeEditServicesPicker();
    this.refreshEditEndFromSelectedService();
    this.forceViewRefresh();
  }

  cancelAppointmentEdit(): void {
    if (!this.selectedAppointment) {
      return;
    }

    if (this.isEditingFromCalendarAction) {
      this.closeAppointmentDetail();
      return;
    }

    this.isEditingAppointment = false;
    this.appointmentActionError = '';
    this.appointmentEditForm = {
      dataOraInizio: this.originalAppointmentEditForm.dataOraInizio,
      dataOraFine: this.originalAppointmentEditForm.dataOraFine,
      idServizio: this.originalAppointmentEditForm.idServizio,
      durataPersonalizzata: this.originalAppointmentEditForm.durataPersonalizzata
    };
    this.syncEditStartPartsFromForm();
    this.closeEditDatePicker(true);
    this.closeEditServicesPicker();
    this.refreshEditEndFromSelectedService();
    this.forceViewRefresh();
  }

  onEditStartChange(): void {
    this.appointmentActionError = '';
    this.syncEditStartPartsFromForm();
    this.refreshEditEndFromSelectedService();
    this.forceViewRefresh();
  }

  onEditServiceChange(): void {
    this.appointmentActionError = '';
    this.syncEditDurationWithSelectedService();
    this.refreshEditEndFromSelectedService();
    this.forceViewRefresh();
  }

  onEditTimeChange(): void {
    this.applyEditStartParts();
  }

  onEditDurationChange(): void {
    this.appointmentActionError = '';
    const duration = Number(this.appointmentEditForm.durataPersonalizzata);
    this.appointmentEditForm.durataPersonalizzata = Number.isFinite(duration) && duration > 0
      ? Math.trunc(duration)
      : null;
    this.refreshEditEndFromSelectedService();
    this.forceViewRefresh();
  }

  selectEditService(service: Servizio): void {
    if (!this.canEditServiceInCurrentSlot(service)) {
      return;
    }

    this.appointmentEditForm.idServizio = service.idServizio;
    this.appointmentEditForm.durataPersonalizzata = Number(service.durata || 0) || null;
    this.closeEditServicesPicker();
    this.onEditServiceChange();
  }

  toggleEditServicesPicker(): void {
    if (!this.isEditingAppointment || this.isEditFormLoading || this.editableServices.length === 0) {
      return;
    }

    this.editServicesOpen = !this.editServicesOpen;
    this.forceViewRefresh();
  }

  closeEditServicesPicker(): void {
    this.editServicesOpen = false;
  }

  get selectedEditServiceLabel(): string {
    const selectedService = this.editableServices.find(
      (service) => service.idServizio === this.appointmentEditForm.idServizio
    );

    if (!selectedService) {
      return 'Seleziona servizio';
    }

    return `${selectedService.nome} | ${selectedService.prezzo} EUR`;
  }

  saveAppointmentEdit(): void {
    if (!this.selectedAppointment || this.isAppointmentActionLoading || this.isEditFormLoading) {
      return;
    }

    this.closeEditServicesPicker();

    if (!this.canModifySelectedAppointment) {
      this.appointmentActionError = "Puoi modificare solo appuntamenti futuri e gestibili.";
      return;
    }

    const range = this.buildEditedRangeFromSelectedService();

    if (!range) {
      this.appointmentActionError = 'Seleziona orario e servizio validi.';
      return;
    }

    if (!this.isEditedRangeInFuture(range.start)) {
      this.appointmentActionError = "Non puoi spostare un appuntamento in un orario gia passato.";
      return;
    }

    if (!this.isWithinOpeningHoursRange(range.start, range.end)) {
      this.appointmentActionError = 'Il servizio scelto non rientra negli orari di apertura.';
      return;
    }

    if (this.hasOverlapForEditedRange(range.start, range.calendarHoldEnd)) {
      this.appointmentActionError = 'Il servizio scelto si sovrappone a un altro appuntamento.';
      return;
    }

    const hasRealChanges =
      this.appointmentEditForm.dataOraInizio !== this.originalAppointmentEditForm.dataOraInizio ||
      this.appointmentEditForm.dataOraFine !== this.originalAppointmentEditForm.dataOraFine ||
      this.appointmentEditForm.idServizio !== this.originalAppointmentEditForm.idServizio ||
      this.appointmentEditForm.durataPersonalizzata !== this.originalAppointmentEditForm.durataPersonalizzata;

    if (!hasRealChanges) {
      this.appointmentActionError = 'Non ci sono modifiche da salvare.';
      this.forceViewRefresh();
      return;
    }

    this.isAppointmentActionLoading = true;
    this.appointmentActionError = '';
    this.forceViewRefresh();

    this.appuntamentoService.aggiornaAppuntamento(this.selectedAppointment.idAppuntamento, {
      dataOraInizio: this.appointmentEditForm.dataOraInizio,
      dataOraFine: this.appointmentEditForm.dataOraFine,
      idServizio: range.service.idServizio,
      durataPersonalizzata: this.appointmentEditForm.durataPersonalizzata,
      note: range.service.nome
    }).subscribe({
      next: () => {
        this.isAppointmentActionLoading = false;
        this.isEditingAppointment = false;
        this.isEditingFromCalendarAction = false;
        this.loadAppointments();
        this.showCalendarMessage('Appuntamento modificato con successo.');
        this.closeAppointmentDetail();
      },
      error: (err) => {
        this.isAppointmentActionLoading = false;
        this.appointmentActionError = err?.error?.message || 'Modifica non riuscita.';
        this.forceViewRefresh();
      }
    });
  }

  private loadServiceDetailsForOperators(operatorIds: number[]): void {
    if (operatorIds.length === 0) {
      this.serviceDescriptionByName.clear();
      return;
    }

    forkJoin(operatorIds.map((operatorId) => this.serviziService.getServiziPrenotabiliByOperatore(operatorId))).subscribe({
      next: (servicesByOperator) => {
        this.serviceDescriptionByName = new Map(
          servicesByOperator.flat().map((service) => [
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

  private loadAllOperatorAppointments(): void {
    const visibleOperators = this.getOperatorDayColumnOperators();

    if (visibleOperators.length === 0) {
      this.events = [];
      this.loadedAppointments = [];
      this.refreshCalendarEvents();
      this.isLoading = false;
      this.showCalendarMessage('Nessun operatore disponibile.');
      this.cdr.detectChanges();
      return;
    }

    this.isLoading = true;
    this.clearCalendarMessage();
    this.cdr.detectChanges();

    forkJoin(visibleOperators.map((operatore) => this.appuntamentoService.getAppuntamenti(operatore.idUtente))).subscribe({
      next: (appointmentsByOperator) => {
        this.loadedAppointments = appointmentsByOperator.flat();
        this.loadServiceDetailsForOperators(visibleOperators.map((operatore) => operatore.idUtente));
        this.rebuildCalendarEvents();
        this.isLoading = false;
        this.cdr.detectChanges();
      },
      error: (error) => {
        console.error('Errore caricamento appuntamenti di tutti gli operatori:', error);
        this.isLoading = false;
        this.showCalendarMessage('Non riesco a caricare gli appuntamenti degli operatori.');
        this.cdr.detectChanges();
      }
    });
  }

  deleteSelectedAppointment(): void {
    if (!this.selectedAppointment || this.isAppointmentActionLoading) {
      return;
    }

    this.openDeleteConfirmation(this.selectedAppointment, true);
  }

  openDeleteConfirmation(appointment: Appuntamento, keepDetailOpen: boolean): void {
    if (this.isAppointmentActionLoading || !this.canDeleteAppointment(appointment)) {
      return;
    }

    this.appointmentActionError = '';
    this.deleteConfirmAppointment = appointment;
    this.deleteConfirmKeepDetailOpen = keepDetailOpen;
    this.isDeleteConfirmOpen = true;
    this.forceViewRefresh();
  }

  cancelDeleteConfirmation(): void {
    this.isDeleteConfirmOpen = false;
    this.deleteConfirmAppointment = null;
    this.deleteConfirmKeepDetailOpen = false;
    this.forceViewRefresh();
  }

  confirmDeleteAppointment(): void {
    if (!this.deleteConfirmAppointment || this.isAppointmentActionLoading) {
      return;
    }

    if (!this.canDeleteAppointment(this.deleteConfirmAppointment)) {
      this.cancelDeleteConfirmation();
      this.appointmentActionError = 'Puoi eliminare solo appuntamenti futuri e gestibili.';
      this.forceViewRefresh();
      return;
    }

    const appointmentToDelete = this.deleteConfirmAppointment;
    const keepDetailOpen = this.deleteConfirmKeepDetailOpen;
    this.isAppointmentActionLoading = true;
    this.appointmentActionError = '';
    this.forceViewRefresh();

    this.appuntamentoService.eliminaAppuntamento(appointmentToDelete.idAppuntamento)
      .subscribe({
        next: () => {
          this.isAppointmentActionLoading = false;
          this.cancelDeleteConfirmation();
          this.loadAppointments();
          this.showCalendarMessage('Appuntamento eliminato con successo.');
          this.closeAppointmentDetail();
        },
        error: (err) => {
          this.isAppointmentActionLoading = false;
          const message = err?.error?.message || 'Eliminazione non riuscita.';
          if (keepDetailOpen) {
            this.appointmentActionError = message;
          } else {
            this.showCalendarMessage(message);
          }
          this.forceViewRefresh();
        }
      });
  }

  get canManageSelectedAppointment(): boolean {
    return Boolean(this.selectedAppointment && this.canUserManageAppointment(this.selectedAppointment));
  }

  get canModifySelectedAppointment(): boolean {
    return Boolean(this.selectedAppointment && this.canModifyAppointment(this.selectedAppointment));
  }

  get canDeleteSelectedAppointment(): boolean {
    return Boolean(this.selectedAppointment && this.canDeleteAppointment(this.selectedAppointment));
  }

  onAppointmentModalOverlayClick(event: MouseEvent): void {
    if (event.target !== event.currentTarget) {
      return;
    }

    this.closeAppointmentDetail();
  }

  onDeleteConfirmOverlayClick(event: MouseEvent): void {
    if (event.target !== event.currentTarget) {
      return;
    }

    this.cancelDeleteConfirmation();
  }

  private getVisualEventEnd(startValue: string, endValue: string): string {
    const start = new Date(startValue);
    const end = new Date(endValue);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return endValue;
    }

    const durationMinutes = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 60000));
    const minimumEnd = new Date(start);
    minimumEnd.setMinutes(minimumEnd.getMinutes() + this.roundDurationToCalendarBlock(durationMinutes));

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

    const durationMinutes = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 60000));
    const roundedEnd = new Date(start);
    roundedEnd.setMinutes(roundedEnd.getMinutes() + this.roundDurationToCalendarBlock(durationMinutes));
    return this.toLocalDateTimeInput(roundedEnd.toISOString());
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
      return appointment.note === 'Ferie' ? 'Ferie' : (appointment.note || 'Permesso');
    }

    return appointment.servizioNome?.trim()
      || appointment.note?.trim()
      || 'Servizio non indicato';
  }

  private getAppointmentClientLabel(appointment: Appuntamento): string {
    return this.getAppointmentClientDetails(appointment)?.name ?? '';
  }

  private getAppointmentClientDetails(appointment: Appuntamento): { name: string; phone: string; email: string } | null {
    if (!appointment.idCliente) {
      return {
        name: appointment.note === 'Ferie' ? 'Ferie' : (appointment.note || 'Permesso'),
        phone: '',
        email: ''
      };
    }

    const cliente = this.clienti.find((item) => item.idUtente === appointment.idCliente);
    return {
      name: cliente ? `${cliente.nome} ${cliente.cognome}` : `Cliente #${appointment.idCliente}`,
      phone: cliente?.telefono?.trim() ?? '',
      email: cliente?.email?.trim() ?? ''
    };
  }

  private getAppointmentToneClass(appointment: Appuntamento): string {
    const isPermission = this.isPermissionAppointment(appointment);
    const isFerie = isPermission && appointment.note === 'Ferie';

    if (isFerie) {
      return 'tone-ferie';
    }
    if (isPermission) {
      return 'tone-permission';
    }
    if (this.isPastAppointment(appointment) || appointment.stato === 'completato') {
      return 'tone-past';
    }

    return 'tone-my';
  }

  get isSelectedPermissionAppointment(): boolean {
    return Boolean(this.selectedAppointment && this.isPermissionAppointment(this.selectedAppointment));
  }

  get isSelectedFerieAppointment(): boolean {
    return Boolean(this.selectedAppointment && this.isPermissionAppointment(this.selectedAppointment) && this.selectedAppointment.note === 'Ferie');
  }

  get selectedAbsenceTypeLabel(): string {
    return this.isSelectedFerieAppointment ? 'Ferie' : 'Permesso';
  }

  get appointmentDetailKicker(): string {
    return this.isSelectedPermissionAppointment ? this.selectedAbsenceTypeLabel : 'Appuntamento';
  }

  get selectedAbsenceStatusLabel(): string {
    if (!this.selectedAppointment) {
      return 'Non indicato';
    }

    return this.isPastAppointment(this.selectedAppointment) ? 'Terminato' : 'Programmato';
  }

  get selectedAbsenceDetailLabel(): string {
    if (!this.selectedAppointment) {
      return 'Non indicato';
    }

    const note = String(this.selectedAppointment.note ?? '').trim();
    const normalizedNote = note.toLowerCase();

    if (!note || normalizedNote === 'ferie' || normalizedNote === 'permesso') {
      return 'Non sono stati inseriti dettagli';
    }

    return note;
  }

  getSelectedAppointmentClientLabel(): string {
    if (!this.selectedAppointment) {
      return '';
    }

    return this.getAppointmentClientLabel(this.selectedAppointment);
  }

  getSelectedAppointmentClientPhoneLabel(): string {
    if (!this.selectedAppointment) {
      return '';
    }

    return this.getAppointmentClientDetails(this.selectedAppointment)?.phone || 'Non indicato';
  }

  getSelectedAppointmentClientEmailLabel(): string {
    if (!this.selectedAppointment) {
      return '';
    }

    return this.getAppointmentClientDetails(this.selectedAppointment)?.email || 'Non indicata';
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

  get selectedAppointmentStartLabel(): string {
    const range = this.getSelectedAppointmentDisplayRange();
    return range ? this.formatDateTimeValue(range.start) : 'Non indicato';
  }

  get selectedAppointmentEndLabel(): string {
    const range = this.getSelectedAppointmentDisplayRange();
    return range ? this.formatDateTimeValue(range.end) : 'Non indicato';
  }

  getSelectedAppointmentDurationLabel(): string {
    const customDuration = Number(this.selectedAppointment?.durataPersonalizzata);

    if (Number.isFinite(customDuration) && customDuration > 0) {
      return this.formatDurationLabel(Math.trunc(customDuration));
    }

    const range = this.getSelectedAppointmentDisplayRange();

    if (!range) {
      return 'Non indicata';
    }

    const start = range.start;
    const end = range.end;

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      return 'Non indicata';
    }

    return this.formatDurationLabel(Math.round((end.getTime() - start.getTime()) / 60000));
  }

  private getSelectedAppointmentDisplayRange(): { start: Date; end: Date } | null {
    return this.selectedAppointment
      ? this.getAppointmentDisplayRange(this.selectedAppointment)
      : null;
  }

  private getAppointmentDisplayRange(appointment: Appuntamento): { start: Date; end: Date } | null {
    const start = new Date(appointment.dataOraInizio);
    const end = new Date(appointment.dataOraFine);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return null;
    }

    if (!this.isFerieAppointment(appointment)) {
      return { start, end };
    }

    const ferieBlocks = this.loadedAppointments
      .filter((item) => item.idOperatore === appointment.idOperatore && this.isFerieAppointment(item))
      .map((item) => ({
        appointment: item,
        start: new Date(item.dataOraInizio),
        end: new Date(item.dataOraFine)
      }))
      .filter((item) => !Number.isNaN(item.start.getTime()) && !Number.isNaN(item.end.getTime()))
      .sort((a, b) => a.start.getTime() - b.start.getTime());

    const selectedIndex = ferieBlocks.findIndex(
      (item) => item.appointment.idAppuntamento === appointment.idAppuntamento
    );

    if (selectedIndex < 0) {
      return { start, end };
    }

    let firstIndex = selectedIndex;
    let lastIndex = selectedIndex;

    while (
      firstIndex > 0 &&
      this.areConsecutiveLocalDays(ferieBlocks[firstIndex - 1].start, ferieBlocks[firstIndex].start)
    ) {
      firstIndex -= 1;
    }

    while (
      lastIndex < ferieBlocks.length - 1 &&
      this.areConsecutiveLocalDays(ferieBlocks[lastIndex].start, ferieBlocks[lastIndex + 1].start)
    ) {
      lastIndex += 1;
    }

    const rangeBlocks = ferieBlocks.slice(firstIndex, lastIndex + 1);
    return {
      start: rangeBlocks.reduce((earliest, item) => item.start < earliest ? item.start : earliest, rangeBlocks[0].start),
      end: rangeBlocks.reduce((latest, item) => item.end > latest ? item.end : latest, rangeBlocks[0].end)
    };
  }

  private isFerieAppointment(appointment: Appuntamento): boolean {
    return this.isPermissionAppointment(appointment) && String(appointment.note ?? '').trim() === 'Ferie';
  }

  private areConsecutiveLocalDays(previous: Date, next: Date): boolean {
    const previousDay = new Date(previous.getFullYear(), previous.getMonth(), previous.getDate());
    const nextDay = new Date(next.getFullYear(), next.getMonth(), next.getDate());
    const diffDays = Math.round((nextDay.getTime() - previousDay.getTime()) / 86400000);
    return diffDays === 1;
  }

  private formatDateTimeValue(date: Date): string {
    if (Number.isNaN(date.getTime())) {
      return 'Non indicato';
    }

    return new Intl.DateTimeFormat('it-IT', {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(date);
  }

  private formatDurationLabel(totalMinutes: number): string {
    if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) {
      return 'Non indicata';
    }

    const dayMinutes = 24 * 60;
    const days = Math.floor(totalMinutes / dayMinutes);
    const remainingAfterDays = totalMinutes % dayMinutes;
    const hours = Math.floor(remainingAfterDays / 60);
    const minutes = remainingAfterDays % 60;
    const parts: string[] = [];

    if (days > 0) {
      parts.push(days === 1 ? '1 giorno' : `${days} giorni`);
    }

    if (hours > 0) {
      parts.push(hours === 1 ? '1 ora' : `${hours} ore`);
    }

    if (minutes > 0 || parts.length === 0) {
      parts.push(minutes === 1 ? '1 minuto' : `${minutes} minuti`);
    }

    return parts.join(' e ');
  }

  private loadEditableServicesForSelectedAppointment(): void {
    if (!this.selectedAppointment) {
      this.editableServices = [];
      this.isEditFormLoading = false;
      this.forceViewRefresh();
      return;
    }

    this.isEditFormLoading = true;
    this.forceViewRefresh();

    this.serviziService.getServiziPrenotabiliByOperatore(this.selectedAppointment.idOperatore)
      .subscribe({
        next: (services) => {
          if (!this.selectedAppointment || services.length === 0) {
            this.editableServices = [];
            this.appointmentEditForm.idServizio = null;
            this.appointmentEditForm.dataOraFine = '';
            this.isEditFormLoading = false;
            this.forceViewRefresh();
            return;
          }

          this.editableServices = services;
          const matchedService = services.find((service) =>
            service.idServizio === this.selectedAppointment?.idServizio ||
            service.nome === (this.selectedAppointment?.note ?? '') ||
            service.nome === (this.selectedAppointment?.servizioNome ?? '')
          );
          const firstAvailableService = services.find((service) => this.canEditServiceInCurrentSlot(service));

          this.appointmentEditForm.idServizio = matchedService?.idServizio ?? firstAvailableService?.idServizio ?? null;
          const customDuration = Number(this.selectedAppointment?.durataPersonalizzata);
          const initialServiceDuration = Number((matchedService ?? firstAvailableService)?.durata || 0);
          this.appointmentEditForm.durataPersonalizzata = Number.isFinite(customDuration) && customDuration > 0
            ? Math.trunc(customDuration)
            : (initialServiceDuration || null);
          this.refreshEditEndFromSelectedService();
          this.originalAppointmentEditForm = {
            dataOraInizio: this.appointmentEditForm.dataOraInizio,
            dataOraFine: this.appointmentEditForm.dataOraFine,
            idServizio: this.appointmentEditForm.idServizio,
            durataPersonalizzata: this.appointmentEditForm.durataPersonalizzata
          };
          this.isEditFormLoading = false;
          this.forceViewRefresh();
        },
        error: () => {
          this.editableServices = [];
          this.appointmentEditForm.idServizio = null;
          this.appointmentEditForm.dataOraFine = '';
          this.isEditFormLoading = false;
          this.forceViewRefresh();
        }
      });
  }

  canEditServiceInCurrentSlot(service: Servizio): boolean {
    const range = this.buildEditedRangeFromService(service);

    if (!range) {
      return false;
    }

    return this.isEditedRangeInFuture(range.start) &&
      this.isWithinOpeningHoursRange(range.start, range.end) &&
      !this.hasOverlapForEditedRange(range.start, range.calendarHoldEnd);
  }

  private refreshEditEndFromSelectedService(): void {
    const selectedService = this.editableServices.find(
      (service) => service.idServizio === this.appointmentEditForm.idServizio
    );

    if (!selectedService) {
      this.appointmentEditForm.dataOraFine = '';
      return;
    }

    const range = this.buildEditedRangeFromService(selectedService);

    if (!range) {
      this.appointmentEditForm.dataOraFine = '';
      return;
    }

    this.appointmentEditForm.dataOraFine = this.toLocalDateTimeInput(range.end.toISOString());
  }

  private buildEditedRangeFromSelectedService():
    | { start: Date; end: Date; calendarHoldEnd: Date; service: Servizio }
    | null {
    const selectedService = this.editableServices.find(
      (service) => service.idServizio === this.appointmentEditForm.idServizio
    );

    if (!selectedService) {
      return null;
    }

    const range = this.buildEditedRangeFromService(selectedService);

    if (!range) {
      return null;
    }

    return { ...range, service: selectedService };
  }

  private buildEditedRangeFromService(service: Servizio): { start: Date; end: Date; calendarHoldEnd: Date } | null {
    const start = new Date(this.appointmentEditForm.dataOraInizio);
    const durationMinutes = this.getEditServiceDuration(service);

    if (Number.isNaN(start.getTime()) || !Number.isFinite(durationMinutes) || durationMinutes <= 0) {
      return null;
    }

    const end = new Date(start);
    end.setMinutes(end.getMinutes() + this.roundDurationToCalendarBlock(durationMinutes));

    return { start, end, calendarHoldEnd: end };
  }

  private getEditServiceDuration(service: Servizio): number {
    if (service.idServizio === this.appointmentEditForm.idServizio) {
      const customDuration = Number(this.appointmentEditForm.durataPersonalizzata);

      if (Number.isFinite(customDuration) && customDuration > 0) {
        return customDuration;
      }
    }

    return Number(service.durata || 0);
  }

  private syncEditDurationWithSelectedService(): void {
    if (!this.appointmentEditForm.idServizio) {
      this.appointmentEditForm.durataPersonalizzata = null;
      return;
    }

    const currentDuration = Number(this.appointmentEditForm.durataPersonalizzata);

    if (Number.isFinite(currentDuration) && currentDuration > 0) {
      this.appointmentEditForm.durataPersonalizzata = Math.trunc(currentDuration);
      return;
    }

    const selectedService = this.editableServices.find(
      (service) => service.idServizio === this.appointmentEditForm.idServizio
    );

    this.appointmentEditForm.durataPersonalizzata = selectedService
      ? Number(selectedService.durata || 0) || null
      : null;
  }

  private roundDurationToCalendarBlock(durationMinutes: number): number {
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
      return this.minimumAppointmentDurationMinutes;
    }

    return Math.ceil(durationMinutes / this.minimumAppointmentDurationMinutes) * this.minimumAppointmentDurationMinutes;
  }

  private getInitialAppointmentDuration(appointment: Appuntamento): number | null {
    const customDuration = Number(appointment.durataPersonalizzata);

    if (Number.isFinite(customDuration) && customDuration > 0) {
      return Math.trunc(customDuration);
    }

    const start = new Date(appointment.dataOraInizio);
    const end = new Date(appointment.dataOraFine);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      return null;
    }

    return Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000));
  }

  private isWithinOpeningHoursRange(start: Date, end: Date): boolean {
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      return false;
    }

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

  private hasOverlapForEditedRange(start: Date, end: Date): boolean {
    if (!this.selectedAppointment) {
      return false;
    }

    const selectedAppointment = this.selectedAppointment;

    return this.loadedAppointments.some((appointment) => {
      if (appointment.idAppuntamento === selectedAppointment.idAppuntamento) {
        return false;
      }

      if (appointment.idOperatore !== selectedAppointment.idOperatore) {
        return false;
      }

      const appointmentStart = new Date(appointment.dataOraInizio);
      const appointmentEnd = new Date(appointment.dataOraFine);

      if (Number.isNaN(appointmentStart.getTime()) || Number.isNaN(appointmentEnd.getTime())) {
        return false;
      }

      return start < this.getMinimumAppointmentEnd(appointmentStart, appointmentEnd) && end > appointmentStart;
    });
  }

  private getMinimumAppointmentEnd(start: Date, end: Date): Date {
    const durationMinutes = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 60000));
    const roundedEnd = new Date(start);
    roundedEnd.setMinutes(roundedEnd.getMinutes() + this.roundDurationToCalendarBlock(durationMinutes));
    return roundedEnd;
  }

  private isEditedRangeInFuture(start: Date): boolean {
    return !Number.isNaN(start.getTime()) && start.getTime() > Date.now();
  }

  private canModifyAppointment(appointment: Appuntamento): boolean {
    if (!this.canUserManageAppointment(appointment)) {
      return false;
    }

    if (appointment.stato === 'completato') {
      return false;
    }

    const appointmentEnd = new Date(appointment.dataOraFine);
    return !Number.isNaN(appointmentEnd.getTime()) && appointmentEnd.getTime() > Date.now();
  }

  private canDeleteAppointment(appointment: Appuntamento): boolean {
    if (!this.canUserManageAppointment(appointment)) {
      return false;
    }

    return true;
  }

  private isUntilDayBefore(dateString: string): boolean {
    const appointmentDate = new Date(dateString);

    if (Number.isNaN(appointmentDate.getTime())) {
      return false;
    }

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const appointmentDayStart = new Date(
      appointmentDate.getFullYear(),
      appointmentDate.getMonth(),
      appointmentDate.getDate()
    );

    return appointmentDayStart > todayStart;
  }

  private canUserManageAppointment(appointment: Appuntamento): boolean {
    return !this.isPermissionAppointment(appointment);
  }

  private isPastAppointment(appointment: Appuntamento): boolean {
    const appointmentEnd = new Date(appointment.dataOraFine);
    return !Number.isNaN(appointmentEnd.getTime()) && appointmentEnd.getTime() < Date.now();
  }

  private isPermissionAppointment(appointment: Appuntamento): boolean {
    const note = String(appointment.note ?? '').trim();
    const serviceName = String(appointment.servizioNome ?? '').trim();

    return !appointment.idCliente &&
      !appointment.idServizio &&
      !appointment.stato &&
      (!serviceName || serviceName === note);
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
    if (this.isOperatorDayView) {
      return this.buildOperatorDayAvailabilityMaskEvents();
    }

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

  private buildOperatorDayAvailabilityMaskEvents(): EventInput[] {
    const maskEvents: EventInput[] = [];
    const now = new Date();
    const realDay = new Date(this.operatorDayDate);
    const daySchedule = this.openingSchedule[realDay.getDay()];

    this.getOperatorDayColumnOperators().forEach((_, index) => {
      const syntheticDay = this.getOperatorDayDateByIndex(index);
      const slotStart = this.withTime(syntheticDay, '07:00');
      const slotEnd = this.withTime(syntheticDay, '22:00');

      if (this.startOfDay(realDay) < this.startOfDay(now)) {
        maskEvents.push(this.createMaskEvent(slotStart, slotEnd, ['invalid-slot-background', 'is-past-slot']));
        return;
      }

      if (!daySchedule || daySchedule.intervals.length === 0) {
        maskEvents.push(this.createMaskEvent(slotStart, slotEnd, ['invalid-slot-background']));
        return;
      }

      let cursor = new Date(slotStart);

      for (const interval of daySchedule.intervals) {
        const intervalStart = this.withTime(syntheticDay, interval.start);
        const intervalEnd = this.withTime(syntheticDay, interval.end);

        if (cursor < intervalStart) {
          maskEvents.push(this.createMaskEvent(cursor, intervalStart, ['invalid-slot-background']));
        }

        cursor = new Date(intervalEnd);
      }

      if (cursor < slotEnd) {
        maskEvents.push(this.createMaskEvent(cursor, slotEnd, ['invalid-slot-background']));
      }

      if (this.isSameLocalDay(realDay, now)) {
        const pastEnd = this.moveDateKeepingTime(now, syntheticDay);

        if (pastEnd > slotStart) {
          maskEvents.push(this.createMaskEvent(slotStart, pastEnd, ['invalid-slot-background', 'is-past-slot']));
        }
      }
    });

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

  private addDays(date: Date, days: number): Date {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
  }

  private isSameLocalDay(first: Date, second: Date): boolean {
    return this.formatDateForInput(first) === this.formatDateForInput(second);
  }

  private sortOperatorsById(operators: Utente[]): Utente[] {
    return [...operators].sort((first, second) => first.idUtente - second.idUtente);
  }

  private syncOperatorDaySelectionWithOperators(): void {
    const operatorIds = new Set(this.operatori.map((operatore) => operatore.idUtente));
    const savedSelection = this.getSavedOperatorDaySelection();
    const nextSelection = new Set<number>();

    if (savedSelection.length > 0) {
      savedSelection.forEach((operatorId) => {
        if (operatorIds.has(operatorId)) {
          nextSelection.add(operatorId);
        }
      });
    }

    if (nextSelection.size === 0) {
      this.operatori.forEach((operatore) => nextSelection.add(operatore.idUtente));
    }

    this.selectedOperatorDayIds = nextSelection;
    this.syncOperatorDayOrderWithOperators();
  }

  private syncOperatorDayOrderWithOperators(): void {
    const operatorIds = new Set(this.operatori.map((operatore) => operatore.idUtente));
    const savedOrder = this.getSavedOperatorDayOrder();
    const orderedIds = savedOrder.filter((operatorId) => operatorIds.has(operatorId));
    const missingIds = this.operatori
      .map((operatore) => operatore.idUtente)
      .filter((operatorId) => !orderedIds.includes(operatorId))
      .sort((first, second) => first - second);

    this.operatorDayOrderIds = [...orderedIds, ...missingIds];
  }

  private getSavedOperatorDaySelection(): number[] {
    if (typeof localStorage === 'undefined') {
      return [];
    }

    const rawSelection = localStorage.getItem(this.operatorDaySelectionStorageKey);

    if (!rawSelection) {
      return [];
    }

    try {
      const parsed = JSON.parse(rawSelection);

      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value));
    } catch {
      return [];
    }
  }

  private persistOperatorDaySelection(): void {
    if (typeof localStorage === 'undefined') {
      return;
    }

    if (this.selectedOperatorDayIds.size === this.operatori.length) {
      localStorage.removeItem(this.operatorDaySelectionStorageKey);
      return;
    }

    localStorage.setItem(
      this.operatorDaySelectionStorageKey,
      JSON.stringify([...this.selectedOperatorDayIds])
    );
  }

  private getSavedOperatorDayOrder(): number[] {
    if (typeof localStorage === 'undefined') {
      return [];
    }

    const rawOrder = localStorage.getItem(this.operatorDayOrderStorageKey);

    if (!rawOrder) {
      return [];
    }

    try {
      const parsed = JSON.parse(rawOrder);

      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value));
    } catch {
      return [];
    }
  }

  private persistOperatorDayOrder(): void {
    if (typeof localStorage === 'undefined') {
      return;
    }

    const defaultOrder = this.sortOperatorsById(this.operatori).map((operatore) => operatore.idUtente);
    const isDefaultOrder =
      this.operatorDayOrderIds.length === defaultOrder.length &&
      this.operatorDayOrderIds.every((operatorId, index) => operatorId === defaultOrder[index]);

    if (isDefaultOrder) {
      localStorage.removeItem(this.operatorDayOrderStorageKey);
      return;
    }

    localStorage.setItem(this.operatorDayOrderStorageKey, JSON.stringify(this.operatorDayOrderIds));
  }

  private setOperatorDayDate(date: Date): void {
    const day = this.startOfDay(date);
    this.operatorDayDate = day;
    this.operatorDayAnchorDate = new Date(day);
    this.visibleRangeStart = new Date(day);
    this.visibleRangeEnd = this.addDays(day, Math.max(1, this.getOperatorDayColumnOperators().length));
  }

  private getOperatorDayColumnOperators(): Utente[] {
    const visibleOperators = this.getOrderedOperatorDayOperators()
      .filter((operatore) => this.selectedOperatorDayIds.has(operatore.idUtente));
    return visibleOperators.length > 0 ? visibleOperators : this.getOrderedOperatorDayOperators();
  }

  private getOrderedOperatorDayOperators(): Utente[] {
    const operatorsById = new Map(this.operatori.map((operatore) => [operatore.idUtente, operatore]));
    const orderedOperators = this.operatorDayOrderIds
      .map((operatorId) => operatorsById.get(operatorId))
      .filter((operatore): operatore is Utente => Boolean(operatore));
    const orderedIds = new Set(orderedOperators.map((operatore) => operatore.idUtente));
    const missingOperators = this.sortOperatorsById(
      this.operatori.filter((operatore) => !orderedIds.has(operatore.idUtente))
    );

    return [...orderedOperators, ...missingOperators];
  }

  private getOperatorDayDateByIndex(index: number): Date {
    return this.addDays(this.operatorDayAnchorDate, index);
  }

  private getOperatorDayDateForOperator(operatorId: number): Date | null {
    const index = this.getOperatorDayColumnOperators().findIndex((operatore) => operatore.idUtente === operatorId);
    return index >= 0 ? this.getOperatorDayDateByIndex(index) : null;
  }

  private getOperatorFromSyntheticDate(date: Date): Utente | null {
    const columnIndex = Math.round(
      (this.startOfDay(date).getTime() - this.operatorDayAnchorDate.getTime()) / 86400000
    );
    return this.getOperatorDayColumnOperators()[columnIndex] ?? null;
  }

  private mapSyntheticDateToOperatorDay(date: Date): Date {
    return this.moveDateKeepingTime(date, this.operatorDayDate);
  }

  private moveDateKeepingTime(source: Date, targetDay: Date): Date {
    const moved = new Date(targetDay);
    moved.setHours(source.getHours(), source.getMinutes(), source.getSeconds(), source.getMilliseconds());
    return moved;
  }

  private getOperatorLabel(operatorId: number): string {
    const operatore = this.operatori.find((item) => item.idUtente === operatorId);
    return operatore ? `${operatore.nome} ${operatore.cognome}` : `Operatore #${operatorId}`;
  }

  private suppressOperatorClickAfterDrag(): void {
    this.suppressNextOperatorClick = true;
    if (typeof window === 'undefined') {
      this.suppressNextOperatorClick = false;
      return;
    }

    window.setTimeout(() => {
      this.suppressNextOperatorClick = false;
      this.cdr.detectChanges();
    }, 120);
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

    if (resizeCalendar) {
      this.calendarComponent?.getApi()?.updateSize();
    }
  }

  private resizeCalendarAroundLayoutChange(): void {
    this.forceViewRefresh(true);

    if (typeof window === 'undefined') {
      return;
    }

    window.setTimeout(() => this.forceViewRefresh(true), 80);
    window.setTimeout(() => this.forceViewRefresh(true), 260);
  }

  private observeCalendarWrapperResize(): void {
    if (typeof ResizeObserver === 'undefined' || typeof document === 'undefined') {
      return;
    }

    const wrapper = document.querySelector('.management-appointments-section .calendar-wrapper');

    if (!wrapper) {
      return;
    }

    this.calendarResizeObserver = new ResizeObserver(() => {
      this.forceViewRefresh(true);
    });
    this.calendarResizeObserver.observe(wrapper);
  }

  private syncCalendarResponsiveMode(): void {
    const nextIsMobile = typeof window !== 'undefined' && window.innerWidth <= this.mobileBreakpoint;

    if (this.isMobileCalendar === nextIsMobile && this.calendarComponent) {
      return;
    }

    this.isMobileCalendar = nextIsMobile;
    const nextView = this.isOperatorDayView ? 'operatorDay' : this.getResponsiveCalendarView();
    const nextToolbarRight = this.getResponsiveToolbarRight();

    this.calendarOptions = {
      ...this.calendarOptions,
      initialView: nextView,
      headerToolbar: {
        ...this.calendarOptions.headerToolbar,
        left: 'managementPrev,managementNext managementToday',
        center: 'title',
        right: nextToolbarRight
      }
    };

    if (this.calendarComponent) {
      const calendarApi = this.calendarComponent.getApi();
      calendarApi.setOption('headerToolbar', {
        left: 'managementPrev,managementNext managementToday',
        center: 'title',
        right: nextToolbarRight
      });
      calendarApi.changeView(nextView);
      this.syncCalendarTitleStateSoon();
    }

    this.cdr.detectChanges();
  }

  private getInitialCalendarView(): 'timeGridWeek' | 'timeGridDay' | 'operatorDay' {
    const savedView = this.getSavedCalendarView();
    return savedView ?? this.getResponsiveCalendarView();
  }

  private goToToday(): void {
    const calendarApi = this.calendarComponent?.getApi();

    if (!calendarApi) {
      return;
    }

    if (this.isCalendarShowingToday()) {
      this.syncTodayButtonStateSoon();
      return;
    }

    if (!this.isOperatorDayView) {
      calendarApi.today();
      return;
    }

    const today = this.startOfDay(new Date());
    this.setOperatorDayDate(today);
    this.syncCalendarNowIndicator();
    calendarApi.changeView('operatorDay', this.operatorDayAnchorDate);
    this.syncCalendarTitleStateSoon();
    this.syncTodayButtonStateSoon();
  }

  private goToPreviousCalendarPeriod(): void {
    this.moveCalendarPeriod(-1);
  }

  private goToNextCalendarPeriod(): void {
    this.moveCalendarPeriod(1);
  }

  private moveCalendarPeriod(direction: -1 | 1): void {
    const calendarApi = this.calendarComponent?.getApi();

    if (!calendarApi) {
      return;
    }

    if (!this.isOperatorDayView) {
      if (direction < 0) {
        calendarApi.prev();
      } else {
        calendarApi.next();
      }

      return;
    }

    const nextDay = this.addDays(this.operatorDayDate, direction);
    this.setOperatorDayDate(nextDay);
    this.syncCalendarNowIndicator();
    calendarApi.changeView('operatorDay', this.operatorDayAnchorDate);
    this.syncCalendarTitleStateSoon();
    this.syncTodayButtonStateSoon();
  }

  private isCalendarShowingToday(): boolean {
    if (this.isOperatorDayView) {
      return this.isSameLocalDay(this.operatorDayDate, new Date());
    }

    const activeDate = this.calendarComponent?.getApi()?.getDate();
    return activeDate ? this.isSameLocalDay(activeDate, new Date()) : false;
  }

  private syncTodayButtonStateSoon(): void {
    if (typeof window === 'undefined') {
      return;
    }

    window.requestAnimationFrame(() => this.syncTodayButtonState());
    window.setTimeout(() => this.syncTodayButtonState(), 80);
  }

  private syncTodayButtonState(): void {
    if (typeof document === 'undefined') {
      return;
    }

    const todayButton = document.querySelector(
      '.management-appointments-section .calendar-wrapper .fc-managementToday-button'
    ) as HTMLButtonElement | null;

    if (!todayButton) {
      return;
    }

    const isShowingToday = this.isCalendarShowingToday();
    todayButton.disabled = isShowingToday;
    todayButton.setAttribute('aria-disabled', String(isShowingToday));
    todayButton.classList.toggle('is-current-day', isShowingToday);
  }

  private syncCalendarNowIndicator(): void {
    const shouldShowNowIndicator = !this.isOperatorDayView || this.isSameLocalDay(this.operatorDayDate, new Date());
    const calendarApi = this.calendarComponent?.getApi();

    if (!calendarApi) {
      this.calendarOptions = {
        ...this.calendarOptions,
        nowIndicator: shouldShowNowIndicator
      };
      return;
    }

    calendarApi.setOption('nowIndicator', shouldShowNowIndicator);
  }

  private getSavedCalendarView(): 'timeGridWeek' | 'timeGridDay' | 'operatorDay' | null {
    if (typeof localStorage === 'undefined') {
      return null;
    }

    const savedView = localStorage.getItem(this.calendarViewStorageKey);

    if (savedView === 'operatorDay' || savedView === 'timeGridWeek' || savedView === 'timeGridDay') {
      return savedView;
    }

    return null;
  }

  private getSavedCalendarDate(): Date | null {
    if (typeof localStorage === 'undefined') {
      return null;
    }

    const savedDate = localStorage.getItem(this.calendarDateStorageKey);

    if (!savedDate) {
      return null;
    }

    const date = this.parseInputDate(savedDate);
    if (!date || Number.isNaN(date.getTime())) {
      return null;
    }

    return this.startOfDay(date) < this.startOfDay(new Date()) ? null : date;
  }

  private persistCalendarState(arg: { start: Date; view?: { type?: string } }): void {
    if (typeof localStorage === 'undefined') {
      return;
    }

    const viewType = arg.view?.type;
    if (viewType === 'operatorDay' || viewType === 'timeGridWeek' || viewType === 'timeGridDay') {
      localStorage.setItem(this.calendarViewStorageKey, viewType);
    }

    const activeDate = this.isOperatorDayView
      ? this.operatorDayDate
      : (this.calendarComponent?.getApi()?.getDate() ?? arg.start);
    localStorage.setItem(this.calendarDateStorageKey, this.formatDateForInput(activeDate));
  }

  private getResponsiveCalendarView(): 'timeGridWeek' | 'timeGridDay' {
    return this.isMobileCalendar ? 'timeGridDay' : 'timeGridWeek';
  }

  private getResponsiveToolbarRight(): string {
    return this.isMobileCalendar ? 'operatorDay' : 'timeGridWeek,operatorDay';
  }

  private scheduleCalendarDayRollover(): void {
    this.clearCalendarDayRollover();
    this.calendarDayRolloverTimeout = setTimeout(() => {
      this.goToToday();
      this.loadAppointments();
      this.scheduleCalendarDayRollover();
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

  private getOperatorDayViewsOption(): CalendarOptions['views'] {
    return {
      operatorDay: {
        type: 'timeGrid',
        visibleRange: (currentDate: Date) => {
          const start = this.startOfDay(currentDate);

          return {
            start,
            end: this.addDays(start, Math.max(1, this.getOperatorDayColumnOperators().length))
          };
        },
        dateIncrement: { days: 1 },
        buttonText: 'Giorno',
        titleFormat: { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }
      }
    };
  }

  private updateOperatorDayViewDuration(): void {
    const views = this.getOperatorDayViewsOption();
    this.calendarOptions = {
      ...this.calendarOptions,
      views
    };

    const calendarApi = this.calendarComponent?.getApi();
    if (calendarApi) {
      calendarApi.setOption('views', views);
    }
  }

  private syncDatePickerValue(fallbackDate: Date): void {
    const activeDate = this.isOperatorDayView
      ? this.operatorDayDate
      : (this.calendarComponent?.getApi()?.getDate() ?? fallbackDate);
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

      this.calendarComponent?.getApi()?.scrollToTime(this.getCalendarScrollTimeForNow());
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

  private syncEditStartPartsFromForm(): void {
    const value = this.appointmentEditForm.dataOraInizio;
    if (!value || !value.includes('T')) {
      this.editStartDate = '';
      this.editStartTime = '';
      return;
    }

    const [datePart, timePartRaw] = value.split('T');
    const timePart = (timePartRaw || '').slice(0, 5);
    this.editStartDate = datePart || '';
    this.editStartTime = timePart || '08:00';
    this.syncEditDatePickerMonthFromStart();
  }

  private syncEditDatePickerMonthFromStart(): void {
    const base = this.parseInputDate(this.editStartDate) ?? new Date();
    this.editDatePickerMonth = new Date(base.getFullYear(), base.getMonth(), 1);
    this.editDatePickerDays = this.buildCalendarPickerDays(this.editDatePickerMonth, this.editStartDate);
  }

  private applyEditStartParts(): void {
    if (!this.editStartDate) {
      this.appointmentEditForm.dataOraInizio = '';
      this.onEditStartChange();
      return;
    }

    const normalizedTime = this.editStartTime && this.editStartTime.length >= 4
      ? this.editStartTime.slice(0, 5)
      : '08:00';

    this.editStartTime = normalizedTime;
    this.appointmentEditForm.dataOraInizio = `${this.editStartDate}T${normalizedTime}`;
    this.onEditStartChange();
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

  private syncCalendarTitleState(fullCalendarTitle?: string): void {
    if (typeof document === 'undefined') {
      return;
    }

    const title = this.getCalendarTitleElement();

    if (!title) {
      return;
    }

    const nextTitle = this.isOperatorDayView
      ? this.formatOperatorDayTitle(this.operatorDayDate)
      : (fullCalendarTitle ?? this.calendarComponent?.getApi()?.view.title);

    if (nextTitle && title.textContent !== nextTitle) {
      title.textContent = nextTitle;
    }

    title.classList.toggle('is-picker-open', this.calendarPickerOpen && !this.calendarPickerClosing);
  }

  private syncCalendarTitleStateSoon(fullCalendarTitle?: string): void {
    if (typeof window === 'undefined') {
      return;
    }

    window.requestAnimationFrame(() => this.syncCalendarTitleState(fullCalendarTitle));
    window.setTimeout(() => this.syncCalendarTitleState(fullCalendarTitle), 80);
  }

  private getCalendarTitleElement(): HTMLElement | null {
    if (typeof document === 'undefined') {
      return null;
    }

    return document.querySelector(
      '.management-appointments-section .calendar-wrapper .fc-toolbar-title'
    ) as HTMLElement | null;
  }

  private formatOperatorDayTitle(date: Date): string {
    const label = new Intl.DateTimeFormat('it-IT', {
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      year: 'numeric'
    }).format(date);

    return label.charAt(0).toUpperCase() + label.slice(1);
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

  private renderDayHeader(arg: { date: Date; text: string; view?: { type?: string } }): { html: string } | string {
    if (arg.view?.type !== 'operatorDay') {
      return arg.text;
    }

    const operatore = this.getOperatorFromSyntheticDate(arg.date);
    const label = operatore ? `${operatore.nome} ${operatore.cognome}` : '';

    return {
      html: `<span class="operator-day-header">${this.escapeHtml(label)}</span>`
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
    const clientName = this.escapeHtml(String(arg.event.extendedProps['clientName'] ?? '').trim());
    const clientPhone = this.escapeHtml(String(arg.event.extendedProps['clientPhone'] ?? '').trim());
    const clientEmail = this.escapeHtml(String(arg.event.extendedProps['clientEmail'] ?? '').trim());
    const operatorName = this.escapeHtml(String(arg.event.extendedProps['operatorName'] ?? '').trim());
    const timeText = this.escapeHtml(this.buildEventTimeText(arg));
    const canManage = Boolean(arg.event.extendedProps['canManage']);
    const canModify = Boolean(arg.event.extendedProps['canModify']);
    const canDelete = Boolean(arg.event.extendedProps['canDelete']);
    const editStateClass = !canManage ? 'is-hidden' : (canModify ? '' : 'is-disabled');
    const deleteStateClass = !canManage ? 'is-hidden' : (canDelete ? '' : 'is-disabled');
    const contactParts = [clientPhone, clientEmail].filter(Boolean);
    const contactText = contactParts.join(' | ');
    const icons = `
      <div class="appointment-event-actions">
        <button type="button" class="appointment-icon-btn edit ${editStateClass}" title="Modifica">
          <i class="bi bi-pencil-square"></i>
        </button>
        <button type="button" class="appointment-icon-btn delete ${deleteStateClass}" title="Elimina">
          <i class="bi bi-trash3"></i>
        </button>
      </div>
    `;
    const compactRow = `
      <div class="appointment-event-compact-row">
        ${serviceName ? `<span class="appointment-event-service-inline">${serviceName}</span>` : ''}
        ${icons}
      </div>
    `;

    return {
      html: `
        <div class="appointment-event-shell${isCompactEvent ? ' is-compact' : ''}${isTinyEvent ? ' is-tiny' : ''}">
          <div class="appointment-event-head">
            <span class="appointment-event-title">${title || 'Appuntamento'}</span>
            ${clientName ? `<span class="appointment-event-client">${clientName}</span>` : ''}
            ${contactText ? `<span class="appointment-event-contact">${contactText}</span>` : ''}
          </div>
          <div class="appointment-event-expand">
            <span class="appointment-event-time">${timeText}</span>
            ${clientName ? `<span class="appointment-event-info"><strong>Cliente:</strong> ${clientName}</span>` : ''}
            ${clientPhone ? `<span class="appointment-event-info"><strong>Telefono:</strong> ${clientPhone}</span>` : ''}
            ${clientEmail ? `<span class="appointment-event-info"><strong>Email:</strong> ${clientEmail}</span>` : ''}
            ${isCompactEvent ? compactRow : (serviceName ? `<span class="appointment-event-info"><strong>Servizio:</strong> ${serviceName}</span>` : '')}
            ${serviceDescription ? `<span class="appointment-event-info"><strong>Descrizione:</strong> ${serviceDescription}</span>` : ''}
            ${operatorName ? `<span class="appointment-event-info"><strong>Operatore:</strong> ${operatorName}</span>` : ''}
          </div>
          ${isCompactEvent ? '' : icons}
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


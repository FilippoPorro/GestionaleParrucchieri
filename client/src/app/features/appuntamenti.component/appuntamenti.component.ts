import { Component, OnInit, ViewChild, ChangeDetectorRef, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FullCalendarModule, FullCalendarComponent } from '@fullcalendar/angular';
import { CalendarOptions, EventInput, EventContentArg } from '@fullcalendar/core';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import itLocale from '@fullcalendar/core/locales/it';
import { NavbarComponent } from '../navbar.component/navbar.component';
import { FormsModule } from '@angular/forms';
import { UtentiService } from '../../services/utentiService';
import { Utente } from "../../models/utente.model";
import { AppuntamentoService } from "../../services/appuntamentoService";
import { Appuntamento } from '../../models/appuntamento.model';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { ServiziService } from '../../services/servizio';
import { Servizio } from '../../models/servizio.model';
import { forkJoin } from 'rxjs';
import { environment } from '../../../environments/environment';

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
}

@Component({
  selector: 'app-appuntamenti',
  standalone: true,
  imports: [
    CommonModule,
    FullCalendarModule,
    NavbarComponent,
    FormsModule
  ],
  templateUrl: './appuntamenti.component.html',
  styleUrls: ['./appuntamenti.component.css']
})
export class AppuntamentiComponent implements OnInit {
  private readonly mobileBreakpoint = 768;
  private readonly minimumAppointmentDurationMinutes = 30;

  private api = `${environment.apiUrl}/auth`;
  private readonly openingSchedule: Record<number, DailySchedule> = {
    0: { name: 'Domenica', intervals: [] },
    1: { name: 'Lunedi', intervals: [] },
    2: { name: 'Martedi', intervals: [{ start: '08:00', end: '12:30' }, { start: '14:00', end: '19:30' }] },
    3: { name: 'Mercoledi', intervals: [{ start: '13:00', end: '21:30' }] },
    4: { name: 'Giovedi', intervals: [{ start: '08:00', end: '12:30' }, { start: '14:00', end: '19:30' }] },
    5: { name: 'Venerdi', intervals: [{ start: '07:00', end: '19:30' }] },
    6: { name: 'Sabato', intervals: [{ start: '07:00', end: '18:00' }] }
  };
  readonly openingScheduleList: DailySchedule[] = [
    this.openingSchedule[1],
    this.openingSchedule[2],
    this.openingSchedule[3],
    this.openingSchedule[4],
    this.openingSchedule[5],
    this.openingSchedule[6],
    this.openingSchedule[0]
  ];

  selectedOperator: number | null = null;
  selectedServiceId: number | null = null;
  selectedServiceName = '';
  operatorSelectOpen = false;
  operatori: Utente[] = [];
  clienti: Utente[] = [];
  availableServiceOperatorIds = new Set<number>();
  user: any = null;
  showError = false;
  shakeAnimation = false;
  errorMessage = '';
  alertVariant: 'error' | 'success' = 'error';
  isMobileCalendar = false;
  calendarDatePickerValue = '';
  calendarPickerOpen = false;
  calendarPickerClosing = false;
  calendarPickerMonth = new Date();
  calendarPickerDays: CalendarPickerDay[] = [];
  calendarPickerPanelStyle: Record<string, string> = {};
  readonly calendarPickerWeekdays = ['Lu', 'Ma', 'Me', 'Gi', 'Ve', 'Sa', 'Do'];
  readonly calendarPickerMonthFormatter = new Intl.DateTimeFormat('it-IT', { month: 'long', year: 'numeric' });
  private alertTimeout: ReturnType<typeof setTimeout> | null = null;
  private calendarPickerCloseTimeout: ReturnType<typeof setTimeout> | null = null;
  private calendarScrollTimeout: ReturnType<typeof setTimeout> | null = null;
  private requestedOperatorId: number | null = null;
  private requestedCalendarDate: string | null = null;
  private appointmentDetailCloseTimeout: ReturnType<typeof setTimeout> | null = null;

  events: EventInput[] = [];
  private loadedAppointments: Appuntamento[] = [];
  private serviceDescriptionByName = new Map<string, string>();
  private availabilityMaskEvents: EventInput[] = [];
  private visibleRangeStart: Date | null = null;
  private visibleRangeEnd: Date | null = null;
  selectedAppointment: Appuntamento | null = null;
  selectedAppointmentLabel = '';
  isAppointmentDetailOpen = false;
  isAppointmentDetailClosing = false;
  appointmentDetailToneClass = 'tone-other';
  isEditingAppointment = false;
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
    idServizio: null
  };
  private originalAppointmentEditForm: AppointmentEditForm = {
    dataOraInizio: '',
    dataOraFine: '',
    idServizio: null
  };
  editStartDate = '';
  editStartTime = '';
  editDatePickerOpen = false;
  editDatePickerClosing = false;
  editDatePickerMonth = new Date();
  editDatePickerDays: CalendarPickerDay[] = [];
  editServicesOpen = false;
  private editDatePickerCloseTimeout: ReturnType<typeof setTimeout> | null = null;

  @ViewChild('calendar') calendarComponent!: FullCalendarComponent;

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
    private utenteService: UtentiService,
    private appuntamentoService: AppuntamentoService,
    private http: HttpClient,
    private cdr: ChangeDetectorRef,
    private serviziService: ServiziService,
    private route: ActivatedRoute,
    private router: Router
  ) { }

  ngOnInit() {
    this.route.queryParamMap.subscribe((params) => {
      this.hideAlert();
      const servizio = params.get('servizio');
      const operatore = params.get('operatore');
      const requestedDate = params.get('data');
      const parsedServizio = servizio ? Number(servizio) : null;
      const parsedOperatore = operatore ? Number(operatore) : null;
      this.selectedServiceId = parsedServizio !== null && Number.isFinite(parsedServizio)
        ? parsedServizio
        : null;
      this.requestedOperatorId = parsedOperatore !== null && Number.isFinite(parsedOperatore)
        ? parsedOperatore
        : null;
      this.requestedCalendarDate = requestedDate;

      if (this.selectedServiceId) {
        this.loadSelectedServiceContext(this.selectedServiceId);
      } else {
        this.selectedServiceName = '';
        this.availableServiceOperatorIds.clear();
      }
    });
    this.syncCalendarResponsiveMode();
    this.calendarDatePickerValue = this.formatDateForInput(new Date());
    this.syncCalendarPickerMonth(new Date());
    this.getLoggedUser();

    forkJoin({
      operatori: this.utenteService.getOperatori(),
      clienti: this.utenteService.getClienti()
    }).subscribe({
      next: ({ operatori, clienti }) => {
        this.operatori = operatori;
        this.clienti = clienti;

        if (this.operatori.length > 0) {
          if (this.requestedOperatorId && this.operatori.some((operatore) => operatore.idUtente === this.requestedOperatorId)) {
            this.selectedOperator = this.requestedOperatorId;
            this.onOperatorChange(null);
          } else if (this.selectedServiceId) {
            this.loadSelectedServiceContext(this.selectedServiceId);
          } else {
            this.selectedOperator = this.operatori[0].idUtente;
            this.onOperatorChange(null);
          }
        }

        this.cdr.detectChanges();
      },
      error: (err) => console.error("Errore caricando operatori e clienti:", err)
    });


  }

  @HostListener('window:resize')
  onWindowResize(): void {
    this.syncCalendarResponsiveMode();
    this.updateCalendarPickerPosition();
  }

  handleDateClick(arg: any) {
    const clickedDate = arg.date instanceof Date ? arg.date : new Date(arg.date);

    if (!this.isBookableDateTime(clickedDate)) {
      if (this.isTrustedUserInteraction(arg?.jsEvent)) {
        this.showAlert(this.getInvalidSlotMessage(clickedDate));
      }
      return;
    }

    this.router.navigate(['/prenotazione'], {
      queryParams: {
        data: arg.dateStr,
        operatore: this.selectedOperator,
        servizio: this.selectedServiceId ?? undefined
      }
    });
  }

  handleEventClick(arg: any) {
    if (arg.event?.display === 'background') {
      const startDate = arg.event.start instanceof Date
        ? arg.event.start
        : new Date(arg.event.start);

      if (this.isTrustedUserInteraction(arg?.jsEvent)) {
        this.showAlert(this.getInvalidSlotMessage(startDate));
      }
      return;
    }

    const clickedAppointmentId = Number(
      arg.event?.id ?? arg.event?.extendedProps?.idAppuntamento
    );

    if (!Number.isFinite(clickedAppointmentId)) {
      return;
    }

    const appointment = this.loadedAppointments.find(
      (item) => item.idAppuntamento === clickedAppointmentId
    );

    if (!appointment) {
      return;
    }

    if (!this.canUserViewAppointment(appointment)) {
      if (this.isTrustedUserInteraction(arg?.jsEvent)) {
        this.showAlert('Questo slot e gia prenotato.');
      }
      return;
    }

    const clickedElement = arg.jsEvent?.target as HTMLElement | null;
    if (clickedElement?.closest('.appointment-icon-btn.edit')) {
      if (!arg.event.extendedProps?.canModify) {
        return;
      }
      this.openAppointmentDetail(appointment, true);
      return;
    }

    if (clickedElement?.closest('.appointment-icon-btn.delete')) {
      if (!arg.event.extendedProps?.canDelete) {
        return;
      }
      this.openDeleteConfirmation(appointment, false);
      return;
    }

    this.openAppointmentDetail(appointment);
  }

  getLoggedUser() {
      this.http.get<any>(`${this.api}/me`)
        .subscribe({
          next: (res) => {
            if (!res) return;

            this.user = res;
            console.log("Utente loggato:", this.user);

            if (this.selectedOperator) {
              this.onOperatorChange(null);
            }

            this.cdr.detectChanges();
          },
          error: () => {
            // Utente non loggato: il calendario resta visibile, ma senza evidenziare "Tuo appuntamento".
            this.user = null;
            this.cdr.detectChanges();
          }
        });
    }

  onOperatorChange(event: any) {
      this.closeOperatorSelect();

      if(!this.selectedOperator) return;

    this.appuntamentoService.getAppuntamenti(this.selectedOperator)
      .subscribe({
        next: (eventi) => {
          console.log(eventi);
          this.loadedAppointments = eventi;
          this.loadServiceDetailsForOperator(this.selectedOperator!);
          this.closeAppointmentDetail();
          this.rebuildCalendarEvents();
        },
        error: (err) => console.error("Errore caricando appuntamenti:", err)
      });
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

  private rebuildCalendarEvents(): void {
    const nowTimestamp = Date.now();
    this.events = this.loadedAppointments.map((a) => {
      const normalizedStart = this.normalizeDateTimeForCalendar(a.dataOraInizio);
      const normalizedEnd = this.normalizeDateTimeForCalendar(a.dataOraFine);
      const calendarEnd = this.getCalendarEventEnd(normalizedStart, normalizedEnd);
      const isMyAppointment = this.isCustomerOwnAppointment(a.idCliente);
      const appointmentEnd = new Date(normalizedEnd);
      const isPastAppointment =
        !Number.isNaN(appointmentEnd.getTime()) &&
        appointmentEnd.getTime() < nowTimestamp;
      const isPermission = this.isPermissionAppointment(a);
      const isFerie = isPermission && String(a.note || '').trim() === 'Ferie';
      const canSeePermissionLabel = isPermission && this.canCurrentUserSeePermissionLabel();
      const canManage = this.canUserManageAppointment(a);
      const canModify = this.canModifyAppointment(a);
      const canDelete = this.canDeleteAppointment(a);
      const isVisible = this.canUserViewAppointment(a);
      const serviceName = isPermission ? '' : (a.note || '').trim();
      const normalizedServiceName = serviceName.toLowerCase();
      const serviceDescription = this.serviceDescriptionByName.get(normalizedServiceName) || '';
      const clientDetails = isPermission ? null : this.getAppointmentClientDetails(a);
      const displayTitle = canSeePermissionLabel
        ? (isFerie ? 'Ferie' : 'Permesso')
        : isPermission
        ? 'Occupato'
        : isVisible
        ? (serviceName || 'Servizio prenotato')
        : 'Appuntamento prenotato';

      return {
        id: `${a.idAppuntamento}`,
        title: displayTitle,
        start: normalizedStart,
        end: calendarEnd,
        extendedProps: {
          idAppuntamento: a.idAppuntamento,
          actualStart: normalizedStart,
          actualEnd: normalizedEnd,
          canManage,
          canModify,
          canDelete,
          isVisible,
          displayTitle,
          serviceName,
          serviceDescription,
          operatorName: this.selectedOperatorLabel,
          clientName: clientDetails?.name ?? '',
          clientPhone: clientDetails?.phone ?? '',
          clientEmail: clientDetails?.email ?? ''
        },
        classNames: [
          isMyAppointment && !isPermission ? 'my-appointment' : (isPastAppointment ? 'past-appointment' : 'other-appointment'),
          isFerie && canSeePermissionLabel ? 'ferie-appointment' : '',
          canSeePermissionLabel && !isFerie ? 'permission-appointment' : '',
          isPermission && !canSeePermissionLabel ? 'permission-occupied-appointment' : '',
          !isVisible ? 'masked-appointment' : ''
        ].filter(Boolean)
      } as EventInput;
    });
    this.refreshCalendarEvents();
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

  private isCustomerOwnAppointment(appointmentCustomerId: number | null | undefined): boolean {
    if (!this.user) {
      return false;
    }

    if (this.user.ruolo === 'admin' || this.user.ruolo === 'operatore') {
      return true;
    }

    if (!appointmentCustomerId || !this.user.idUtente) {
      return false;
    }

    return this.user.ruolo === 'cliente' && appointmentCustomerId === this.user.idUtente;
  }

  private openAppointmentDetail(appointment: Appuntamento, startInEditMode = false): void {
    if (this.appointmentDetailCloseTimeout) {
      clearTimeout(this.appointmentDetailCloseTimeout);
      this.appointmentDetailCloseTimeout = null;
    }

    this.selectedAppointment = appointment;
    this.selectedAppointmentLabel = this.buildAppointmentLabel(appointment);
    this.appointmentActionError = '';
    this.isEditingAppointment = false;
    this.isAppointmentDetailClosing = false;
    this.isAppointmentDetailOpen = true;
    this.appointmentDetailToneClass = this.getAppointmentToneClass(appointment);
    this.appointmentEditForm = {
      dataOraInizio: this.toLocalDateTimeInput(appointment.dataOraInizio),
      dataOraFine: this.toLocalDateTimeInput(appointment.dataOraFine),
      idServizio: null
    };
    this.originalAppointmentEditForm = {
      dataOraInizio: this.appointmentEditForm.dataOraInizio,
      dataOraFine: this.appointmentEditForm.dataOraFine,
      idServizio: null
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
  }

  closeAppointmentDetail(): void {
    if (!this.isAppointmentDetailOpen || this.isAppointmentDetailClosing) {
      return;
    }

    this.isAppointmentDetailClosing = true;
    this.appointmentDetailCloseTimeout = setTimeout(() => {
      this.isAppointmentDetailOpen = false;
      this.isAppointmentDetailClosing = false;
      this.isEditingAppointment = false;
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
        idServizio: null
      };
      this.originalAppointmentEditForm = {
        dataOraInizio: '',
        dataOraFine: '',
        idServizio: null
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
    if (!this.selectedAppointment) {
      return;
    }

    if (!this.canModifySelectedAppointment) {
      this.appointmentActionError = "Puoi modificare solo appuntamenti futuri e gestibili.";
      return;
    }

    if (this.isEditFormLoading) {
      return;
    }

    this.isEditingAppointment = true;
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

    this.isEditingAppointment = false;
    this.appointmentActionError = '';
    this.appointmentEditForm = {
      dataOraInizio: this.originalAppointmentEditForm.dataOraInizio,
      dataOraFine: this.originalAppointmentEditForm.dataOraFine,
      idServizio: this.originalAppointmentEditForm.idServizio
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
    this.refreshEditEndFromSelectedService();
    this.forceViewRefresh();
  }

  selectEditService(service: Servizio): void {
    if (!this.canEditServiceInCurrentSlot(service)) {
      return;
    }

    this.appointmentEditForm.idServizio = service.idServizio;
    this.closeEditServicesPicker();
    this.onEditServiceChange();
    this.forceViewRefresh();
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
    this.forceViewRefresh();
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
      this.appointmentActionError = "Seleziona orario e servizio validi.";
      return;
    }

    if (!this.isWithinOpeningHoursRange(range.start, range.end)) {
      this.appointmentActionError = "Il servizio scelto non rientra negli orari di apertura.";
      return;
    }

    if (this.hasOverlapForEditedRange(range.start, range.end)) {
      this.appointmentActionError = "Il servizio scelto si sovrappone a un altro appuntamento.";
      return;
    }

    const hasRealChanges =
      this.appointmentEditForm.dataOraInizio !== this.originalAppointmentEditForm.dataOraInizio ||
      this.appointmentEditForm.dataOraFine !== this.originalAppointmentEditForm.dataOraFine ||
      this.appointmentEditForm.idServizio !== this.originalAppointmentEditForm.idServizio;

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
      note: range.service.nome
    }).subscribe({
      next: () => {
        this.isAppointmentActionLoading = false;
        this.isEditingAppointment = false;
        this.showAlert('Appuntamento modificato con successo.', 'success');
        this.forceViewRefresh(true);
        this.onOperatorChange(null);
      },
      error: (err) => {
        this.isAppointmentActionLoading = false;
        this.appointmentActionError = err?.error?.message || "Modifica non riuscita.";
        this.forceViewRefresh();
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
    if (this.isAppointmentActionLoading) {
      return;
    }

    if (!this.canDeleteAppointment(appointment)) {
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
          this.closeAppointmentDetail();
          this.forceViewRefresh(true);
          this.onOperatorChange(null);
        },
        error: (err) => {
          this.isAppointmentActionLoading = false;
          const message = err?.error?.message || 'Eliminazione non riuscita.';
          if (keepDetailOpen) {
            this.appointmentActionError = message;
          } else {
            this.showAlert(message);
          }
          this.forceViewRefresh();
        }
      });
  }

  get canManageSelectedAppointment(): boolean {
    if (!this.selectedAppointment) {
      return false;
    }

    return this.canUserManageAppointment(this.selectedAppointment);
  }

  get canModifySelectedAppointment(): boolean {
    if (!this.selectedAppointment) {
      return false;
    }

    return this.canModifyAppointment(this.selectedAppointment);
  }

  private canUserViewAppointment(appointment: Appuntamento): boolean {
    if (this.isPermissionAppointment(appointment)) {
      return this.canCurrentUserSeePermissionLabel();
    }

    if (!this.user) {
      return false;
    }

    if (this.user.ruolo === 'admin' || this.user.ruolo === 'operatore') {
      return true;
    }

    return this.user.ruolo === 'cliente' && appointment.idCliente === this.user.idUtente;
  }

  private canUserManageAppointment(appointment: Appuntamento): boolean {
    if (this.isPermissionAppointment(appointment)) {
      return false;
    }

    if (!this.user) {
      return false;
    }

    if (this.user.ruolo === 'admin' || this.user.ruolo === 'operatore') {
      return true;
    }

    return this.user.ruolo === 'cliente' && appointment.idCliente === this.user.idUtente;
  }

  private canCurrentUserSeePermissionLabel(): boolean {
    return this.user?.ruolo === 'admin' || this.user?.ruolo === 'operatore';
  }

  get canDeleteSelectedAppointment(): boolean {
    if (!this.selectedAppointment) {
      return false;
    }

    return this.canDeleteAppointment(this.selectedAppointment);
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

    if (this.isAppointmentDetailOpen) {
      this.closeEditDatePicker();
      this.closeAppointmentDetail();
      return;
    }

    this.closeCalendarPicker();
    this.closeOperatorSelect();
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
          if (
            !this.selectedAppointment ||
            services.length === 0
          ) {
            this.editableServices = [];
            this.appointmentEditForm.idServizio = null;
            this.appointmentEditForm.dataOraFine = '';
            this.isEditFormLoading = false;
            this.forceViewRefresh();
            return;
          }

          this.editableServices = services;
          const matchedService = services.find((service) => service.nome === (this.selectedAppointment?.note ?? ''));
          const firstAvailableService = services.find((service) => this.canEditServiceInCurrentSlot(service));

          this.appointmentEditForm.idServizio = matchedService?.idServizio ?? firstAvailableService?.idServizio ?? null;
          this.refreshEditEndFromSelectedService();
          this.originalAppointmentEditForm = {
            dataOraInizio: this.appointmentEditForm.dataOraInizio,
            dataOraFine: this.appointmentEditForm.dataOraFine,
            idServizio: this.appointmentEditForm.idServizio
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

    return this.isWithinOpeningHoursRange(range.start, range.end) && !this.hasOverlapForEditedRange(range.start, range.calendarHoldEnd);
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

    if (!this.canEditServiceInCurrentSlot(selectedService)) {
      this.appointmentEditForm.idServizio = null;
      this.appointmentEditForm.dataOraFine = '';
      return;
    }

    this.appointmentEditForm.dataOraFine = this.toLocalDateTimeInput(range.end.toISOString());
  }

  private buildEditedRangeFromSelectedService():
    | { start: Date; end: Date; service: Servizio }
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
    const durationMinutes = Number(service.durata || 0);

    if (Number.isNaN(start.getTime()) || !Number.isFinite(durationMinutes) || durationMinutes <= 0) {
      return null;
    }

    const end = new Date(start);
    end.setMinutes(end.getMinutes() + durationMinutes);

    const calendarHoldEnd = new Date(start);
    calendarHoldEnd.setMinutes(calendarHoldEnd.getMinutes() + this.minimumAppointmentDurationMinutes);

    return { start, end, calendarHoldEnd: end < calendarHoldEnd ? calendarHoldEnd : end };
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

    return this.loadedAppointments.some((appointment) => {
      if (appointment.idAppuntamento === this.selectedAppointment?.idAppuntamento) {
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
    const clientName = this.escapeHtml(String(arg.event.extendedProps['clientName'] ?? '').trim());
    const clientPhone = this.escapeHtml(String(arg.event.extendedProps['clientPhone'] ?? '').trim());
    const clientEmail = this.escapeHtml(String(arg.event.extendedProps['clientEmail'] ?? '').trim());
    const timeText = this.escapeHtml(this.buildEventTimeText(arg));
    const canManage = Boolean(arg.event.extendedProps['canManage']);
    const canModify = Boolean(arg.event.extendedProps['canModify']);
    const canDelete = Boolean(arg.event.extendedProps['canDelete']);
    const editStateClass = !canManage ? 'is-hidden' : (canModify ? '' : 'is-disabled');
    const deleteStateClass = !canManage ? 'is-hidden' : (canDelete ? '' : 'is-disabled');
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

  private getMinimumAppointmentEnd(start: Date, end: Date): Date {
    const minimumEnd = new Date(start);
    minimumEnd.setMinutes(minimumEnd.getMinutes() + this.minimumAppointmentDurationMinutes);
    return end < minimumEnd ? minimumEnd : end;
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

    return !this.isPastAppointment(appointment);
  }

  private isPastAppointment(appointment: Appuntamento): boolean {
    const appointmentEnd = new Date(appointment.dataOraFine);
    return !Number.isNaN(appointmentEnd.getTime()) && appointmentEnd.getTime() < Date.now();
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
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

    return this.canUserManageAppointment(appointment) ? 'tone-my' : 'tone-other';
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

  private getAppointmentClientDetails(appointment: Appuntamento): { name: string; phone: string; email: string } | null {
    if (!appointment.idCliente) {
      return null;
    }

    const cliente = this.clienti.find((item) => item.idUtente === appointment.idCliente);
    return {
      name: cliente ? `${cliente.nome} ${cliente.cognome}` : `Cliente #${appointment.idCliente}`,
      phone: cliente?.telefono?.trim() ?? '',
      email: cliente?.email?.trim() ?? ''
    };
  }

  getSelectedAppointmentServiceLabel(): string {
    if (!this.selectedAppointment) {
      return '';
    }

    return this.selectedAppointment.servizioNome?.trim()
      || this.selectedAppointment.note?.trim()
      || 'Servizio non indicato';
  }

  getSelectedAppointmentClientLabel(): string {
    if (!this.selectedAppointment) {
      return '';
    }

    return this.getAppointmentClientDetails(this.selectedAppointment)?.name || 'Non indicato';
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

  private isPermissionAppointment(appointment: Appuntamento): boolean {
    const note = String(appointment.note ?? '').trim();
    const serviceName = String(appointment.servizioNome ?? '').trim();

    return !appointment.idCliente &&
      !appointment.idServizio &&
      (!serviceName || serviceName === note) &&
      (!note || note === 'Permesso' || note === 'Ferie') &&
      !appointment.stato;
  }

  private buildAppointmentLabel(appointment: Appuntamento): string {
    const start = new Date(appointment.dataOraInizio);
    const end = new Date(appointment.dataOraFine);
    const dateFormatter = new Intl.DateTimeFormat('it-IT', {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    });
    const timeFormatter = new Intl.DateTimeFormat('it-IT', {
      hour: '2-digit',
      minute: '2-digit'
    });

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return 'Dettaglio appuntamento';
    }

    return `${dateFormatter.format(start)} - ${timeFormatter.format(end)}`;
  }

  get selectedOperatorLabel(): string {
    const selected = this.operatori.find(
      (operatore) => operatore.idUtente === this.selectedOperator
    );

    if (!selected) {
      return 'Seleziona operatore';
    }

    return `${selected.nome} ${selected.cognome}`;
  }

  get availableOperators(): Utente[] {
    return this.operatori.filter((operatore) => operatore.idUtente !== this.selectedOperator);
  }

  get serviceInfoMessage(): string {
    return this.selectedServiceName
      ? `Scegli l'ora e l'operatore disponibile per il servizio: ${this.selectedServiceName}`
      : '';
  }

  toggleOperatorSelect(): void {
    this.operatorSelectOpen = !this.operatorSelectOpen;
  }

  selectOperator(operatorId: number): void {
    if (this.isOperatorDisabled(operatorId)) {
      return;
    }

    if (this.selectedOperator === operatorId) {
      this.closeOperatorSelect();
      return;
    }

    this.selectedOperator = operatorId;
    this.onOperatorChange(null);
  }

  closeOperatorSelect(): void {
    this.operatorSelectOpen = false;
  }

  onOperatorTriggerKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.toggleOperatorSelect();
      return;
    }

    if (event.key === 'Escape') {
      this.closeOperatorSelect();
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.operatorSelectOpen = true;
    }
  }

  isOperatorDisabled(operatorId: number): boolean {
    if (!this.selectedServiceId) {
      return false;
    }

    return !this.availableServiceOperatorIds.has(operatorId);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;

    if (target?.closest('.appointments-select-wrapper')) {
      return;
    }

    if (target?.closest('.fc-toolbar-title')) {
      this.toggleCalendarPicker();
      return;
    }

    if (!target?.closest('.appointments-date-picker-panel')) {
      this.closeCalendarPicker();
    }

    if (!target?.closest('.appointment-edit-date-wrap')) {
      this.closeEditDatePicker();
    }

    if (!target?.closest('.appointment-services-picker-wrap')) {
      this.closeEditServicesPicker();
    }

    this.closeOperatorSelect();
  }

  private showAlert(message: string, variant: 'error' | 'success' = 'error'): void {
    this.alertVariant = variant;
    this.errorMessage = message;
    this.showError = true;
    this.shakeAnimation = false;
    this.cdr.detectChanges();

    if (variant === 'error') {
      setTimeout(() => {
        this.shakeAnimation = true;
        this.cdr.detectChanges();
      }, 10);
    }

    if (this.alertTimeout) {
      clearTimeout(this.alertTimeout);
    }

    this.alertTimeout = setTimeout(() => {
      this.showError = false;
      this.cdr.detectChanges();
    }, 2600);
  }

  private hideAlert(): void {
    if (this.alertTimeout) {
      clearTimeout(this.alertTimeout);
      this.alertTimeout = null;
    }

    this.showError = false;
    this.shakeAnimation = false;
    this.errorMessage = '';
  }

  private isTrustedUserInteraction(event: Event | null | undefined): boolean {
    return Boolean(event && (event as Event).isTrusted);
  }

  private loadSelectedServiceContext(serviceId: number): void {
    this.serviziService.getServiceById(serviceId).subscribe({
      next: (service) => {
        this.selectedServiceName = service?.nome ?? '';
        this.loadOperatorsAvailabilityForService(service);
        this.cdr.detectChanges();
      },
      error: () => {
        this.selectedServiceName = '';
        this.availableServiceOperatorIds.clear();
        this.cdr.detectChanges();
      }
    });
  }

  private loadOperatorsAvailabilityForService(service: Servizio | undefined): void {
    if (!service || this.operatori.length === 0) {
      this.availableServiceOperatorIds.clear();
      return;
    }

    forkJoin(
      this.operatori.map((operatore) =>
        this.serviziService.getServiziPrenotabiliByOperatore(operatore.idUtente)
      )
    ).subscribe({
      next: (servicesByOperator) => {
        const availableIds = new Set<number>();

        servicesByOperator.forEach((services, index) => {
          const canPerformService = services.some(
            (operatorService) => operatorService.idServizio === service.idServizio
          );

          if (canPerformService) {
            availableIds.add(this.operatori[index].idUtente);
          }
        });

        this.availableServiceOperatorIds = availableIds;

        if (!this.selectedOperator || !this.availableServiceOperatorIds.has(this.selectedOperator)) {
          this.selectedOperator = this.operatori.find((operatore) =>
            this.availableServiceOperatorIds.has(operatore.idUtente)
          )?.idUtente ?? null;

          if (this.selectedOperator) {
            this.onOperatorChange(null);
          }
        }

        this.cdr.detectChanges();
      },
      error: () => {
        this.availableServiceOperatorIds.clear();
        this.cdr.detectChanges();
      }
    });
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

  onEditTimeChange(): void {
    this.applyEditStartParts();
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
    const requestedDate = this.parseCalendarDateValue(this.requestedCalendarDate);
    const activeDate = requestedDate
      ?? (this.calendarComponent ? this.calendarComponent.getApi().getDate() : fallbackDate);

    this.calendarDatePickerValue = this.formatDateForInput(activeDate);
    this.syncCalendarPickerMonth(activeDate);
    this.requestedCalendarDate = null;
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

      const calendarApi = this.calendarComponent.getApi();
      calendarApi.scrollToTime(this.getCalendarScrollTimeForNow());
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

  private parseCalendarDateValue(value: string | null): Date | null {
    if (!value) {
      return null;
    }

    const date = new Date(value);
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

    const wrapper = document.querySelector('.calendar-wrapper') as HTMLElement | null;
    const title = document.querySelector('.fc-toolbar-title') as HTMLElement | null;

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

  private refreshCalendarEvents(): void {
    if (!this.calendarComponent) {
      return;
    }

    this.availabilityMaskEvents = this.buildAvailabilityMaskEvents();

    const calendarApi = this.calendarComponent.getApi();
    calendarApi.removeAllEvents();
    calendarApi.addEventSource([
      ...this.availabilityMaskEvents,
      ...this.events
    ]);
    this.forceViewRefresh(true);
  }

  private forceViewRefresh(resizeCalendar = false): void {
    this.cdr.detectChanges();

    if (resizeCalendar && this.calendarComponent) {
      this.calendarComponent.getApi().updateSize();
    }
  }

  private isBookableDateTime(date: Date): boolean {
    if (Number.isNaN(date.getTime())) {
      return false;
    }

    if (this.isPastSlot(date)) {
      return false;
    }

    return this.isWithinOpeningHours(date);
  }

  private isPastSlot(date: Date): boolean {
    const now = new Date();

    if (date.toDateString() !== now.toDateString()) {
      return date < now;
    }

    return date < now;
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
}

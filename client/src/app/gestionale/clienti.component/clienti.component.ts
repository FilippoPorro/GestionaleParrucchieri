import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IntlTelInputComponent } from 'intl-tel-input/angularWithUtils';
import { timeout } from 'rxjs/operators';
import { SidenavComponent } from '../sidenav.component/sidenav.component';
import { UtentiService } from '../../services/utentiService';
import { Utente } from '../../models/utente.model';

interface ClienteFormDraft {
  nome: string;
  cognome: string;
  email: string;
  telefono: string;
  data_nascita: string;
  sesso: '' | 'm' | 'f';
  ruolo: string;
}

interface CalendarPickerDay {
  date: Date;
  label: number;
  currentMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
}

@Component({
  selector: 'app-clienti.component',
  standalone: true,
  imports: [CommonModule, FormsModule, SidenavComponent, IntlTelInputComponent],
  templateUrl: './clienti.component.html',
  styleUrl: './clienti.component.css',
})
export class ClientiComponent implements OnInit, OnDestroy {
  private feedbackTimeout: ReturnType<typeof setTimeout> | null = null;
  private createCloseTimeout: ReturnType<typeof setTimeout> | null = null;
  private editCloseTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly panelCloseAnimationMs = 240;
  isSidenavCollapsed = false;
  clienti: Utente[] = [];
  selectedCliente: Utente | null = null;
  draftCliente: Utente | null = null;
  newCliente: ClienteFormDraft = this.createEmptyClienteDraft();
  pendingDeleteCliente: Utente | null = null;
  brokenProfilePhotos = new Set<number | string>();
  searchTerm = '';
  isLoading = true;
  isSaving = false;
  isCreating = false;
  isCreateMode = false;
  isCreateClosing = false;
  isEditClosing = false;
  isDeleting = false;
  feedbackMessage = '';
  feedbackType: 'success' | 'error' | '' = '';
  feedbackTitle = '';
  feedbackPlacement: 'table' | 'create' | 'editor' = 'editor';
  isNewPhoneValid = false;
  isEditPhoneValid = true;
  createBirthDatePickerOpen = false;
  createBirthDatePickerClosing = false;
  createBirthDatePickerMonth = new Date();
  createBirthDatePickerDays: CalendarPickerDay[] = [];
  createBirthDatePickerMode: 'days' | 'years' = 'days';
  readonly calendarPickerWeekdays = ['Lu', 'Ma', 'Me', 'Gi', 'Ve', 'Sa', 'Do'];
  readonly calendarPickerMonthFormatter = new Intl.DateTimeFormat('it-IT', { month: 'long' });
  readonly createBirthDatePickerYears = this.buildBirthDatePickerYears();
  private createBirthDatePickerCloseTimeout: ReturnType<typeof setTimeout> | null = null;
  initTelOptions = {
    initialCountry: 'it' as const,
    preferredCountries: ['it', 'gb', 'fr', 'de', 'es', 'us'],
    separateDialCode: true,
    nationalMode: false,
    strictMode: true,
    formatOnDisplay: true,
    autoPlaceholder: 'polite' as const
  };

  constructor(
    private utentiService: UtentiService,
    private cdr: ChangeDetectorRef
  ) {}

  get filteredClienti(): Utente[] {
    const term = this.searchTerm.trim().toLowerCase();

    if (!term) {
      return this.clienti;
    }

    return this.clienti.filter((cliente) =>
      [
        cliente.nome,
        cliente.cognome,
        cliente.email,
        cliente.telefono,
        String(cliente.idUtente)
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term))
    );
  }

  get clientiConTelefono(): number {
    return this.clienti.filter((cliente) => !!cliente.telefono).length;
  }

  get clientiSenzaTelefono(): number {
    return this.clienti.length - this.clientiConTelefono;
  }

  get hasDraftChanges(): boolean {
    if (!this.selectedCliente || !this.draftCliente) {
      return false;
    }

    return this.selectedCliente.nome !== this.draftCliente.nome ||
      this.selectedCliente.cognome !== this.draftCliente.cognome ||
      this.selectedCliente.email !== this.draftCliente.email ||
      (this.selectedCliente.telefono ?? '') !== (this.draftCliente.telefono ?? '') ||
      this.toDateInputValue(this.selectedCliente.data_nascita) !== (this.draftCliente.data_nascita ?? '') ||
      (this.selectedCliente.sesso ?? '') !== (this.draftCliente.sesso ?? '');
  }

  get isNewClienteValid(): boolean {
    return this.newCliente.nome.trim() !== '' &&
      this.newCliente.cognome.trim() !== '' &&
      this.newCliente.email.trim() !== '' &&
      this.newCliente.telefono.trim() !== '' &&
      this.newCliente.sesso !== '' &&
      this.isNewPhoneValid &&
      this.isAdult(this.newCliente.data_nascita);
  }

  ngOnInit(): void {
    this.loadClienti();
    this.syncCreateBirthDatePickerMonth(new Date());
  }

  ngOnDestroy(): void {
    this.clearPanelCloseTimers();
    this.clearCreateBirthDatePickerTimer();

    if (this.feedbackTimeout) {
      clearTimeout(this.feedbackTimeout);
      this.feedbackTimeout = null;
    }
  }

  toggleSidenav(): void {
    this.isSidenavCollapsed = !this.isSidenavCollapsed;
  }

  private getClientiRequest() {
    return this.utentiService.getClienti().pipe(timeout(8000));
  }

  loadClienti(): void {
    this.isLoading = true;
    this.clearFeedback();
    this.refreshView();

    this.getClientiRequest().subscribe({
      next: (clienti: Utente[]) => {
        this.clienti = clienti;
        this.pendingDeleteCliente = null;
        if (this.selectedCliente) {
          const updatedSelection = clienti.find((cliente: Utente) => cliente.idUtente === this.selectedCliente?.idUtente) ?? null;
          if (updatedSelection) {
            this.selectCliente(updatedSelection);
          } else {
            this.selectedCliente = null;
            this.draftCliente = null;
          }
        }
        this.isLoading = false;
        this.refreshView();
      },
      error: (err: any) => {
        console.error('Errore caricamento clienti:', err);
        this.showFeedback(
          'Impossibile caricare i clienti. Controlla che il backend sia avviato e collegato a Supabase.',
          'error',
          'Caricamento non riuscito',
          'table'
        );
        this.isLoading = false;
        this.refreshView();
      }
    });
  }

  selectCliente(cliente: Utente, scrollToEditor = false): void {
    this.clearPanelCloseTimers();
    this.isCreateClosing = false;
    this.isEditClosing = false;
    this.isCreateMode = false;
    this.selectedCliente = cliente;
    this.draftCliente = {
      ...cliente,
      telefono: cliente.telefono ?? '',
      data_nascita: this.toDateInputValue(cliente.data_nascita),
      sesso: cliente.sesso ?? null,
      ruolo: cliente.ruolo ?? 'cliente'
    };
    this.isEditPhoneValid = true;
    this.clearFeedback();

    if (scrollToEditor) {
      this.scrollToEditor();
    }
  }

  clearSelection(): void {
    if (this.isEditClosing) {
      return;
    }

    if (this.selectedCliente || this.draftCliente) {
      this.isEditClosing = true;
      this.clearFeedback();
      this.refreshView();

      this.editCloseTimeout = setTimeout(() => {
        this.selectedCliente = null;
        this.draftCliente = null;
        this.isCreateMode = false;
        this.isEditClosing = false;
        this.editCloseTimeout = null;
        this.refreshView();
      }, this.panelCloseAnimationMs);

      return;
    }

    this.selectedCliente = null;
    this.draftCliente = null;
    this.isCreateMode = false;
    this.clearFeedback();
  }

  startCreateCliente(): void {
    this.clearPanelCloseTimers();
    this.isCreateClosing = false;
    this.isEditClosing = false;
    this.isCreateMode = true;
    this.selectedCliente = null;
    this.draftCliente = null;
    this.newCliente = this.createEmptyClienteDraft();
    this.isNewPhoneValid = false;
    this.closeCreateBirthDatePicker(true);
    this.clearFeedback();
    this.scrollToEditor();
  }

  cancelCreateCliente(): void {
    if (this.isCreating || this.isCreateClosing) {
      return;
    }

    this.isCreateClosing = true;
    this.clearFeedback();
    this.refreshView();

    this.createCloseTimeout = setTimeout(() => {
      this.isCreateMode = false;
      this.isCreateClosing = false;
      this.newCliente = this.createEmptyClienteDraft();
      this.isNewPhoneValid = false;
      this.closeCreateBirthDatePicker(true);
      this.createCloseTimeout = null;
      this.refreshView();
    }, this.panelCloseAnimationMs);
  }

  onNewPhoneNumberChange(phoneNumber: string): void {
    this.newCliente.telefono = phoneNumber || '';
  }

  onNewPhoneValidityChange(isValid: boolean): void {
    this.isNewPhoneValid = isValid;
    this.refreshView();
  }

  onEditPhoneNumberChange(phoneNumber: string): void {
    if (!this.draftCliente) {
      return;
    }

    this.draftCliente.telefono = phoneNumber || '';
  }

  onEditPhoneValidityChange(isValid: boolean): void {
    this.isEditPhoneValid = isValid;
    this.refreshView();
  }

  requestDeleteCliente(cliente: Utente): void {
    if (this.isDeleting) {
      return;
    }

    this.pendingDeleteCliente = cliente;
    this.clearFeedback();
  }

  cancelDeleteCliente(): void {
    if (!this.isDeleting) {
      this.pendingDeleteCliente = null;
    }
  }

  confirmDeleteCliente(): void {
    if (!this.pendingDeleteCliente) {
      return;
    }

    this.deleteCliente(this.pendingDeleteCliente);
  }

  saveCliente(): void {
    if (!this.selectedCliente || !this.draftCliente || this.isSaving) {
      return;
    }

    if ((this.draftCliente.telefono ?? '').trim() && !this.isEditPhoneValid) {
      this.showFeedback(
          'Controlla il numero di telefono: prefisso e formato devono essere validi.',
          'error',
        'Telefono non valido',
        'editor'
      );
      return;
    }

    this.isSaving = true;
    this.clearFeedback();
    this.refreshView();

    this.utentiService.updateCliente(this.selectedCliente.idUtente, {
      nome: this.draftCliente.nome,
      cognome: this.draftCliente.cognome,
      email: this.draftCliente.email,
      telefono: this.draftCliente.telefono ?? '',
      data_nascita: this.draftCliente.data_nascita ?? '',
      sesso: this.draftCliente.sesso || undefined
    }).subscribe({
      next: (clienteAggiornato: Utente) => {
        this.clienti = this.clienti.map((cliente) =>
          cliente.idUtente === clienteAggiornato.idUtente ? clienteAggiornato : cliente
        );
        this.selectCliente(clienteAggiornato);
        this.showFeedback('Cliente modificato con successo.', 'success', 'Modifica completata', 'editor');
        this.isSaving = false;
        this.refreshView();
      },
      error: (err: any) => {
        console.error('Errore aggiornamento cliente:', err);
        this.showFeedback(
          err?.error?.message || 'Aggiornamento cliente non riuscito.',
          'error',
          'Modifica non riuscita',
          'editor'
        );
        this.isSaving = false;
        this.refreshView();
      }
    });
  }

  saveNewCliente(): void {
    if (this.isCreating || !this.isNewClienteValid) {
      return;
    }

    this.isCreating = true;
    this.clearFeedback();
    this.refreshView();

    this.utentiService.createCliente({
      nome: this.newCliente.nome.trim(),
      cognome: this.newCliente.cognome.trim(),
      email: this.newCliente.email.trim().toLowerCase(),
      telefono: this.newCliente.telefono.trim(),
      data_nascita: this.newCliente.data_nascita,
      sesso: this.newCliente.sesso as 'm' | 'f',
      ruolo: 'cliente'
    }).subscribe({
      next: (clienteCreato: Utente) => {
        this.clienti = [...this.clienti, clienteCreato].sort((a, b) => {
          const cognomeCompare = a.cognome.localeCompare(b.cognome, 'it', { sensitivity: 'base' });
          return cognomeCompare !== 0
            ? cognomeCompare
            : a.nome.localeCompare(b.nome, 'it', { sensitivity: 'base' });
        });
        this.isCreating = false;
        this.isCreateClosing = true;
        this.selectedCliente = null;
        this.draftCliente = null;
        this.showFeedback(
          'Cliente inserito con successo. Abbiamo inviato la mail per impostare la password.',
          'success',
          'Cliente creato',
          'create'
        );
        this.refreshView();

        this.createCloseTimeout = setTimeout(() => {
          this.isCreateMode = false;
          this.isCreateClosing = false;
          this.newCliente = this.createEmptyClienteDraft();
          this.isNewPhoneValid = false;
          this.closeCreateBirthDatePicker(true);
          this.createCloseTimeout = null;
          this.refreshView();
        }, this.panelCloseAnimationMs);
      },
      error: (err: any) => {
        console.error('Errore inserimento cliente:', err);
        this.showFeedback(
          err?.error?.message || 'Inserimento cliente non riuscito.',
          'error',
          'Inserimento non riuscito',
          'create'
        );
        this.isCreating = false;
        this.refreshView();
      }
    });
  }

  private deleteCliente(cliente: Utente): void {
    if (this.isDeleting) {
      return;
    }

    this.isDeleting = true;
    this.clearFeedback();
    this.refreshView();

    this.utentiService.deleteCliente(cliente.idUtente).subscribe({
      next: () => {
        this.clienti = this.clienti.filter((item) => item.idUtente !== cliente.idUtente);
        this.pendingDeleteCliente = null;
        if (this.selectedCliente?.idUtente === cliente.idUtente) {
          this.clearSelection();
        }
        this.showFeedback('Cliente eliminato correttamente.', 'success', 'Cliente eliminato', 'table');
        this.isDeleting = false;
        this.refreshView();
      },
      error: (err: any) => {
        console.error('Errore eliminazione cliente:', err);
        this.showFeedback(
          err?.error?.message || 'Eliminazione cliente non riuscita.',
          'error',
          'Eliminazione non riuscita',
          'table'
        );
        this.isDeleting = false;
        this.refreshView();
      }
    });
  }

  getInitials(cliente: Pick<Utente, 'nome' | 'cognome'>): string {
    const initials = `${cliente.nome?.[0] ?? ''}${cliente.cognome?.[0] ?? ''}`.trim();
    return initials ? initials.toUpperCase() : 'CL';
  }

  private toDateInputValue(value?: string | null): string {
    if (!value) {
      return '';
    }

    return value.includes('T') ? value.split('T')[0] : value;
  }

  private refreshView(): void {
    this.cdr.detectChanges();
  }

  private clearPanelCloseTimers(): void {
    if (this.createCloseTimeout) {
      clearTimeout(this.createCloseTimeout);
      this.createCloseTimeout = null;
    }

    if (this.editCloseTimeout) {
      clearTimeout(this.editCloseTimeout);
      this.editCloseTimeout = null;
    }
  }

  private clearCreateBirthDatePickerTimer(): void {
    if (this.createBirthDatePickerCloseTimeout) {
      clearTimeout(this.createBirthDatePickerCloseTimeout);
      this.createBirthDatePickerCloseTimeout = null;
    }
  }

  private showFeedback(
    message: string,
    type: 'success' | 'error',
    title: string,
    placement: 'table' | 'create' | 'editor' = 'editor'
  ): void {
    if (this.feedbackTimeout) {
      clearTimeout(this.feedbackTimeout);
      this.feedbackTimeout = null;
    }

    this.feedbackMessage = message;
    this.feedbackType = type;
    this.feedbackTitle = title;
    this.feedbackPlacement = placement;

    if (type === 'success') {
      this.feedbackTimeout = setTimeout(() => {
        this.clearFeedback();
        this.refreshView();
      }, 2600);
    }
  }

  clearFeedback(): void {
    if (this.feedbackTimeout) {
      clearTimeout(this.feedbackTimeout);
      this.feedbackTimeout = null;
    }

    this.feedbackMessage = '';
    this.feedbackType = '';
    this.feedbackTitle = '';
    this.feedbackPlacement = 'editor';
  }

  get createBirthDateDisplayValue(): string {
    const date = this.parseInputDate(this.newCliente.data_nascita);

    if (!date) {
      return 'gg/mm/aaaa';
    }

    return new Intl.DateTimeFormat('it-IT', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    }).format(date);
  }

  get createBirthDatePickerMonthLabel(): string {
    const label = this.calendarPickerMonthFormatter.format(this.createBirthDatePickerMonth);
    const month = label.charAt(0).toUpperCase() + label.slice(1);
    return `${month} ${this.createBirthDatePickerYear}`;
  }

  get createBirthDatePickerYear(): number {
    return this.createBirthDatePickerMonth.getFullYear();
  }

  toggleCreateBirthDatePicker(): void {
    if (this.createBirthDatePickerOpen) {
      this.closeCreateBirthDatePicker();
      return;
    }

    this.clearCreateBirthDatePickerTimer();
    this.createBirthDatePickerClosing = false;
    this.createBirthDatePickerOpen = true;
    this.createBirthDatePickerMode = 'days';
    this.syncCreateBirthDatePickerMonth(this.parseInputDate(this.newCliente.data_nascita) ?? new Date());
  }

  closeCreateBirthDatePicker(immediate = false): void {
    if (!this.createBirthDatePickerOpen && !this.createBirthDatePickerClosing) {
      return;
    }

    this.clearCreateBirthDatePickerTimer();

    if (immediate) {
      this.createBirthDatePickerOpen = false;
      this.createBirthDatePickerClosing = false;
      this.createBirthDatePickerMode = 'days';
      return;
    }

    this.createBirthDatePickerClosing = true;
    this.createBirthDatePickerCloseTimeout = setTimeout(() => {
      this.createBirthDatePickerOpen = false;
      this.createBirthDatePickerClosing = false;
      this.createBirthDatePickerMode = 'days';
      this.createBirthDatePickerCloseTimeout = null;
      this.refreshView();
    }, 180);
  }

  toggleCreateBirthDatePickerYears(): void {
    this.createBirthDatePickerMode = this.createBirthDatePickerMode === 'years' ? 'days' : 'years';
  }

  previousCreateBirthDatePickerMonth(): void {
    const next = new Date(this.createBirthDatePickerMonth);
    next.setMonth(next.getMonth() - 1, 1);
    this.syncCreateBirthDatePickerMonth(next);
  }

  nextCreateBirthDatePickerMonth(): void {
    const next = new Date(this.createBirthDatePickerMonth);
    next.setMonth(next.getMonth() + 1, 1);
    this.syncCreateBirthDatePickerMonth(next);
  }

  selectCreateBirthDatePickerYear(year: number | string): void {
    const parsedYear = Number(year);

    if (!Number.isFinite(parsedYear)) {
      return;
    }

    const next = new Date(this.createBirthDatePickerMonth);
    next.setFullYear(parsedYear, next.getMonth(), 1);
    this.syncCreateBirthDatePickerMonth(next);
    this.createBirthDatePickerMode = 'days';
  }

  selectCreateBirthDatePickerDay(day: CalendarPickerDay): void {
    this.newCliente.data_nascita = this.formatDateForInput(day.date);
    this.syncCreateBirthDatePickerMonth(day.date);
    this.closeCreateBirthDatePicker();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;

    if (!target?.closest('.customers-birthdate-picker')) {
      this.closeCreateBirthDatePicker();
    }
  }

  getClientePhotoUrl(cliente: Partial<Utente> | ClienteFormDraft): string | null {
    const key = 'idUtente' in cliente && cliente.idUtente
      ? cliente.idUtente
      : `${cliente.email || cliente.nome || 'new'}`;

    if (this.brokenProfilePhotos.has(key)) {
      return null;
    }

    const rawUrl = String(
      ('photoURL' in cliente && cliente.photoURL) ||
      ('picture' in cliente && cliente.picture) ||
      ('avatar_url' in cliente && cliente.avatar_url) ||
      ('avatar' in cliente && cliente.avatar) ||
      ''
    ).trim();

    if (!rawUrl) {
      return null;
    }

    const normalizedUrl = rawUrl.startsWith('//') ? `https:${rawUrl}` : rawUrl;

    if (normalizedUrl.includes('googleusercontent.com')) {
      return normalizedUrl.replace(/=s\d+-c$/, '=s256-c');
    }

    return normalizedUrl;
  }

  onClientePhotoError(cliente: Partial<Utente> | ClienteFormDraft): void {
    const key = 'idUtente' in cliente && cliente.idUtente
      ? cliente.idUtente
      : `${cliente.email || cliente.nome || 'new'}`;

    this.brokenProfilePhotos.add(key);
    this.refreshView();
  }

  private createEmptyClienteDraft(): ClienteFormDraft {
    return {
      nome: '',
      cognome: '',
      email: '',
      telefono: '',
      data_nascita: '',
      sesso: '',
      ruolo: 'cliente'
    };
  }

  private buildBirthDatePickerYears(): number[] {
    const currentYear = new Date().getFullYear();
    const years: number[] = [];

    for (let year = currentYear; year >= 1900; year--) {
      years.push(year);
    }

    return years;
  }

  private syncCreateBirthDatePickerMonth(baseDate: Date): void {
    this.createBirthDatePickerMonth = new Date(baseDate.getFullYear(), baseDate.getMonth(), 1);
    this.createBirthDatePickerDays = this.buildCalendarPickerDays(this.createBirthDatePickerMonth);
  }

  private buildCalendarPickerDays(monthDate: Date): CalendarPickerDay[] {
    const firstDayOfMonth = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
    const start = new Date(firstDayOfMonth);
    const firstWeekday = (firstDayOfMonth.getDay() + 6) % 7;
    start.setDate(start.getDate() - firstWeekday);

    const selectedValue = this.newCliente.data_nascita;
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

  private scrollToEditor(): void {
    setTimeout(() => {
      const editor = document.getElementById('modifica-cliente');
      const scrollContainer = document.querySelector('.management-layout__content') as HTMLElement | null;

      if (!editor || !scrollContainer) {
        editor?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }

      scrollContainer.scrollTo({
        top: scrollContainer.scrollHeight,
        behavior: 'smooth'
      });
    });
  }

  private isAdult(value: string): boolean {
    if (!value) {
      return false;
    }

    const birth = new Date(`${value}T00:00:00`);

    if (Number.isNaN(birth.getTime())) {
      return false;
    }

    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();

    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
      age--;
    }

    return age >= 18;
  }

  formatDate(value?: string | null): string {
    if (!value) {
      return '-';
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return new Intl.DateTimeFormat('it-IT').format(date);
  }
}

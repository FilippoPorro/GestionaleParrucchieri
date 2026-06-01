import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IntlTelInputComponent } from 'intl-tel-input/angularWithUtils';
import { timeout } from 'rxjs/operators';
import { SidenavComponent } from '../sidenav.component/sidenav.component';
import { Fornitore } from '../../models/fornitore.model';
import { FornitoriService } from '../../services/fornitori';

interface FornitoreFormDraft {
  nome: string;
  telefono: string;
  email: string;
  partitaIva: string;
}

interface FornitoriEditorState {
  mode: 'create' | 'edit';
  selectedId?: number;
  newFornitore?: FornitoreFormDraft;
  draftFornitore?: Fornitore;
}

@Component({
  selector: 'app-fornitori',
  standalone: true,
  imports: [CommonModule, FormsModule, SidenavComponent, IntlTelInputComponent],
  templateUrl: './fornitori.component.html',
  styleUrl: './fornitori.component.css',
})
export class FornitoriComponent implements OnInit, OnDestroy {
  private readonly editorStateStorageKey = 'gestionale.fornitori.editorState';
  private feedbackTimeout: ReturnType<typeof setTimeout> | null = null;
  private createCloseTimeout: ReturnType<typeof setTimeout> | null = null;
  private editCloseTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly panelCloseAnimationMs = 240;

  isSidenavCollapsed = typeof window !== 'undefined' && window.matchMedia('(max-width: 980px)').matches;
  fornitori: Fornitore[] = [];
  selectedFornitore: Fornitore | null = null;
  draftFornitore: Fornitore | null = null;
  newFornitore: FornitoreFormDraft = this.createEmptyFornitoreDraft();
  pendingDeleteFornitore: Fornitore | null = null;
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
  isNewPhoneValid = true;
  isEditPhoneValid = true;

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
    private fornitoriService: FornitoriService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.loadFornitori();
  }

  ngOnDestroy(): void {
    this.clearPanelCloseTimers();

    if (this.feedbackTimeout) {
      clearTimeout(this.feedbackTimeout);
      this.feedbackTimeout = null;
    }
  }

  get filteredFornitori(): Fornitore[] {
    const term = this.searchTerm.trim().toLowerCase();

    if (!term) {
      return this.fornitori;
    }

    return this.fornitori.filter((fornitore) =>
      [
        fornitore.nome,
        fornitore.email,
        fornitore.telefono,
        fornitore.partitaIva,
        String(fornitore.idFornitore)
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term))
    );
  }

  get fornitoriConTelefono(): number {
    return this.fornitori.filter((fornitore) => !!fornitore.telefono).length;
  }

  get fornitoriSenzaTelefono(): number {
    return this.fornitori.length - this.fornitoriConTelefono;
  }

  get fornitoriConPartitaIva(): number {
    return this.fornitori.filter((fornitore) => !!fornitore.partitaIva).length;
  }

  get hasDraftChanges(): boolean {
    if (!this.selectedFornitore || !this.draftFornitore) {
      return false;
    }

    return this.selectedFornitore.nome !== this.draftFornitore.nome ||
      (this.selectedFornitore.email ?? '') !== (this.draftFornitore.email ?? '') ||
      (this.selectedFornitore.telefono ?? '') !== (this.draftFornitore.telefono ?? '') ||
      (this.selectedFornitore.partitaIva ?? '') !== (this.draftFornitore.partitaIva ?? '');
  }

  get isNewFornitoreValid(): boolean {
    return this.newFornitore.nome.trim() !== '' &&
      (!this.newFornitore.telefono.trim() || this.isNewPhoneValid);
  }

  toggleSidenav(): void {
    this.isSidenavCollapsed = !this.isSidenavCollapsed;
  }

  loadFornitori(): void {
    this.isLoading = true;
    this.clearFeedback();
    this.refreshView();

    this.fornitoriService.getFornitori().pipe(timeout(8000)).subscribe({
      next: (fornitori) => {
        this.fornitori = fornitori;
        this.pendingDeleteFornitore = null;

        if (!this.restorePersistedEditorState() && this.selectedFornitore) {
          const updatedSelection = fornitori.find(
            (fornitore) => fornitore.idFornitore === this.selectedFornitore?.idFornitore
          ) ?? null;

          if (updatedSelection) {
            this.selectFornitore(updatedSelection);
          } else {
            this.selectedFornitore = null;
            this.draftFornitore = null;
            this.clearPersistedEditorState();
          }
        }

        this.isLoading = false;
        this.refreshView();
      },
      error: (err) => {
        this.showFeedback(
          'Impossibile caricare i fornitori. Controlla che il backend sia avviato e collegato a Supabase.',
          'error',
          'Caricamento non riuscito',
          'table'
        );
        this.isLoading = false;
        this.refreshView();
      }
    });
  }

  selectFornitore(fornitore: Fornitore, scrollToEditor = false): void {
    this.clearPanelCloseTimers();
    this.isCreateClosing = false;
    this.isEditClosing = false;
    this.isCreateMode = false;
    this.selectedFornitore = fornitore;
    this.draftFornitore = {
      ...fornitore,
      telefono: fornitore.telefono ?? '',
      email: fornitore.email ?? '',
      partitaIva: fornitore.partitaIva ?? ''
    };
    this.isEditPhoneValid = true;
    this.clearFeedback();
    this.persistEditorState();

    if (scrollToEditor) {
      this.scrollToEditor();
    }
  }

  clearSelection(): void {
    if (this.isEditClosing) {
      return;
    }

    if (this.selectedFornitore || this.draftFornitore) {
      this.isEditClosing = true;
      this.clearFeedback();
      this.clearPersistedEditorState();
      this.refreshView();

      this.editCloseTimeout = setTimeout(() => {
        this.selectedFornitore = null;
        this.draftFornitore = null;
        this.isCreateMode = false;
        this.isEditClosing = false;
        this.editCloseTimeout = null;
        this.clearPersistedEditorState();
        this.refreshView();
      }, this.panelCloseAnimationMs);

      return;
    }

    this.selectedFornitore = null;
    this.draftFornitore = null;
    this.isCreateMode = false;
    this.clearFeedback();
    this.clearPersistedEditorState();
  }

  startCreateFornitore(): void {
    this.clearPanelCloseTimers();
    this.isCreateClosing = false;
    this.isEditClosing = false;
    this.isCreateMode = true;
    this.selectedFornitore = null;
    this.draftFornitore = null;
    this.newFornitore = this.createEmptyFornitoreDraft();
    this.isNewPhoneValid = true;
    this.clearFeedback();
    this.persistEditorState();
    this.scrollToEditor();
  }

  cancelCreateFornitore(): void {
    if (this.isCreating || this.isCreateClosing) {
      return;
    }

    this.isCreateClosing = true;
    this.clearFeedback();
    this.clearPersistedEditorState();
    this.refreshView();

    this.createCloseTimeout = setTimeout(() => {
      this.isCreateMode = false;
      this.isCreateClosing = false;
      this.newFornitore = this.createEmptyFornitoreDraft();
      this.isNewPhoneValid = true;
      this.createCloseTimeout = null;
      this.clearPersistedEditorState();
      this.refreshView();
    }, this.panelCloseAnimationMs);
  }

  onNewPhoneNumberChange(phoneNumber: string): void {
    this.newFornitore.telefono = phoneNumber || '';
    this.persistEditorState();
  }

  onNewPhoneValidityChange(isValid: boolean): void {
    this.isNewPhoneValid = isValid;
    this.refreshView();
  }

  onEditPhoneNumberChange(phoneNumber: string): void {
    if (!this.draftFornitore) {
      return;
    }

    this.draftFornitore.telefono = phoneNumber || '';
    this.persistEditorState();
  }

  persistEditorState(): void {
    if (typeof sessionStorage === 'undefined') {
      return;
    }

    const state: FornitoriEditorState | null = this.isCreateMode
      ? { mode: 'create', newFornitore: this.newFornitore }
      : this.selectedFornitore && this.draftFornitore
        ? {
            mode: 'edit',
            selectedId: this.selectedFornitore.idFornitore,
            draftFornitore: this.draftFornitore
          }
        : null;

    try {
      if (state) {
        sessionStorage.setItem(this.editorStateStorageKey, JSON.stringify(state));
      } else {
        sessionStorage.removeItem(this.editorStateStorageKey);
      }
    } catch {
      // Storage can fail in private browsing; the editor still works normally.
    }
  }

  onEditPhoneValidityChange(isValid: boolean): void {
    this.isEditPhoneValid = isValid;
    this.refreshView();
  }

  requestDeleteFornitore(fornitore: Fornitore): void {
    if (this.isDeleting) {
      return;
    }

    this.pendingDeleteFornitore = fornitore;
    this.clearFeedback();
  }

  cancelDeleteFornitore(): void {
    if (!this.isDeleting) {
      this.pendingDeleteFornitore = null;
    }
  }

  confirmDeleteFornitore(): void {
    if (!this.pendingDeleteFornitore) {
      return;
    }

    this.deleteFornitore(this.pendingDeleteFornitore);
  }

  saveFornitore(): void {
    if (!this.selectedFornitore || !this.draftFornitore || this.isSaving) {
      return;
    }

    if ((this.draftFornitore.telefono ?? '').trim() && !this.isEditPhoneValid) {
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

    this.fornitoriService.updateFornitore(this.selectedFornitore.idFornitore, {
      nome: this.draftFornitore.nome.trim(),
      email: (this.draftFornitore.email ?? '').trim(),
      telefono: (this.draftFornitore.telefono ?? '').trim(),
      partitaIva: (this.draftFornitore.partitaIva ?? '').trim()
    }).subscribe({
      next: (fornitoreAggiornato) => {
        this.fornitori = this.fornitori.map((fornitore) =>
          fornitore.idFornitore === fornitoreAggiornato.idFornitore ? fornitoreAggiornato : fornitore
        ).sort((a, b) => a.nome.localeCompare(b.nome, 'it', { sensitivity: 'base' }));
        this.selectFornitore(fornitoreAggiornato);
        this.showFeedback('Fornitore modificato con successo.', 'success', 'Modifica completata', 'editor');
        this.isSaving = false;
        this.refreshView();
      },
      error: (err) => {
        this.showFeedback(
          err?.error?.message || 'Aggiornamento fornitore non riuscito.',
          'error',
          'Modifica non riuscita',
          'editor'
        );
        this.isSaving = false;
        this.refreshView();
      }
    });
  }

  saveNewFornitore(): void {
    if (this.isCreating || !this.isNewFornitoreValid) {
      return;
    }

    this.isCreating = true;
    this.clearFeedback();
    this.refreshView();

    this.fornitoriService.createFornitore({
      nome: this.newFornitore.nome.trim(),
      email: this.newFornitore.email.trim(),
      telefono: this.newFornitore.telefono.trim(),
      partitaIva: this.newFornitore.partitaIva.trim()
    }).subscribe({
      next: (fornitoreCreato) => {
        this.fornitori = [...this.fornitori, fornitoreCreato]
          .sort((a, b) => a.nome.localeCompare(b.nome, 'it', { sensitivity: 'base' }));
        this.isCreating = false;
        this.isCreateClosing = true;
        this.selectedFornitore = null;
        this.draftFornitore = null;
        this.clearPersistedEditorState();
        this.showFeedback('Fornitore inserito con successo.', 'success', 'Fornitore creato', 'create');
        this.refreshView();

        this.createCloseTimeout = setTimeout(() => {
          this.isCreateMode = false;
          this.isCreateClosing = false;
          this.newFornitore = this.createEmptyFornitoreDraft();
          this.isNewPhoneValid = true;
          this.createCloseTimeout = null;
          this.refreshView();
        }, this.panelCloseAnimationMs);
      },
      error: (err) => {
        this.showFeedback(
          err?.error?.message || 'Inserimento fornitore non riuscito.',
          'error',
          'Inserimento non riuscito',
          'create'
        );
        this.isCreating = false;
        this.refreshView();
      }
    });
  }

  getInitials(fornitore: Pick<Fornitore, 'nome'> | FornitoreFormDraft): string {
    const words = (fornitore.nome || '').trim().split(/\s+/).filter(Boolean);
    const initials = words.slice(0, 2).map((word) => word[0]).join('');
    return initials ? initials.toUpperCase() : 'FO';
  }

  private deleteFornitore(fornitore: Fornitore): void {
    if (this.isDeleting) {
      return;
    }

    this.isDeleting = true;
    this.clearFeedback();
    this.refreshView();

    this.fornitoriService.deleteFornitore(fornitore.idFornitore).subscribe({
      next: () => {
        this.fornitori = this.fornitori.filter((item) => item.idFornitore !== fornitore.idFornitore);
        this.pendingDeleteFornitore = null;
        if (this.selectedFornitore?.idFornitore === fornitore.idFornitore) {
          this.clearSelection();
        }
        this.showFeedback('Fornitore eliminato correttamente.', 'success', 'Fornitore eliminato', 'table');
        this.isDeleting = false;
        this.refreshView();
      },
      error: (err) => {
        this.showFeedback(
          err?.error?.message || 'Eliminazione fornitore non riuscita.',
          'error',
          'Eliminazione non riuscita',
          'table'
        );
        this.isDeleting = false;
        this.refreshView();
      }
    });
  }

  private restorePersistedEditorState(): boolean {
    if (typeof sessionStorage === 'undefined') {
      return false;
    }

    try {
      const rawState = sessionStorage.getItem(this.editorStateStorageKey);

      if (!rawState) {
        return false;
      }

      const state = JSON.parse(rawState) as FornitoriEditorState;

      if (state.mode === 'create' && state.newFornitore) {
        this.clearPanelCloseTimers();
        this.isCreateMode = true;
        this.isCreateClosing = false;
        this.isEditClosing = false;
        this.selectedFornitore = null;
        this.draftFornitore = null;
        this.newFornitore = {
          ...this.createEmptyFornitoreDraft(),
          ...state.newFornitore
        };
        this.isNewPhoneValid = true;
        return true;
      }

      if (state.mode === 'edit' && state.selectedId && state.draftFornitore) {
        const selectedFornitore = this.fornitori.find((fornitore) => fornitore.idFornitore === state.selectedId);

        if (!selectedFornitore) {
          this.clearPersistedEditorState();
          return false;
        }

        this.clearPanelCloseTimers();
        this.isCreateMode = false;
        this.isCreateClosing = false;
        this.isEditClosing = false;
        this.selectedFornitore = selectedFornitore;
        this.draftFornitore = {
          ...selectedFornitore,
          ...state.draftFornitore,
          idFornitore: selectedFornitore.idFornitore
        };
        this.isEditPhoneValid = true;
        return true;
      }
    } catch {
      this.clearPersistedEditorState();
    }

    return false;
  }

  private clearPersistedEditorState(): void {
    if (typeof sessionStorage === 'undefined') {
      return;
    }

    try {
      sessionStorage.removeItem(this.editorStateStorageKey);
    } catch {
      // Ignore storage cleanup failures.
    }
  }

  private createEmptyFornitoreDraft(): FornitoreFormDraft {
    return {
      nome: '',
      telefono: '',
      email: '',
      partitaIva: ''
    };
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

  private refreshView(): void {
    this.cdr.detectChanges();
  }

  private scrollToEditor(): void {
    setTimeout(() => {
      const editor = document.getElementById('modifica-fornitore');
      const scrollContainer = document.querySelector('.management-layout__content') as HTMLElement | null;

      if (!editor || !scrollContainer) {
        editor?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }

      scrollContainer.scrollTo({
        top: scrollContainer.scrollHeight,
        behavior: 'smooth'
      });
    }, 80);
  }
}

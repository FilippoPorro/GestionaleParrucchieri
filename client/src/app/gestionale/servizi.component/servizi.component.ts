import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SidenavComponent } from '../sidenav.component/sidenav.component';
import { ServiziService } from '../../services/servizio';
import { Servizio } from '../../models/servizio.model';
import { timeout } from 'rxjs/operators';

interface ServizioFormDraft {
  nome: string;
  descrizione: string;
  durata: string;
  prezzo: number | null;
  categoria: string;
  sottocategoria: string;
  tipoPrenotazione: 'sito' | 'telefono' | 'consulenza';
  visualizzazioneSito: boolean;
}

@Component({
  selector: 'app-servizi.component',
  standalone: true,
  imports: [CommonModule, FormsModule, SidenavComponent],
  templateUrl: './servizi.component.html',
  styleUrl: './servizi.component.css',
})
export class ServiziComponent implements OnInit, OnDestroy {
  private feedbackTimeout: ReturnType<typeof setTimeout> | null = null;
  private createCloseTimeout: ReturnType<typeof setTimeout> | null = null;
  private editCloseTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly panelCloseAnimationMs = 240;
  
  isSidenavCollapsed = false;
  servizi: Servizio[] = [];
  selectedServizio: Servizio | null = null;
  draftServizio: Servizio | null = null;
  newServizio: ServizioFormDraft = this.createEmptyServizioDraft();
  pendingDeleteServizio: Servizio | null = null;
  searchTerm = '';
  currentPage = 1;
  readonly pageSize = 10;
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

  constructor(
    private serviziService: ServiziService,
    private cdr: ChangeDetectorRef
  ) {}

  getInitials(servizio: Pick<Servizio, 'nome'> | ServizioFormDraft): string {
    const initials = (servizio.nome || '').substring(0, 2).toUpperCase();
    return initials || 'SR';
  }

  get filteredServizi(): Servizio[] {
    const term = this.searchTerm.trim().toLowerCase();

    if (!term) {
      return this.servizi;
    }

    return this.servizi.filter((servizio) =>
      [
        servizio.nome,
        servizio.descrizione,
        servizio.categoria,
        servizio.sottocategoria,
        String(servizio.idServizio)
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term))
    );
  }

  get serviziSito(): number {
    return this.servizi.filter((s) => s.tipoPrenotazione === 'sito').length;
  }

  get serviziAltro(): number {
    return this.servizi.length - this.serviziSito;
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.filteredServizi.length / this.pageSize));
  }

  get paginatedServizi(): Servizio[] {
    const start = (this.currentPage - 1) * this.pageSize;
    return this.filteredServizi.slice(start, start + this.pageSize);
  }

  get pageStart(): number {
    if (!this.filteredServizi.length) {
      return 0;
    }

    return (this.currentPage - 1) * this.pageSize + 1;
  }

  get pageEnd(): number {
    return Math.min(this.currentPage * this.pageSize, this.filteredServizi.length);
  }

  get hasDraftChanges(): boolean {
    if (!this.selectedServizio || !this.draftServizio) {
      return false;
    }

    return this.selectedServizio.nome !== this.draftServizio.nome ||
      this.selectedServizio.descrizione !== this.draftServizio.descrizione ||
      (this.selectedServizio.durata ?? '') !== (this.draftServizio.durata ?? '') ||
      this.selectedServizio.prezzo !== this.draftServizio.prezzo ||
      this.selectedServizio.categoria !== this.draftServizio.categoria ||
      this.selectedServizio.sottocategoria !== this.draftServizio.sottocategoria ||
      this.selectedServizio.tipoPrenotazione !== this.draftServizio.tipoPrenotazione ||
      this.selectedServizio.visualizzazioneSito !== this.draftServizio.visualizzazioneSito;
  }

  get isNewServizioValid(): boolean {
    return this.newServizio.nome.trim() !== '' &&
      this.newServizio.prezzo !== null &&
      this.newServizio.prezzo >= 0;
  }

  ngOnInit(): void {
    this.loadServizi();
  }

  ngOnDestroy(): void {
    this.clearPanelCloseTimers();
    if (this.feedbackTimeout) {
      clearTimeout(this.feedbackTimeout);
      this.feedbackTimeout = null;
    }
  }

  toggleSidenav(): void {
    this.isSidenavCollapsed = !this.isSidenavCollapsed;
  }

  onSearchTermChange(term: string): void {
    this.searchTerm = term;
    this.currentPage = 1;
  }

  previousPage(): void {
    if (this.currentPage > 1) {
      this.currentPage -= 1;
    }
  }

  nextPage(): void {
    if (this.currentPage < this.totalPages) {
      this.currentPage += 1;
    }
  }

  loadServizi(): void {
    this.isLoading = true;
    this.clearFeedback();
    this.refreshView();

    this.serviziService.getServizi(true).pipe(timeout(8000)).subscribe({
      next: (servizi: Servizio[]) => {
        this.servizi = this.sortServizi(servizi);
        this.currentPage = 1;
        this.pendingDeleteServizio = null;
        if (this.selectedServizio) {
          const updatedSelection = this.servizi.find((s) => s.idServizio === this.selectedServizio?.idServizio) ?? null;
          if (updatedSelection) {
            this.selectServizio(updatedSelection);
          } else {
            this.selectedServizio = null;
            this.draftServizio = null;
          }
        }
        this.isLoading = false;
        this.refreshView();
      },
      error: (err: any) => {
        this.showFeedback(
          'Impossibile caricare i servizi. Controlla il backend.',
          'error',
          'Caricamento non riuscito',
          'table'
        );
        this.isLoading = false;
        this.refreshView();
      }
    });
  }

  selectServizio(servizio: Servizio, scrollToEditor = false): void {
    this.clearPanelCloseTimers();
    this.isCreateClosing = false;
    this.isEditClosing = false;
    this.isCreateMode = false;
    this.selectedServizio = servizio;
    this.draftServizio = {
      ...servizio,
      descrizione: servizio.descrizione ?? '',
      durata: servizio.durata !== null ? String(servizio.durata) : '',
      categoria: servizio.categoria ?? '',
      sottocategoria: servizio.sottocategoria ?? '',
      tipoPrenotazione: servizio.tipoPrenotazione || 'sito',
      visualizzazioneSito: servizio.visualizzazioneSito !== undefined ? servizio.visualizzazioneSito : true
    };
    this.clearFeedback();

    if (scrollToEditor) {
      this.scrollToEditor();
    }
  }

  clearSelection(): void {
    if (this.isEditClosing) {
      return;
    }

    if (this.selectedServizio || this.draftServizio) {
      this.isEditClosing = true;
      this.clearFeedback();
      this.refreshView();

      this.editCloseTimeout = setTimeout(() => {
        this.selectedServizio = null;
        this.draftServizio = null;
        this.isCreateMode = false;
        this.isEditClosing = false;
        this.editCloseTimeout = null;
        this.refreshView();
      }, this.panelCloseAnimationMs);

      return;
    }

    this.selectedServizio = null;
    this.draftServizio = null;
    this.isCreateMode = false;
    this.clearFeedback();
  }

  startCreateServizio(): void {
    this.clearPanelCloseTimers();
    this.isCreateClosing = false;
    this.isEditClosing = false;
    this.isCreateMode = true;
    this.selectedServizio = null;
    this.draftServizio = null;
    this.newServizio = this.createEmptyServizioDraft();
    this.clearFeedback();
    this.scrollToEditor();
  }

  cancelCreateServizio(): void {
    if (this.isCreating || this.isCreateClosing) {
      return;
    }

    this.isCreateClosing = true;
    this.clearFeedback();
    this.refreshView();

    this.createCloseTimeout = setTimeout(() => {
      this.isCreateMode = false;
      this.isCreateClosing = false;
      this.newServizio = this.createEmptyServizioDraft();
      this.createCloseTimeout = null;
      this.refreshView();
    }, this.panelCloseAnimationMs);
  }

  requestDeleteServizio(servizio: Servizio): void {
    if (this.isDeleting) {
      return;
    }

    this.pendingDeleteServizio = servizio;
    this.clearFeedback();
  }

  cancelDeleteServizio(): void {
    if (!this.isDeleting) {
      this.pendingDeleteServizio = null;
    }
  }

  confirmDeleteServizio(): void {
    if (!this.pendingDeleteServizio) {
      return;
    }

    this.deleteServizio(this.pendingDeleteServizio);
  }

  saveServizio(): void {
    if (!this.selectedServizio || !this.draftServizio || this.isSaving) {
      return;
    }

    this.isSaving = true;
    this.clearFeedback();
    this.refreshView();

    this.serviziService.updateServizio(this.selectedServizio.idServizio, {
      nome: this.draftServizio.nome,
      descrizione: this.draftServizio.descrizione,
      durata: this.draftServizio.durata || null,
      prezzo: Number(this.draftServizio.prezzo),
      categoria: this.draftServizio.categoria,
      sottocategoria: this.draftServizio.sottocategoria,
      tipoPrenotazione: this.draftServizio.tipoPrenotazione,
      visualizzazioneSito: this.draftServizio.visualizzazioneSito
    }).subscribe({
      next: (servizioAggiornato: Servizio) => {
        this.servizi = this.servizi.map((s) =>
          s.idServizio === servizioAggiornato.idServizio ? servizioAggiornato : s
        );
        this.selectServizio(servizioAggiornato);
        this.showFeedback('Servizio modificato con successo.', 'success', 'Modifica completata', 'editor');
        this.isSaving = false;
        this.refreshView();
      },
      error: (err: any) => {
        this.showFeedback(
          err?.error?.message || 'Aggiornamento servizio non riuscito.',
          'error',
          'Modifica non riuscita',
          'editor'
        );
        this.isSaving = false;
        this.refreshView();
      }
    });
  }

  saveNewServizio(): void {
    if (this.isCreating || !this.isNewServizioValid) {
      return;
    }

    this.isCreating = true;
    this.clearFeedback();
    this.refreshView();

    this.serviziService.createServizio({
      nome: this.newServizio.nome.trim(),
      descrizione: this.newServizio.descrizione.trim(),
      durata: this.newServizio.durata || null,
      prezzo: Number(this.newServizio.prezzo),
      categoria: this.newServizio.categoria.trim(),
      sottocategoria: this.newServizio.sottocategoria.trim(),
      tipoPrenotazione: this.newServizio.tipoPrenotazione,
      visualizzazioneSito: this.newServizio.visualizzazioneSito
    }).subscribe({
      next: (servizioCreato: Servizio) => {
        this.servizi = this.sortServizi([...this.servizi, servizioCreato]);
        this.currentPage = 1;
        this.isCreating = false;
        this.isCreateClosing = true;
        this.selectedServizio = null;
        this.draftServizio = null;
        this.showFeedback(
          'Servizio inserito con successo.',
          'success',
          'Servizio creato',
          'create'
        );
        this.refreshView();

        this.createCloseTimeout = setTimeout(() => {
          this.isCreateMode = false;
          this.isCreateClosing = false;
          this.newServizio = this.createEmptyServizioDraft();
          this.createCloseTimeout = null;
          this.refreshView();
        }, this.panelCloseAnimationMs);
      },
      error: (err: any) => {
        this.showFeedback(
          err?.error?.message || 'Inserimento servizio non riuscito.',
          'error',
          'Inserimento non riuscito',
          'create'
        );
        this.isCreating = false;
        this.refreshView();
      }
    });
  }

  private deleteServizio(servizio: Servizio): void {
    if (this.isDeleting) {
      return;
    }

    this.isDeleting = true;
    this.clearFeedback();
    this.refreshView();

    this.serviziService.deleteServizio(servizio.idServizio).subscribe({
      next: () => {
        this.servizi = this.servizi.filter((s) => s.idServizio !== servizio.idServizio);
        if (this.currentPage > this.totalPages) {
          this.currentPage = this.totalPages;
        }
        this.pendingDeleteServizio = null;
        if (this.selectedServizio?.idServizio === servizio.idServizio) {
          this.clearSelection();
        }
        this.showFeedback('Servizio rimosso con successo.', 'success', 'Servizio eliminato', 'table');
        this.isDeleting = false;
        this.refreshView();
      },
      error: (err: any) => {
        this.showFeedback(
          err?.error?.message || 'Eliminazione servizio non riuscita.',
          'error',
          'Eliminazione non riuscita',
          'table'
        );
        this.isDeleting = false;
        this.refreshView();
      }
    });
  }

  private refreshView(): void {
    this.cdr.detectChanges();
  }

  private sortServizi(servizi: Servizio[]): Servizio[] {
    return [...servizi].sort((a, b) =>
      a.nome.localeCompare(b.nome, 'it', { sensitivity: 'base' })
    );
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

  private createEmptyServizioDraft(): ServizioFormDraft {
    return {
      nome: '',
      descrizione: '',
      durata: '30',
      prezzo: null,
      categoria: '',
      sottocategoria: '',
      tipoPrenotazione: 'sito',
      visualizzazioneSito: true
    };
  }

  private scrollToEditor(): void {
    setTimeout(() => {
      const editor = document.getElementById('modifica-servizio');
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
}

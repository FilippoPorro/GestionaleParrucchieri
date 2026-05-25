import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { timeout } from 'rxjs/operators';
import { SidenavComponent } from '../sidenav.component/sidenav.component';
import { Prodotto, ProdottoService } from '../../services/prodotto';

interface ProdottoFormDraft {
  foto: string;
  nome: string;
  marca: string;
  formato: string;
  descrizione: string;
  prezzoRivendita: number | null;
  prezzoAcquisto: number | null;
  qta: number | null;
  categoria: string;
}

@Component({
  selector: 'app-magazzino.component',
  standalone: true,
  imports: [CommonModule, FormsModule, SidenavComponent],
  templateUrl: './magazzino.component.html',
  styleUrl: './magazzino.component.css',
})
export class MagazzinoComponent implements OnInit, OnDestroy {
  private feedbackTimeout: ReturnType<typeof setTimeout> | null = null;
  private createCloseTimeout: ReturnType<typeof setTimeout> | null = null;
  private editCloseTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly panelCloseAnimationMs = 240;

  isSidenavCollapsed = false;
  prodotti: Prodotto[] = [];
  selectedProdotto: Prodotto | null = null;
  draftProdotto: Prodotto | null = null;
  newProdotto: ProdottoFormDraft = this.createEmptyProdottoDraft();
  pendingDeleteProdotto: Prodotto | null = null;
  searchTerm = '';
  selectedCategoriaFilter = '';
  selectedMarcaFilter = '';
  openFilterDropdown: 'categoria' | 'marca' | null = null;
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
    private prodottoService: ProdottoService,
    private route: ActivatedRoute,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.loadProdotti();
  }

  ngOnDestroy(): void {
    this.clearPanelCloseTimers();
    if (this.feedbackTimeout) {
      clearTimeout(this.feedbackTimeout);
      this.feedbackTimeout = null;
    }
  }

  getInitials(prodotto: Pick<Prodotto, 'nome'> | ProdottoFormDraft): string {
    const initials = (prodotto.nome || '').substring(0, 2).toUpperCase();
    return initials || 'PR';
  }

  get filteredProdotti(): Prodotto[] {
    const term = this.searchTerm.trim().toLowerCase();
    const categoria = this.selectedCategoriaFilter.trim().toLowerCase();
    const marca = this.selectedMarcaFilter.trim().toLowerCase();

    return this.prodotti.filter((prodotto) => {
      const matchesSearch = !term || [
        prodotto.nome,
        prodotto.descrizione,
        prodotto.categoria,
        prodotto.marca,
        prodotto.formato,
        String(prodotto.idProdotto)
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term));

      const matchesCategoria = !categoria || (prodotto.categoria || '').toLowerCase() === categoria;
      const matchesMarca = !marca || (prodotto.marca || '').toLowerCase() === marca;

      return matchesSearch && matchesCategoria && matchesMarca;
    });
  }

  get categorieDisponibili(): string[] {
    return this.getUniqueValues(this.prodotti.map((prodotto) => prodotto.categoria));
  }

  get marcheDisponibili(): string[] {
    return this.getUniqueValues(this.prodotti.map((prodotto) => prodotto.marca));
  }

  get categoriaFilterLabel(): string {
    return this.selectedCategoriaFilter || 'Tutte le categorie';
  }

  get marcaFilterLabel(): string {
    return this.selectedMarcaFilter || 'Tutte le marche';
  }

  get prodottiInEsaurimento(): number {
    return this.prodotti.filter((prodotto) => Number(prodotto.qta) < 5).length;
  }

  get prodottiDaRiordinare(): Prodotto[] {
    return this.prodotti
      .filter((prodotto) => Number(prodotto.qta) < 5)
      .sort((a, b) => Number(a.qta) - Number(b.qta));
  }

  get totaleValoreMagazzino(): number {
    return this.prodotti.reduce((sum, prodotto) => sum + (Number(prodotto.prezzoAcquisto) * Number(prodotto.qta)), 0);
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.filteredProdotti.length / this.pageSize));
  }

  get paginatedProdotti(): Prodotto[] {
    const start = (this.currentPage - 1) * this.pageSize;
    return this.filteredProdotti.slice(start, start + this.pageSize);
  }

  get pageStart(): number {
    if (!this.filteredProdotti.length) {
      return 0;
    }

    return (this.currentPage - 1) * this.pageSize + 1;
  }

  get pageEnd(): number {
    return Math.min(this.currentPage * this.pageSize, this.filteredProdotti.length);
  }

  get hasDraftChanges(): boolean {
    if (!this.selectedProdotto || !this.draftProdotto) {
      return false;
    }

    return this.selectedProdotto.foto !== this.draftProdotto.foto ||
      this.selectedProdotto.nome !== this.draftProdotto.nome ||
      this.selectedProdotto.marca !== this.draftProdotto.marca ||
      this.selectedProdotto.formato !== this.draftProdotto.formato ||
      this.selectedProdotto.descrizione !== this.draftProdotto.descrizione ||
      this.selectedProdotto.prezzoRivendita !== this.draftProdotto.prezzoRivendita ||
      this.selectedProdotto.prezzoAcquisto !== this.draftProdotto.prezzoAcquisto ||
      this.selectedProdotto.qta !== this.draftProdotto.qta ||
      this.selectedProdotto.categoria !== this.draftProdotto.categoria;
  }

  get isNewProdottoValid(): boolean {
    return this.newProdotto.nome.trim() !== '' &&
      this.newProdotto.prezzoRivendita !== null &&
      this.newProdotto.prezzoRivendita >= 0 &&
      this.newProdotto.prezzoAcquisto !== null &&
      this.newProdotto.prezzoAcquisto >= 0 &&
      this.newProdotto.qta !== null &&
      this.newProdotto.qta >= 0;
  }

  toggleSidenav(): void {
    this.isSidenavCollapsed = !this.isSidenavCollapsed;
  }

  @HostListener('document:click')
  closeFilterDropdowns(): void {
    this.openFilterDropdown = null;
  }

  toggleFilterDropdown(dropdown: 'categoria' | 'marca', event: MouseEvent): void {
    event.stopPropagation();
    this.openFilterDropdown = this.openFilterDropdown === dropdown ? null : dropdown;
  }

  selectCategoriaFilter(value: string, event: MouseEvent): void {
    event.stopPropagation();
    this.onCategoriaFilterChange(value);
    this.openFilterDropdown = null;
  }

  selectMarcaFilter(value: string, event: MouseEvent): void {
    event.stopPropagation();
    this.onMarcaFilterChange(value);
    this.openFilterDropdown = null;
  }

  onSearchTermChange(term: string): void {
    this.searchTerm = term;
    this.currentPage = 1;
  }

  onCategoriaFilterChange(value: string): void {
    this.selectedCategoriaFilter = value;
    this.currentPage = 1;
  }

  onMarcaFilterChange(value: string): void {
    this.selectedMarcaFilter = value;
    this.currentPage = 1;
  }

  resetFilters(): void {
    this.selectedCategoriaFilter = '';
    this.selectedMarcaFilter = '';
    this.openFilterDropdown = null;
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

  loadProdotti(): void {
    this.isLoading = true;
    this.clearFeedback();
    this.refreshView();

    this.prodottoService.getProdotti().pipe(timeout(8000)).subscribe({
      next: (prodotti: Prodotto[]) => {
        this.prodotti = this.sortProdotti(prodotti);
        this.currentPage = 1;
        this.pendingDeleteProdotto = null;
        const productIdFromRoute = this.getProductIdFromRoute();

        if (productIdFromRoute !== null) {
          const routeSelection = this.prodotti.find((p) => p.idProdotto === productIdFromRoute) ?? null;

          if (routeSelection) {
            this.openProductFromRoute(routeSelection);
          }
        } else if (this.selectedProdotto) {
          const updatedSelection = this.prodotti.find((p) => p.idProdotto === this.selectedProdotto?.idProdotto) ?? null;
          if (updatedSelection) {
            this.selectProdotto(updatedSelection);
          } else {
            this.selectedProdotto = null;
            this.draftProdotto = null;
          }
        }
        this.isLoading = false;
        this.refreshView();
      },
      error: (err: any) => {
        console.error('Errore caricamento prodotti:', err);
        this.showFeedback(
          'Impossibile caricare i prodotti. Controlla il backend.',
          'error',
          'Caricamento non riuscito',
          'table'
        );
        this.isLoading = false;
        this.refreshView();
      }
    });
  }

  selectProdotto(prodotto: Prodotto, scrollToEditor = false): void {
    this.clearPanelCloseTimers();
    this.isCreateClosing = false;
    this.isEditClosing = false;
    this.isCreateMode = false;
    this.selectedProdotto = prodotto;
    this.draftProdotto = { ...prodotto };
    this.clearFeedback();

    if (scrollToEditor) {
      this.scrollToEditor();
    }
  }

  clearSelection(): void {
    if (this.isEditClosing) {
      return;
    }

    if (this.selectedProdotto || this.draftProdotto) {
      this.isEditClosing = true;
      this.clearFeedback();
      this.refreshView();

      this.editCloseTimeout = setTimeout(() => {
        this.selectedProdotto = null;
        this.draftProdotto = null;
        this.isCreateMode = false;
        this.isEditClosing = false;
        this.editCloseTimeout = null;
        this.refreshView();
      }, this.panelCloseAnimationMs);

      return;
    }

    this.selectedProdotto = null;
    this.draftProdotto = null;
    this.isCreateMode = false;
    this.clearFeedback();
  }

  startCreateProdotto(): void {
    this.clearPanelCloseTimers();
    this.isCreateClosing = false;
    this.isEditClosing = false;
    this.isCreateMode = true;
    this.selectedProdotto = null;
    this.draftProdotto = null;
    this.newProdotto = this.createEmptyProdottoDraft();
    this.clearFeedback();
    this.scrollToEditor();
  }

  cancelCreateProdotto(): void {
    if (this.isCreating || this.isCreateClosing) {
      return;
    }

    this.isCreateClosing = true;
    this.clearFeedback();
    this.refreshView();

    this.createCloseTimeout = setTimeout(() => {
      this.isCreateMode = false;
      this.isCreateClosing = false;
      this.newProdotto = this.createEmptyProdottoDraft();
      this.createCloseTimeout = null;
      this.refreshView();
    }, this.panelCloseAnimationMs);
  }

  requestDeleteProdotto(prodotto: Prodotto): void {
    if (this.isDeleting) {
      return;
    }

    this.pendingDeleteProdotto = prodotto;
    this.clearFeedback();
  }

  cancelDeleteProdotto(): void {
    if (!this.isDeleting) {
      this.pendingDeleteProdotto = null;
    }
  }

  confirmDeleteProdotto(): void {
    if (!this.pendingDeleteProdotto) {
      return;
    }

    this.deleteProdotto(this.pendingDeleteProdotto);
  }

  saveProdotto(): void {
    if (!this.selectedProdotto || !this.draftProdotto || this.isSaving) {
      return;
    }

    this.isSaving = true;
    this.clearFeedback();
    this.refreshView();

    this.prodottoService.updateProdotto(this.selectedProdotto.idProdotto, {
      foto: this.draftProdotto.foto,
      nome: this.draftProdotto.nome,
      marca: this.draftProdotto.marca,
      formato: this.draftProdotto.formato,
      descrizione: this.draftProdotto.descrizione,
      prezzoRivendita: Number(this.draftProdotto.prezzoRivendita),
      prezzoAcquisto: Number(this.draftProdotto.prezzoAcquisto),
      qta: Number(this.draftProdotto.qta),
      categoria: this.draftProdotto.categoria
    }).subscribe({
      next: (prodottoAggiornato: Prodotto) => {
        this.prodotti = this.sortProdotti(
          this.prodotti.map((p) => p.idProdotto === prodottoAggiornato.idProdotto ? prodottoAggiornato : p)
        );
        this.selectProdotto(prodottoAggiornato);
        this.showFeedback('Prodotto modificato con successo.', 'success', 'Modifica completata', 'editor');
        this.isSaving = false;
        this.refreshView();
      },
      error: (err: any) => {
        console.error('Errore aggiornamento prodotto:', err);
        this.showFeedback(
          err?.error?.message || 'Aggiornamento prodotto non riuscito.',
          'error',
          'Modifica non riuscita',
          'editor'
        );
        this.isSaving = false;
        this.refreshView();
      }
    });
  }

  saveNewProdotto(): void {
    if (this.isCreating || !this.isNewProdottoValid) {
      return;
    }

    this.isCreating = true;
    this.clearFeedback();
    this.refreshView();

    this.prodottoService.createProdotto({
      foto: null,
      nome: this.newProdotto.nome.trim(),
      marca: this.newProdotto.marca.trim(),
      formato: this.newProdotto.formato.trim(),
      descrizione: this.newProdotto.descrizione.trim(),
      prezzoRivendita: Number(this.newProdotto.prezzoRivendita),
      prezzoAcquisto: Number(this.newProdotto.prezzoAcquisto),
      qta: Number(this.newProdotto.qta),
      categoria: this.newProdotto.categoria.trim()
    }).subscribe({
      next: (prodottoCreato: Prodotto) => {
        this.prodotti = this.sortProdotti([...this.prodotti, prodottoCreato]);
        this.currentPage = 1;
        this.isCreating = false;
        this.isCreateClosing = true;
        this.selectedProdotto = null;
        this.draftProdotto = null;
        this.showFeedback(
          'Prodotto inserito con successo.',
          'success',
          'Prodotto creato',
          'create'
        );
        this.refreshView();

        this.createCloseTimeout = setTimeout(() => {
          this.isCreateMode = false;
          this.isCreateClosing = false;
          this.newProdotto = this.createEmptyProdottoDraft();
          this.createCloseTimeout = null;
          this.refreshView();
        }, this.panelCloseAnimationMs);
      },
      error: (err: any) => {
        console.error('Errore inserimento prodotto:', err);
        this.showFeedback(
          err?.error?.message || 'Inserimento prodotto non riuscito.',
          'error',
          'Inserimento non riuscito',
          'create'
        );
        this.isCreating = false;
        this.refreshView();
      }
    });
  }

  private deleteProdotto(prodotto: Prodotto): void {
    if (this.isDeleting) {
      return;
    }

    this.isDeleting = true;
    this.clearFeedback();
    this.refreshView();

    this.prodottoService.deleteProdotto(prodotto.idProdotto).subscribe({
      next: () => {
        this.prodotti = this.prodotti.filter((p) => p.idProdotto !== prodotto.idProdotto);
        if (this.currentPage > this.totalPages) {
          this.currentPage = this.totalPages;
        }
        this.pendingDeleteProdotto = null;
        if (this.selectedProdotto?.idProdotto === prodotto.idProdotto) {
          this.clearSelection();
        }
        this.showFeedback('Prodotto rimosso con successo.', 'success', 'Prodotto eliminato', 'table');
        this.isDeleting = false;
        this.refreshView();
      },
      error: (err: any) => {
        console.error('Errore eliminazione prodotto:', err);
        this.showFeedback(
          err?.error?.message || 'Eliminazione prodotto non riuscita.',
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

  private sortProdotti(prodotti: Prodotto[]): Prodotto[] {
    return [...prodotti].sort((a, b) =>
      a.nome.localeCompare(b.nome, 'it', { sensitivity: 'base' })
    );
  }

  private getUniqueValues(values: string[]): string[] {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'it', { sensitivity: 'base' }));
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

  private createEmptyProdottoDraft(): ProdottoFormDraft {
    return {
      foto: '',
      nome: '',
      marca: '',
      formato: '',
      descrizione: '',
      prezzoRivendita: null,
      prezzoAcquisto: null,
      qta: null,
      categoria: ''
    };
  }

  private scrollToEditor(): void {
    setTimeout(() => {
      const editor = document.getElementById('modifica-prodotto');
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

  private getProductIdFromRoute(): number | null {
    const rawValue =
      this.route.snapshot.queryParamMap.get('prodotto') ||
      this.route.snapshot.queryParamMap.get('idProdotto');
    const productId = Number(rawValue);

    return Number.isFinite(productId) && productId > 0 ? productId : null;
  }

  private openProductFromRoute(prodotto: Prodotto): void {
    this.selectedCategoriaFilter = '';
    this.selectedMarcaFilter = '';
    this.searchTerm = '';
    this.currentPage = Math.max(
      1,
      Math.ceil((this.filteredProdotti.findIndex((p) => p.idProdotto === prodotto.idProdotto) + 1) / this.pageSize)
    );
    this.selectProdotto(prodotto, true);
  }
}

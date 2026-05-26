import { CommonModule } from '@angular/common';
import { Component, OnInit, ChangeDetectorRef, HostListener } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SidenavComponent } from '../sidenav.component/sidenav.component';
import { UtentiService } from '../../services/utentiService';
import { ServiziService } from '../../services/servizio';
import { ProdottoService, Prodotto } from '../../services/prodotto';
import { AppuntamentoDaIncassare, CassaService } from '../../services/cassaService';
import { Utente } from '../../models/utente.model';
import { Servizio } from '../../models/servizio.model';

interface ScontrinoItem {
  id: number;
  nome: string;
  tipo: 'servizio' | 'prodotto';
  prezzoUnitario: number;
  quantita: number;
}

interface CassaDraft {
  receiptItems: ScontrinoItem[];
  selectedClienteId: number | null;
  selectedClienteLabel: string;
  selectedOperatoreId: number | null;
  selectedOperatoreLabel: string;
  selectedAppuntamentoId: number | null;
  selectedMetodo: MetodoPagamentoGestionale;
  discount: number;
  discountMode: DiscountMode;
}

type MetodoPagamentoGestionale = 'pos' | 'contanti';
type DiscountMode = 'euro' | 'percent';
type PosSimulationStep = 'idle' | 'waiting' | 'reading' | 'authorizing' | 'approved';

interface PosSimulationStatus {
  step: Exclude<PosSimulationStep, 'idle'>;
  label: string;
}

@Component({
  selector: 'app-cassa.component',
  standalone: true,
  imports: [CommonModule, FormsModule, SidenavComponent],
  templateUrl: './cassa.component.html',
  styleUrl: './cassa.component.css',
})
export class CassaComponent implements OnInit {
  isSidenavCollapsed = false;

  // Data lists loaded from DB
  clienti: Utente[] = [];
  operatori: Utente[] = [];
  servizi: Servizio[] = [];
  prodotti: Prodotto[] = [];
  appuntamentiDaIncassare: AppuntamentoDaIncassare[] = [];

  // Selected values for adding items
  selectedServizioId: string | null = null;
  selectedProdottoId: string | null = null;

  // Search autocomplete states
  serviceSearchQuery: string = '';
  showServiceDropdown: boolean = false;
  productSearchQuery: string = '';
  showProductDropdown: boolean = false;
  showCustomerDropdown: boolean = false;
  showOperatorDropdown: boolean = false;

  // Checkout inputs
  selectedClienteId: number | null = null;
  selectedClienteLabel = '';
  selectedOperatoreId: number | null = null;
  selectedOperatoreLabel = '';
  selectedAppuntamentoId: number | null = null;
  selectedMetodo: MetodoPagamentoGestionale = 'pos';
  discount: number = 0;
  discountMode: DiscountMode = 'euro';

  // Receipt items state
  receiptItems: ScontrinoItem[] = [];

  // Statistics
  incassoOggi: number = 0;
  scontriniOggi: number = 0;

  // Loading & message states
  loading = false;
  successMessage = '';
  errorMessage = '';
  showProcessingAlert = false;
  processingAlertMessage = '';
  activePaymentAction: 'standard' | 'receipt' | null = null;
  posSimulationStep: PosSimulationStep = 'idle';
  readonly posSimulationStatuses: PosSimulationStatus[] = [
    { step: 'waiting', label: 'Carta' },
    { step: 'reading', label: 'Lettura' },
    { step: 'authorizing', label: 'Autorizzazione' },
    { step: 'approved', label: 'Approvato' }
  ];
  private readonly draftStorageKey = 'gestionale-cassa-draft-v1';
  private posSimulationTimeoutIds: ReturnType<typeof setTimeout>[] = [];

  constructor(
    private utentiService: UtentiService,
    private serviziService: ServiziService,
    private prodottoService: ProdottoService,
    private cassaService: CassaService,
    private cdr: ChangeDetectorRef
  ) { }

  ngOnInit(): void {
    this.restoreReceiptDraft();
    this.loadAllData();
    this.loadDailyStats();
    this.loadAppuntamentiDaIncassare();
  }

  @HostListener('document:click')
  closeOpenDropdowns(): void {
    this.showServiceDropdown = false;
    this.showProductDropdown = false;
    this.showCustomerDropdown = false;
    this.showOperatorDropdown = false;
  }

  toggleSidenav(): void {
    this.isSidenavCollapsed = !this.isSidenavCollapsed;
  }

  loadAllData(): void {
    this.utentiService.getClienti().subscribe({
      next: (res) => {
        this.clienti = res;
      },
      error: (err) => console.error("Errore caricamento clienti:", err)
    });

    this.utentiService.getOperatori().subscribe({
      next: (res) => {
        this.operatori = res;
      },
      error: (err) => console.error("Errore caricamento operatori:", err)
    });

    this.serviziService.getServizi().subscribe({
      next: (res) => {
        this.servizi = res;
      },
      error: (err) => console.error("Errore caricamento servizi:", err)
    });

    this.prodottoService.getProdotti().subscribe({
      next: (res) => {
        this.prodotti = res;
      },
      error: (err) => console.error("Errore caricamento prodotti:", err)
    });
  }

  loadDailyStats(): void {
    this.cassaService.getStats().subscribe({
      next: (res) => {
        this.incassoOggi = res.incassoOggi;
        this.scontriniOggi = res.scontriniOggi;
        this.cdr.detectChanges();
      },
      error: (err) => console.error("Errore caricamento statistiche cassa:", err)
    });
  }

  loadAppuntamentiDaIncassare(): void {
    this.cassaService.getAppuntamentiDaIncassare().subscribe({
      next: (res) => {
        this.appuntamentiDaIncassare = res.appuntamenti || [];
        this.cdr.detectChanges();
      },
      error: (err) => console.error("Errore caricamento appuntamenti da incassare:", err)
    });
  }

  addServizioItem(): void {
    if (!this.selectedServizioId) return;
    const servId = Number(this.selectedServizioId);
    const serv = this.servizi.find(s => s.idServizio === servId);
    if (!serv) return;

    const existing = this.receiptItems.find(item => item.tipo === 'servizio' && item.id === servId);
    if (existing) {
      existing.quantita = 1;
      this.selectedServizioId = null;
      this.serviceSearchQuery = '';
      this.errorMessage = 'Questo servizio e gia presente nello scontrino: la quantita resta 1.';
      this.successMessage = '';
      this.saveReceiptDraft();
      return;
    } else {
      this.receiptItems.push({
        id: serv.idServizio,
        nome: serv.nome,
        tipo: 'servizio',
        prezzoUnitario: serv.prezzo,
        quantita: 1
      });
    }
    this.selectedServizioId = null;
    this.serviceSearchQuery = '';
    this.saveReceiptDraft();
    this.clearMessages();
  }

  addProdottoItem(): void {
    if (!this.selectedProdottoId) return;
    const prodId = Number(this.selectedProdottoId);
    const prod = this.prodotti.find(p => p.idProdotto === prodId);
    if (!prod) return;

    if (prod.qta <= 0) {
      this.errorMessage = 'Questo prodotto è esaurito in magazzino.';
      return;
    }

    const existing = this.receiptItems.find(item => item.tipo === 'prodotto' && item.id === prodId);
    if (existing) {
      if (existing.quantita >= prod.qta) {
        this.errorMessage = `Non puoi aggiungere più di ${prod.qta} unità per questo prodotto.`;
        return;
      }
      existing.quantita++;
    } else {
      this.receiptItems.push({
        id: prod.idProdotto,
        nome: prod.nome,
        tipo: 'prodotto',
        prezzoUnitario: prod.prezzoRivendita,
        quantita: 1
      });
    }
    this.selectedProdottoId = null;
    this.productSearchQuery = '';
    this.saveReceiptDraft();
    this.clearMessages();
  }

  get filteredServizi(): Servizio[] {
    if (!this.serviceSearchQuery.trim()) {
      return this.servizi;
    }
    const q = this.serviceSearchQuery.toLowerCase();
    return this.servizi.filter(s => s.nome.toLowerCase().includes(q));
  }

  get filteredProdotti(): Prodotto[] {
    if (!this.productSearchQuery.trim()) {
      return this.prodotti;
    }
    const q = this.productSearchQuery.toLowerCase();
    return this.prodotti.filter(p => p.nome.toLowerCase().includes(q) || (p.marca && p.marca.toLowerCase().includes(q)));
  }

  selectServizio(serv: Servizio): void {
    this.selectedServizioId = String(serv.idServizio);
    this.serviceSearchQuery = `${serv.nome} - € ${serv.prezzo.toFixed(2)}`;
    this.showServiceDropdown = false;
    this.clearMessages();
  }

  selectProdotto(prod: Prodotto): void {
    this.selectedProdottoId = String(prod.idProdotto);
    this.productSearchQuery = `${prod.nome} - € ${prod.prezzoRivendita.toFixed(2)}`;
    this.showProductDropdown = false;
    this.clearMessages();
  }

  onServiceSearchChange(): void {
    this.selectedServizioId = null;
    this.showServiceDropdown = true;
    this.showProductDropdown = false;
  }

  onProductSearchChange(): void {
    this.selectedProdottoId = null;
    this.showProductDropdown = true;
    this.showServiceDropdown = false;
  }

  toggleServiceDropdownFromClick(event: MouseEvent): void {
    event.stopPropagation();
    this.showServiceDropdown = !this.showServiceDropdown;

    if (this.showServiceDropdown) {
      this.showProductDropdown = false;
      this.showCustomerDropdown = false;
      this.showOperatorDropdown = false;
    }
  }

  toggleProductDropdownFromClick(event: MouseEvent): void {
    event.stopPropagation();
    this.showProductDropdown = !this.showProductDropdown;

    if (this.showProductDropdown) {
      this.showServiceDropdown = false;
      this.showCustomerDropdown = false;
      this.showOperatorDropdown = false;
    }
  }

  toggleCustomerDropdown(event: MouseEvent): void {
    event.stopPropagation();
    this.showCustomerDropdown = !this.showCustomerDropdown;

    if (this.showCustomerDropdown) {
      this.showServiceDropdown = false;
      this.showProductDropdown = false;
      this.showOperatorDropdown = false;
    }
  }

  toggleOperatorDropdown(event: MouseEvent): void {
    event.stopPropagation();
    this.showOperatorDropdown = !this.showOperatorDropdown;

    if (this.showOperatorDropdown) {
      this.showServiceDropdown = false;
      this.showProductDropdown = false;
      this.showCustomerDropdown = false;
    }
  }

  toggleServiceDropdown(show: boolean): void {
    setTimeout(() => {
      this.showServiceDropdown = show;
    }, 200);
  }

  toggleProductDropdown(show: boolean): void {
    setTimeout(() => {
      this.showProductDropdown = show;
    }, 200);
  }

  toggleCustomerDropdownBlur(show: boolean): void {
    setTimeout(() => {
      this.showCustomerDropdown = show;
    }, 200);
  }

  toggleOperatorDropdownBlur(show: boolean): void {
    setTimeout(() => {
      this.showOperatorDropdown = show;
    }, 200);
  }

  removeReceiptItem(index: number): void {
    this.receiptItems.splice(index, 1);
    if (this.selectedAppuntamentoId && !this.receiptItems.some(item => item.tipo === 'servizio')) {
      this.selectedAppuntamentoId = null;
      this.selectedClienteId = null;
      this.selectedClienteLabel = '';
      this.selectedOperatoreId = null;
      this.selectedOperatoreLabel = '';
    }
    this.saveReceiptDraft();
    this.clearMessages();
  }

  increaseItemQty(index: number): void {
    const item = this.receiptItems[index];
    if (!item) {
      return;
    }

    if (item.tipo === 'servizio') {
      item.quantita = 1;
      this.errorMessage = 'La quantita dei servizi resta sempre 1.';
      this.successMessage = '';
      this.saveReceiptDraft();
      return;
    }

    if (item.tipo === 'prodotto') {
      const prod = this.prodotti.find(p => p.idProdotto === item.id);
      if (prod && item.quantita >= prod.qta) {
        this.errorMessage = `Disponibilità limitata: massimo ${prod.qta} unità.`;
        return;
      }
    }
    item.quantita++;
    this.saveReceiptDraft();
    this.clearMessages();
  }

  decreaseItemQty(index: number): void {
    if (this.receiptItems[index].quantita > 1) {
      this.receiptItems[index].quantita--;
    } else {
      this.removeReceiptItem(index);
    }
    this.saveReceiptDraft();
    this.clearMessages();
  }

  onItemPriceChange(index: number): void {
    const item = this.receiptItems[index];

    if (!item) {
      return;
    }

    const price = Number(item.prezzoUnitario);
    item.prezzoUnitario = Number.isFinite(price) && price >= 0 ? price : 0;
    this.saveReceiptDraft();
    this.clearMessages();
  }

  get subtotal(): number {
    return this.receiptItems.reduce((sum, item) => sum + (item.prezzoUnitario * item.quantita), 0);
  }

  get normalizedDiscountValue(): number {
    const value = Number(this.discount || 0);
    return Number.isFinite(value) ? Math.max(0, value) : 0;
  }

  get discountAmount(): number {
    if (this.subtotal <= 0) {
      return 0;
    }

    if (this.discountMode === 'percent') {
      const percent = Math.min(this.normalizedDiscountValue, 100);
      return Math.min(this.subtotal, (this.subtotal * percent) / 100);
    }

    return Math.min(this.subtotal, this.normalizedDiscountValue);
  }

  get total(): number {
    return Math.max(0, this.subtotal - this.discountAmount);
  }

  get selectedClienteDisplay(): string {
    return this.selectedClienteLabel || 'Carica una prenotazione per associare il cliente';
  }

  get selectedOperatoreDisplay(): string {
    return this.selectedOperatoreLabel || 'Carica una prenotazione per associare l\'operatore';
  }

  get selectedClienteChoiceLabel(): string {
    if (!this.selectedClienteId) {
      return 'Cliente occasionale';
    }

    const cliente = this.clienti.find(c => c.idUtente === Number(this.selectedClienteId));
    return cliente ? this.formatClienteLabel(cliente) : 'Cliente selezionato';
  }

  get selectedOperatoreChoiceLabel(): string {
    if (!this.selectedOperatoreId) {
      return 'Seleziona operatore...';
    }

    const operatore = this.operatori.find(o => o.idUtente === Number(this.selectedOperatoreId));
    return operatore ? `${operatore.cognome} ${operatore.nome}` : 'Operatore selezionato';
  }

  get hasServizi(): boolean {
    return this.receiptItems.some(item => item.tipo === 'servizio');
  }

  get selectedMetodoLabel(): string {
    return this.selectedMetodo === 'pos' ? 'Carta' : 'Contanti';
  }

  get posSimulationTitle(): string {
    switch (this.posSimulationStep) {
      case 'waiting':
        return 'In attesa carta';
      case 'reading':
        return 'Lettura carta';
      case 'authorizing':
        return 'Autorizzazione';
      case 'approved':
        return 'Pagamento approvato';
      default:
        return 'Terminale pronto';
    }
  }

  get posSimulationCopy(): string {
    switch (this.posSimulationStep) {
      case 'waiting':
        return 'Carta attesa sul terminale.';
      case 'reading':
        return 'Lettura del chip o del pagamento senza contatto in corso.';
      case 'authorizing':
        return 'Richiesta autorizzazione alla banca.';
      case 'approved':
        return 'Transazione autorizzata, sto registrando la vendita.';
      default:
        return 'Terminale in attesa del pagamento carta.';
    }
  }

  get posSimulationIcon(): string {
    switch (this.posSimulationStep) {
      case 'reading':
        return 'bi bi-broadcast-pin';
      case 'authorizing':
        return 'bi bi-shield-check';
      case 'approved':
        return 'bi bi-check2-circle';
      default:
        return 'bi bi-credit-card-2-front';
    }
  }

  clearMessages(): void {
    this.successMessage = '';
    this.errorMessage = '';
  }

  private restoreReceiptDraft(): void {
    try {
      const rawDraft = localStorage.getItem(this.draftStorageKey);
      if (!rawDraft) {
        return;
      }

      const draft = JSON.parse(rawDraft) as Partial<CassaDraft>;
      const receiptItems = Array.isArray(draft.receiptItems)
        ? draft.receiptItems.filter((item): item is ScontrinoItem =>
          typeof item?.id === 'number' &&
          (item.tipo === 'servizio' || item.tipo === 'prodotto') &&
          typeof item.nome === 'string' &&
          typeof item.prezzoUnitario === 'number' &&
          typeof item.quantita === 'number'
        )
          .map(item => ({
            ...item,
            quantita: item.tipo === 'servizio' ? 1 : Math.max(1, Math.floor(item.quantita))
          }))
        : [];

      if (receiptItems.length === 0) {
        return;
      }

      this.receiptItems = receiptItems;
      this.selectedClienteId = this.parseNullableNumber(draft.selectedClienteId);
      this.selectedClienteLabel = typeof draft.selectedClienteLabel === 'string' ? draft.selectedClienteLabel : '';
      this.selectedOperatoreId = this.parseNullableNumber(draft.selectedOperatoreId);
      this.selectedOperatoreLabel = typeof draft.selectedOperatoreLabel === 'string' ? draft.selectedOperatoreLabel : '';
      this.selectedAppuntamentoId = this.parseNullableNumber(draft.selectedAppuntamentoId);
      this.selectedMetodo = draft.selectedMetodo === 'contanti' ? 'contanti' : 'pos';
      this.discountMode = draft.discountMode === 'percent' ? 'percent' : 'euro';
      this.discount = Number.isFinite(Number(draft.discount)) ? Math.max(0, Number(draft.discount)) : 0;
    } catch (err) {
      console.error('Errore ripristino scontrino in corso:', err);
      this.clearReceiptDraft();
    }
  }

  private saveReceiptDraft(): void {
    try {
      if (this.receiptItems.length === 0) {
        this.clearReceiptDraft();
        return;
      }

      const draft: CassaDraft = {
        receiptItems: this.receiptItems,
        selectedClienteId: this.selectedClienteId,
        selectedClienteLabel: this.selectedClienteLabel,
        selectedOperatoreId: this.selectedOperatoreId,
        selectedOperatoreLabel: this.selectedOperatoreLabel,
        selectedAppuntamentoId: this.selectedAppuntamentoId,
        selectedMetodo: this.selectedMetodo,
        discount: this.discount,
        discountMode: this.discountMode
      };

      localStorage.setItem(this.draftStorageKey, JSON.stringify(draft));
    } catch (err) {
      console.error('Errore salvataggio scontrino in corso:', err);
    }
  }

  private clearReceiptDraft(): void {
    try {
      localStorage.removeItem(this.draftStorageKey);
    } catch (err) {
      console.error('Errore pulizia scontrino in corso:', err);
    }
  }

  private parseNullableNumber(value: unknown): number | null {
    const parsedValue = Number(value);
    return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : null;
  }

  private formatClienteLabel(cliente: { nome?: string | null; cognome?: string | null; email?: string | null }): string {
    const fullName = `${cliente.cognome || ''} ${cliente.nome || ''}`.trim() || 'Cliente';
    const email = String(cliente.email || '').trim();

    return email ? `${fullName} (${email})` : fullName;
  }

  selectMetodo(metodo: MetodoPagamentoGestionale): void {
    this.selectedMetodo = metodo;
    this.posSimulationStep = 'idle';
    this.saveReceiptDraft();
    this.onPaymentFormInteraction();
  }

  selectCliente(clienteId: number | null): void {
    this.selectedClienteId = clienteId;
    this.selectedClienteLabel = '';
    this.showCustomerDropdown = false;
    this.saveReceiptDraft();
    this.onPaymentFormInteraction();
  }

  selectOperatore(operatoreId: number | null): void {
    this.selectedOperatoreId = operatoreId;
    this.selectedOperatoreLabel = '';
    this.showOperatorDropdown = false;
    this.saveReceiptDraft();
    this.onPaymentFormInteraction();
  }

  isPosStepActive(step: Exclude<PosSimulationStep, 'idle'>): boolean {
    return this.posSimulationStep === step;
  }

  isPosStepComplete(step: Exclude<PosSimulationStep, 'idle'>): boolean {
    const order: PosSimulationStep[] = ['waiting', 'reading', 'authorizing', 'approved'];
    return order.indexOf(this.posSimulationStep) > order.indexOf(step);
  }

  selectDiscountMode(mode: DiscountMode): void {
    this.discountMode = mode;

    if (mode === 'percent' && this.normalizedDiscountValue > 100) {
      this.discount = 100;
    }

    this.saveReceiptDraft();
    this.clearMessages();
  }

  onDiscountChange(value: number | string): void {
    const numericValue = Number(value);
    const normalizedValue = Number.isFinite(numericValue) ? Math.max(0, numericValue) : 0;

    this.discount = this.discountMode === 'percent'
      ? Math.min(normalizedValue, 100)
      : normalizedValue;

    this.saveReceiptDraft();
    this.clearMessages();
  }

  onPaymentFormInteraction(): void {
    this.clearMessages();
  }

  nuovaVendita(): void {
    this.clearPosSimulationTimeouts();
    this.receiptItems = [];
    this.selectedClienteId = null;
    this.selectedClienteLabel = '';
    this.selectedOperatoreId = null;
    this.selectedOperatoreLabel = '';
    this.selectedAppuntamentoId = null;
    this.selectedMetodo = 'pos';
    this.discount = 0;
    this.discountMode = 'euro';
    this.serviceSearchQuery = '';
    this.productSearchQuery = '';
    this.activePaymentAction = null;
    this.posSimulationStep = 'idle';
    this.clearReceiptDraft();
    this.clearMessages();
  }

  caricaAppuntamentoInCassa(appuntamento: AppuntamentoDaIncassare): void {
    if (!appuntamento.servizi.length) {
      this.errorMessage = 'Questo appuntamento non ha servizi associati da mettere in cassa.';
      return;
    }

    this.receiptItems = appuntamento.servizi.map(servizio => ({
      id: servizio.idServizio,
      nome: servizio.nome,
      tipo: 'servizio',
      prezzoUnitario: servizio.prezzo,
      quantita: 1
    }));
    this.selectedClienteId = appuntamento.idCliente;
    this.selectedClienteLabel = this.formatClienteLabel({
      nome: appuntamento.clienteNome,
      email: appuntamento.clienteEmail
    });
    this.selectedOperatoreId = appuntamento.idOperatore;
    this.selectedOperatoreLabel = appuntamento.operatoreNome;
    this.selectedAppuntamentoId = appuntamento.idAppuntamento;
    this.discount = 0;
    this.discountMode = 'euro';
    this.serviceSearchQuery = '';
    this.productSearchQuery = '';
    this.saveReceiptDraft();
    this.clearMessages();
  }

  getAppointmentServicesLabel(appuntamento: AppuntamentoDaIncassare): string {
    if (appuntamento.servizi.length === 0) {
      return appuntamento.note || 'Servizio prenotato';
    }

    return appuntamento.servizi.map(servizio => servizio.nome).join(', ');
  }

  registraPagamento(): void {
    this.completaPagamento(false);
  }

  registraPagamentoConRicevuta(): void {
    this.completaPagamento(true);
  }

  private completaPagamento(generaRicevuta: boolean): void {
    if (this.receiptItems.length === 0) {
      this.errorMessage = 'Inserisci almeno un articolo nello scontrino per registrare il pagamento.';
      return;
    }

    if (this.hasServizi && !this.selectedOperatoreId) {
      this.errorMessage = 'Seleziona l\'operatore che ha effettuato il servizio.';
      return;
    }

    this.loading = true;
    this.activePaymentAction = generaRicevuta ? 'receipt' : 'standard';
    this.errorMessage = '';
    this.successMessage = '';
    this.showProcessingAlert = true;
    this.clearPosSimulationTimeouts();

    if (this.selectedMetodo === 'pos') {
      this.runPosSimulation(generaRicevuta);
      return;
    }

    this.posSimulationStep = 'idle';
    this.processingAlertMessage = generaRicevuta
      ? 'Registrazione contanti in corso... Generazione ricevuta in corso.'
      : 'Registrazione contanti in corso...';

    const timeoutId = setTimeout(() => {
      this.registraPagamentoBackend(generaRicevuta);
    }, 700);
    this.posSimulationTimeoutIds.push(timeoutId);
  }

  private runPosSimulation(generaRicevuta: boolean): void {
    const steps: Array<{ step: PosSimulationStep; message: string; delay: number }> = [
      {
        step: 'waiting',
        message: 'Terminale pronto: appoggia, inserisci o striscia la carta.',
        delay: 0
      },
      {
        step: 'reading',
        message: 'Lettura carta in corso...',
        delay: 850
      },
      {
        step: 'authorizing',
        message: 'Autorizzazione pagamento carta in corso...',
        delay: 950
      },
      {
        step: 'approved',
        message: generaRicevuta
          ? 'Carta approvata. Registro il pagamento e preparo la ricevuta...'
          : 'Carta approvata. Registro il pagamento...',
        delay: 900
      }
    ];

    let elapsed = 0;

    steps.forEach((item, index) => {
      elapsed += item.delay;
      const timeoutId = setTimeout(() => {
        this.posSimulationStep = item.step;
        this.processingAlertMessage = item.message;
        this.cdr.detectChanges();

        if (index === steps.length - 1) {
          const submitTimeoutId = setTimeout(() => {
            this.registraPagamentoBackend(generaRicevuta);
          }, 500);
          this.posSimulationTimeoutIds.push(submitTimeoutId);
        }
      }, elapsed);
      this.posSimulationTimeoutIds.push(timeoutId);
    });
  }

  private clearPosSimulationTimeouts(): void {
    this.posSimulationTimeoutIds.forEach(timeoutId => clearTimeout(timeoutId));
    this.posSimulationTimeoutIds = [];
  }

  private registraPagamentoBackend(generaRicevuta: boolean): void {
    const prodottiPayload = this.receiptItems
      .filter(item => item.tipo === 'prodotto')
      .map(item => ({
        idProdotto: item.id,
        quantita: item.quantita,
        prezzoUnitario: item.prezzoUnitario
      }));

    const metodoPagamentoBackend: 'carta' | 'contanti' =
      this.selectedMetodo === 'pos' ? 'carta' : 'contanti';

    const payload = {
      idCliente: this.selectedClienteId ? Number(this.selectedClienteId) : null,
      idOperatore: this.selectedOperatoreId ? Number(this.selectedOperatoreId) : null,
      idAppuntamento: this.selectedAppuntamentoId,
      totale: this.total,
      metodo: metodoPagamentoBackend,
      prodotti: prodottiPayload
    };

    this.cassaService.registraPagamento(payload).subscribe({
      next: (res) => {
        if (generaRicevuta) {
          try {
            this.generateWordDocument();
          } catch (err) {
            console.error("Errore durante la generazione del file Word:", err);
          }
        }

        this.loading = false;
        this.activePaymentAction = null;
        this.showProcessingAlert = false;
        this.successMessage = generaRicevuta
          ? `Pagamento registrato con ricevuta! (Vendita #${res.idVendita})`
          : `Pagamento registrato con successo! (Vendita #${res.idVendita})`;
        this.loadDailyStats();
        this.loadAppuntamentiDaIncassare();

        // Clear receipt and all states immediately (pulisci tutto)
        this.receiptItems = [];
        this.selectedClienteId = null;
        this.selectedClienteLabel = '';
        this.selectedOperatoreId = null;
        this.selectedOperatoreLabel = '';
        this.selectedAppuntamentoId = null;
        this.discount = 0;
        this.discountMode = 'euro';
        this.serviceSearchQuery = '';
        this.productSearchQuery = '';
        this.posSimulationStep = 'idle';
        this.clearReceiptDraft();

        // Refresh products list in case of stock updates
        this.prodottoService.getProdotti().subscribe(res => this.prodotti = res);

        this.cdr.detectChanges();

        // Auto-clear success message after 4 seconds
        setTimeout(() => {
          if (this.successMessage.startsWith('Pagamento registrato')) {
            this.successMessage = '';
            this.cdr.detectChanges();
          }
        }, 4000);
      },
      error: (err) => {
        this.loading = false;
        this.activePaymentAction = null;
        this.showProcessingAlert = false;
        this.posSimulationStep = 'idle';
        this.errorMessage = err?.status === 409
          ? 'Alcuni prodotti non sono piu disponibili nella quantita richiesta.'
          : 'Pagamento non riuscito. Riprova tra qualche istante.';
        console.error(err);
        this.cdr.detectChanges();
      }
    });
  }

  generateWordDocument(): void {

    // =========================================
    // LOGO
    // =========================================

    const logoUrl =
      'https://res.cloudinary.com/duimlq34k/image/upload/v1777022407/logo-parrucchieri-oro-scuro-transparent_tfooef.png';

    // =========================================
    // DATI CLIENTE / OPERATORE
    // =========================================

    const cliente = this.selectedClienteId
      ? this.clienti.find(c => c.idUtente === Number(this.selectedClienteId))
      : null;

    const clienteName = this.selectedClienteLabel || (cliente ? this.formatClienteLabel(cliente) : 'Generico');

    const operatore = this.operatori.find(
      o => o.idUtente === Number(this.selectedOperatoreId)
    );

    const operatoreName = this.selectedOperatoreLabel || (operatore
      ? `${operatore.cognome} ${operatore.nome}`
      : 'Non specificato');

    const currentDate = new Date().toLocaleString('it-IT');

    const metodoPagamento =
      this.selectedMetodoLabel;

    const discountLabel = this.discountMode === 'percent'
      ? `Sconto Applicato (${this.normalizedDiscountValue.toLocaleString('it-IT', { maximumFractionDigits: 2 })}%)`
      : 'Sconto Applicato';

    // =========================================
    // TABELLA ARTICOLI
    // =========================================

    let itemsHtml = '';

    this.receiptItems.forEach((item, index) => {

      const totaleRiga = item.prezzoUnitario * item.quantita;

      itemsHtml += `
      <tr class="${index % 2 === 0 ? 'row-even' : 'row-odd'}">

        <td>${item.nome}</td>

        <td style="text-transform: capitalize; text-align:center;">
          ${item.tipo}
        </td>

        <td style="text-align:center;">
          ${item.quantita}
        </td>

        <td style="text-align:right;">
          € ${item.prezzoUnitario.toFixed(2)}
        </td>

        <td style="text-align:right; font-weight:bold;">
          € ${totaleRiga.toFixed(2)}
        </td>

      </tr>
    `;
    });

    // =========================================
    // HTML WORD
    // =========================================


    const items = this.receiptItems.map((item) => ({
      nome: item.nome,
      tipologia: item.tipo,
      quantita: item.quantita,
      prezzo: item.prezzoUnitario
    }));

const htmlContent = `
<!DOCTYPE html>
<html lang="it">

<head>

  <meta charset="UTF-8" />

  <title>Ricevuta di Pagamento</title>

  <style>

    *{
      margin:0;
      padding:0;
      box-sizing:border-box;
    }

    body{
      background:#f3f4f6;
      font-family:system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
      color:#1f2937;
      padding:45px;
      line-height: 1.5;
    }

    .receipt-container{
      max-width:980px;
      margin:0 auto;
      background:#ffffff;
      border-radius:24px;
      padding:55px;
      box-shadow:
        0 20px 60px rgba(0,0,0,0.04),
        0 6px 18px rgba(0,0,0,0.02);
      overflow:hidden;
      position:relative;
    }

    .receipt-container::before{
      content:"";
      position:absolute;
      top:0;
      left:0;
      width:100%;
      height:7px;
      background:linear-gradient(
        90deg,
        #8f6b10,
        #c89b2f,
        #f2d27a,
        #b8860b
      );
    }

    /* =========================
        HEADER
    ========================= */

    .header{
      text-align:center;
      margin-bottom:55px;
    }

    .logo{
      width:320px;
      max-width:100%;
      object-fit:contain;
      margin-bottom:18px;
    }

    .receipt-title{
      font-size:13px;
      color:#6b7280;
      text-transform:uppercase;
      letter-spacing:5px;
      font-weight:600;
    }

    /* =========================
        SECTION TITLE
    ========================= */

    .section-title{
      font-size:14px;
      font-weight:700;
      text-transform:uppercase;
      letter-spacing:2px;
      color:#b8860b;
      margin-bottom:22px;
      padding-left:4px;
    }

    /* FORZATURA TOTALE DELLA NUOVA PAGINA */
    .force-page-break {
      page-break-before: always !important;
      break-before: page !important;
      height: 0;
      margin: 0;
      padding: 0;
    }

    /* =========================
        INFO GRID
    ========================= */

    .details-grid{
      display:grid;
      grid-template-columns:1fr 1fr;
      gap:20px;
      margin-bottom:50px;
    }

    .detail-card{
      background:#fafafa;
      border:1px solid #f3f4f6;
      border-radius:16px;
      padding:20px 24px;
      transition:all 0.2s ease;
    }

    .detail-card:hover{
      transform:translateY(-1px);
      background:#f7f7f7;
    }

    .detail-label{
      font-size:11px;
      text-transform:uppercase;
      letter-spacing:1.5px;
      color:#9ca3af;
      margin-bottom:8px;
      font-weight:700;
    }

    .detail-value{
      font-size:16px;
      font-weight:600;
      color:#111827;
      line-height:1.4;
    }

    /* =========================
        PRODUCTS TABLE
    ========================= */

    .products-wrapper{
      background:#ffffff;
      border-radius:16px;
      overflow:hidden;
      border:1px solid #e5e7eb;
      margin-top:12px;
    }

    .products-table{
      width:100%;
      border-collapse:collapse;
    }

    .products-table thead th{
      background:#1f2937;
      color:#ffffff;
      padding:18px 20px;
      font-size:12px;
      text-transform:uppercase;
      letter-spacing:1.5px;
      font-weight:700;
      text-align:right;
    }

    .products-table thead th.th-desc {
      text-align:left;
      width: 40%;
    }
    
    .products-table thead th.th-type {
      text-align:center;
      width: 18%;
    }

    .products-table tbody tr{
      border-bottom:1px solid #f3f4f6;
      transition:background 0.2s ease;
    }

    .products-table tbody tr:last-child{
      border-bottom:none;
    }

    .products-table tbody tr:nth-child(even){
      background:#f9fafb;
    }

    .products-table tbody tr:hover{
      background:#f3f4f6;
    }

    .products-table tbody td{
      padding:18px 20px;
      font-size:14px;
      color:#374151;
      vertical-align:middle;
      text-align:right;
    }

    .products-table tbody td.td-desc{
      text-align:left;
      font-weight:600;
      color:#111827;
      line-height:1.5;
    }

    .products-table tbody td.td-type{
      text-align:center;
    }

    .type-badge{
      display:inline-block;
      padding:6px 14px;
      border-radius:8px;
      font-size:11px;
      font-weight:700;
      text-transform: uppercase;
      letter-spacing:0.5px;
      background:#fef3c7;
      color:#92400e;
    }

    .price, .total-price{
      white-space: nowrap !important;
    }

    .price{
      font-weight:500;
      color:#374151;
    }

    .qty{
      font-weight:600;
      color:#6b7280;
    }

    .total-price{
      font-weight:700;
      color:#b8860b;
      font-size:15px;
    }

    /* =========================
        TOTALS
    ========================= */

    .totals-wrapper{
      display:flex;
      justify-content:flex-end;
      margin-top:35px;
      page-break-inside: avoid !important;
      break-inside: avoid !important;
    }

    .totals-card{
      width:380px;
      background:#fafafa;
      border-radius:16px;
      padding:24px;
      border:1px solid #e5e7eb;
    }

    .totals-table{
      width:100%;
      border-collapse:collapse;
    }

    .totals-table tr td{
      padding:12px 0;
    }

    .totals-table tr:not(.grand-total){
      border-bottom:1px dashed #e5e7eb;
    }

    .totals-label{
      font-size:14px;
      color:#4b5563;
      font-weight:500;
    }

    .totals-value{
      text-align:right;
      font-size:15px;
      font-weight:600;
      color:#111827;
      white-space: nowrap;
    }

    .discount-value{
      color:#dc2626;
    }

    .grand-total td{
      padding-top:20px !important;
    }

    .grand-total .totals-label{
      font-size:15px;
      color:#b8860b;
      font-weight:700;
      letter-spacing:0.5px;
    }

    .grand-total .totals-value{
      font-size:32px;
      color:#b8860b;
      font-weight:800;
      line-height:1;
    }

    /* =========================
        FOOTER
    ========================= */

    .footer{
      margin-top:60px;
      padding-top:24px;
      border-top:1px solid #e5e7eb;
      text-align:center;
    }

    .footer-text{
      color:#9ca3af;
      font-size:12px;
      margin-bottom:8px;
    }

    .footer-thanks{
      color:#4b5563;
      font-size:14px;
      font-style:italic;
    }

    /* Regola esplicita per i motori di stampa PDF */
    @media print {
      .force-page-break {
        page-break-before: always !important;
        break-before: page !important;
      }
    }

  </style>

</head>

<body>

  <div class="receipt-container">

    <div class="header">
      <img
        src="${logoUrl}"
        alt="Logo Parrucchieri"
        class="logo"
      />
      <div class="receipt-title">
        Ricevuta di Pagamento
      </div>
    </div>

    <div class="section-title">
      Dettagli Transazione
    </div>

    <div class="details-grid">
      <div class="detail-card">
        <div class="detail-label">Data e Ora</div>
        <div class="detail-value">${currentDate}</div>
      </div>

      <div class="detail-card">
        <div class="detail-label">Cliente</div>
        <div class="detail-value">${clienteName}</div>
      </div>

      <div class="detail-card">
        <div class="detail-label">Operatore</div>
        <div class="detail-value">${operatoreName}</div>
      </div>

      <div class="detail-card">
        <div class="detail-label">Metodo di Pagamento</div>
        <div class="detail-value">${metodoPagamento}</div>
      </div>
    </div>

    <div class="force-page-break"></div>

    <div class="table-container">
      
      <div class="section-title">
        Prodotti e Servizi
      </div>

      <div class="products-wrapper">
        <table class="products-table">
          <thead>
            <tr>
              <th class="th-desc">Descrizione</th>
              <th class="th-type">Tipologia</th>
              <th>QTA</th>
              <th>Prezzo</th>
              <th>Totale</th>
            </tr>
          </thead>
          <tbody>
            ${items.map((item, index) => `
              <tr>
                <td class="td-desc">${item.nome}</td>
                <td class="td-type">
                  <span class="type-badge">${item.tipologia}</span>
                </td>
                <td class="qty">${item.quantita}</td>
                <td class="price">€ ${Number(item.prezzo).toFixed(2)}</td>
                <td class="total-price">€ ${(item.quantita * item.prezzo).toFixed(2)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>

    </div>

    <div class="totals-wrapper">
      <div class="totals-card">
        <table class="totals-table">
          <tr>
            <td class="totals-label">Subtotale</td>
            <td class="totals-value">€ ${this.subtotal.toFixed(2)}</td>
          </tr>
          <tr>
            <td class="totals-label">${discountLabel}</td>
            <td class="totals-value discount-value">- € ${this.discountAmount.toFixed(2)}</td>
          </tr>
          <tr class="grand-total">
            <td class="totals-label">TOTALE</td>
            <td class="totals-value">€ ${this.total.toFixed(2)}</td>
          </tr>
        </table>
      </div>
    </div>

    <div class="footer">
      <div class="footer-text">
        Documento generato automaticamente dal gestionale.
      </div>
      <div class="footer-thanks">
        Grazie per aver scelto I Parrucchieri di Fossano.
      </div>
    </div>

  </div>

</body>

</html>
`;

    // =========================================
    // CREAZIONE FILE WORD
    // =========================================

    const blob = new Blob(
      ['\ufeff', htmlContent],
      {
        type: 'application/msword'
      }
    );

    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');

    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const giorno = pad(now.getDate());
    const mese = pad(now.getMonth() + 1);
    const anno = now.getFullYear();
    const ore = pad(now.getHours());
    const minuti = pad(now.getMinutes());
    const secondi = pad(now.getSeconds());

    link.href = url;
    link.download = `ricevuta-${giorno}-${mese}-${anno}_${ore}-${minuti}-${secondi}.doc`;

    document.body.appendChild(link);

    link.click();

    document.body.removeChild(link);

    URL.revokeObjectURL(url);
  }
}

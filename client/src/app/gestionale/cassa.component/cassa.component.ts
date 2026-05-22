import { CommonModule } from '@angular/common';
import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
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
  private posSimulationTimeoutIds: ReturnType<typeof setTimeout>[] = [];

  constructor(
    private utentiService: UtentiService,
    private serviziService: ServiziService,
    private prodottoService: ProdottoService,
    private cassaService: CassaService,
    private cdr: ChangeDetectorRef
  ) { }

  ngOnInit(): void {
    this.loadAllData();
    this.loadDailyStats();
    this.loadAppuntamentiDaIncassare();
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
      existing.quantita++;
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
    }
  }

  toggleProductDropdownFromClick(event: MouseEvent): void {
    event.stopPropagation();
    this.showProductDropdown = !this.showProductDropdown;

    if (this.showProductDropdown) {
      this.showServiceDropdown = false;
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

  removeReceiptItem(index: number): void {
    this.receiptItems.splice(index, 1);
    if (this.selectedAppuntamentoId && !this.receiptItems.some(item => item.tipo === 'servizio')) {
      this.selectedAppuntamentoId = null;
      this.selectedClienteId = null;
      this.selectedClienteLabel = '';
      this.selectedOperatoreId = null;
      this.selectedOperatoreLabel = '';
    }
    this.clearMessages();
  }

  increaseItemQty(index: number): void {
    const item = this.receiptItems[index];
    if (item.tipo === 'prodotto') {
      const prod = this.prodotti.find(p => p.idProdotto === item.id);
      if (prod && item.quantita >= prod.qta) {
        this.errorMessage = `Disponibilità limitata: massimo ${prod.qta} unità.`;
        return;
      }
    }
    item.quantita++;
    this.clearMessages();
  }

  decreaseItemQty(index: number): void {
    if (this.receiptItems[index].quantita > 1) {
      this.receiptItems[index].quantita--;
    } else {
      this.removeReceiptItem(index);
    }
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
        return 'Lettura del chip o del contactless in corso.';
      case 'authorizing':
        return 'Richiesta autorizzazione alla banca.';
      case 'approved':
        return 'Transazione autorizzata, sto registrando la vendita.';
      default:
        return 'Terminale in standby per pagamento carta.';
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

  private formatClienteLabel(cliente: { nome?: string | null; cognome?: string | null; email?: string | null }): string {
    const fullName = `${cliente.cognome || ''} ${cliente.nome || ''}`.trim() || 'Cliente';
    const email = String(cliente.email || '').trim();

    return email ? `${fullName} (${email})` : fullName;
  }

  selectMetodo(metodo: MetodoPagamentoGestionale): void {
    this.selectedMetodo = metodo;
    this.posSimulationStep = 'idle';
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

    this.clearMessages();
  }

  onDiscountChange(value: number | string): void {
    const numericValue = Number(value);
    const normalizedValue = Number.isFinite(numericValue) ? Math.max(0, numericValue) : 0;

    this.discount = this.discountMode === 'percent'
      ? Math.min(normalizedValue, 100)
      : normalizedValue;

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
        message: 'POS pronto: appoggia, inserisci o striscia la carta.',
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

    const clienteName = this.selectedClienteLabel || (cliente ? this.formatClienteLabel(cliente) : 'Non selezionato');

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

    const htmlContent = `
  <!DOCTYPE html>
  <html lang="it">

  <head>

    <meta charset="UTF-8">

    <title>Ricevuta Vendita</title>

    <style>

      body{
        font-family: Arial, Helvetica, sans-serif;
        background:#ffffff;
        color:#2c2c2c;
        margin:0;
        padding:40px;
      }

      .container{
        max-width:950px;
        margin:0 auto;
      }

      /* =========================
         HEADER
      ========================= */

      .header{
        text-align:center;
        padding-bottom:30px;
        border-bottom:3px solid #b8860b;
        margin-bottom:40px;
      }

      .logo{
        width:170px;
        margin:0 auto 15px auto;
        display:block;
      }

      .title{
        font-size:34px;
        font-weight:bold;
        color:#b8860b;
        letter-spacing:2px;
        margin-bottom:10px;
        text-transform:uppercase;
      }

      .subtitle{
        font-size:15px;
        color:#777777;
      }

      /* =========================
         SEZIONI
      ========================= */

      .section-title{
        font-size:18px;
        font-weight:bold;
        color:#b8860b;
        text-align:center;
        margin-top:35px;
        margin-bottom:18px;
        letter-spacing:1px;
      }

      /* =========================
         DETAILS TABLE
      ========================= */

      .details-wrapper{
        display:flex;
        justify-content:center;
      }

      .details-table{
        width:80%;
        border-collapse:collapse;
        background:#fafafa;
        border-radius:10px;
        overflow:hidden;
        border:1px solid #ececec;
      }

      .details-table td{
        padding:14px 18px;
        border-bottom:1px solid #eeeeee;
        font-size:14px;
      }

      .details-label{
        width:35%;
        font-weight:bold;
        color:#b8860b;
        background:#fcfcfc;
      }

      /* =========================
         ITEMS TABLE
      ========================= */

      .table-container{
        margin-top:15px;
      }

      .items-table{
        width:100%;
        border-collapse:collapse;
        overflow:hidden;
        border-radius:12px;
        border:1px solid #e5e5e5;
      }

      .items-table thead th{
        background:#b8860b;
        color:white;
        padding:15px;
        text-align:center;
        font-size:14px;
        letter-spacing:0.5px;
      }

      .items-table td{
        padding:14px;
        border-bottom:1px solid #efefef;
        font-size:14px;
      }

      .row-even{
        background:#ffffff;
      }

      .row-odd{
        background:#fafafa;
      }

      /* =========================
         TOTALI
      ========================= */

      .totals-wrapper{
        display:flex;
        justify-content:flex-end;
        margin-top:35px;
      }

      .totals-box{
        width:360px;
        border:1px solid #e6e6e6;
        border-radius:12px;
        padding:20px;
        background:#fcfcfc;
      }

      .totals-table{
        width:100%;
        border-collapse:collapse;
      }

      .totals-table td{
        padding:10px 0;
        font-size:15px;
      }

      .totals-label{
        color:#666666;
      }

      .discount{
        color:#d9534f;
        font-weight:bold;
      }

      .final-total{
        border-top:2px solid #b8860b;
      }

      .final-total td{
        padding-top:18px;
        font-size:24px;
        font-weight:bold;
        color:#b8860b;
      }

      /* =========================
         FOOTER
      ========================= */

      .footer{
        margin-top:70px;
        text-align:center;
        color:#888888;
        font-size:12px;
        border-top:1px solid #e5e5e5;
        padding-top:25px;
      }

      .footer-thanks{
        margin-top:8px;
        font-style:italic;
      }

    </style>

  </head>

  <body>

    <div class="container">

      <!-- =========================
           HEADER
      ========================== -->

      <div class="header">

        <img
          src="${logoUrl}"
          class="logo"
          alt="Logo Parrucchieri"
        />

        <div class="title">
          I Parrucchieri di Fossano
        </div>

        <div class="subtitle">
          Ricevuta di Pagamento e Riepilogo Vendita
        </div>

      </div>

      <!-- =========================
           DETTAGLI
      ========================== -->

      <div class="section-title">
        DETTAGLI TRANSAZIONE
      </div>

      <div class="details-wrapper">

        <table class="details-table">

          <tr>
            <td class="details-label">
              Data e Ora
            </td>

            <td>
              ${currentDate}
            </td>
          </tr>

          <tr>
            <td class="details-label">
              Cliente
            </td>

            <td>
              ${clienteName}
            </td>
          </tr>

          <tr>
            <td class="details-label">
              Operatore
            </td>

            <td>
              ${operatoreName}
            </td>
          </tr>

          <tr>
            <td class="details-label">
              Metodo di Pagamento
            </td>

            <td>
              ${metodoPagamento}
            </td>
          </tr>

        </table>

      </div>

      <!-- =========================
           ARTICOLI
      ========================== -->

      <div class="section-title">
        PRODOTTI E SERVIZI
      </div>

      <div class="table-container">

        <table class="items-table">

          <thead>

            <tr>
              <th>Descrizione</th>
              <th>Tipologia</th>
              <th>Quantità</th>
              <th>Prezzo Unitario</th>
              <th>Totale</th>
            </tr>

          </thead>

          <tbody>

            ${itemsHtml}

          </tbody>

        </table>

      </div>

      <!-- =========================
           TOTALI
      ========================== -->

      <div class="totals-wrapper">

        <div class="totals-box">

          <table class="totals-table">

            <tr>

              <td class="totals-label">
                Subtotale
              </td>

              <td style="text-align:right; font-weight:bold;">
                € ${this.subtotal.toFixed(2)}
              </td>

            </tr>

            <tr>

              <td class="totals-label">
                ${discountLabel}
              </td>

              <td class="discount" style="text-align:right;">
                - € ${this.discountAmount.toFixed(2)}
              </td>

            </tr>

            <tr class="final-total">

              <td>
                TOTALE
              </td>

              <td style="text-align:right;">
                € ${this.total.toFixed(2)}
              </td>

            </tr>

          </table>

        </div>

      </div>

      <!-- =========================
           FOOTER
      ========================== -->

      <div class="footer">

        Documento generato automaticamente dal gestionale.

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

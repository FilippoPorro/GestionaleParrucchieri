import { CommonModule } from '@angular/common';
import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SidenavComponent } from '../sidenav.component/sidenav.component';
import { UtentiService } from '../../services/utentiService';
import { ServiziService } from '../../services/servizio';
import { ProdottoService, Prodotto } from '../../services/prodotto';
import { CassaService } from '../../services/cassaService';
import { Utente } from '../../models/utente.model';
import { Servizio } from '../../models/servizio.model';

interface ScontrinoItem {
  id: number;
  nome: string;
  tipo: 'servizio' | 'prodotto';
  prezzoUnitario: number;
  quantita: number;
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
  selectedOperatoreId: number | null = null;
  selectedMetodo: 'carta' | 'contanti' = 'carta';
  discount: number = 0;

  // Card details state
  cardHolder: string = '';
  cardNumber: string = '';
  cardExpiry: string = '';
  cardCvc: string = '';

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
  }

  onProductSearchChange(): void {
    this.selectedProdottoId = null;
    this.showProductDropdown = true;
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

  onExpiryInput(event: any): void {
    let val = event.target.value;
    val = val.replace(/\D/g, '');
    if (val.length > 2) {
      val = val.substring(0, 2) + '/' + val.substring(2, 4);
    }
    this.cardExpiry = val;
    event.target.value = val;
    this.clearMessages();
  }

  onCvcInput(event: any): void {
    let val = event.target.value;
    val = val.replace(/\D/g, '').substring(0, 4);
    this.cardCvc = val;
    event.target.value = val;
    this.clearMessages();
  }

  removeReceiptItem(index: number): void {
    this.receiptItems.splice(index, 1);
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

  get total(): number {
    return Math.max(0, this.subtotal - this.discount);
  }

  onClienteChange(): void {
    this.clearMessages();
  }

  clearMessages(): void {
    this.successMessage = '';
    this.errorMessage = '';
  }

  nuovaVendita(): void {
    this.receiptItems = [];
    this.selectedClienteId = null;
    this.selectedOperatoreId = null;
    this.selectedMetodo = 'carta';
    this.discount = 0;
    this.cardHolder = '';
    this.cardNumber = '';
    this.cardExpiry = '';
    this.cardCvc = '';
    this.serviceSearchQuery = '';
    this.productSearchQuery = '';
    this.clearMessages();
  }

  registraPagamento(): void {
    if (this.receiptItems.length === 0) {
      this.errorMessage = 'Inserisci almeno un articolo nello scontrino per registrare il pagamento.';
      return;
    }

    if (!this.selectedOperatoreId) {
      this.errorMessage = 'Seleziona l\'operatore che ha effettuato il servizio o la vendita.';
      return;
    }

    if (this.selectedMetodo === 'carta') {
      if (!this.cardHolder.trim() || !this.cardNumber.trim() || !this.cardExpiry.trim() || !this.cardCvc.trim()) {
        this.errorMessage = 'Inserisci tutti i dettagli della carta per registrare il pagamento.';
        return;
      }
    }

    this.loading = true;
    this.errorMessage = '';
    this.successMessage = '';
    this.showProcessingAlert = true;
    this.processingAlertMessage = 'Elaborazione pagamento in corso... Generazione ricevuta in corso.';

    setTimeout(() => {
      // 1. Download Word document (.doc) containing receipt data
      try {
        this.generateWordDocument();
      } catch (err) {
        console.error("Errore durante la generazione del file Word:", err);
      }

      // 2. Perform backend payment registration
      const prodottiPayload = this.receiptItems
        .filter(item => item.tipo === 'prodotto')
        .map(item => ({
          idProdotto: item.id,
          quantita: item.quantita,
          prezzoUnitario: item.prezzoUnitario
        }));

      const payload = {
        idCliente: this.selectedClienteId ? Number(this.selectedClienteId) : null,
        idOperatore: Number(this.selectedOperatoreId),
        totale: this.total,
        metodo: this.selectedMetodo,
        prodotti: prodottiPayload
      };

      this.cassaService.registraPagamento(payload).subscribe({
        next: (res) => {
          this.loading = false;
          this.showProcessingAlert = false;
          this.successMessage = `Pagamento registrato con successo! (Vendita #${res.idVendita})`;
          this.loadDailyStats();

          // Clear receipt and all states immediately (pulisci tutto)
          this.receiptItems = [];
          this.selectedClienteId = null;
          this.selectedOperatoreId = null;
          this.discount = 0;
          this.cardHolder = '';
          this.cardNumber = '';
          this.cardExpiry = '';
          this.cardCvc = '';
          this.serviceSearchQuery = '';
          this.productSearchQuery = '';

          // Refresh products list in case of stock updates
          this.prodottoService.getProdotti().subscribe(res => this.prodotti = res);

          this.cdr.detectChanges();

          // Auto-clear success message after 4 seconds
          setTimeout(() => {
            if (this.successMessage.includes('Pagamento registrato con successo')) {
              this.successMessage = '';
              this.cdr.detectChanges();
            }
          }, 4000);
        },
        error: (err) => {
          this.loading = false;
          this.showProcessingAlert = false;
          this.errorMessage = err.error?.message || 'Errore durante la registrazione del pagamento.';
          console.error(err);
          this.cdr.detectChanges();
        }
      });
    }, 1500); // Wait 1.5 seconds
  }

  stampa(): void {
    if (this.receiptItems.length === 0) {
      this.errorMessage = 'Inserisci almeno un articolo nello scontrino per generare la stampa.';
      return;
    }

    if (!this.selectedOperatoreId) {
      this.errorMessage = 'Seleziona l\'operatore prima di stampare.';
      return;
    }

    this.loading = true;
    this.errorMessage = '';
    this.successMessage = '';
    this.showProcessingAlert = true;
    this.processingAlertMessage = 'Generazione ricevuta di stampa... Download del documento in corso.';

    setTimeout(() => {
      // 1. Download Word document without making a backend payment registration
      try {
        this.generateWordDocument();
      } catch (err) {
        console.error("Errore durante la stampa/generazione del file Word:", err);
      }

      this.loading = false;
      this.showProcessingAlert = false;
      this.successMessage = 'Ricevuta stampata con successo!';
      this.loadDailyStats();
      this.cdr.detectChanges();

      // Auto-clear success message after 4 seconds
      setTimeout(() => {
        if (this.successMessage === 'Ricevuta stampata con successo!') {
          this.successMessage = '';
          this.cdr.detectChanges();
        }
      }, 4000);
    }, 1500); // Wait 1.5 seconds
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

    const clienteName = cliente
      ? `${cliente.cognome} ${cliente.nome}`
      : 'Non selezionato';

    const operatore = this.operatori.find(
      o => o.idUtente === Number(this.selectedOperatoreId)
    );

    const operatoreName = operatore
      ? `${operatore.cognome} ${operatore.nome}`
      : 'Non specificato';

    const currentDate = new Date().toLocaleString('it-IT');

    const metodoPagamento =
      this.selectedMetodo === 'carta'
        ? 'Carta di Credito / Debito'
        : 'Contanti';

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
                Sconto Applicato
              </td>

              <td class="discount" style="text-align:right;">
                - € ${this.discount.toFixed(2)}
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

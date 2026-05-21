import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { SidenavComponent } from '../sidenav.component/sidenav.component';
import { ChangeDetectorRef } from '@angular/core';
import { DashboardService } from '../../services/dashboard';

@Component({
  selector: 'app-home.component',
  standalone: true,
  imports: [CommonModule, SidenavComponent],
  templateUrl: './home.component.html',
  styleUrl: './home.component.css',
})
export class HomeComponent implements OnInit {
  constructor(private readonly dashboardService: DashboardService, private cdr: ChangeDetectorRef) {}

  isSidenavCollapsed = false;

  toggleSidenav(): void {
    this.isSidenavCollapsed = !this.isSidenavCollapsed;
  }
  stats = [
    { label: 'Appuntamenti oggi', value: '-', trend: 'calcolo dal calendario' },
    { label: 'Incasso registrato', value: '-', trend: 'pagamenti di oggi' },
    { label: 'Incasso previsto', value: '-', trend: 'servizi prenotati oggi' },
    { label: 'Prodotti da riordinare', value: '-', trend: 'attenzione stock' },
    { label: 'Clienti in salone', value: '-', trend: 'fascia oraria corrente' }
  ];

  ngOnInit(): void {
    this.dashboardService.getStats().subscribe({
      next: (dashboardStats) => {
        const slotStart = this.formatTime(dashboardStats.slotCorrente.inizio);
        const slotEnd = this.formatTime(dashboardStats.slotCorrente.fine);

        this.stats = [
          {
            label: 'Appuntamenti oggi',
            value: String(dashboardStats.appuntamentiOggi),
            trend: dashboardStats.data
          },
          {
            label: 'Incasso registrato',
            value: this.formatCurrency(dashboardStats.incassoGiornaliero),
            trend: 'somma pagamenti di oggi'
          },
          {
            label: 'Incasso previsto',
            value: this.formatCurrency(dashboardStats.incassoPrevistoAppuntamenti),
            trend: 'servizi negli appuntamenti'
          },
          {
            label: 'Prodotti in riordino',
            value: String(dashboardStats.prodottiInRiordino),
            trend: `stock <= ${dashboardStats.sogliaRiordino}`
          },
          {
            label: 'Clienti in salone',
            value: String(dashboardStats.clientiInSalone),
            trend: `${slotStart}-${slotEnd}`
          }
        ];
        this.cdr.detectChanges();
      },
      error: (error) => {
        console.error('Errore nel recupero delle statistiche dashboard:', error);
      }
    });
  }

  private formatCurrency(value: number): string {
    return new Intl.NumberFormat('it-IT', {
      style: 'currency',
      currency: 'EUR'
    }).format(value || 0);
  }

  private formatTime(value: string): string {
    const [, time = ''] = value.split('T');
    return time.slice(0, 5);
  }

  readonly focusCards = [
    {
      title: 'Agenda del giorno',
      text: 'Vista rapida degli slot, ritardi e conferme prenotazione da gestire in reception.'
    },
    {
      title: 'Movimenti cassa',
      text: 'Controllo incassi, metodi di pagamento e chiusura operativa di fine giornata.'
    },
    {
      title: 'Magazzino attivo',
      text: 'Monitoraggio prodotti professionali, vendita retail e soglie minime di riordino.'
    }
  ];
}

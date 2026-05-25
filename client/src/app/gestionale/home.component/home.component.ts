import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  OnInit,
  ViewChild
} from '@angular/core';
import { RouterModule } from '@angular/router';
import { SidenavComponent } from '../sidenav.component/sidenav.component';
import { DashboardService, DashboardStats } from '../../services/dashboard';

interface DashboardActionCard {
  title: string;
  text: string;
  ctaLabel: string;
  route: string;
  icon: string;
}

interface DashboardQuickReminder {
  title: string;
  detail: string;
  meta: string;
  badge: string;
  route: string;
  queryParams?: Record<string, string | number>;
  icon: string;
  tone: 'now' | 'soon' | 'stock' | 'cash' | 'quiet';
}

@Component({
  selector: 'app-home.component',
  standalone: true,
  imports: [CommonModule, RouterModule, SidenavComponent],
  templateUrl: './home.component.html',
  styleUrl: './home.component.css',
})
export class HomeComponent implements AfterViewInit, OnDestroy, OnInit {
  constructor(private readonly dashboardService: DashboardService, private cdr: ChangeDetectorRef) {}

  @ViewChild('contentScroll') private contentScroll?: ElementRef<HTMLElement>;

  private readonly contentScrollStorageKey = 'gestionale_dashboard_content_scroll_top';
  private readonly contentScrollRestoreDelays = [0, 50, 150, 350, 700, 1100];
  private contentScrollTimeouts: ReturnType<typeof setTimeout>[] = [];
  private contentScrollFrameIds: number[] = [];
  private dashboardRefreshTimeout: ReturnType<typeof setTimeout> | null = null;
  private contentResizeObserver?: ResizeObserver;
  private isRestoringContentScroll = true;

  isSidenavCollapsed = false;
  quickReminders: DashboardQuickReminder[] = [
    {
      title: 'Caricamento promemoria',
      detail: 'Sto preparando appuntamenti, clienti in arrivo e controlli rapidi.',
      meta: 'Dashboard in tempo reale',
      badge: 'Ora',
      route: '/gestionale/appuntamenti',
      icon: 'bi-arrow-repeat',
      tone: 'quiet'
    }
  ];

  toggleSidenav(): void {
    this.persistContentScrollPosition();
    this.isSidenavCollapsed = !this.isSidenavCollapsed;
  }
  stats = [
    { label: 'Appuntamenti oggi', value: '-', trend: 'calcolo dal calendario' },
    { label: 'Incasso registrato', value: '-', trend: 'pagamenti di oggi' },
    { label: 'Incasso previsto', value: '-', trend: 'servizi prenotati oggi' },
    { label: 'Prodotti da riordinare', value: '-', trend: 'attenzione scorte' },
    { label: 'Clienti in salone', value: '-', trend: 'fascia oraria corrente' }
  ];

  ngAfterViewInit(): void {
    this.observeContentScrollSize();
    this.scheduleContentScrollRestore();
  }

  ngOnInit(): void {
    this.loadDashboardStats();
  }

  ngOnDestroy(): void {
    this.clearDashboardRefreshTimeout();
    this.clearContentScrollTimeouts();
    this.clearContentScrollAnimationFrames();
    this.contentResizeObserver?.disconnect();
    this.contentResizeObserver = undefined;
    this.persistContentScrollPosition();
  }

  private loadDashboardStats(): void {
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
            trend: `riordino < ${dashboardStats.sogliaRiordino}`
          },
          {
            label: 'Clienti in salone',
            value: String(dashboardStats.clientiInSalone),
            trend: `${slotStart}-${slotEnd}`
          }
        ];
        this.quickReminders = this.buildQuickReminders(dashboardStats);
        this.cdr.detectChanges();
        this.scheduleContentScrollRestore();
        this.scheduleNextDashboardRefresh();
      },
      error: (error) => {
        console.error('Errore nel recupero delle statistiche dashboard:', error);
        this.scheduleNextDashboardRefresh();
      }
    });
  }

  private scheduleNextDashboardRefresh(): void {
    this.clearDashboardRefreshTimeout();
    this.dashboardRefreshTimeout = setTimeout(() => {
      this.loadDashboardStats();
    }, this.getMillisecondsUntilNextHalfHour());
  }

  private clearDashboardRefreshTimeout(): void {
    if (this.dashboardRefreshTimeout) {
      clearTimeout(this.dashboardRefreshTimeout);
      this.dashboardRefreshTimeout = null;
    }
  }

  private getMillisecondsUntilNextHalfHour(now = new Date()): number {
    const next = new Date(now);
    const nextMinutes = now.getMinutes() < 30 ? 30 : 60;

    next.setMinutes(nextMinutes, 0, 0);

    return Math.max(next.getTime() - now.getTime(), 1000);
  }

  @HostListener('window:beforeunload')
  @HostListener('window:pagehide')
  persistContentScrollBeforeUnload(): void {
    this.persistContentScrollPosition();
  }

  onContentScroll(): void {
    if (this.isRestoringContentScroll) {
      return;
    }

    this.persistContentScrollPosition();
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

  private persistContentScrollPosition(): void {
    const contentElement = this.contentScroll?.nativeElement;

    if (!contentElement) {
      return;
    }

    this.setStoredContentScrollTop(contentElement.scrollTop);
  }

  private restoreContentScrollPosition(): void {
    const contentElement = this.contentScroll?.nativeElement;

    if (!contentElement) {
      return;
    }

    const savedScrollTop = this.getStoredContentScrollTop();

    if (Number.isFinite(savedScrollTop)) {
      const maxScrollTop = Math.max(contentElement.scrollHeight - contentElement.clientHeight, 0);
      contentElement.scrollTop = Math.min(Math.max(savedScrollTop, 0), maxScrollTop);
    }
  }

  private scheduleContentScrollRestore(): void {
    this.clearContentScrollTimeouts();
    this.isRestoringContentScroll = true;
    this.restoreContentScrollInAnimationFrames(6);

    this.contentScrollRestoreDelays.forEach((delay, index) => {
      const timeout = setTimeout(() => {
        this.restoreContentScrollPosition();

        if (index === this.contentScrollRestoreDelays.length - 1) {
          this.isRestoringContentScroll = false;
          this.contentScrollTimeouts = [];
        }
      }, delay);

      this.contentScrollTimeouts.push(timeout);
    });
  }

  private restoreContentScrollInAnimationFrames(framesLeft: number): void {
    if (framesLeft <= 0 || typeof window === 'undefined' || !window.requestAnimationFrame) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      this.restoreContentScrollPosition();
      this.restoreContentScrollInAnimationFrames(framesLeft - 1);
    });

    this.contentScrollFrameIds.push(frameId);
  }

  private clearContentScrollTimeouts(): void {
    this.contentScrollTimeouts.forEach((timeout) => clearTimeout(timeout));
    this.contentScrollTimeouts = [];
  }

  private clearContentScrollAnimationFrames(): void {
    if (typeof window !== 'undefined' && window.cancelAnimationFrame) {
      this.contentScrollFrameIds.forEach((frameId) => window.cancelAnimationFrame(frameId));
    }

    this.contentScrollFrameIds = [];
  }

  private observeContentScrollSize(): void {
    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    const contentElement = this.contentScroll?.nativeElement;

    if (!contentElement) {
      return;
    }

    this.contentResizeObserver = new ResizeObserver(() => {
      this.restoreContentScrollPosition();
    });
    this.contentResizeObserver.observe(contentElement);
  }

  private setStoredContentScrollTop(scrollTop: number): void {
    const value = String(scrollTop);

    this.getBrowserStorage('localStorage')?.setItem(this.contentScrollStorageKey, value);
    this.getBrowserStorage('sessionStorage')?.setItem(this.contentScrollStorageKey, value);
  }

  private getStoredContentScrollTop(): number {
    const storedValue =
      this.getBrowserStorage('localStorage')?.getItem(this.contentScrollStorageKey) ??
      this.getBrowserStorage('sessionStorage')?.getItem(this.contentScrollStorageKey) ??
      '0';

    return Number(storedValue);
  }

  private getBrowserStorage(storageName: 'localStorage' | 'sessionStorage'): Storage | null {
    if (typeof window === 'undefined') {
      return null;
    }

    try {
      return window[storageName];
    } catch {
      return null;
    }
  }

  private buildQuickReminders(dashboardStats: DashboardStats): DashboardQuickReminder[] {
    const appointmentReminders = (dashboardStats.promemoria?.appuntamenti || []).map((appointment) => {
      const isCurrent = appointment.stato === 'in_corso';

      return {
        title: appointment.clienteNome,
        detail: `${appointment.servizio} con ${appointment.operatoreNome}`,
        meta: `${appointment.ora}-${appointment.oraFine}`,
        badge: isCurrent ? 'Adesso' : 'In arrivo',
        route: '/gestionale/appuntamenti',
        icon: isCurrent ? 'bi-scissors' : 'bi-clock-history',
        tone: isCurrent ? 'now' : 'soon'
      } satisfies DashboardQuickReminder;
    });

    const productReminders = (dashboardStats.promemoria?.prodotti || []).map((product) => ({
      title: product.nome,
      detail: 'Prodotto sotto soglia da controllare in magazzino.',
      meta: `${product.quantita} pezzi rimasti`,
      badge: 'Scorte',
      route: '/gestionale/magazzino',
      queryParams: { prodotto: product.idProdotto, edit: 1 },
      icon: 'bi-box-seam',
      tone: 'stock'
    } satisfies DashboardQuickReminder));

    const cashReminder: DashboardQuickReminder[] = dashboardStats.incassoPrevistoAppuntamenti > dashboardStats.incassoGiornaliero
      ? [{
        title: 'Incassi da verificare',
        detail: 'Il previsto degli appuntamenti supera l’incasso registrato.',
        meta: this.formatCurrency(dashboardStats.incassoPrevistoAppuntamenti - dashboardStats.incassoGiornaliero),
        badge: 'Cassa',
        route: '/gestionale/cassa',
        icon: 'bi-receipt',
        tone: 'cash'
      }]
      : [];

    const reminders = [...appointmentReminders, ...cashReminder, ...productReminders];

    if (reminders.length > 0) {
      return reminders;
    }

    return [
      {
        title: 'Nessuna urgenza adesso',
        detail: 'Non risultano clienti in arrivo nelle prossime ore o prodotti critici.',
        meta: dashboardStats.slotCorrente.inizio ? `${this.formatTime(dashboardStats.slotCorrente.inizio)}-${this.formatTime(dashboardStats.slotCorrente.fine)}` : 'Ora',
        badge: 'Ok',
        route: '/gestionale/appuntamenti',
        icon: 'bi-check2-circle',
        tone: 'quiet'
      }
    ];
  }

  readonly focusCards: DashboardActionCard[] = [
    {
      title: 'Agenda del giorno',
      text: 'Vista rapida delle fasce orarie, ritardi e conferme prenotazione da gestire al banco.',
      ctaLabel: 'Apri agenda',
      route: '/gestionale/appuntamenti',
      icon: 'bi-calendar2-week'
    },
    {
      title: 'Movimenti cassa',
      text: 'Controllo incassi, metodi di pagamento e chiusura operativa di fine giornata.',
      ctaLabel: 'Vai alla cassa',
      route: '/gestionale/cassa',
      icon: 'bi-receipt'
    },
    {
      title: 'Magazzino attivo',
      text: 'Monitoraggio prodotti professionali, vendita al banco e soglie minime di riordino.',
      ctaLabel: 'Controlla magazzino',
      route: '/gestionale/magazzino',
      icon: 'bi-box-seam'
    }
  ];

}

import { CommonModule } from '@angular/common';
import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, EventEmitter, HostListener, Input, OnDestroy, OnInit, Output, ViewChild } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService, AuthUserSummary } from '../../services/auth';

let lastKnownNavScrollTop: number | null = null;

interface SideNavItem {
  label: string;
  href: string;
  description: string;
  badge?: string;
  titolareOnly?: boolean;
}

interface SideNavSection {
  title: string;
  items: SideNavItem[];
}

interface OpeningInterval {
  start: string;
  end: string;
}

interface DailySchedule {
  name: string;
  intervals: OpeningInterval[];
}

@Component({
  selector: 'app-sidenav',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './sidenav.component.html',
  styleUrl: './sidenav.component.css',
})
export class SidenavComponent implements AfterViewInit, OnDestroy, OnInit {
  @Input() isCollapsed = false;
  @Output() collapsedChange = new EventEmitter<boolean>();
  @ViewChild('navScroll') private navScroll?: ElementRef<HTMLElement>;

  private readonly navScrollStorageKey = 'gestionale_sidenav_scroll_top';
  private readonly windowScrollStorageKeyPrefix = 'gestionale_sidenav_window_scroll_y';
  private readonly navScrollRestoreDelays = [0, 50, 150, 350, 700, 1100];
  private restoreScrollTimeouts: ReturnType<typeof setTimeout>[] = [];
  private restoreAnimationFrameIds: number[] = [];
  private navResizeObserver?: ResizeObserver;
  private salonStatusTimer: ReturnType<typeof setInterval> | null = null;
  private isRestoringNavScroll = true;
  private readonly persistNavScrollFromNativeScroll = () => {
    this.persistNavScrollPosition();
  };
  private readonly persistNavScrollFromNativeInteraction = () => {
    this.persistNavScrollPosition(true);
  };

  constructor(
    private readonly router: Router,
    private readonly auth: AuthService,
    private readonly cdr: ChangeDetectorRef
  ) {}

  private readonly openingSchedule: Record<number, DailySchedule> = {
    0: { name: 'Domenica', intervals: [] },
    1: { name: 'Lunedi', intervals: [] },
    2: { name: 'Martedi', intervals: [{ start: '08:00', end: '12:30' }, { start: '14:00', end: '19:30' }] },
    3: { name: 'Mercoledi', intervals: [{ start: '13:00', end: '21:30' }] },
    4: { name: 'Giovedi', intervals: [{ start: '08:00', end: '12:30' }, { start: '14:00', end: '19:30' }] },
    5: { name: 'Venerdi', intervals: [{ start: '07:00', end: '19:30' }] },
    6: { name: 'Sabato', intervals: [{ start: '07:00', end: '18:00' }] }
  };

  isSalonOpen = false;
  salonStatusTitle = 'Salone non operativo';
  salonStatusCopy = 'Fuori dagli orari di apertura';
  currentUser: AuthUserSummary | null = null;

  sections: SideNavSection[] = [];

  private readonly allSections: SideNavSection[] = [
    {
      title: 'Operativita',
      items: [
        {
          label: 'Dashboard',
          href: '/gestionale',
          description: 'Panoramica della giornata',
        },
        {
          label: 'Appuntamenti',
          href: '/gestionale/appuntamenti',
          description: 'Agenda, conferme e accoglienza',
        },
        {
          label: 'Cassa',
          href: '/gestionale/cassa',
          description: 'Incassi, pagamenti e chiusura',
        },
        {
          label: 'Clienti',
          href: '/gestionale/clienti',
          description: 'Schede cliente e storico',
        }
      ]
    },
    {
      title: 'Attivita',
      items: [
        {
          label: 'Report',
          href: '/gestionale/report',
          description: 'Vendite, rendimento e indicatori',
          titolareOnly: true,
        },
        {
          label: 'Magazzino',
          href: '/gestionale/magazzino',
          description: 'Scorte, movimenti e riordino',
        },
        {
          label: 'Servizi',
          href: '/gestionale/servizi',
          description: 'Listino, durate e disponibilita',
        },
        {
          label: 'Fornitori',
          href: '/gestionale/fornitori',
          description: 'Anagrafica e ordini acquisto',
        }
      ]
    },
    {
      title: 'Configurazione',
      items: [
        {
          label: 'Personale',
          href: '/gestionale/staff',
          description: 'Operatori e permessi',
          titolareOnly: true,
        }
      ]
    }
  ];

  toggleCollapsed(): void {
    this.persistNavScrollPosition(true);
    this.isCollapsed = !this.isCollapsed;
    this.collapsedChange.emit(this.isCollapsed);
  }

  ngOnInit(): void {
    this.currentUser = this.auth.currentUser();
    this.sections = this.buildVisibleSections();
    this.updateSalonStatus();
    this.salonStatusTimer = setInterval(() => this.updateSalonStatus(), 15000);
  }

  ngAfterViewInit(): void {
    this.bindNativeNavScrollPersistence();
    this.observeNavScrollSize();
    this.scheduleNavScrollRestore();
  }

  ngOnDestroy(): void {
    if (this.salonStatusTimer) {
      clearInterval(this.salonStatusTimer);
      this.salonStatusTimer = null;
    }

    this.unbindNativeNavScrollPersistence();
    this.clearRestoreTimeouts();
    this.clearRestoreAnimationFrames();
    this.navResizeObserver?.disconnect();
    this.navResizeObserver = undefined;

    this.persistNavScrollPosition();
  }

  @HostListener('window:beforeunload')
  @HostListener('window:pagehide')
  persistNavScrollBeforeUnload(): void {
    this.persistNavScrollPosition();
    this.persistWindowScrollPosition();
  }

  @HostListener('window:scroll')
  onWindowScroll(): void {
    this.persistWindowScrollPosition();
  }

  @HostListener('window:focus')
  @HostListener('document:visibilitychange')
  refreshSalonStatus(): void {
    this.updateSalonStatus();
  }

  onNavScroll(): void {
    this.persistNavScrollPosition();
  }

  rememberNavPosition(): void {
    this.persistNavScrollPosition(true);
    this.persistWindowScrollPosition();
  }

  get accountDisplayName(): string {
    const fullName = `${this.currentUser?.nome || ''} ${this.currentUser?.cognome || ''}`.trim();
    return fullName || this.currentUser?.email || 'Account gestionale';
  }

  get accountInitials(): string {
    const source = this.accountDisplayName || this.currentUser?.email || 'GP';
    const parts = source
      .split(/\s+/)
      .map((part) => part.trim())
      .filter(Boolean);

    if (parts.length >= 2) {
      return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase();
    }

    return source.slice(0, 2).toUpperCase();
  }

  get accountRoleLabel(): string {
    const role = this.currentUser?.ruolo || 'utente';
    return role === 'titolare' ? 'Titolare' : role === 'operatore' ? 'Operatore' : role;
  }

  changeAccount(): void {
    this.persistNavScrollPosition(true);
    this.persistWindowScrollPosition();
    this.auth.logout();
  }

  private buildVisibleSections(): SideNavSection[] {
    return this.allSections
      .map((section) => ({
        ...section,
        items: section.items.filter((item) => !item.titolareOnly || this.auth.isTitolare())
      }))
      .filter((section) => section.items.length > 0);
  }

  isItemActive(href: string): boolean {
    if (href === '/gestionale') {
      return this.router.url === href;
    }

    return this.router.url === href || this.router.url.startsWith(`${href}/`);
  }

  private updateSalonStatus(now = new Date()): void {
    const dayOfWeek = now.getDay();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const todaySchedule = this.openingSchedule[dayOfWeek];
    const activeInterval = todaySchedule?.intervals.find((interval) => this.isMinuteWithinInterval(currentMinutes, interval));

    this.isSalonOpen = Boolean(activeInterval);

    if (activeInterval) {
      this.salonStatusTitle = 'Salone operativo';
      this.salonStatusCopy = `Aperto fino alle ${activeInterval.end}`;
      this.cdr.detectChanges();
      return;
    }

    this.salonStatusTitle = 'Salone non operativo';
    this.salonStatusCopy = this.buildClosedStatusCopy(dayOfWeek, currentMinutes);
    this.cdr.detectChanges();
  }

  private buildClosedStatusCopy(dayOfWeek: number, currentMinutes: number): string {
    const todaySchedule = this.openingSchedule[dayOfWeek];
    const nextIntervalToday = todaySchedule?.intervals.find(
      (interval) => this.timeToMinutes(interval.start) > currentMinutes
    );

    if (nextIntervalToday) {
      return `Apre alle ${nextIntervalToday.start}`;
    }

    const nextOpening = this.findNextOpening(dayOfWeek);
    return nextOpening
      ? `Riapre ${nextOpening.dayLabel} alle ${nextOpening.time}`
      : 'Fuori dagli orari di apertura';
  }

  private findNextOpening(dayOfWeek: number): { dayLabel: string; time: string } | null {
    for (let offset = 1; offset <= 7; offset += 1) {
      const scheduleDay = (dayOfWeek + offset) % 7;
      const schedule = this.openingSchedule[scheduleDay];
      const firstInterval = schedule?.intervals[0];

      if (firstInterval) {
        return {
          dayLabel: offset === 1 ? 'domani' : schedule.name.toLowerCase(),
          time: firstInterval.start
        };
      }
    }

    return null;
  }

  private isMinuteWithinInterval(currentMinutes: number, interval: OpeningInterval): boolean {
    const start = this.timeToMinutes(interval.start);
    const end = this.timeToMinutes(interval.end);
    return currentMinutes >= start && currentMinutes < end;
  }

  private timeToMinutes(time: string): number {
    const [hours = '0', minutes = '0'] = time.split(':');
    return Number(hours) * 60 + Number(minutes);
  }

  private persistNavScrollPosition(force = false): void {
    const navElement = this.navScroll?.nativeElement;

    if (!navElement) {
      return;
    }

    const currentScrollTop = navElement.scrollTop;
    const savedScrollTop = this.getStoredNavScrollTop();

    if (!force && this.isRestoringNavScroll && currentScrollTop === 0 && savedScrollTop && savedScrollTop > 0) {
      return;
    }

    lastKnownNavScrollTop = currentScrollTop;
    this.setStoredNavScrollTop(currentScrollTop);
  }

  private restoreNavScrollPosition(): void {
    const navElement = this.navScroll?.nativeElement;

    if (!navElement) {
      return;
    }

    const savedScrollTop = this.getStoredNavScrollTop();
    const activeLinkScrollTop = this.getActiveLinkScrollTop(navElement);

    if (savedScrollTop === null && activeLinkScrollTop === null) {
      return;
    }

    const targetScrollTop = savedScrollTop && savedScrollTop > 0
      ? savedScrollTop
      : activeLinkScrollTop ?? savedScrollTop ?? 0;
    const maxScrollTop = Math.max(navElement.scrollHeight - navElement.clientHeight, 0);
    navElement.scrollTop = Math.min(Math.max(targetScrollTop, 0), maxScrollTop);
  }

  private scheduleNavScrollRestore(): void {
    this.clearRestoreTimeouts();
    this.isRestoringNavScroll = true;
    this.restoreNavScrollInAnimationFrames(6);

    this.navScrollRestoreDelays.forEach((delay, index) => {
      const timeout = setTimeout(() => {
        this.restoreNavScrollPosition();
        this.restoreWindowScrollPosition();

        if (index === this.navScrollRestoreDelays.length - 1) {
          this.isRestoringNavScroll = false;
          this.restoreScrollTimeouts = [];
          this.navResizeObserver?.disconnect();
          this.navResizeObserver = undefined;
        }
      }, delay);

      this.restoreScrollTimeouts.push(timeout);
    });
  }

  private restoreNavScrollInAnimationFrames(framesLeft: number): void {
    if (framesLeft <= 0 || typeof window === 'undefined' || !window.requestAnimationFrame) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      this.restoreNavScrollPosition();
      this.restoreWindowScrollPosition();
      this.restoreNavScrollInAnimationFrames(framesLeft - 1);
    });

    this.restoreAnimationFrameIds.push(frameId);
  }

  private clearRestoreTimeouts(): void {
    this.restoreScrollTimeouts.forEach((timeout) => clearTimeout(timeout));
    this.restoreScrollTimeouts = [];
  }

  private clearRestoreAnimationFrames(): void {
    if (typeof window !== 'undefined' && window.cancelAnimationFrame) {
      this.restoreAnimationFrameIds.forEach((frameId) => window.cancelAnimationFrame(frameId));
    }

    this.restoreAnimationFrameIds = [];
  }

  private observeNavScrollSize(): void {
    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    const navElement = this.navScroll?.nativeElement;

    if (!navElement) {
      return;
    }

    this.navResizeObserver = new ResizeObserver(() => {
      this.restoreNavScrollPosition();
    });
    this.navResizeObserver.observe(navElement);
  }

  private getActiveLinkScrollTop(navElement: HTMLElement): number | null {
    const activeLink = navElement.querySelector<HTMLElement>('.management-sidenav__link.is-active');

    if (!activeLink) {
      return null;
    }

    const navRect = navElement.getBoundingClientRect();
    const activeRect = activeLink.getBoundingClientRect();
    const activeOffsetTop = activeRect.top - navRect.top + navElement.scrollTop;
    const centeredOffset = Math.max((navElement.clientHeight - activeLink.clientHeight) / 2, 0);

    return activeOffsetTop - centeredOffset;
  }

  private bindNativeNavScrollPersistence(): void {
    const navElement = this.navScroll?.nativeElement;

    if (!navElement) {
      return;
    }

    navElement.addEventListener('scroll', this.persistNavScrollFromNativeScroll, { passive: true });
    navElement.addEventListener('pointerdown', this.persistNavScrollFromNativeInteraction, {
      capture: true,
      passive: true
    });
    navElement.addEventListener('mousedown', this.persistNavScrollFromNativeInteraction, {
      capture: true,
      passive: true
    });
    navElement.addEventListener('touchstart', this.persistNavScrollFromNativeInteraction, {
      capture: true,
      passive: true
    });
    navElement.addEventListener('click', this.persistNavScrollFromNativeInteraction, {
      capture: true,
      passive: true
    });
  }

  private unbindNativeNavScrollPersistence(): void {
    const navElement = this.navScroll?.nativeElement;

    if (!navElement) {
      return;
    }

    navElement.removeEventListener('scroll', this.persistNavScrollFromNativeScroll);
    navElement.removeEventListener('pointerdown', this.persistNavScrollFromNativeInteraction, true);
    navElement.removeEventListener('mousedown', this.persistNavScrollFromNativeInteraction, true);
    navElement.removeEventListener('touchstart', this.persistNavScrollFromNativeInteraction, true);
    navElement.removeEventListener('click', this.persistNavScrollFromNativeInteraction, true);
  }

  private setStoredNavScrollTop(scrollTop: number): void {
    const value = String(scrollTop);

    this.getBrowserStorage('localStorage')?.setItem(this.navScrollStorageKey, value);
    this.getBrowserStorage('sessionStorage')?.setItem(this.navScrollStorageKey, value);
  }

  private getStoredNavScrollTop(): number | null {
    if (lastKnownNavScrollTop !== null) {
      return lastKnownNavScrollTop;
    }

    const storedValue =
      this.getBrowserStorage('localStorage')?.getItem(this.navScrollStorageKey) ??
      this.getBrowserStorage('sessionStorage')?.getItem(this.navScrollStorageKey);

    if (storedValue === null || storedValue === undefined) {
      return null;
    }

    return Number(storedValue);
  }

  private persistWindowScrollPosition(): void {
    if (typeof window === 'undefined') {
      return;
    }

    this.setStoredWindowScrollY(window.scrollY);
  }

  private restoreWindowScrollPosition(): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return;
    }

    const savedScrollY = this.getStoredWindowScrollY();

    if (!Number.isFinite(savedScrollY)) {
      return;
    }

    const documentElement = document.documentElement;
    const maxScrollY = Math.max(documentElement.scrollHeight - window.innerHeight, 0);

    window.scrollTo({
      top: Math.min(Math.max(savedScrollY, 0), maxScrollY),
      left: 0
    });
  }

  private setStoredWindowScrollY(scrollY: number): void {
    const value = String(scrollY);
    const storageKey = this.getWindowScrollStorageKey();

    this.getBrowserStorage('localStorage')?.setItem(storageKey, value);
    this.getBrowserStorage('sessionStorage')?.setItem(storageKey, value);
  }

  private getStoredWindowScrollY(): number {
    const storageKey = this.getWindowScrollStorageKey();
    const storedValue =
      this.getBrowserStorage('localStorage')?.getItem(storageKey) ??
      this.getBrowserStorage('sessionStorage')?.getItem(storageKey) ??
      '0';

    return Number(storedValue);
  }

  private getWindowScrollStorageKey(): string {
    const pathname = typeof window !== 'undefined' ? window.location.pathname : 'gestionale';
    return `${this.windowScrollStorageKeyPrefix}:${pathname}`;
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
}

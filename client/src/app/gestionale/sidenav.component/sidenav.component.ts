import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, ElementRef, EventEmitter, HostListener, Input, OnDestroy, Output, ViewChild } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

let lastKnownNavScrollTop: number | null = null;

interface SideNavItem {
  label: string;
  href: string;
  description: string;
  badge?: string;
}

interface SideNavSection {
  title: string;
  items: SideNavItem[];
}

@Component({
  selector: 'app-sidenav',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './sidenav.component.html',
  styleUrl: './sidenav.component.css',
})
export class SidenavComponent implements AfterViewInit, OnDestroy {
  @Input() isCollapsed = false;
  @Output() collapsedChange = new EventEmitter<boolean>();
  @ViewChild('navScroll') private navScroll?: ElementRef<HTMLElement>;

  private readonly navScrollStorageKey = 'gestionale_sidenav_scroll_top';
  private readonly windowScrollStorageKeyPrefix = 'gestionale_sidenav_window_scroll_y';
  private readonly navScrollRestoreDelays = [0, 50, 150, 350, 700, 1100];
  private restoreScrollTimeouts: ReturnType<typeof setTimeout>[] = [];
  private restoreAnimationFrameIds: number[] = [];
  private navResizeObserver?: ResizeObserver;
  private isRestoringNavScroll = true;
  private readonly persistNavScrollFromNativeScroll = () => {
    this.persistNavScrollPosition();
  };
  private readonly persistNavScrollFromNativeInteraction = () => {
    this.persistNavScrollPosition(true);
  };

  constructor(private readonly router: Router) {}

  readonly sections: SideNavSection[] = [
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
          description: 'Agenda, conferme e check-in',
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
      title: 'Business',
      items: [
        {
          label: 'Report',
          href: '/gestionale/report',
          description: 'Vendite, performance e KPI',
        },
        {
          label: 'Magazzino',
          href: '/gestionale/magazzino',
          description: 'Scorte, movimenti e riordino',
          badge: 'Stock',
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
          label: 'Staff',
          href: '/gestionale/staff',
          description: 'Operatori e permessi',
        },
        {
          label: 'Promozioni',
          href: '/gestionale/promozioni',
          description: 'Coupon, pacchetti e offerte',
        },
        {
          label: 'Impostazioni',
          href: '/gestionale/impostazioni',
          description: 'Parametri salone e preferenze',
        }
      ]
    }
  ];

  toggleCollapsed(): void {
    this.persistNavScrollPosition(true);
    this.isCollapsed = !this.isCollapsed;
    this.collapsedChange.emit(this.isCollapsed);
  }

  ngAfterViewInit(): void {
    this.bindNativeNavScrollPersistence();
    this.observeNavScrollSize();
    this.scheduleNavScrollRestore();
  }

  ngOnDestroy(): void {
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

  onNavScroll(): void {
    this.persistNavScrollPosition();
  }

  rememberNavPosition(): void {
    this.persistNavScrollPosition(true);
    this.persistWindowScrollPosition();
  }

  navigateTo(event: MouseEvent, href: string): void {
    this.rememberNavPosition();

    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
      return;
    }

    event.preventDefault();

    if (this.router.url !== href) {
      void this.router.navigateByUrl(href);
    }
  }

  isItemActive(href: string): boolean {
    if (href === '/gestionale') {
      return this.router.url === href;
    }

    return this.router.url === href || this.router.url.startsWith(`${href}/`);
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

import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

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
  imports: [CommonModule, RouterLink, RouterLinkActive],
  templateUrl: './sidenav.component.html',
  styleUrl: './sidenav.component.css',
})
export class SidenavComponent {
  @Input() isCollapsed = false;
  @Output() collapsedChange = new EventEmitter<boolean>();

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
          badge: 'Oggi',
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
    this.isCollapsed = !this.isCollapsed;
    this.collapsedChange.emit(this.isCollapsed);
  }
}

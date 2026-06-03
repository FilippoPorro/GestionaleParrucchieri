import { Component, Input } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { Servizio } from '../../../models/servizio.model';

@Component({
  selector: 'app-service-card',
  standalone: true,
  imports: [CurrencyPipe, RouterModule],
  templateUrl: './service-card.component.html',
  styleUrls: ['./service-card.component.css']
})
export class ServiceCardComponent {
  private readonly salonPhoneHref = 'tel:+393478085277';

  @Input() service!: Servizio;

  constructor(private router: Router) { }

  get durationLabel(): string {
    const rawDuration = this.service?.durata?.trim();

    if (!rawDuration) {
      return 'Durata su richiesta';
    }

    const normalized = rawDuration.toLowerCase();

    if (
      normalized.includes('min') ||
      normalized.includes('ora') ||
      normalized.includes('circa') ||
      normalized.includes('/')
    ) {
      return rawDuration;
    }

    return `${rawDuration} min`;
  }

  get bookingBadge(): string {
    switch (this.service.tipoPrenotazione) {
      case 'telefono':
        return 'Prenotazione telefonica';
      case 'consulenza':
        return 'Prenotazione con consulenza';
      default:
        return 'Prenotabile dal sito';
    }
  }

  get buttonLabel(): string {
    switch (this.service.tipoPrenotazione) {
      case 'telefono':
        return 'Chiama';
      case 'consulenza':
        return 'Richiedi consulenza';
      default:
        return 'Aggiungi';
    }
  }

  get buttonTitle(): string {
    if (this.service.tipoPrenotazione === 'consulenza') {
      return 'Questo servizio puo essere prenotato solo dopo una consulenza.';
    }

    if (this.service.tipoPrenotazione === 'telefono') {
      return 'Chiama il salone per prenotare questo servizio.';
    }

    return 'Aggiungi il servizio alla prenotazione';
  }

  openDetails(event?: Event): void {
    event?.preventDefault();
    this.router.navigate(['/service', this.service.idServizio]);
  }

  addToCart(event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();

    if (this.service.tipoPrenotazione !== 'sito') {
      return;
    }

    this.router.navigate(['/appointments'], {
      queryParams: {
        servizio: this.service.idServizio
      }
    });
  }

  callSalon(event?: Event): void {
    event?.stopPropagation();
    window.location.href = this.salonPhoneHref;
  }

  requestConsultation(event?: Event): void {
    event?.stopPropagation();
    window.location.href = this.salonPhoneHref;
  }
}

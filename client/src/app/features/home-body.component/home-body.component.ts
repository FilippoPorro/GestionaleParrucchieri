import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ChatUiService } from '../../services/chat-ui';
import { NavbarComponent } from "../navbar.component/navbar.component";
import { RouterLink, RouterLinkActive } from "@angular/router";
import { FooterComponent } from '../footer.component/footer.component';

@Component({
  selector: 'app-home-body',
  standalone: true,
  imports: [CommonModule, NavbarComponent, RouterLink, RouterLinkActive, FooterComponent],
  templateUrl: './home-body.component.html',
  styleUrl: './home-body.component.css',
})
export class HomeBodyComponent implements AfterViewInit, OnDestroy {
  @ViewChild('servicesCarousel') servicesCarousel?: ElementRef<HTMLElement>;

  chatUi = inject(ChatUiService);
  private servicesLoopResetTimer?: number;
  private servicesAutoSlideTimer?: number;
  private servicesInteractionResumeTimer?: number;
  private readonly servicesAutoSlideDelay = 4200;
  private readonly servicesInteractionResumeDelay = 3200;

  ngAfterViewInit(): void {
    this.startServicesAutoplay();
  }

  openAiFromCard() {
    this.chatUi.open('card');
  }

  nextServicesSlide(): void {
    const carousel = this.servicesCarousel?.nativeElement;

    if (!carousel || !this.isMobileServicesCarousel()) {
      return;
    }

    const realCards = this.getRealServiceCards(carousel);
    const clone = carousel.querySelector<HTMLElement>('.service-card.is-carousel-clone');

    if (!realCards.length || !clone) {
      return;
    }

    const currentLeft = carousel.scrollLeft;
    const nextCard = realCards.find((card) => this.getCardScrollLeft(card, carousel) > currentLeft + 8);
    const targetLeft = nextCard
      ? this.getCardScrollLeft(nextCard, carousel)
      : this.getCardScrollLeft(clone, carousel);

    carousel.scrollTo({ left: targetLeft, behavior: 'smooth' });

    if (!nextCard) {
      this.scheduleServicesLoopReset(carousel, 560);
    }
  }

  handleServicesScroll(): void {
    const carousel = this.servicesCarousel?.nativeElement;

    if (!carousel || !this.isMobileServicesCarousel()) {
      return;
    }

    const clone = carousel.querySelector<HTMLElement>('.service-card.is-carousel-clone');

    if (clone && carousel.scrollLeft >= this.getCardScrollLeft(clone, carousel) - 8) {
      this.scheduleServicesLoopReset(carousel, 90);
    }
  }

  pauseServicesCarousel(): void {
    if (!this.isMobileServicesCarousel()) {
      return;
    }

    this.stopServicesAutoplay();

    if (this.servicesInteractionResumeTimer) {
      window.clearTimeout(this.servicesInteractionResumeTimer);
      this.servicesInteractionResumeTimer = undefined;
    }
  }

  resumeServicesCarousel(): void {
    if (!this.isMobileServicesCarousel()) {
      return;
    }

    if (this.servicesInteractionResumeTimer) {
      window.clearTimeout(this.servicesInteractionResumeTimer);
    }

    this.servicesInteractionResumeTimer = window.setTimeout(() => {
      this.startServicesAutoplay();
    }, this.servicesInteractionResumeDelay);
  }

  ngOnDestroy(): void {
    if (this.servicesLoopResetTimer) {
      window.clearTimeout(this.servicesLoopResetTimer);
    }

    if (this.servicesInteractionResumeTimer) {
      window.clearTimeout(this.servicesInteractionResumeTimer);
    }

    this.stopServicesAutoplay();
  }

  private startServicesAutoplay(): void {
    if (!this.isBrowser() || this.servicesAutoSlideTimer) {
      return;
    }

    this.servicesAutoSlideTimer = window.setInterval(() => {
      this.nextServicesSlide();
    }, this.servicesAutoSlideDelay);
  }

  private stopServicesAutoplay(): void {
    if (!this.servicesAutoSlideTimer || !this.isBrowser()) {
      return;
    }

    window.clearInterval(this.servicesAutoSlideTimer);
    this.servicesAutoSlideTimer = undefined;
  }

  private scheduleServicesLoopReset(carousel: HTMLElement, delay: number): void {
    if (this.servicesLoopResetTimer) {
      window.clearTimeout(this.servicesLoopResetTimer);
    }

    this.servicesLoopResetTimer = window.setTimeout(() => {
      const previousScrollBehavior = carousel.style.scrollBehavior;
      const previousScrollSnapType = carousel.style.scrollSnapType;

      carousel.style.scrollBehavior = 'auto';
      carousel.style.scrollSnapType = 'none';
      carousel.scrollLeft = 0;

      window.requestAnimationFrame(() => {
        carousel.style.scrollBehavior = previousScrollBehavior;
        carousel.style.scrollSnapType = previousScrollSnapType;
      });
    }, delay);
  }

  private getRealServiceCards(carousel: HTMLElement): HTMLElement[] {
    return Array.from(carousel.querySelectorAll<HTMLElement>('.service-card:not(.is-carousel-clone)'));
  }

  private getCardScrollLeft(card: HTMLElement, carousel: HTMLElement): number {
    return card.offsetLeft - carousel.offsetLeft;
  }

  private isMobileServicesCarousel(): boolean {
    return this.isBrowser() && window.matchMedia('(max-width: 768px)').matches;
  }

  private isBrowser(): boolean {
    return typeof window !== 'undefined';
  }
}

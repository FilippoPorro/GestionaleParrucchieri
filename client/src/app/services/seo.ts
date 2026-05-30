import { DOCUMENT } from '@angular/common';
import { inject, Injectable } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';
import { filter, map } from 'rxjs';

export interface SeoData {
  title?: string;
  description?: string;
  robots?: string;
}

const SITE_URL = 'https://sito-parrucchieri-seven.vercel.app';
const DEFAULT_TITLE = 'I Parrucchieri - Fossano';
const DEFAULT_DESCRIPTION =
  'I Parrucchieri a Fossano: scopri servizi, prodotti professionali e prenota online il tuo appuntamento in salone.';

@Injectable({ providedIn: 'root' })
export class SeoService {
  private readonly router = inject(Router);
  private readonly activatedRoute = inject(ActivatedRoute);
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);
  private readonly document = inject(DOCUMENT);

  init(): void {
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        map(() => this.getDeepestRoute(this.activatedRoute)),
      )
      .subscribe((route) => {
        const seo = (route.snapshot.data['seo'] ?? {}) as SeoData;
        const path = this.router.url.split('?')[0].split('#')[0] || '/';
        this.applySeo({
          title: seo.title ?? DEFAULT_TITLE,
          description: seo.description ?? DEFAULT_DESCRIPTION,
          robots: seo.robots ?? 'index, follow',
        }, path);
      });
  }

  private applySeo(seo: Required<SeoData>, path: string): void {
    const canonicalUrl = `${SITE_URL}${path === '/home' ? '/' : path}`;

    this.title.setTitle(seo.title);
    this.meta.updateTag({ name: 'description', content: seo.description });
    this.meta.updateTag({ name: 'robots', content: seo.robots });
    this.meta.updateTag({ property: 'og:title', content: seo.title });
    this.meta.updateTag({ property: 'og:description', content: seo.description });
    this.meta.updateTag({ property: 'og:url', content: canonicalUrl });
    this.meta.updateTag({ property: 'og:type', content: 'website' });
    this.meta.updateTag({ name: 'twitter:card', content: 'summary_large_image' });
    this.meta.updateTag({ name: 'twitter:title', content: seo.title });
    this.meta.updateTag({ name: 'twitter:description', content: seo.description });
    this.setCanonical(canonicalUrl);
  }

  private getDeepestRoute(route: ActivatedRoute): ActivatedRoute {
    let current = route;
    while (current.firstChild) {
      current = current.firstChild;
    }
    return current;
  }

  private setCanonical(url: string): void {
    let link = this.document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!link) {
      link = this.document.createElement('link');
      link.setAttribute('rel', 'canonical');
      this.document.head.appendChild(link);
    }
    link.setAttribute('href', url);
  }
}

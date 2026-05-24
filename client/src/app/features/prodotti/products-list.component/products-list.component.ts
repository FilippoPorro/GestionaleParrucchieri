import {
  Component,
  OnInit,
  OnDestroy,
  HostListener,
  ChangeDetectorRef,
  ApplicationRef
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Observable, Subscription } from 'rxjs';
import { Router } from '@angular/router';

import { NavbarComponent } from '../../navbar.component/navbar.component';
import { ProductCardComponent } from '../product-card.component/product-card.component';

import { Prodotto } from '../../../services/prodotto';
import { ProdottoService } from '../../../services/prodotto';

@Component({
  selector: 'app-products-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    NavbarComponent,
    ProductCardComponent
  ],
  templateUrl: './products-list.component.html',
  styleUrls: ['./products-list.component.css']
})
export class ProductsListComponent implements OnInit, OnDestroy {
  productsMD!: Observable<Prodotto[]>;
  allProducts: Prodotto[] = [];

  selectedCategory: string = 'all';
  searchTerm: string = '';
  categories: string[] = [];
  isCategoryOpen: boolean = false;

  showCartAlert: boolean = false;
  isClosing: boolean = false;
  cartAlertMessage: string = '';

  currentAlertProductId: number | null = null;
  contProd: number = 0;

  private alertTimeout: ReturnType<typeof setTimeout> | null = null;
  private removeAlertTimeout: ReturnType<typeof setTimeout> | null = null;
  private productsSub?: Subscription;
  private pendingCartProductIds = new Set<number>();

  constructor(
    private prodottiService: ProdottoService,
    private cdr: ChangeDetectorRef,
    private appRef: ApplicationRef,
    private router: Router
  ) { }

  ngOnInit(): void {
    this.productsMD = this.prodottiService.getProdotti();
    this.productsSub = this.productsMD.subscribe(products => {
      this.allProducts = products;
      this.categories = [...new Set(products.map(p => p.categoria))];
      this.forceUiUpdate();
    });
  }

  ngOnDestroy(): void {
    if (this.alertTimeout) {
      clearTimeout(this.alertTimeout);
    }

    if (this.removeAlertTimeout) {
      clearTimeout(this.removeAlertTimeout);
    }

    if (this.productsSub) {
      this.productsSub.unsubscribe();
    }
  }

  private forceUiUpdate(): void {
    // Strategia difensiva per UI asincrona: detectChanges immediato + tick globale
    // + passaggio nel frame successivo per sincronizzare dropdown/alert animati.
    this.cdr.detectChanges();
    this.appRef.tick();

    requestAnimationFrame(() => {
      this.cdr.detectChanges();
    });
  }

  trackById(index: number, product: Prodotto): number {
    return product.idProdotto;
  }

  toggleCategoryDropdown(): void {
    this.isCategoryOpen = !this.isCategoryOpen;
    this.forceUiUpdate();
  }

  selectCategory(category: string): void {
    this.selectedCategory = category;
    this.isCategoryOpen = false;
    this.forceUiUpdate();
  }

  getSelectedCategoryLabel(): string {
    return this.selectedCategory === 'all' ? 'Tutti' : this.selectedCategory;
  }

  getFilteredProductsCount(): number {
    return this.getFilteredProducts(this.allProducts).length;
  }

  getFilteredProducts(products: Prodotto[]): Prodotto[] {
    const query = this.normalizeSearchText(this.searchTerm);

    return products.filter(product => {
      const matchesCategory =
        this.selectedCategory === 'all' || product.categoria === this.selectedCategory;

      if (!matchesCategory) {
        return false;
      }

      if (!query) {
        return true;
      }

      return this.normalizeSearchText([
        product.nome,
        product.marca,
        product.formato,
        product.descrizione,
        product.categoria
      ].join(' ')).includes(query);
    });
  }

  clearSearch(): void {
    this.searchTerm = '';
    this.forceUiUpdate();
  }

  private normalizeSearchText(value: string): string {
    return value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
  }

  onAddToCart(product: Prodotto): void {
    if (this.pendingCartProductIds.has(product.idProdotto)) {
      return;
    }

    this.pendingCartProductIds.add(product.idProdotto);

    this.prodottiService.addProductToCart(product).subscribe({
      next: () => {
        this.pendingCartProductIds.delete(product.idProdotto);
        this.showAddedToCartAlert(product);
      },
      error: (err) => {
        this.pendingCartProductIds.delete(product.idProdotto);
        this.cartAlertMessage = err?.status === 409
          ? `${product.nome} non e piu disponibile nella quantita richiesta`
          : 'Non sono riuscito ad aggiornare il carrello';
        this.showCartAlert = true;
        this.isClosing = false;
        this.currentAlertProductId = product.idProdotto;
        this.contProd = 0;
        this.forceUiUpdate();
      }
    });
  }

  private showAddedToCartAlert(product: Prodotto): void {
    // Se l'utente aggiunge più volte lo stesso prodotto mentre il toast è visibile,
    // incrementiamo il contatore invece di riaprire un nuovo alert.
    const sameProductAlertVisible =
      this.showCartAlert && this.currentAlertProductId === product.idProdotto;

    this.showCartAlert = true;
    this.isClosing = false;
    this.currentAlertProductId = product.idProdotto;
    this.cartAlertMessage = `${product.nome} aggiunto al carrello`;

    if (sameProductAlertVisible) {
      this.contProd += 1;
    } else {
      this.contProd = 1;
    }

    if (this.alertTimeout) {
      clearTimeout(this.alertTimeout);
    }

    if (this.removeAlertTimeout) {
      clearTimeout(this.removeAlertTimeout);
    }

    this.forceUiUpdate();

    this.alertTimeout = setTimeout(() => {
      this.isClosing = true;
      this.forceUiUpdate();

      this.removeAlertTimeout = setTimeout(() => {
        this.showCartAlert = false;
        this.isClosing = false;
        this.contProd = 0;
        this.currentAlertProductId = null;
        this.forceUiUpdate();
      }, 320);
    }, 2000);
  }

  goToCart(): void {
    this.router.navigate(['/cart']);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;

    if (!target.closest('.custom-dropdown')) {
      this.isCategoryOpen = false;
      this.forceUiUpdate();
    }
  }
}

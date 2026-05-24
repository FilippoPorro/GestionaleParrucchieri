import {
  Component,
  ChangeDetectorRef,
  OnInit,
  OnDestroy,
  NgZone
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { NavbarComponent } from '../../navbar.component/navbar.component';
import { ProdottoService, Prodotto } from '../../../services/prodotto';

@Component({
  selector: 'app-product-details',
  standalone: true,
  imports: [CommonModule, NavbarComponent, RouterLink],
  templateUrl: './product-details.component.html',
  styleUrls: ['./product-details.component.css']
})
export class ProductDetailsComponent implements OnInit, OnDestroy {
  product: Prodotto | undefined;
  isImageLoading = true;
  showImageZoom = false;
  isClosingImageZoom = false;
  showError = false;
  shakeAnimation = false;
  errorMessage = '';
  private errorTimeout: any;
  showCartAlert = false;
  isClosing = false;
  shakeCart = false;
  selectedQuantity = 1;
  isAddingToCart = false;

  cartAlertMessage = '';
  contProd = 0;
  private lastAddedQuantity = 1;

  private currentAlertProductId: number | null = null;
  private alertTimeout: any;
  private removeAlertTimeout: any;
  private imageZoomCloseTimeout: any;

  constructor(
    private route: ActivatedRoute,
    private prodottoService: ProdottoService,
    private cdr: ChangeDetectorRef,
    private router: Router,
    private ngZone: NgZone
  ) { }

  ngOnInit(): void {
    const productId = Number(this.route.snapshot.paramMap.get('id'));

    if (!isNaN(productId)) {
      this.prodottoService.getProdottoById(productId).subscribe(p => {
        this.product = p;
        this.isImageLoading = !!p?.foto;
        this.showImageZoom = false;
        this.cdr.detectChanges();
      });
    }
  }

  ngOnDestroy(): void {
    clearTimeout(this.alertTimeout);
    clearTimeout(this.removeAlertTimeout);
    clearTimeout(this.errorTimeout);
    clearTimeout(this.imageZoomCloseTimeout);
  }

  addToCart(): void {
    if (!this.product || this.isAddingToCart) return;

    // Controllo lato client del limite quantità: evita UX incoerente prima della chiamata backend.
    const qty = this.prodottoService.getCartItemQuantity(this.product.idProdotto);
    const quantityToAdd = Math.max(1, Math.min(this.selectedQuantity, this.product.qta - qty));

    if (quantityToAdd <= 0 || qty + quantityToAdd > this.product.qta) {
      this.showErrorAlert(
        `Limite massimo raggiunto (${this.product.qta})`
      );
      return;
    }
    this.isAddingToCart = true;
    this.lastAddedQuantity = quantityToAdd;

    this.prodottoService.addProductToCart(this.product, quantityToAdd).subscribe({
      next: () => {
        this.isAddingToCart = false;
        this.showAddedToCartAlert();
      },
      error: (err) => {
        this.isAddingToCart = false;
        this.showErrorAlert(
          err?.status === 409
            ? 'Prodotto non piu disponibile nella quantita richiesta'
            : 'Non sono riuscito ad aggiornare il carrello'
        );
      }
    });
  }

  increaseSelectedQuantity(): void {
    if (!this.product) return;

    const alreadyReserved = this.prodottoService.getCartItemQuantity(this.product.idProdotto);
    const maxSelectable = Math.max(1, this.product.qta - alreadyReserved);

    this.selectedQuantity = Math.min(this.selectedQuantity + 1, maxSelectable);
  }

  decreaseSelectedQuantity(): void {
    this.selectedQuantity = Math.max(1, this.selectedQuantity - 1);
  }

  get canIncreaseSelectedQuantity(): boolean {
    if (!this.product) return false;

    const alreadyReserved = this.prodottoService.getCartItemQuantity(this.product.idProdotto);
    return this.selectedQuantity < Math.max(1, this.product.qta - alreadyReserved);
  }

  private showAddedToCartAlert(): void {
    if (!this.product) return;

    const sameProduct =
      this.showCartAlert &&
      this.currentAlertProductId === this.product.idProdotto;

    this.showCartAlert = true;
    this.isClosing = false;
    this.currentAlertProductId = this.product.idProdotto;
    this.cartAlertMessage = `${this.product.nome} aggiunto`;

    this.contProd = sameProduct ? this.contProd + this.lastAddedQuantity : this.lastAddedQuantity;
    this.shakeCart = false;
    this.cdr.detectChanges();

    setTimeout(() => {
      this.shakeCart = true;
      this.cdr.detectChanges();
    }, 10);

    clearTimeout(this.alertTimeout);

    // Chiusura in due fasi: prima trigger CSS di uscita, poi rimozione dal DOM.
    this.alertTimeout = setTimeout(() => {
      this.ngZone.run(() => {
        this.isClosing = true;
        this.cdr.detectChanges();

        this.removeAlertTimeout = setTimeout(() => {
          this.ngZone.run(() => {
            this.showCartAlert = false;
            this.contProd = 0;
            this.cdr.detectChanges();
          });
        }, 300);
      });
    }, 2000);
  }

  showErrorAlert(msg: string) {
    // Forziamo il passaggio in NgZone perché il flusso include timer/animazioni e vogliamo
    // garantire il refresh UI in modo prevedibile.
    this.ngZone.run(() => {
      this.errorMessage = msg;
      this.showError = true;
      this.shakeAnimation = false;
      this.cdr.detectChanges();

      setTimeout(() => {
        this.ngZone.run(() => {
          this.shakeAnimation = true;
          this.cdr.detectChanges();
        });
      }, 10);

      clearTimeout(this.errorTimeout);

      this.errorTimeout = setTimeout(() => {
        this.ngZone.run(() => {
          this.showError = false;
          this.cdr.detectChanges(); 
        });
      }, 2500);
    });
  }

  goToCart(): void {
    this.router.navigate(['/cart']);
  }

  onImageLoad(): void {
    this.isImageLoading = false;
    this.cdr.detectChanges();
  }

  onImageError(): void {
    this.isImageLoading = false;
    this.cdr.detectChanges();
  }

  openImageZoom(): void {
    if (!this.product?.foto) return;
    clearTimeout(this.imageZoomCloseTimeout);
    this.showImageZoom = true;
    this.isClosingImageZoom = false;
    this.cdr.detectChanges();
  }

  closeImageZoom(): void {
    this.isClosingImageZoom = true;
    this.cdr.detectChanges();

    // La chiusura ritardata lascia terminare l'animazione prima di rimuovere l'overlay.
    clearTimeout(this.imageZoomCloseTimeout);
    this.imageZoomCloseTimeout = setTimeout(() => {
      this.showImageZoom = false;
      this.isClosingImageZoom = false;
      this.cdr.detectChanges();
    }, 240);
  }
}


import { Component, Signal, computed, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';

import { NavbarComponent } from '../navbar.component/navbar.component';

import { Prodotto } from '../../services/prodotto';
import { ProdottoService } from '../../services/prodotto';

@Component({
  selector: 'app-cart',
  standalone: true,
  imports: [CommonModule, NavbarComponent, RouterLink],
  templateUrl: './cart.component.html',
  styleUrl: './cart.component.css',
})
export class CartComponent implements OnInit {
  cartItems: Signal<Prodotto[]>;

  differentProductsCount = computed(() => this.cartItems().length);

  totalQuantity = computed(() =>
    this.cartItems().reduce((sum, item) => sum + (item.quantita || 1), 0)
  );

  finalTotal = computed(() =>
    this.cartItems().reduce(
      (sum, item) => sum + item.prezzo * (item.quantita || 1),
      0
    )
  );
  cartExpirationLabel = computed(() => this.prodottoService.getCartExpirationLabel());

  constructor(
    private prodottoService: ProdottoService,
    private router: Router
  ) {
    this.cartItems = this.prodottoService.cart;
  }

  ngOnInit(): void {
    this.prodottoService.loadReservedCart().subscribe({ error: () => undefined });
  }

  increase(id: number): void {
    const product = this.cartItems().find(item => item.idProdotto === id);

    if (!product) return;

    const quantitaAttuale = product.quantita || 1;
    const quantitaMassima = product.qta;

    if (quantitaAttuale < quantitaMassima) {
      this.prodottoService.increaseQuantity(id).subscribe({
        error: () => alert('Quantita non piu disponibile')
      });
    }
  }

  decrease(id: number): void {
    const product = this.cartItems().find(item => item.idProdotto === id);

    if (!product) return;

    const quantitaAttuale = product.quantita || 1;

    if (quantitaAttuale > 1) {
      this.prodottoService.decreaseQuantity(id).subscribe();
    }
  }

  removeFromCart(id: number): void {
    this.prodottoService.removeProductFromCart(id).subscribe();
  }

  clearCart(): void {
    this.prodottoService.clearCart();
  }

  checkout(): void {
    const cart = this.cartItems();

    if (!cart || cart.length == 0) {
      alert('Il carrello è vuoto');
      return;
    }

    this.prodottoService.persistCheckoutSnapshot(this.finalTotal());

    if (this.cartItems().length === 0) {
      alert('Il carrello e scaduto');
      return;
    }


    this.router.navigate(['/payment']);
  }

  trackById(index: number, item: Prodotto): number {
    return item.idProdotto;
  }
}

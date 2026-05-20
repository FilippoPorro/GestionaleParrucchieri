import { Injectable, signal, WritableSignal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface Prodotto {
  idProdotto: number;
  foto: string | null;
  nome: string;
  marca: string;
  formato: string;
  descrizione: string;
  prezzoRivendita: number;
  prezzoAcquisto: number;
  prezzo: number;
  qta: number;
  categoria: string;
  quantita?: number;
}

export interface CheckoutCustomerData {
  name: string;
  surname: string;
  email: string;
  phone: string;
  shippingMethod: string;
  shippingCost: number;
  address?: string;
  city?: string;
  zip?: string;
  lockerLabel?: string;
}

@Injectable({
  providedIn: 'root'
})
export class ProdottoService {
  private readonly cartTtlMs = 10 * 60 * 1000;
  private readonly storageKey = 'cart';
  private readonly cartExpiresAtStorageKey = 'cart_expires_at';

  private _cart: WritableSignal<Prodotto[]> = signal([]);
  cart = this._cart.asReadonly();
  private _cartRemainingSeconds: WritableSignal<number> = signal(0);
  cartRemainingSeconds = this._cartRemainingSeconds.asReadonly();

  private apiUrl = 'http://localhost:3000/api/prodotti';
  private apiBaseUrl = 'http://localhost:3000';

  constructor(private http: HttpClient) {
    this.loadCart();
    this.refreshCartCountdown();
    setInterval(() => this.refreshCartCountdown(), 1000);
  }

  getProdotti(): Observable<Prodotto[]> {
    return this.http.get<any[]>(this.apiUrl).pipe(
      map(prodotti =>
        prodotti.map(p => this.mapProdotto(p))
      )
    );
  }

  createProdotto(prodotto: Partial<Prodotto>): Observable<Prodotto> {
    return this.http.post<any>(this.apiUrl, prodotto).pipe(
      map(p => this.mapProdotto(p))
    );
  }

  updateProdotto(idProdotto: number, prodotto: Partial<Prodotto>): Observable<Prodotto> {
    return this.http.put<any>(`${this.apiUrl}/${idProdotto}`, prodotto).pipe(
      map(p => this.mapProdotto(p))
    );
  }

  deleteProdotto(idProdotto: number): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.apiUrl}/${idProdotto}`);
  }

  private buildImageUrl(foto?: string | null): string {
    if (!foto) {
      return '';
    }

    if (/^https?:\/\//i.test(foto)) {
      return this.normalizeCloudinaryImage(foto);
    }

    return `${this.apiBaseUrl}${foto.startsWith('/') ? '' : '/'}${foto}`;
  }

  private normalizeCloudinaryImage(url: string): string {
    if (!/res\.cloudinary\.com/i.test(url) || !/\/image\/upload\//i.test(url)) {
      return url;
    }

    // Uniforma il canvas dei packshot senza perdere il ritaglio del prodotto.
    return url.replace(
      '/image/upload/',
      '/image/upload/e_trim/c_pad,w_900,h_900/'
    );
  }

  private loadCart() {
    if (this.isCartExpired()) {
      this.clearCart();
      return;
    }

    const data = localStorage.getItem(this.storageKey);

    if (data) {
      try {
        this._cart.set(JSON.parse(data));

        if (this._cart().length > 0 && !this.getCartExpiresAt()) {
          localStorage.setItem(
            this.cartExpiresAtStorageKey,
            `${Date.now() + this.cartTtlMs}`
          );
        }
      } catch {
        this.clearCart();
      }
    }
  }

  private saveCart() {
    if (this._cart().length === 0) {
      localStorage.removeItem(this.storageKey);
      localStorage.removeItem(this.cartExpiresAtStorageKey);
      this._cartRemainingSeconds.set(0);
      return;
    }

    if (!this.getCartExpiresAt()) {
      localStorage.setItem(
        this.cartExpiresAtStorageKey,
        `${Date.now() + this.cartTtlMs}`
      );
    }

    localStorage.setItem(this.storageKey, JSON.stringify(this._cart()));
    this.refreshCartCountdown();
  }

  private getCartExpiresAt(): number | null {
    const value = Number(localStorage.getItem(this.cartExpiresAtStorageKey));
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  private isCartExpired(): boolean {
    const expiresAt = this.getCartExpiresAt();
    return expiresAt !== null && Date.now() >= expiresAt;
  }

  private refreshCartCountdown(): void {
    const expiresAt = this.getCartExpiresAt();

    if (!expiresAt || this._cart().length === 0) {
      this._cartRemainingSeconds.set(0);
      return;
    }

    const remainingSeconds = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
    this._cartRemainingSeconds.set(remainingSeconds);

    if (remainingSeconds === 0) {
      this.clearCart();
    }
  }

  getProdottoById(id: number): Observable<Prodotto | undefined> {
    return this.getProdotti().pipe(
      map(prodotti => prodotti.find(p => p.idProdotto == id))
    );
  }

  private mapProdotto(p: any): Prodotto {
    return {
      idProdotto: p.idProdotto ?? p.id,
      foto: this.buildImageUrl(p.foto),
      nome: p.nome ?? '',
      marca: p.marca ?? '',
      formato: p.formato ?? '',
      descrizione: p.descrizione ?? '',
      prezzoRivendita: Number(p.prezzoRivendita ?? p.prezzo ?? 0),
      prezzoAcquisto: Number(p.prezzoAcquisto ?? 0),
      prezzo: Number(p.prezzoRivendita ?? p.prezzo ?? 0),
      qta: Number(p.quantitaMagazzino ?? p.qta ?? 0),
      categoria: p.categoria ?? '',
      quantita: Number(p.quantita ?? 0)
    };
  }

  addProductToCart(prod: Prodotto) {
    if (this.isCartExpired()) {
      this.clearCart();
    }

    this._cart.update(cart => {
      const existing = cart.find(p => p.idProdotto === prod.idProdotto);
      if (existing) {
        return cart.map(p =>
          p.idProdotto === prod.idProdotto
            ? { ...p, quantita: (p.quantita || 1) + 1 }
            : p
        );
      }
      return [...cart, { ...prod, quantita: 1 }];
    });
    this.saveCart();
  }

  increaseQuantity(productId: number) {
    if (this.isCartExpired()) {
      this.clearCart();
      return;
    }

    this._cart.update(cart =>
      cart.map(p =>
        p.idProdotto === productId
          ? { ...p, quantita: (p.quantita || 1) + 1 }
          : p
      )
    );
    this.saveCart();
  }

  decreaseQuantity(productId: number) {
    if (this.isCartExpired()) {
      this.clearCart();
      return;
    }

    this._cart.update(cart =>
      cart
        .map(p =>
          p.idProdotto === productId
            ? { ...p, quantita: (p.quantita || 1) - 1 }
            : p
        )
        .filter(p => (p.quantita || 1) > 0)
    );
    this.saveCart();
  }

  removeProductFromCart(productId: number | string): void {
    this._cart.update(cart =>
      cart.filter(product => product.idProdotto != productId)
    );
    this.saveCart();
  }

  clearCart(): void {
    this._cart.set([]);
    localStorage.removeItem(this.storageKey);
    localStorage.removeItem(this.cartExpiresAtStorageKey);
    localStorage.removeItem('cart_total');
    this._cartRemainingSeconds.set(0);
  }

  getCart(): Prodotto[] {
    if (this.isCartExpired()) {
      this.clearCart();
    }

    return this._cart();
  }

  getCartItemQuantity(productId: number): number {
    return this.getCart()
      .find((product) => product.idProdotto === productId)
      ?.quantita || 0;
  }

  getCartExpirationLabel(): string {
    const remainingSeconds = this.cartRemainingSeconds();

    if (remainingSeconds <= 0) {
      return '00:00';
    }

    const minutes = `${Math.floor(remainingSeconds / 60)}`.padStart(2, '0');
    const seconds = `${remainingSeconds % 60}`.padStart(2, '0');
    return `${minutes}:${seconds}`;
  }

  persistCheckoutSnapshot(total: number): void {
    if (this.isCartExpired()) {
      this.clearCart();
      return;
    }

    localStorage.setItem(this.storageKey, JSON.stringify(this._cart()));
    localStorage.setItem('cart_total', JSON.stringify(total));
  }

  getCartItemCount(): number {
    return this.getCart().reduce((sum, p) => sum + (p.quantita || 1), 0);
  }

  getCartTotal(): number {
    return this.getCart().reduce(
      (sum, p) => sum + p.prezzo * (p.quantita || 1),
      0
    );
  }

  updateStock(cartItems: Prodotto[]) {
    return this.http.post('http://localhost:3000/api/products/update-stock', cartItems);
  }

  completeCheckout(
    cartItems: Prodotto[],
    total: number,
    customer: CheckoutCustomerData
  ) {
    return this.http.post('http://localhost:3000/api/checkout/complete', {
      cartItems,
      total,
      customer
    });
  }
}

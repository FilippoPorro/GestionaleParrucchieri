import { Injectable, signal, WritableSignal } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map, tap } from 'rxjs/operators';
import { environment } from '../../environments/environment';

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

interface ReservedCartResponse {
  cartId: string | null;
  expiresAt: string | null;
  items: any[];
}

@Injectable({
  providedIn: 'root'
})
export class ProdottoService {
  private readonly cartTtlMs = 10 * 60 * 1000;
  private readonly storageKey = 'cart';
  private readonly cartExpiresAtStorageKey = 'cart_expires_at';
  private readonly cartIdStorageKey = 'cart_id';

  private _cart: WritableSignal<Prodotto[]> = signal([]);
  cart = this._cart.asReadonly();
  private _cartRemainingSeconds: WritableSignal<number> = signal(0);
  cartRemainingSeconds = this._cartRemainingSeconds.asReadonly();

  private apiUrl = `${environment.apiUrl}/prodotti`;
  private apiBaseUrl = environment.apiBaseUrl;
  private cartApiUrl = `${environment.apiUrl}/cart`;

  constructor(private http: HttpClient) {
    this.loadCart();
    this.refreshCartCountdown();
    setInterval(() => this.refreshCartCountdown(), 1000);
  }

  getProdotti(): Observable<Prodotto[]> {
    return this.http.get<any[]>(this.apiUrl, { headers: this.getCartHeaders() }).pipe(
      map(prodotti =>
        prodotti.map(p => this.mapProdotto(p))
      )
    );
  }

  loadReservedCart(): Observable<void> {
    return this.http.get<ReservedCartResponse>(this.cartApiUrl, { headers: this.getCartHeaders() }).pipe(
      tap((cart) => this.applyReservedCart(cart)),
      map(() => undefined)
    );
  }

  loadActiveUserCart(): Observable<void> {
    return this.http.get<ReservedCartResponse>(`${this.cartApiUrl}/active`).pipe(
      tap((cart) => this.applyReservedCart(cart)),
      map(() => undefined)
    );
  }

  claimCurrentCart(): Observable<void> {
    const cartId = this.getCartId();

    if (!cartId) {
      return this.loadActiveUserCart();
    }

    return this.http.post<ReservedCartResponse>(
      `${this.cartApiUrl}/claim`,
      { cartId },
      { headers: new HttpHeaders({ 'x-cart-id': cartId }) }
    ).pipe(
      tap((cart) => this.applyReservedCart(cart)),
      map(() => undefined)
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

  private getCartId(): string | null {
    return localStorage.getItem(this.cartIdStorageKey);
  }

  private ensureCartId(): string {
    const existingCartId = this.getCartId();

    if (existingCartId) {
      return existingCartId;
    }

    const cartId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : this.createFallbackUuid();

    this.setCartId(cartId);
    return cartId;
  }

  private createFallbackUuid(): string {
    return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (char) => {
      const randomValue = crypto.getRandomValues(new Uint8Array(1))[0];
      return (Number(char) ^ (randomValue & (15 >> (Number(char) / 4)))).toString(16);
    });
  }

  private setCartId(cartId: string | null): void {
    if (cartId) {
      localStorage.setItem(this.cartIdStorageKey, cartId);
      return;
    }

    localStorage.removeItem(this.cartIdStorageKey);
  }

  private getCartHeaders(): HttpHeaders {
    const cartId = this.getCartId();
    return cartId ? new HttpHeaders({ 'x-cart-id': cartId }) : new HttpHeaders();
  }

  private applyReservedCart(cart: ReservedCartResponse | null): void {
    if (!cart?.cartId || !cart.expiresAt || (cart.items || []).length === 0) {
      this.setCartId(null);
      this.clearLocalCart();
      return;
    }

    this.setCartId(cart.cartId);
    localStorage.setItem(this.cartExpiresAtStorageKey, `${new Date(cart.expiresAt).getTime()}`);
    this._cart.set((cart.items || []).map(p => this.mapProdotto(p)));
    this.saveCart();
  }

  private clearLocalCart(): void {
    this._cart.set([]);
    localStorage.removeItem(this.storageKey);
    localStorage.removeItem(this.cartExpiresAtStorageKey);
    localStorage.removeItem('cart_total');
    this._cartRemainingSeconds.set(0);
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

  addProductToCart(prod: Prodotto, quantity: number = 1): Observable<void> {
    if (this.isCartExpired()) {
      this.clearCart();
    }

    const safeQuantity = Math.max(1, Math.floor(Number(quantity) || 1));
    const nextQuantity = this.getCartItemQuantity(prod.idProdotto) + safeQuantity;
    return this.reserveProductQuantity(prod.idProdotto, nextQuantity);
  }

  increaseQuantity(productId: number): Observable<void> {
    if (this.isCartExpired()) {
      this.clearCart();
      return this.loadReservedCart();
    }

    return this.reserveProductQuantity(productId, this.getCartItemQuantity(productId) + 1);
  }

  decreaseQuantity(productId: number): Observable<void> {
    if (this.isCartExpired()) {
      this.clearCart();
      return this.loadReservedCart();
    }

    return this.reserveProductQuantity(productId, Math.max(0, this.getCartItemQuantity(productId) - 1));
  }

  removeProductFromCart(productId: number | string): Observable<void> {
    return this.http.delete<ReservedCartResponse>(
      `${this.cartApiUrl}/items/${productId}`,
      { headers: this.getCartHeaders() }
    ).pipe(
      tap((cart) => this.applyReservedCart(cart)),
      map(() => undefined)
    );
  }

  clearCart(): void {
    const cartId = this.getCartId();
    this.clearLocalCart();
    this.setCartId(null);

    if (cartId) {
      this.http.delete(this.cartApiUrl, {
        headers: new HttpHeaders({ 'x-cart-id': cartId })
      }).subscribe({ error: () => undefined });
    }
  }

  abandonCurrentCart(): void {
    const cartId = this.getCartId();
    this.clearLocalCart();
    this.setCartId(null);

    if (!cartId) {
      return;
    }

    this.http.delete(this.cartApiUrl, {
      headers: new HttpHeaders({ 'x-cart-id': cartId })
    }).subscribe({ error: () => undefined });
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

  private reserveProductQuantity(productId: number, quantity: number): Observable<void> {
    const cartId = this.ensureCartId();

    return this.http.post<ReservedCartResponse>(
      `${this.cartApiUrl}/items`,
      {
        cartId,
        productId,
        quantity
      },
      { headers: new HttpHeaders({ 'x-cart-id': cartId }) }
    ).pipe(
      tap((cart) => this.applyReservedCart(cart)),
      map(() => undefined)
    );
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
    return this.http.post(`${environment.apiUrl}/products/update-stock`, cartItems);
  }

  completeCheckout(
    cartItems: Prodotto[],
    total: number,
    customer: CheckoutCustomerData
  ) {
    return this.http.post(`${environment.apiUrl}/checkout/complete`, {
      cartId: this.getCartId(),
      cartItems,
      total,
      customer
    }, { headers: this.getCartHeaders() }).pipe(
      tap(() => {
        this.clearLocalCart();
        this.setCartId(null);
      })
    );
  }
}

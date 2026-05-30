import { Component, ViewChild, ElementRef, AfterViewChecked, OnDestroy, OnInit } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import * as L from 'leaflet';
import { IntlTelInputComponent } from 'intl-tel-input/angularWithUtils';
import { AuthService } from '../../services/auth';
import { NavbarComponent } from '../navbar.component/navbar.component';
import { CheckoutCustomerData, Prodotto } from '../../services/prodotto';
import { ProdottoService } from '../../services/prodotto';
import { LockerService, LockerOption } from '../../services/locker';
import { ChangeDetectorRef } from '@angular/core';
import { environment } from '../../../environments/environment';

delete (L.Icon.Default.prototype as any)._getIconUrl;

L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'assets/marker-icon-2x-red.png',
  iconUrl: 'assets/marker-icon-red.png',
  shadowUrl: 'assets/marker-shadow.png',
});

@Component({
  selector: 'app-payment.component',
  standalone: true,
  imports: [CommonModule, NavbarComponent, RouterLink, FormsModule, IntlTelInputComponent],
  templateUrl: './payment.component.html',
  styleUrl: './payment.component.css',
})
export class PaymentComponent implements OnInit, AfterViewChecked, OnDestroy {
  private authApi = `${environment.apiUrl}/auth`;
  private cartExpiryWatcherId: ReturnType<typeof setInterval> | null = null;

  cartItems: Prodotto[] = [];
  totalQuantity: number = 0;
  subtotal: number = 0;
  finalTotal: number = 0;

  shippingMethod: string = 'pickup';
  shippingCost: number = 0;

  name: string = '';
  surname: string = '';
  email: string = '';
  phone: string = '';
  isPhoneValid = false;
  isLoadingUserData = false;
  cardName: string = '';
  cardNumber: string = '';
  expiry: string = '';
  cvv: string = '';

  address: string = '';
  city: string = '';
  zip: string | number = '';

  isProcessing: boolean = false;
  paymentSuccess: boolean = false;
  showValidationErrors = false;
  paymentErrorMessage = '';

  @ViewChild('mapContainer') mapContainer!: ElementRef;
  map!: L.Map;
  mapInitialized = false;

  lockers: LockerOption[] = [];
  selectedLocker: LockerOption | null = null;

  initTelOptions = {
    initialCountry: 'auto' as const,
    geoIpLookup: (
      success: (iso2: any) => void,
      failure: () => void
    ) => {
      fetch('https://ipapi.co/json/')
        .then((res) => res.json())
        .then((data) => {
          const code = String(data?.country_code || 'it').toLowerCase();
          success(code as any);
        })
        .catch(() => {
          success('it' as any);
          failure();
        });
    },
    preferredCountries: ['it', 'gb', 'fr', 'de', 'es', 'us'],
    separateDialCode: true,
    nationalMode: false,
    strictMode: true,
    formatOnDisplay: true,
    autoPlaceholder: 'polite' as const
  };

  constructor(
    private http: HttpClient,
    private auth: AuthService,
    private prodottoService: ProdottoService,
    private lockerService: LockerService,
    private cdr: ChangeDetectorRef,
    private location: Location,
    private router: Router
  ) { }

  goBack(): void {
    if (window.history.length > 1) {
      this.location.back();
      return;
    }

    window.location.href = '/cart';
  }

  ngOnInit(): void {
    this.onShippingChange();
    const savedCart = this.prodottoService.getCart();

    if (savedCart.length > 0) {
      this.cartItems = savedCart;
      this.totalQuantity = this.cartItems.reduce(
        (sum, item) => sum + (item.quantita || 1),
        0
      );

      this.subtotal = this.cartItems.reduce(
        (sum, item) => sum + item.prezzo * (item.quantita || 1),
        0
      );

      this.updateTotal();
    }

    this.loadLoggedUserData();
    this.startCartExpiryWatcher();
  }

  ngOnDestroy(): void {
    if (this.cartExpiryWatcherId) {
      clearInterval(this.cartExpiryWatcherId);
      this.cartExpiryWatcherId = null;
    }
  }

  ngAfterViewChecked() {
    // Il container mappa compare solo con spedizione locker: inizializziamo qui una sola volta
    // quando il nodo DOM esiste davvero.
    if (
      this.shippingMethod === 'locker' &&
      !this.mapInitialized &&
      this.mapContainer
    ) {
      this.initMap();
      this.loadLockers();

      // Leaflet può calcolare male le dimensioni appena montato: forziamo il resize dopo il render.
      setTimeout(() => {
        this.map.invalidateSize();
      }, 200);

      this.mapInitialized = true;
    }
  }

  initMap() {
    if (this.map) return;

    if (!this.mapContainer?.nativeElement) {
      return;
    }

    this.map = L
      .map(this.mapContainer.nativeElement)
      .setView([44.55, 7.72], 13);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap'
    }).addTo(this.map);
  }

  isValidName(): boolean {
    return /^[a-zA-ZàèéìòùÀÈÉÌÒÙ\s]{2,}$/.test(this.name.trim());
  }

  isValidSurname(): boolean {
    return /^[a-zA-ZàèéìòùÀÈÉÌÒÙ\s]{2,}$/.test(this.surname.trim());
  }

  isValidEmail(): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.email);
  }

  isValidPhone(): boolean {
    return this.isPhoneValid && this.phone.trim() !== '';
  }

  onPhoneNumberChange(phoneNumber: string): void {
    this.phone = phoneNumber || '';
    this.paymentErrorMessage = '';
  }

  onPhoneValidityChange(isValid: boolean): void {
    this.isPhoneValid = isValid;
    this.paymentErrorMessage = '';
  }

  onExpiryInput(value: string): void {
    const digits = value.replace(/\D/g, '').slice(0, 4);

    if (digits.length <= 2) {
      this.expiry = digits;
    } else {
      this.expiry = `${digits.slice(0, 2)}/${digits.slice(2)}`;
    }

    this.onFormInteraction();
  }

  private loadLoggedUserData(): void {
    if (!this.auth.isLoggedIn()) {
      return;
    }

    this.isLoadingUserData = true;

    this.http.get<any>(`${this.authApi}/me`).subscribe({
      next: (user) => {
        if (!user) {
          this.isLoadingUserData = false;
          this.cdr.detectChanges();
          return;
        }

        this.name = user.nome ?? this.name;
        this.surname = user.cognome ?? this.surname;
        this.email = user.email ?? this.email;
        this.phone = user.telefono != null ? String(user.telefono) : this.phone;
        this.isPhoneValid = this.phone.trim() !== '';
        this.isLoadingUserData = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.isLoadingUserData = false;
        this.cdr.detectChanges();
      }
    });
  }

  isValidCardName(): boolean {
    return this.cardName.trim().length >= 3;
  }

  isValidCardNumber(): boolean {
    const clean = this.cardNumber.replace(/\s+/g, '');
    return /^[0-9]{16}$/.test(clean);
  }

  getExpiryErrorMessage(): string | null {
    if (!this.expiry.trim()) return 'Inserisci la scadenza nel formato MM/AA.';

    const clean = this.expiry.trim();
    const match = clean.match(/^(\d{1,2})\/(\d{2})$/);
    if (!match) return 'Usa il formato MM/AA per la scadenza.';

    const month = parseInt(match[1], 10);
    const year = 2000 + parseInt(match[2], 10);

    if (month < 1 || month > 12) {
      return 'Il mese della scadenza deve essere tra 01 e 12.';
    }

    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    if (year < currentYear) {
      return 'L\'anno della carta non e\' piu\' valido.';
    }

    if (year === currentYear && month < currentMonth) {
      return 'La carta risulta scaduta.';
    }

    return null;
  }

  isValidExpiry(): boolean {
    return this.getExpiryErrorMessage() === null;
  }

  isValidCVV(): boolean {
    if (!this.cvv) return false;

    const clean = this.cvv.replace(/\D/g, ''); 
    return clean.length === 3 || clean.length === 4;
  }

  isValidAddress(): boolean {
    const zipValue = this.getZipValue();

    return this.address.trim() !== '' &&
      this.city.trim() !== '' &&
      /^[0-9]{5}$/.test(zipValue);
  }

  private getZipValue(): string {
    return String(this.zip ?? '').trim();
  }

  isPayDisabled(): boolean {

    if (
      !this.isValidName() ||
      !this.isValidSurname() ||
      !this.isValidEmail() ||
      !this.isValidPhone() ||
      !this.isValidCardName() ||
      !this.isValidCardNumber() ||
      !this.isValidExpiry() ||
      !this.isValidCVV()
    ) {
      return true;
    }

    if (this.shippingMethod === 'locker' && !this.selectedLocker) {
      return true;
    }

    if (
      (this.shippingMethod === 'standard' || this.shippingMethod === 'express') &&
      !this.isValidAddress()
    ) {
      return true;
    }

    return false;
  }

  hasFieldError(field: string): boolean {
    return this.getFieldErrorMessage(field) !== null;
  }

  getFieldErrorMessage(field: string): string | null {
    if (!this.showValidationErrors) return null;

    switch (field) {
      case 'name':
        return this.isValidName() ? null : 'Inserisci un nome valido.';
      case 'surname':
        return this.isValidSurname() ? null : 'Inserisci un cognome valido.';
      case 'email':
        return this.isValidEmail() ? null : 'Controlla l\'indirizzo email.';
      case 'phone':
        return this.isValidPhone() ? null : 'Inserisci un numero di telefono valido.';
      case 'cardName':
        return this.isValidCardName() ? null : 'Il nome sulla carta non e\' valido.';
      case 'cardNumber':
        return this.isValidCardNumber() ? null : 'Il numero della carta deve avere 16 cifre.';
      case 'expiry':
        return this.getExpiryErrorMessage();
      case 'cvv':
        return this.isValidCVV() ? null : 'Il CVV deve contenere 3 o 4 cifre.';
      case 'address':
        if (this.shippingMethod !== 'standard' && this.shippingMethod !== 'express') return null;
        return this.address.trim() ? null : 'Inserisci l\'indirizzo di consegna.';
      case 'city':
        if (this.shippingMethod !== 'standard' && this.shippingMethod !== 'express') return null;
        return this.city.trim() ? null : 'Inserisci la citta\' di consegna.';
      case 'zip':
        if (this.shippingMethod !== 'standard' && this.shippingMethod !== 'express') return null;
        if (!this.getZipValue()) return 'Inserisci il CAP.';
        return /^[0-9]{5}$/.test(this.getZipValue()) ? null : 'Il CAP deve avere 5 cifre.';
      case 'locker':
        return this.shippingMethod === 'locker' && !this.selectedLocker
          ? 'Seleziona un locker dalla mappa.'
          : null;
      default:
        return null;
    }
  }

  onFormInteraction(): void {
    this.paymentErrorMessage = '';
  }

  getPayTooltip(): string {

    if (!this.isValidName()) return 'Nome non valido';
    if (!this.isValidSurname()) return 'Cognome non valido';
    if (!this.isValidEmail()) return 'Email non valida';
    if (!this.isValidPhone()) return 'Telefono non valido';
    if (!this.isValidCardName()) return 'Nome sulla carta non valido';
    if (!this.isValidCardNumber()) return 'Numero carta non valido';
    if (!this.isValidExpiry()) return 'Scadenza non valida (MM/AA)';
    if (!this.isValidCVV()) return 'CVV non valido';

    if (this.shippingMethod === 'locker' && !this.selectedLocker) {
      return 'Seleziona un locker';
    }

    if (
      (this.shippingMethod === 'standard' || this.shippingMethod === 'express') &&
      !this.isValidAddress()
    ) {
      return 'Completa indirizzo (CAP valido)';
    }

    return '';
  }

  loadLockers() {
    if (!this.map) return;

    // Il bottone nel popup usa onclick HTML: esponiamo una callback globale per collegare il click
    // alla selezione locker nel componente Angular.
    (window as any).selectLockerFromMap = (lockerId: string) => {
      const locker = this.lockers.find(l => l.id === lockerId);
      if (locker) {
        this.selectedLocker = locker;
        this.cdr.detectChanges();
      }
    };

    this.lockerService.getLockersAroundFossano().subscribe(lockers => {
      this.lockers = lockers;

      lockers.forEach(locker => {
        const marker = L.marker([locker.lat, locker.lng])
          .addTo(this.map)
          .bindPopup(`
          <div style="min-width:180px">
            <strong>${locker.name}</strong><br>
            ${locker.address}<br>
            ${locker.city}<br><br>

            <button 
              onclick="selectLockerFromMap('${locker.id}')"
              style="
                background:#d4af37;
                color:black;
                border:none;
                padding:6px 10px;
                border-radius:6px;
                cursor:pointer;
                width:100%;
                font-weight:600;
              "
            >
              Seleziona
            </button>
          </div>
        `);
      });
    });
  }

  onShippingChange() {
    this.onFormInteraction();

    switch (this.shippingMethod) {
      case 'express':
        this.shippingCost = 9.99;
        break;
      case 'standard':
        this.shippingCost = 4.99;
        break;
      default:
        this.shippingCost = 0;
    }

    this.updateTotal();

    if (this.shippingMethod !== 'locker') {
      // Uscendo dalla modalità locker smontiamo la mappa per evitare istanze/marker duplicati
      // al prossimo ingresso.
      this.mapInitialized = false;

      if (this.map) {
        this.map.remove();
        this.map = undefined as any;
      }
    }
  }

  updateTotal() {
    this.finalTotal = this.subtotal + this.shippingCost;
  }

  private startCartExpiryWatcher(): void {
    if (this.cartExpiryWatcherId) {
      clearInterval(this.cartExpiryWatcherId);
    }

    this.cartExpiryWatcherId = setInterval(() => {
      if (this.isProcessing || this.paymentSuccess) {
        return;
      }

      if (this.prodottoService.getCart().length === 0) {
        this.redirectToEmptyCart();
      }
    }, 1000);
  }

  private redirectToEmptyCart(): void {
    if (this.cartExpiryWatcherId) {
      clearInterval(this.cartExpiryWatcherId);
      this.cartExpiryWatcherId = null;
    }

    this.prodottoService.abandonCurrentCart();
    this.router.navigate(['/cart']);
  }

  trackById(index: number, item: Prodotto): number {
    return item.idProdotto;
  }

  pay(): void {
    if (this.isProcessing || this.paymentSuccess) return;

    this.showValidationErrors = true;
    this.paymentErrorMessage = '';

    const currentCart = this.prodottoService.getCart();

    if (currentCart.length === 0) {
      this.redirectToEmptyCart();
      return;
    }

    this.cartItems = currentCart;
    this.totalQuantity = this.cartItems.reduce(
      (sum, item) => sum + (item.quantita || 1),
      0
    );
    this.subtotal = this.cartItems.reduce(
      (sum, item) => sum + item.prezzo * (item.quantita || 1),
      0
    );
    this.updateTotal();

    if (this.isPayDisabled()) {
      this.cdr.detectChanges();
      return;
    }

    this.isProcessing = true;
    this.cdr.detectChanges();

    setTimeout(() => {
      const customer: CheckoutCustomerData = {
        name: this.name.trim(),
        surname: this.surname.trim(),
        email: this.email.trim(),
        phone: this.phone.trim(),
        shippingMethod: this.shippingMethod,
        shippingCost: this.shippingCost,
        address: this.address.trim(),
        city: this.city.trim(),
        zip: this.getZipValue(),
        lockerLabel: this.selectedLocker
          ? `${this.selectedLocker.name} - ${this.selectedLocker.address}`
          : ''
      };

      this.prodottoService.completeCheckout(this.cartItems, this.finalTotal, customer).subscribe({

        next: () => {

          this.paymentSuccess = true;
          this.isProcessing = false;
          this.showValidationErrors = false;
          this.paymentErrorMessage = '';

          this.cdr.detectChanges();

          setTimeout(() => {
            sessionStorage.setItem('paymentSuccessAccess', 'true');

            this.prodottoService.clearCart();

            this.cartItems = [];
            this.totalQuantity = 0;
            this.finalTotal = 0;

            window.location.href = '/payment-success';

          }, 3000);
        },

        error: (err) => {
          this.isProcessing = false;
          const errorMessage = String(err?.error?.message || err?.message || '');

          if (err?.status === 409 && /carrello.*scaduto|cart_expired/i.test(errorMessage)) {
            this.redirectToEmptyCart();
            return;
          }

          this.paymentErrorMessage = err?.status === 409
            ? (err?.error?.message || 'Alcuni prodotti non sono piu disponibili nella quantita richiesta.')
            : 'Pagamento non riuscito. Riprova tra qualche istante.';
          this.cdr.detectChanges();
        }

      });

    }, 2500);
  }
}

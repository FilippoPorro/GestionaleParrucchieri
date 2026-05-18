import { Routes } from '@angular/router';
import { HomeBodyComponent } from './features/home-body.component/home-body.component';
import { ProductsListComponent } from './features/prodotti/products-list.component/products-list.component';
import { ProductDetailsComponent } from './features/prodotti/product-details.component/product-details.component';
import { ServicesListComponent } from './features/servizi/services-list.component/services-list.component';
import { ServiceDetailsComponent } from './features/servizi/service-details.component/service-details.component';
import { CartComponent } from './features/cart.component/cart.component';
import { PaymentComponent } from './features/payment.component/payment.component';
import { PaymentSuccessComponent } from './features/payment-success.component/payment-success.component';
import { LoginComponent } from './features/login.component/login.component';
import { RegisterComponent } from './features/register.component/register.component';
import { InfoUtenteComponent } from './features/info-utente.component/info-utente.component';
import { AppuntamentiComponent } from './features/appuntamenti.component/appuntamenti.component';
import { PasswordDimenticataComponent } from './features/password-dimenticata.component/password-dimenticata.component';
import { ResetPasswordComponent } from './features/reset-password.component/reset-password.component';
import { authGuard } from './guards/auth.guard';
import { PrenotaAppuntamentoComponent } from './features/prenota-appuntamento.component/prenota-appuntamento.component';
import { paymentSuccessGuard } from './guards/payment-success.guard';
import { registerGuard } from './guards/register.guard';
import { managementGuard } from './guards/management.guard';
import { HomeComponent } from './gestionale/home.component/home.component';
import { AppuntamentiGestionaleComponent } from './gestionale/appuntamenti-gestionale.component/appuntamenti-gestionale.component';
import { CassaComponent } from './gestionale/cassa.component/cassa.component';
import { ClientiComponent } from './gestionale/clienti.component/clienti.component';
import { StaffComponent } from './gestionale/staff.component/staff.component';

export const routes: Routes = [
    { path: '', redirectTo: '/home', pathMatch: 'full' },
    { path: 'home', component: HomeBodyComponent },
    { path: 'products', component: ProductsListComponent },
    { path: 'product/:id', component: ProductDetailsComponent },
    { path: 'services', component: ServicesListComponent },
    { path: 'service/:id', component: ServiceDetailsComponent },
    { path: 'cart', component: CartComponent },
    { path: 'payment', component: PaymentComponent, canActivate: [authGuard] },
    { path: 'payment-success', component: PaymentSuccessComponent, canActivate: [paymentSuccessGuard] },
    { path: 'login', component: LoginComponent },
    { path: 'register', component: RegisterComponent, canActivate: [registerGuard] },
    { path: 'account', component: InfoUtenteComponent, canActivate: [authGuard] },
    { path: 'appointments', component: AppuntamentiComponent },
    { path: 'forgot-password', component: PasswordDimenticataComponent },
    { path: 'reset-password', component: ResetPasswordComponent },
    { path: 'prenotazione', component: PrenotaAppuntamentoComponent},
    { path: 'gestionale', component: HomeComponent, canActivate: [managementGuard] },
    { path: 'gestionale/appuntamenti', component: AppuntamentiGestionaleComponent, canActivate: [managementGuard]},
    { path: 'gestionale/cassa', component: CassaComponent, canActivate: [managementGuard]},
    { path: 'gestionale/clienti', component: ClientiComponent, canActivate: [managementGuard]},
    { path: 'gestionale/staff', component: StaffComponent, canActivate: [managementGuard]},
    { path: '**', redirectTo: '/home' }
];

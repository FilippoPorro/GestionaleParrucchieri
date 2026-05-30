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
import { titolareManagementGuard, managementGuard } from './guards/management.guard';
import { HomeComponent } from './gestionale/home.component/home.component';
import { AppuntamentiGestionaleComponent } from './gestionale/appuntamenti-gestionale.component/appuntamenti-gestionale.component';
import { CassaComponent } from './gestionale/cassa.component/cassa.component';
import { ClientiComponent } from './gestionale/clienti.component/clienti.component';
import { StaffComponent } from './gestionale/staff.component/staff.component';
import { PrenotaAppuntamentoGestionaleComponent } from './gestionale/prenota-appuntamento-gestionale.component/prenota-appuntamento-gestionale.component';
import { ServiziComponent } from './gestionale/servizi.component/servizi.component';
import { MagazzinoComponent } from './gestionale/magazzino.component/magazzino.component';
import { FornitoriComponent } from './gestionale/fornitori.component/fornitori.component';
import { ReportComponent } from './gestionale/report.component/report.component';

export const routes: Routes = [
    { path: '', redirectTo: '/home', pathMatch: 'full' },
    {
        path: 'home',
        component: HomeBodyComponent,
        data: {
            seo: {
                title: 'I Parrucchieri - Parrucchiere a Fossano',
                description: 'Salone I Parrucchieri a Fossano: servizi capelli, prodotti professionali e prenotazione appuntamenti online.',
            },
        },
    },
    {
        path: 'products',
        component: ProductsListComponent,
        data: {
            seo: {
                title: 'Prodotti professionali per capelli | I Parrucchieri',
                description: 'Acquista prodotti professionali per la cura dei capelli selezionati dal salone I Parrucchieri.',
            },
        },
    },
    {
        path: 'product/:id',
        component: ProductDetailsComponent,
        data: {
            seo: {
                title: 'Dettaglio prodotto capelli | I Parrucchieri',
                description: 'Scopri dettagli, prezzo e disponibilita del prodotto selezionato da I Parrucchieri.',
            },
        },
    },
    {
        path: 'services',
        component: ServicesListComponent,
        data: {
            seo: {
                title: 'Servizi parrucchiere a Fossano | I Parrucchieri',
                description: 'Scopri taglio, piega, colore e trattamenti capelli disponibili nel salone I Parrucchieri a Fossano.',
            },
        },
    },
    {
        path: 'service/:id',
        component: ServiceDetailsComponent,
        data: {
            seo: {
                title: 'Dettaglio servizio parrucchiere | I Parrucchieri',
                description: 'Consulta durata, prezzo e dettagli del servizio selezionato e prenota il tuo appuntamento online.',
            },
        },
    },
    {
        path: 'cart',
        component: CartComponent,
        data: { seo: { title: 'Carrello | I Parrucchieri', description: 'Controlla i prodotti nel carrello prima del pagamento.', robots: 'noindex, nofollow' } },
    },
    {
        path: 'payment',
        component: PaymentComponent,
        data: { seo: { title: 'Pagamento | I Parrucchieri', description: 'Completa in sicurezza il pagamento del tuo ordine.', robots: 'noindex, nofollow' } },
    },
    {
        path: 'payment-success',
        component: PaymentSuccessComponent,
        canActivate: [paymentSuccessGuard],
        data: { seo: { title: 'Ordine completato | I Parrucchieri', description: 'Il tuo ordine e stato completato correttamente.', robots: 'noindex, nofollow' } },
    },
    {
        path: 'login',
        component: LoginComponent,
        data: { seo: { title: 'Accesso clienti | I Parrucchieri', description: 'Accedi alla tua area personale I Parrucchieri.', robots: 'noindex, nofollow' } },
    },
    {
        path: 'register',
        component: RegisterComponent,
        canActivate: [registerGuard],
        data: { seo: { title: 'Registrazione clienti | I Parrucchieri', description: 'Crea il tuo account cliente I Parrucchieri.', robots: 'noindex, nofollow' } },
    },
    {
        path: 'account',
        component: InfoUtenteComponent,
        canActivate: [authGuard],
        data: { seo: { title: 'Area personale | I Parrucchieri', description: 'Gestisci dati, appuntamenti e ordini del tuo account.', robots: 'noindex, nofollow' } },
    },
    {
        path: 'appointments',
        component: AppuntamentiComponent,
        data: {
            seo: {
                title: 'Appuntamenti online | I Parrucchieri',
                description: 'Consulta e gestisci i tuoi appuntamenti presso il salone I Parrucchieri.',
            },
        },
    },
    {
        path: 'forgot-password',
        component: PasswordDimenticataComponent,
        data: { seo: { title: 'Recupero password | I Parrucchieri', description: 'Richiedi un link per reimpostare la password del tuo account.', robots: 'noindex, nofollow' } },
    },
    {
        path: 'reset-password',
        component: ResetPasswordComponent,
        data: { seo: { title: 'Reimposta password | I Parrucchieri', description: 'Imposta una nuova password per il tuo account.', robots: 'noindex, nofollow' } },
    },
    {
        path: 'prenotazione',
        component: PrenotaAppuntamentoComponent,
        data: {
            seo: {
                title: 'Prenota appuntamento parrucchiere online | I Parrucchieri',
                description: 'Prenota online il tuo appuntamento per taglio, piega, colore e trattamenti capelli da I Parrucchieri.',
            },
        },
    },
    { path: 'gestionale', component: HomeComponent, canActivate: [managementGuard], data: { seo: { title: 'Gestionale | I Parrucchieri', description: 'Area gestionale riservata.', robots: 'noindex, nofollow' } } },
    { path: 'gestionale/appuntamenti', component: AppuntamentiGestionaleComponent, canActivate: [managementGuard], data: { seo: { title: 'Gestionale appuntamenti | I Parrucchieri', description: 'Area gestionale riservata.', robots: 'noindex, nofollow' } } },
    { path: 'gestionale/prenotazione', component: PrenotaAppuntamentoGestionaleComponent, canActivate: [managementGuard], data: { seo: { title: 'Gestionale prenotazione | I Parrucchieri', description: 'Area gestionale riservata.', robots: 'noindex, nofollow' } } },
    { path: 'gestionale/cassa', component: CassaComponent, canActivate: [managementGuard], data: { seo: { title: 'Gestionale cassa | I Parrucchieri', description: 'Area gestionale riservata.', robots: 'noindex, nofollow' } } },
    { path: 'gestionale/clienti', component: ClientiComponent, canActivate: [managementGuard], data: { seo: { title: 'Gestionale clienti | I Parrucchieri', description: 'Area gestionale riservata.', robots: 'noindex, nofollow' } } },
    { path: 'gestionale/staff', component: StaffComponent, canActivate: [titolareManagementGuard], data: { seo: { title: 'Gestionale staff | I Parrucchieri', description: 'Area gestionale riservata.', robots: 'noindex, nofollow' } } },
    { path: 'gestionale/servizi', component: ServiziComponent, canActivate: [managementGuard], data: { seo: { title: 'Gestionale servizi | I Parrucchieri', description: 'Area gestionale riservata.', robots: 'noindex, nofollow' } } },
    { path: 'gestionale/magazzino', component: MagazzinoComponent, canActivate: [managementGuard], data: { seo: { title: 'Gestionale magazzino | I Parrucchieri', description: 'Area gestionale riservata.', robots: 'noindex, nofollow' } } },
    { path: 'gestionale/fornitori', component: FornitoriComponent, canActivate: [managementGuard], data: { seo: { title: 'Gestionale fornitori | I Parrucchieri', description: 'Area gestionale riservata.', robots: 'noindex, nofollow' } } },
    {
        path: 'gestionale/report',
        component: ReportComponent,
        canActivate: [titolareManagementGuard],
        data: { seo: { title: 'Report gestionale | I Parrucchieri', description: 'Area gestionale riservata.', robots: 'noindex, nofollow' } },
    },
    { path: '**', redirectTo: '/home' }
];

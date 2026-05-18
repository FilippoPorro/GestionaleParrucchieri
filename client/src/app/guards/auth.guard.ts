import { inject } from "@angular/core";
import { CanActivateFn, Router } from "@angular/router";
import { AuthService } from "../services/auth";

export const authGuard: CanActivateFn = (_route, state) => {
    const auth = inject(AuthService);
    const router = inject(Router);

    if (auth.isLoggedIn()) {
        if (auth.mustChangePassword() && state.url !== '/account') {
            router.navigate(['/account']);
            return false;
        }

        return true;
    }

    const currentUrl = router.url;

    if (currentUrl && currentUrl !== state.url && currentUrl !== '/login') {
        localStorage.setItem('loginBackUrl', currentUrl);
    }

    localStorage.setItem('postLoginRedirect', state.url);
    router.navigate(['/login']);

    return false;
}

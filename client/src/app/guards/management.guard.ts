import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth';

export const managementGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (!auth.isLoggedIn()) {
    const currentUrl = router.url;

    if (currentUrl && currentUrl !== state.url && currentUrl !== '/login') {
      localStorage.setItem('loginBackUrl', currentUrl);
    }

    localStorage.setItem('postLoginRedirect', state.url);
    router.navigate(['/login']);
    return false;
  }

  if (auth.isOperatore()) {
    return true;
  }

  router.navigate(['/home']);
  return false;
};

export const titolareManagementGuard: CanActivateFn = (route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (!auth.isLoggedIn()) {
    const currentUrl = router.url;

    if (currentUrl && currentUrl !== state.url && currentUrl !== '/login') {
      localStorage.setItem('loginBackUrl', currentUrl);
    }

    localStorage.setItem('postLoginRedirect', state.url);
    router.navigate(['/login']);
    return false;
  }

  if (auth.isTitolare()) {
    return true;
  }

  router.navigate(['/gestionale']);
  return false;
};

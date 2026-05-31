import type { Routes } from '@angular/router';

import { APP_TEXTS } from '../i18n/app.texts';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'map' },
  {
    path: 'map',
    loadComponent: () =>
      import('./views/graph-view/graph-view').then((m) => m.GraphView),
    title: APP_TEXTS.nav.map,
  },
  {
    path: 'files',
    loadComponent: () =>
      import('./views/files-view/files-view').then((m) => m.FilesView),
    title: APP_TEXTS.nav.files,
  },
  // Hidden maintainer self-test for the UI Sentry surface. Deliberately
  // NOT in the nav (no `title`, no link in the shell): reachable only by
  // typing `/intentional-fail`. Browser mirror of `sm intentional-fail`.
  // See `views/intentional-fail/intentional-fail.ts`.
  {
    path: 'intentional-fail',
    loadComponent: () =>
      import('./views/intentional-fail/intentional-fail').then((m) => m.IntentionalFail),
  },
  { path: '**', redirectTo: 'map' },
];

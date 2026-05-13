import type { Routes } from '@angular/router';

import { APP_TEXTS } from '../i18n/app.texts';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'graph' },
  {
    path: 'graph',
    loadComponent: () =>
      import('./views/graph-view/graph-view').then((m) => m.GraphView),
    title: APP_TEXTS.nav.graph,
  },
  {
    path: 'list',
    loadComponent: () =>
      import('./views/list-view/list-view').then((m) => m.ListView),
    title: APP_TEXTS.nav.list,
  },
  { path: '**', redirectTo: 'graph' },
];

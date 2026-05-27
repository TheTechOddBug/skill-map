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
    path: 'files',
    loadComponent: () =>
      import('./views/files-view/files-view').then((m) => m.FilesView),
    title: APP_TEXTS.nav.files,
  },
  { path: '**', redirectTo: 'graph' },
];

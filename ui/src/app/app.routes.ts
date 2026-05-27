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
  { path: '**', redirectTo: 'map' },
];

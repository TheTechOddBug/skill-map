import type { Routes } from '@angular/router';

import { APP_TEXTS } from '../i18n/app.texts';

export const routes: Routes = [
  // The fused workspace (files rail + map + floating inspector) is the only
  // primary view. The former standalone `/map` and `/files` routes were
  // retired once the workspace replaced the split-view navigation.
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () =>
      import('./views/workspace-view/workspace-view').then((m) => m.WorkspaceView),
    title: APP_TEXTS.brand,
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
  { path: '**', redirectTo: '' },
];

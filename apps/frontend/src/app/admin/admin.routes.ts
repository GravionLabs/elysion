import type { Routes } from '@angular/router';

/**
 * The administration area (ADR 0027, #659): one frame (`AdminLayout`, which also says "You are not an administrator" to everybody
 * else) and a lazy page for each part. The login guard is on the parent route in `app.routes.ts`.
 */
export const ADMIN_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./admin-layout').then((m) => m.AdminLayout),
    children: [
      {
        path: '',
        pathMatch: 'full',
        loadComponent: () => import('./admin-overview').then((m) => m.AdminOverview),
      },
      {
        path: 'users',
        loadComponent: () => import('./admin-users').then((m) => m.AdminUsers),
      },
      {
        path: 'groups',
        loadComponent: () => import('./admin-groups').then((m) => m.AdminGroups),
      },
      {
        path: 'rooms',
        loadComponent: () => import('./admin-rooms').then((m) => m.AdminRooms),
      },
      {
        path: 'tokens',
        loadComponent: () => import('./admin-tokens').then((m) => m.AdminTokens),
      },
      {
        path: 'webhooks',
        loadComponent: () => import('./admin-webhooks').then((m) => m.AdminWebhooks),
      },
      {
        path: 'audit',
        loadComponent: () => import('./admin-audit').then((m) => m.AdminAudit),
      },
      { path: '**', redirectTo: '' },
    ],
  },
];

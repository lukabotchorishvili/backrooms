import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    title: 'The Floor Is Lying',
    loadComponent: () => import('./features/main-menu/main-menu').then((m) => m.MainMenu),
  },
  {
    path: 'play',
    title: 'The Floor Is Lying — Floor 14',
    loadComponent: () => import('./features/game/game-page').then((m) => m.GamePage),
  },
  { path: '**', redirectTo: '' },
];

import { RenderMode, ServerRoute } from '@angular/ssr';

/**
 * The game is a WebGL / Web Audio client application: there is nothing meaningful to prerender or
 * server-render (no canvas, no audio, no localStorage save on the server), so every route is
 * rendered in the browser. The server only serves the static shell.
 */
export const serverRoutes: ServerRoute[] = [
  {
    path: '**',
    renderMode: RenderMode.Client,
  },
];

// Entry point of the interactive app.
import { App } from './app';
import './style.css';

export function startApp(root: HTMLElement): App {
  const app = new App(root);
  if (import.meta.env.DEV) (window as unknown as { manualcad: App }).manualcad = app;
  return app;
}

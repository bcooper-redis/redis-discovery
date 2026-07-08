import express from 'express';
import * as path from 'path';
import { createState } from './state';
import type { AppState } from './state';
import { scanRouter } from './routes/scan';
import { authRouter } from './routes/auth';
import { inventoryRouter } from './routes/inventory';
import { exportRouter } from './routes/export';

export { createState };
export type { AppState };

export function createApp(state: AppState = createState()): express.Application {
  const app = express();
  // Default (100kb) is comfortably enough for a normal scan request, but a
  // Credential Scan's body is a full host/port/username/password list —
  // raise the ceiling so a few thousand rows doesn't hit a 413 for what's
  // still a perfectly reasonable known-hosts CSV.
  app.use(express.json({ limit: '5mb' }));
  app.use((_req, res, next) => {
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });
  app.set('state', state);
  app.use('/api', scanRouter);
  app.use('/api', authRouter);
  app.use('/api', inventoryRouter);
  app.use('/api', exportRouter);
  app.use(express.static(path.join(__dirname, 'public')));
  return app;
}

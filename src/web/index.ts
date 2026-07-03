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
  app.use(express.json());
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

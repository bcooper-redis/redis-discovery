import { Router } from 'express';
import { toCsv } from '../../export/index';
import type { AppState } from '../state';

export const exportRouter = Router();

exportRouter.get('/export/csv', (req, res) => {
  const state = req.app.get('state') as AppState;
  const { results } = state.getState();
  const csv = toCsv(results);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="redis-scanner-export.csv"');
  res.send(csv);
});

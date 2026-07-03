import { Router } from 'express';
import { probeHost } from '../../probe/index';
import { assembleResult } from '../../inventory/assemble';
import type { AppState } from '../state';

export const inventoryRouter = Router();

inventoryRouter.post('/inventory', async (req, res) => {
  const state = req.app.get('state') as AppState;

  const { host, port, password, username } = req.body as {
    host?: unknown;
    port?: unknown;
    password?: unknown;
    username?: unknown;
  };

  if (typeof host !== 'string' || !host) {
    res.status(400).json({ error: 'host is required.' });
    return;
  }
  if (typeof port !== 'number' || port < 1 || port > 65535) {
    res.status(400).json({ error: 'port must be a number between 1 and 65535.' });
    return;
  }
  if (typeof password !== 'string' || !password) {
    res.status(400).json({ error: 'password is required.' });
    return;
  }

  const probe = await probeHost(host, port, 5000, {
    credentials: {
      password,
      username: typeof username === 'string' ? username : undefined,
    },
  });

  // Build a synthetic TCP result using the known latency from existing scan results,
  // falling back to 0 when the host wasn't previously scanned.
  const existing = state.getState().results.find((r) => r.host === host && r.port === port);
  const tcpResult = { host, port, open: true, latencyMs: existing?.latency ?? 0 };

  const result = assembleResult(tcpResult, probe, true);

  // Update the in-memory scan results so subsequent GET /api/results reflects auth
  state.updateResult(result);

  // Credentials are never included in the response
  res.json(result);
});

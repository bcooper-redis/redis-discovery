import { Router } from 'express';
import { discover } from '../../inventory/discover';
import { expandPorts } from '../../scanner/ports';
import { detectLocalCidrs, assertScanSize } from '../../scanner/cidr';
import type { AppState } from '../state';
import type { ScanConfig } from '../../types';

export const scanRouter = Router();

scanRouter.post('/scan', (req, res) => {
  const state = req.app.get('state') as AppState;

  if (state.getState().status === 'scanning') {
    res.status(409).json({ error: 'A scan is already in progress.' });
    return;
  }

  const body = req.body as {
    cidrs?: unknown;
    ports?: unknown;
    timeoutMs?: unknown;
    concurrency?: unknown;
    tls?: unknown;
    tlsSkipVerify?: unknown;
    password?: unknown;
    username?: unknown;
  };

  let cidrs: string[];
  if (!body.cidrs || (Array.isArray(body.cidrs) && body.cidrs.length === 0)) {
    cidrs = detectLocalCidrs();
    if (cidrs.length === 0) {
      res.status(400).json({ error: 'No CIDRs provided and none could be auto-detected.' });
      return;
    }
  } else if (!Array.isArray(body.cidrs) || body.cidrs.some((c) => typeof c !== 'string')) {
    res.status(400).json({ error: 'cidrs must be an array of strings.' });
    return;
  } else {
    cidrs = body.cidrs as string[];
  }

  try {
    assertScanSize(cidrs);
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
    return;
  }

  let ports: number[];
  try {
    const portInput = body.ports ?? '6379';
    ports = expandPorts(Array.isArray(portInput) ? (portInput as number[]) : String(portInput));
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
    return;
  }

  const timeoutMs = typeof body.timeoutMs === 'number' ? Math.max(1, body.timeoutMs) : 1000;
  const concurrency = typeof body.concurrency === 'number' ? Math.max(1, body.concurrency) : 100;
  const tls = body.tls === true;
  const tlsSkipVerify = body.tlsSkipVerify === true;

  if (typeof body.username === 'string' && typeof body.password !== 'string') {
    res.status(400).json({ error: 'username requires password.' });
    return;
  }

  const credentials =
    typeof body.password === 'string'
      ? {
          password: body.password,
          username: typeof body.username === 'string' ? body.username : undefined,
        }
      : undefined;

  const config: ScanConfig = { cidrs, ports, timeoutMs, concurrency, tls, tlsSkipVerify };

  state.startScan();

  // Run in background — the caller polls GET /api/results
  void discover(config, {
    credentials,
    onScanProgress: (done, total) => state.updateScanProgress(done, total),
    onProbeProgress: (done, total) => state.updateProbeProgress(done, total),
  })
    .then((results) => state.finishScan(results))
    .catch((e: Error) => state.failScan(e.message));

  res.status(202).json({ status: 'scanning' });
});

scanRouter.get('/results', (req, res) => {
  const state = req.app.get('state') as AppState;
  res.json(state.getState());
});

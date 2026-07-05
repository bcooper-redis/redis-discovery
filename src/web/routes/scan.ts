import { Router } from 'express';
import { discover } from '../../inventory/discover';
import { expandPorts } from '../../scanner/ports';
import { detectLocalCidrs, assertScanSize } from '../../scanner/cidr';
import { createScanController } from '../../scanner/control';
import type { AppState } from '../state';
import type { ScanConfig, AuthCredentials } from '../../types';

export const scanRouter = Router();

/**
 * Kick off a discover() run in the background and wire its callbacks to
 * `state`. Each callback is gated on the generation startScan() returns —
 * if a newer scan (or restart) has since started, this run's late-arriving
 * progress/results/completion are silently dropped instead of clobbering it.
 */
function launchScan(
  state: AppState,
  config: ScanConfig,
  targets: string[],
  autoDetected: boolean,
  credentials: AuthCredentials | undefined,
): void {
  const controller = createScanController();
  const generation = state.startScan(targets, autoDetected, config, controller);
  const isCurrent = () => state.getGeneration() === generation;

  void discover(config, {
    credentials,
    controller,
    onScanProgress: (done, total) => {
      if (isCurrent()) state.updateScanProgress(done, total);
    },
    onProbeProgress: (done, total) => {
      if (isCurrent()) state.updateProbeProgress(done, total);
    },
    onResult: (result) => {
      if (isCurrent()) state.updateResult(result);
    },
  })
    .then((results) => {
      if (isCurrent()) state.finishScan(results);
    })
    .catch((e: Error) => {
      if (isCurrent()) state.failScan(e.message);
    });
}

scanRouter.post('/scan', (req, res) => {
  const state = req.app.get('state') as AppState;
  const status = state.getState().status;

  if (status === 'scanning' || status === 'paused') {
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
  let autoDetected = false;
  if (!body.cidrs || (Array.isArray(body.cidrs) && body.cidrs.length === 0)) {
    cidrs = detectLocalCidrs();
    autoDetected = true;
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

  // Runs in background — the caller polls GET /api/results
  launchScan(state, config, cidrs, autoDetected, credentials);

  res.status(202).json({ status: 'scanning' });
});

scanRouter.post('/scan/pause', (req, res) => {
  const state = req.app.get('state') as AppState;
  if (state.getState().status !== 'scanning') {
    res.status(409).json({ error: 'No running scan to pause.' });
    return;
  }
  state.getController()?.pause();
  state.pauseScan();
  res.json(state.getState());
});

scanRouter.post('/scan/resume', (req, res) => {
  const state = req.app.get('state') as AppState;
  if (state.getState().status !== 'paused') {
    res.status(409).json({ error: 'No paused scan to resume.' });
    return;
  }
  state.getController()?.resume();
  state.resumeScan();
  res.json(state.getState());
});

scanRouter.post('/scan/stop', (req, res) => {
  const state = req.app.get('state') as AppState;
  const status = state.getState().status;
  if (status !== 'scanning' && status !== 'paused') {
    res.status(409).json({ error: 'No running or paused scan to stop.' });
    return;
  }
  state.getController()?.stop();
  state.markStopped();
  res.json(state.getState());
});

scanRouter.post('/scan/restart', (req, res) => {
  const state = req.app.get('state') as AppState;
  const current = state.getState();

  if (current.status === 'scanning' || current.status === 'paused') {
    res.status(409).json({ error: 'Stop the current scan before restarting.' });
    return;
  }

  const lastConfig = state.getLastConfig();
  if (!lastConfig) {
    res.status(400).json({ error: 'No previous scan to restart.' });
    return;
  }

  // Credentials are never persisted, so a restarted scan always runs
  // anonymously — re-authenticate per host afterward if needed.
  launchScan(state, lastConfig, current.targets, current.autoDetected, undefined);

  res.status(202).json({ status: 'scanning' });
});

scanRouter.get('/results', (req, res) => {
  const state = req.app.get('state') as AppState;
  res.json(state.getState());
});

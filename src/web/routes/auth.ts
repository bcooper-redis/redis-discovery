import { Router } from 'express';
import { probeHost } from '../../probe/index';

export const authRouter = Router();

authRouter.post('/authenticate', async (req, res) => {
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

  const result = await probeHost(host, port, 5000, {
    credentials: {
      password,
      username: typeof username === 'string' ? username : undefined,
    },
  });

  // Credentials are never included in the response
  res.json({
    host,
    port,
    authenticated: !result.wrongPassword && result.isRedis,
    wrongPassword: result.wrongPassword,
  });
});

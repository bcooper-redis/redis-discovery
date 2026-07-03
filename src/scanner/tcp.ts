import * as net from 'net';

export interface TcpProbeResult {
  host: string;
  port: number;
  open: boolean;
  latencyMs: number;
}

/**
 * Attempt a TCP connection to host:port within timeoutMs.
 * Always resolves — never rejects. Returns open:false on error or timeout.
 */
export function tcpProbe(host: string, port: number, timeoutMs: number): Promise<TcpProbeResult> {
  return new Promise((resolve) => {
    const start = Date.now();
    const socket = new net.Socket();
    let settled = false;

    const finish = (open: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ host, port, open, latencyMs: Date.now() - start });
    };

    socket.setTimeout(timeoutMs);
    socket.on('connect', () => finish(true));
    socket.on('error', () => finish(false));
    socket.on('timeout', () => finish(false));
    socket.connect(port, host);
  });
}

export function clearLine(): void {
  if (process.stderr.isTTY) process.stderr.write('\r\x1b[K');
}

export function writeProgress(msg: string): void {
  if (process.stderr.isTTY) process.stderr.write(`\r\x1b[K${msg}`);
}

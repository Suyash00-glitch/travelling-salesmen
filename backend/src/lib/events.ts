import type { Response } from 'express';

// Tiny in-memory Server-Sent Events hub. Every open browser tab keeps one
// connection; after any successful change we broadcast a "changed" event so
// clients can refresh their data and notifications immediately.
const clients = new Set<Response>();

export function subscribe(res: Response) {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write('retry: 3000\n\n');

  clients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);

  res.on('close', () => {
    clearInterval(ping);
    clients.delete(res);
  });
}

// Only the changed area is sent (no names or record ids), so the stream is safe for every role.
export function publish(area: string) {
  const message = `data: ${JSON.stringify({ type: 'changed', area, at: new Date().toISOString() })}\n\n`;
  for (const client of clients) client.write(message);
}

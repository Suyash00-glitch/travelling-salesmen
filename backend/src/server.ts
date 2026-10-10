import { app, logger } from './app.js';
import { env } from './config/env.js';

const server = app.listen(env.port, '0.0.0.0', () => {
  logger.info(`LoomOS API http://127.0.0.1:${env.port}`);
});

server.on('error', (err) => {
  logger.error(err, 'Server failed to start');
  process.exit(1);
});

process.on('SIGTERM', () => {
  server.close();
});

import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { app, logger } from './app.js';
import { env } from './config/env.js';
import { sessionUser } from './modules/auth/auth.service.js';
import { setPublisher } from './lib/domain.js';

const http = createServer(app);
const io = new Server(http, {
  cors: {
    origin: env.origin,
    credentials: true,
  },
});

// Authenticate socket handshake using session cookie
io.use(async (socket, next) => {
  const cookies = socket.handshake.headers.cookie ?? '';
  const token = cookies
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith('loomos_session='))
    ?.split('=')[1];

  const session = await sessionUser(token);
  if (!session) {
    next(new Error('Authentication required'));
    return;
  }

  socket.data.user = session.user;
  next();
});

// Join role-appropriate socket rooms on connection
io.on('connection', (socket) => {
  const user = socket.data.user;
  if (user.role === 'BUYER') {
    void socket.join('buyers');
    if (user.buyerId) {
      void socket.join(`buyer:${user.buyerId}`);
    }
  } else {
    void socket.join('factory');
  }
});

// Broadcast light invalidation pings to connected rooms
setPublisher(() => {
  io.to('factory').emit('factory.changed');
  io.to('buyers').emit('orders.changed');
});

http.listen(env.port, '127.0.0.1', () =>
  logger.info(`LoomOS API http://localhost:${env.port}`),
);

process.on('SIGTERM', () => {
  io.close();
  http.close();
});

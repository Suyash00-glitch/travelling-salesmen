import { Router } from 'express';
import { db } from '@loomos/db';
import { authenticate } from '../middleware/auth.js';
import { authRouter } from './auth.routes.js';
import { dashboardRouter } from './dashboard.routes.js';
import { ordersRouter } from './orders.routes.js';
import { inventoryRouter } from './inventory.routes.js';
import { procurementRouter } from './procurement.routes.js';
import { productionRouter } from './production.routes.js';
import { machinesRouter } from './machines.routes.js';
import { qualityRouter } from './quality.routes.js';
import { dispatchRouter } from './dispatch.routes.js';
import { workforceRouter } from './workforce.routes.js';
import { financeRouter } from './finance.routes.js';
import { settingsRouter } from './settings.routes.js';
import { rbacRouter } from './rbac.routes.js';
import { buyerChatRouter } from './buyerChat.routes.js';

export const apiRouter = Router();

// Health check endpoint (unauthenticated)
apiRouter.get('/health', async (_req, res) => {
  await db.$queryRaw`SELECT 1`;
  res.json({ status: 'ok', database: 'postgresql' });
});

// Authentication routes (/auth/login is public, /me and /logout authenticate internally)
apiRouter.use('/auth', authRouter);

// Require authentication for all subsequent factory API endpoints
apiRouter.use(authenticate);

// Domain routers
apiRouter.use(dashboardRouter);
apiRouter.use('/orders', ordersRouter);
apiRouter.use('/inventory', inventoryRouter);
apiRouter.use(procurementRouter);
apiRouter.use('/production', productionRouter);
apiRouter.use('/machines', machinesRouter);
apiRouter.use('/rolls', qualityRouter);
apiRouter.use('/shipments', dispatchRouter);
apiRouter.use(workforceRouter);
apiRouter.use(financeRouter);
apiRouter.use(settingsRouter);
apiRouter.use('/rbac', rbacRouter);
apiRouter.use('/buyer-chat', buyerChatRouter);

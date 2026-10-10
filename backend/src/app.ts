import './config/env.js';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import { apiRouter } from './routes/index.js';
import { logger, errorHandler, notFoundHandler } from './middleware/error.middleware.js';

export { logger };
export const app = express();

// Security and request parsing middleware
app.use(
  helmet(),
  cors({
    origin: (origin, callback) => {
      if (!origin || env.allowedOrigins.includes(origin) || !env.production) {
        callback(null, true);
      } else {
        callback(new Error('CORS not allowed'));
      }
    },
    credentials: true,
  }),
  express.json({ limit: '1mb' }),
  cookieParser(),
);

// Mount main API router on /api/v1
app.use('/api/v1', apiRouter);

// 404 handler for unmatched routes
app.use(notFoundHandler);

// Central error handling middleware
app.use(errorHandler);

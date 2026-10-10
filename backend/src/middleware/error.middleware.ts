import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@loomos/db';
import pino from 'pino';
import { DomainError } from '../lib/domain.js';

export const logger = pino({
  redact: ['password', 'passwordHash', 'cookie', 'authorization'],
});

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({
    error: {
      message: 'Endpoint not found.',
    },
  });
}

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (error instanceof ZodError) {
    res.status(400).json({
      error: {
        message: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
        issues: error.issues,
      },
    });
    return;
  }

  if (error instanceof DomainError) {
    res.status(error.status).json({
      error: {
        message: error.message,
      },
    });
    return;
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (['P2002', 'P2003', 'P2025'].includes(error.code)) {
      res.status(409).json({
        error: {
          message: 'This record already exists, is referenced elsewhere, or could not be found.',
        },
      });
      return;
    }
  }

  logger.error({ err: error }, 'Request failed');
  res.status(500).json({
    error: {
      message: 'Unable to complete this request. Please try again.',
    },
  });
}

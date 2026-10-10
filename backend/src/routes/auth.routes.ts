import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { db } from '@loomos/db';
import * as contracts from '@loomos/shared';
import { env } from '../config/env.js';
import { ensure } from '../lib/domain.js';
import { login, hashToken } from '../modules/auth/auth.service.js';
import { authenticate } from '../middleware/auth.js';

export const authRouter = Router();

// Public login route with rate limiting
authRouter.post(
  '/login',
  rateLimit({
    windowMs: 15 * 60000,
    limit: env.production ? 30 : 5000,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  }),
  async (req, res) => {
    const originAllowed =
      !req.headers.origin ||
      env.allowedOrigins.includes(req.headers.origin) ||
      !env.production;
    ensure(originAllowed, 'Untrusted request origin.', 403);
    const input = contracts.loginSchema.parse(req.body);
    const result = await login(input.email, input.password);

    res
      .cookie('loomos_session', result.token, {
        httpOnly: true,
        secure: env.production,
        sameSite: 'lax',
        maxAge: 8 * 3600000,
        path: '/',
      })
      .json({ csrf: result.csrf });
  },
);

// Authenticated session status
authRouter.get('/me', authenticate, (req, res) => {
  res.json({
    user: req.actor,
    csrf: req.csrf,
    demo: !env.production,
  });
});

// Authenticated logout
authRouter.post('/logout', authenticate, async (req, res) => {
  await db.session.deleteMany({
    where: { id: hashToken(req.cookies.loomos_session as string) },
  });
  res.clearCookie('loomos_session', { path: '/' }).json({ ok: true });
});

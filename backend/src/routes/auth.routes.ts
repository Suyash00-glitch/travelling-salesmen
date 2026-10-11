import { Router, type Request } from 'express';
import { rateLimit } from 'express-rate-limit';
import { db } from '@loomos/db';
import * as contracts from '@loomos/shared';
import { env } from '../config/env.js';
import { ensure } from '../lib/domain.js';
import { login, hashToken, authenticate } from '../middleware/auth.js';
import { signup } from '../services/user.service.js';

export const authRouter = Router();

const publicLimit = (limit: number) =>
  rateLimit({
    windowMs: 15 * 60000,
    limit: env.production ? limit : 5000,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  });

const ensureTrustedOrigin = (req: Request) => {
  const originAllowed =
    !req.headers.origin ||
    env.allowedOrigins.includes(req.headers.origin) ||
    !env.production;
  ensure(originAllowed, 'Untrusted request origin.', 403);
};

// Public login route with rate limiting
authRouter.post(
  '/login',
  publicLimit(30),
  async (req, res) => {
    ensureTrustedOrigin(req);
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

// Public self-signup. The account waits for an administrator to approve it and pick a role,
// so a visitor can never give themselves access.
authRouter.post('/signup', publicLimit(10), async (req, res) => {
  ensureTrustedOrigin(req);
  const input = contracts.signupSchema.parse(req.body);
  res.status(201).json(await signup(input));
});

// Authenticated session status
authRouter.get('/me', authenticate, (req, res) => {
  res.json({
    user: req.actor,
    csrf: req.csrf,
    demo: !env.production,
  });
});

// Logout route - always succeeds, removes server session and clears client cookie
authRouter.post('/logout', async (req, res) => {
  const token = req.cookies?.loomos_session as string | undefined;
  if (token) {
    try {
      await db.session.deleteMany({
        where: { id: hashToken(token) },
      });
    } catch {
      // Ignore database cleanup errors
    }
  }
  res
    .clearCookie('loomos_session', {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: env.production,
    })
    .json({ ok: true });
});

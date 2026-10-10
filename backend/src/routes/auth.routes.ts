import { Router, type Request } from 'express';
import bcrypt from 'bcryptjs';
import { rateLimit } from 'express-rate-limit';
import { db } from '@loomos/db';
import * as contracts from '@loomos/shared';
import { env } from '../config/env.js';
import { ensure } from '../lib/domain.js';
import { login, hashToken, authenticate } from '../middleware/auth.js';

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

// Public self-signup. Accounts start inactive until an administrator approves them,
// so a visitor can never grant themselves access on their own.
authRouter.post('/signup', publicLimit(10), async (req, res) => {
  ensureTrustedOrigin(req);
  const input = contracts.signupSchema.parse(req.body);
  const email = input.email.toLowerCase();

  const existing = await db.user.findUnique({ where: { email } });
  ensure(!existing, 'An account with this email address already exists.', 409);

  const passwordHash = await bcrypt.hash(input.password, 12);
  const role = await db.role.findUnique({ where: { code: input.role } });

  const user = await db.$transaction(async (tx) => {
    const buyer =
      input.role === 'BUYER'
        ? await tx.buyer.create({
            data: {
              name: input.company!,
              email,
              city: input.city!,
              initials: input
                .company!.split(/\s+/)
                .map((w: string) => w[0])
                .join('')
                .slice(0, 2)
                .toUpperCase(),
            },
          })
        : null;

    const created = await tx.user.create({
      data: {
        name: input.name,
        email,
        passwordHash,
        role: input.role,
        active: false,
        buyerId: buyer?.id ?? null,
        userRoles: role ? { create: [{ roleId: role.id }] } : undefined,
      },
    });

    await tx.auditLog.create({
      data: {
        actorId: created.id,
        actorName: created.name,
        action: 'auth.signup',
        entityId: created.id,
        detail: `Self-registered ${created.email} requesting role ${input.role}; pending approval`,
      },
    });

    return created;
  });

  res.status(201).json({ id: user.id, pendingApproval: true });
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

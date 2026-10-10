import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db } from '@loomos/db';
import * as contracts from '@loomos/shared';
import { authorize } from '../middleware/auth.js';
import { audit } from '../lib/domain.js';
import { page, write } from '../lib/route-helpers.js';

export const settingsRouter = Router();

// List system users
settingsRouter.get('/users', authorize('settings'), async (_req, res) => {
  const users = await db.user.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      active: true,
      buyerId: true,
      workerId: true,
    },
  });
  res.json(users);
});

// Create system user with hashed password
write(settingsRouter, '/users', 'settings', contracts.userSchema, async (tx, input, actor) => {
  const { password, ...data } = input;
  const user = await tx.user.create({
    data: {
      ...data,
      email: data.email.toLowerCase(),
      passwordHash: await bcrypt.hash(password, 12),
    },
  });
  await audit(tx, actor, 'user.created', user.id, `${user.name} · ${user.role}`);
  return { id: user.id };
});

// Create fabric recipe
write(settingsRouter, '/recipes', 'settings', contracts.recipeSchema, async (tx, input, actor) => {
  const recipe = await tx.recipe.create({ data: input });
  await audit(tx, actor, 'recipe.created', recipe.id, recipe.name);
  return recipe;
});

// Security and operational audit log
settingsRouter.get('/audit', authorize('settings'), async (req, res) => {
  const logs = await db.auditLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 500,
  });
  res.json(page(req, logs));
});

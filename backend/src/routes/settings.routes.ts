import { Router } from 'express';
import { db } from '@loomos/db';
import * as contracts from '@loomos/shared';
import { authorize } from '../middleware/auth.js';
import { audit } from '../lib/domain.js';
import { page, write, id } from '../lib/route-helpers.js';

export const settingsRouter = Router();

// Create fabric recipe (a material with its fixed selling price)
write(settingsRouter, '/recipes', 'settings:manage', contracts.recipeSchema, async (tx, input, actor) => {
  const recipe = await tx.recipe.create({ data: input });
  await audit(tx, actor, 'recipe.created', recipe.id, `${recipe.name} · ₹${input.pricePerMetre}/m`);
  return recipe;
});

// Change the fixed price of a material. Existing orders keep the price they were placed at.
write(settingsRouter, '/recipes/:id/price', 'settings:manage', contracts.recipePriceSchema, async (tx, input, actor, req) => {
  const recipe = await tx.recipe.update({ where: { id: id(req) }, data: { pricePerMetre: input.pricePerMetre } });
  await audit(tx, actor, 'recipe.price', recipe.id, `${recipe.name} price set to ₹${input.pricePerMetre}/m`);
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

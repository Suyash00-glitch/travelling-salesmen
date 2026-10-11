import { db, type Tx } from '@loomos/db';

// Who gets told about what. Notifications are plain database rows; the browser
// polls for them, so there is no socket server to run or keep alive.

// Floor team responsible for each production stage.
export const stageTeams: Record<string, string[]> = {
  SPINNING: ['SPINNING_OPERATOR'],
  WEAVING: ['WEAVING_OPERATOR'],
  DYEING: ['DYEING_OPERATOR'],
  QUALITY: ['QUALITY_INSPECTOR'],
  DISPATCH: ['DISPATCH_MANAGER'],
};

export const managers = ['SUPER_ADMIN', 'ADMIN', 'PRODUCTION_MANAGER'];
export const admins = ['SUPER_ADMIN', 'ADMIN'];

interface NotifyInput {
  roles?: string[];
  userIds?: string[];
  title: string;
  message: string;
  category: string;
  link?: string;
  // The person who caused the event does not need to be told about it.
  skipUserId?: string;
}

export async function notify(tx: Tx, input: NotifyInput) {
  const roles = input.roles ?? [];
  const byRole = roles.length
    ? await tx.user.findMany({
        where: {
          active: true,
          approvalStatus: 'APPROVED',
          OR: [{ role: { in: roles } }, { userRoles: { some: { role: { code: { in: roles } } } } }],
        },
        select: { id: true },
      })
    : [];

  const recipients = new Set([...byRole.map((u) => u.id), ...(input.userIds ?? [])]);
  if (input.skipUserId) recipients.delete(input.skipUserId);
  if (!recipients.size) return;

  await tx.notification.createMany({
    data: [...recipients].map((userId) => ({
      userId,
      title: input.title,
      message: input.message,
      category: input.category,
      link: input.link ?? '',
    })),
  });
}

export async function listNotifications(userId: string) {
  const [items, unread] = await Promise.all([
    db.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 50 }),
    db.notification.count({ where: { userId, read: false } }),
  ]);
  return { items, unread };
}

export async function markRead(userId: string, id?: string) {
  await db.notification.updateMany({
    where: id ? { id, userId } : { userId, read: false },
    data: { read: true },
  });
  return { ok: true };
}

// Batches past their due date raise one "delayed" notice per batch. This runs
// when notifications are polled, at most every ten minutes.
let lastDelayCheck = 0;

export async function checkDelays() {
  if (Date.now() - lastDelayCheck < 10 * 60000) return;
  lastDelayCheck = Date.now();

  const late = await db.productionOrder.findMany({
    where: {
      status: { notIn: ['COMPLETED', 'CANCELLED'] },
      OR: [{ dueDate: { lt: new Date() } }, { order: { deadline: { lt: new Date() } } }],
    },
    select: { id: true, number: true, fabric: true },
  });

  for (const batch of late) {
    const link = `/batches?open=${batch.id}`;
    const already = await db.notification.findFirst({ where: { category: 'DELAY', link } });
    if (already) continue;
    await notify(db as unknown as Tx, {
      roles: managers,
      title: `${batch.number} is running late`,
      message: `${batch.fabric} has passed its due date and is not finished yet.`,
      category: 'DELAY',
      link,
    });
  }
}

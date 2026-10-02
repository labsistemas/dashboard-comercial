import { Router } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { authenticate, requireAdmin } from '../middleware/auth.middleware';

const router = Router();

function parseDateOnly(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function startOfISOWeek(d: Date) {
  const out = new Date(d);
  const day = out.getUTCDay() || 7;
  out.setUTCDate(out.getUTCDate() - (day - 1));
  out.setUTCHours(0, 0, 0, 0);
  return out;
}

function startOfUTCMonth(d: Date) {
  const out = new Date(d);
  out.setUTCDate(1);
  out.setUTCHours(0, 0, 0, 0);
  return out;
}

const thresholdsSchema = z.object({
  amarelo: z.number().int().nonnegative(),
  vermelho: z.number().int().nonnegative(),
});

async function getOrCreateThresholds() {
  const existing = await prisma.abandonmentThresholds.findUnique({ where: { id: 'default' } });
  if (existing) return existing;
  return prisma.abandonmentThresholds.create({ data: { id: 'default', amarelo: 5, vermelho: 10 } });
}

router.get('/thresholds', authenticate, async (req, res) => {
  const thresholds = await getOrCreateThresholds();
  res.json({ thresholds: { amarelo: thresholds.amarelo, vermelho: thresholds.vermelho } });
});

router.put('/thresholds', authenticate, requireAdmin, async (req, res) => {
  try {
    const input = thresholdsSchema.parse(req.body);
    const updated = await prisma.abandonmentThresholds.upsert({
      where: { id: 'default' },
      update: { amarelo: input.amarelo, vermelho: input.vermelho },
      create: { id: 'default', amarelo: input.amarelo, vermelho: input.vermelho },
    });
    res.json({ thresholds: { amarelo: updated.amarelo, vermelho: updated.vermelho } });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/levels', authenticate, async (req, res) => {
  const thresholds = await getOrCreateThresholds();
  const querySchema = z.object({
    period: z.enum(['hoje', 'semana', 'mes', 'tudo']).optional().default('tudo'),
    ref: z.string().optional(),
    start: z.string().optional(),
    end: z.string().optional(),
  });
  const q = querySchema.parse(req.query || {});
  const period = q.period;

  const startFromQuery = q.start ? parseDateOnly(String(q.start)) : null;
  const endFromQuery = q.end ? parseDateOnly(String(q.end)) : null;
  const ref = q.ref ? parseDateOnly(String(q.ref)) : parseDateOnly(new Date().toISOString().slice(0, 10));
  const refDate = ref || new Date();

  let start: Date | null = null;
  let end: Date | null = null;

  if (startFromQuery && endFromQuery) {
    start = new Date(startFromQuery);
    start.setUTCHours(0, 0, 0, 0);
    const endDay = new Date(endFromQuery);
    endDay.setUTCHours(0, 0, 0, 0);
    end = new Date(endDay);
    end.setUTCDate(end.getUTCDate() + 1);
  } else if (period === 'hoje') {
    start = new Date(refDate);
    start.setUTCHours(0, 0, 0, 0);
    end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);
  } else if (period === 'semana') {
    start = startOfISOWeek(refDate);
    end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 7);
  } else if (period === 'mes') {
    start = startOfUTCMonth(refDate);
    end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + 1);
  }

  const grouped = await prisma.rescueEntry.groupBy({
    by: ['vendedorOrigemId'],
    _sum: { leadsResgatados: true },
    where:
      start && end
        ? {
            data: {
              gte: start,
              lt: end,
            },
          }
        : undefined,
  });

  const vendorIds = grouped.map((g) => g.vendedorOrigemId).filter((id): id is string => Boolean(id));
  const vendors = await prisma.user.findMany({
    where: { id: { in: vendorIds } },
    select: { id: true, nome: true, avatar: true },
  });
  const vendorById = new Map(vendors.map((v) => [v.id, v]));

  const levels = grouped
    .map((g) => {
      if (!g.vendedorOrigemId) return null;
      const totalResgatados = g._sum.leadsResgatados || 0;
      const classificacao =
        totalResgatados >= thresholds.vermelho
          ? 'vermelho'
          : totalResgatados >= thresholds.amarelo
            ? 'amarelo'
            : 'verde';

      return {
        vendedorId: g.vendedorOrigemId,
        vendedorNome: vendorById.get(g.vendedorOrigemId)?.nome || 'Vendedor',
        avatar: vendorById.get(g.vendedorOrigemId)?.avatar ? `/api/upload/proxy/${String(vendorById.get(g.vendedorOrigemId)?.avatar)}` : '',
        totalResgatados,
        classificacao,
      };
    })
    .filter((x): x is NonNullable<typeof x> => Boolean(x))
    .sort((a, b) => b.totalResgatados - a.totalResgatados);

  res.json({ period, levels, thresholds: { amarelo: thresholds.amarelo, vermelho: thresholds.vermelho } });
});

export { router as abandonmentRoutes };

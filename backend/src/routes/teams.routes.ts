import { Router } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { authenticate, AuthRequest, requireAdmin } from '../middleware/auth.middleware';

const router = Router();
const db = prisma as any;

function clampNumber(value: any, bounds: { min?: number; max?: number }) {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return bounds.min ?? 0;
  if (typeof bounds.min === 'number' && num < bounds.min) return bounds.min;
  if (typeof bounds.max === 'number' && num > bounds.max) return bounds.max;
  return num;
}

function parseISODateOnly(value: string) {
  const v = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

async function ensureTeamBonusConfig() {
  const existing = await db.teamBonusConfig.findUnique({ where: { id: 'default' } }).catch(() => null);
  if (existing) return existing;
  try {
    return await db.teamBonusConfig.create({
      data: { id: 'default', minInternalRescuePercent: 0, leaderBonusEnabled: false, leaderBonusPercent: 0, rules: [] as any },
    });
  } catch (error: any) {
    if (error?.code === 'P2002') {
      const createdByOther = await db.teamBonusConfig.findUnique({ where: { id: 'default' } }).catch(() => null);
      if (createdByOther) return createdByOther;
    }
    throw error;
  }
}

const teamCreateSchema = z.object({
  nome: z.string().min(1),
});

const teamUpdateSchema = z.object({
  nome: z.string().min(1).optional(),
});

const teamAssignSchema = z.object({
  userId: z.string().min(1),
  teamId: z.string().min(1).nullable().optional(),
});

const teamBonusRuleSchema = z.object({
  minVendas: z.number().int().nonnegative(),
  pixValor: z.number().nonnegative(),
});

const teamBonusConfigSchema = z.object({
  minInternalRescuePercent: z.number().min(0).max(100).optional(),
  leaderBonusEnabled: z.boolean().optional(),
  leaderBonusPercent: z.number().min(0).max(100).optional(),
  rules: z.array(teamBonusRuleSchema).optional(),
});

router.get('/', authenticate, requireAdmin, async (_req, res) => {
  const teams = await db.team.findMany({
    orderBy: { nome: 'asc' },
    include: { 
      members: { select: { id: true, nome: true, email: true, role: true } },
      leader: { select: { id: true, nome: true, email: true } },
    },
  });
  res.json({
    teams: (teams as any[]).map((t: any) => ({
      id: t.id,
      nome: t.nome,
      members: (t as any).members || [],
      leader: t.leader ? { id: t.leader.id, nome: t.leader.nome, email: t.leader.email } : null,
      criadoEm: t.createdAt.toISOString(),
    })),
  });
});

router.post('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const input = teamCreateSchema.parse(req.body);
    const nome = String(input.nome || '').trim().replace(/\s+/g, ' ');
    const created = await db.team.create({ data: { nome } });
    res.status(201).json({ team: { id: created.id, nome: created.nome, criadoEm: created.createdAt.toISOString() } });
  } catch (error: any) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Invalid input', details: error.errors });
    if (error?.code === 'P2002') return res.status(400).json({ error: 'Time já existe' });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const input = teamUpdateSchema.parse(req.body);
    const nome = input.nome ? String(input.nome || '').trim().replace(/\s+/g, ' ') : undefined;
    const updated = await db.team.update({ where: { id: req.params.id }, data: { ...(nome ? { nome } : {}) } });
    res.json({ team: { id: updated.id, nome: updated.nome, criadoEm: updated.createdAt.toISOString() } });
  } catch (error: any) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Invalid input', details: error.errors });
    if (error?.code === 'P2025') return res.status(404).json({ error: 'Time não encontrado' });
    if (error?.code === 'P2002') return res.status(400).json({ error: 'Time já existe' });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'ID inválido' });
    await db.user.updateMany({ where: { teamId: id }, data: { teamId: null } });
    await db.team.delete({ where: { id } });
    res.json({ ok: true });
  } catch (error: any) {
    if (error?.code === 'P2025') return res.status(404).json({ error: 'Time não encontrado' });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/assign', authenticate, requireAdmin, async (req, res) => {
  try {
    const input = teamAssignSchema.parse(req.body);
    const userId = String(input.userId);
    const teamId = input.teamId === null ? null : input.teamId ? String(input.teamId) : null;

    if (teamId) {
      const team = await db.team.findUnique({ where: { id: teamId }, select: { id: true } });
      if (!team) return res.status(400).json({ error: 'Time inválido' });
    }

    const updated = await db.user.update({ where: { id: userId }, data: { teamId } });
    res.json({ user: { id: updated.id, teamId: updated.teamId } });
  } catch (error: any) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Invalid input', details: error.errors });
    if (error?.code === 'P2025') return res.status(404).json({ error: 'Usuário não encontrado' });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id/leader', authenticate, requireAdmin, async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'ID inválido' });
    const body = (req.body || {}) as { leaderId?: string | null };
    const leaderId = body.leaderId === null ? null : body.leaderId ? String(body.leaderId) : null;

    if (leaderId) {
      const user = await db.user.findUnique({ where: { id: leaderId }, select: { id: true, role: true, teamId: true } });
      if (!user) return res.status(400).json({ error: 'Líder inválido' });
      if (String(user.role) !== 'vendedor') return res.status(400).json({ error: 'Líder deve ser vendedor' });
      // Garante que o líder pertence ao time; se não, atribui
      if (String(user.teamId || '') !== id) {
        await db.user.update({ where: { id: leaderId }, data: { teamId: id } });
      }
    }

    const updated = await db.team.update({ where: { id }, data: { leaderId } });
    res.json({ team: { id: updated.id, leaderId: updated.leaderId } });
  } catch (error: any) {
    if (error?.code === 'P2025') return res.status(404).json({ error: 'Time não encontrado' });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/bonus-config', authenticate, requireAdmin, async (_req, res) => {
  const cfg = await ensureTeamBonusConfig();
  res.json({
    config: {
      minInternalRescuePercent: cfg.minInternalRescuePercent,
      leaderBonusEnabled: Boolean(cfg.leaderBonusEnabled),
      leaderBonusPercent: cfg.leaderBonusPercent,
      rules: (cfg.rules as any) || [],
    },
  });
});

router.put('/bonus-config', authenticate, requireAdmin, async (req, res) => {
  try {
    const input = teamBonusConfigSchema.parse(req.body);
    const minInternalRescuePercent =
      input.minInternalRescuePercent !== undefined ? clampNumber(input.minInternalRescuePercent, { min: 0, max: 100 }) : undefined;
    const leaderBonusEnabled = input.leaderBonusEnabled !== undefined ? Boolean(input.leaderBonusEnabled) : undefined;
    const leaderBonusPercent =
      input.leaderBonusPercent !== undefined ? clampNumber(input.leaderBonusPercent, { min: 0, max: 100 }) : undefined;
    const rules =
      input.rules !== undefined
        ? (input.rules || [])
            .map((r) => ({
              minVendas: clampNumber(r.minVendas, { min: 0 }),
              pixValor: clampNumber(r.pixValor, { min: 0 }),
            }))
            .sort((a, b) => a.minVendas - b.minVendas)
        : undefined;

    const cfg = await ensureTeamBonusConfig();
    const updated = await db.teamBonusConfig.update({
      where: { id: cfg.id },
      data: {
        ...(minInternalRescuePercent !== undefined ? { minInternalRescuePercent } : {}),
        ...(leaderBonusEnabled !== undefined ? { leaderBonusEnabled } : {}),
        ...(leaderBonusPercent !== undefined ? { leaderBonusPercent } : {}),
        ...(rules !== undefined ? { rules: rules as any } : {}),
      },
    });

    res.json({
      config: {
        minInternalRescuePercent: updated.minInternalRescuePercent,
        leaderBonusEnabled: Boolean(updated.leaderBonusEnabled),
        leaderBonusPercent: updated.leaderBonusPercent,
        rules: (updated.rules as any) || [],
      },
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Invalid input', details: error.errors });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/ranking', authenticate, async (req, res) => {
  const reqUser = req as AuthRequest;
  const start = req.query.start ? parseISODateOnly(String(req.query.start)) : null;
  const endInclusive = req.query.end ? parseISODateOnly(String(req.query.end)) : null;
  const endExclusive = endInclusive ? new Date(endInclusive.getTime() + 24 * 60 * 60 * 1000) : null;

  const teams = await db.team.findMany({
    orderBy: { nome: 'asc' },
    include: { members: { select: { id: true, teamId: true } }, leader: { select: { id: true } } },
  });
  const usersTeamIdByUserId = new Map<string, string>();
  for (const t of teams as any[]) {
    for (const m of (t as any).members || []) {
      usersTeamIdByUserId.set(String(m.id), String((t as any).id));
    }
  }

  const whereCommercial: any = start && endExclusive ? { data: { gte: start, lt: endExclusive } } : {};
  const commercialEntries = await db.commercialEntry.findMany({
    where: whereCommercial,
    select: { vendedorId: true, vendas: true },
  });

  const vendasByTeamId = new Map<string, number>();
  for (const e of commercialEntries) {
    const userId = String(e.vendedorId || '');
    const teamId = usersTeamIdByUserId.get(userId);
    if (!teamId) continue;
    vendasByTeamId.set(teamId, (vendasByTeamId.get(teamId) || 0) + (e.vendas || 0));
  }

  const whereRescue: any = start && endExclusive ? { data: { gte: start, lt: endExclusive } } : {};
  const rescueGrouped = await db.rescueEntry.groupBy({
    by: ['vendedorOrigemId', 'closerId'],
    _sum: { leadsConvertidos: true },
    where: whereRescue,
  });

  const rescueConvertedTotalByTeamId = new Map<string, number>();
  const rescueConvertedInternalByTeamId = new Map<string, number>();
  for (const g of rescueGrouped) {
    const originId = String(g.vendedorOrigemId || '');
    const closerId = String(g.closerId || '');
    if (!originId || !closerId) continue;
    if (originId === closerId) continue;
    const converted = g._sum.leadsConvertidos || 0;
    if (converted <= 0) continue;

    const closerTeamId = usersTeamIdByUserId.get(closerId) || '';
    const originTeamId = usersTeamIdByUserId.get(originId) || '';
    if (!closerTeamId) continue;

    rescueConvertedTotalByTeamId.set(closerTeamId, (rescueConvertedTotalByTeamId.get(closerTeamId) || 0) + converted);
    if (closerTeamId && originTeamId && closerTeamId === originTeamId) {
      rescueConvertedInternalByTeamId.set(closerTeamId, (rescueConvertedInternalByTeamId.get(closerTeamId) || 0) + converted);
    }
  }

  const bonusCfg = await ensureTeamBonusConfig();
  const minInternal = clampNumber(bonusCfg.minInternalRescuePercent, { min: 0, max: 100 });
  const leaderBonusEnabled = Boolean(bonusCfg.leaderBonusEnabled);
  const leaderBonusPercent = clampNumber(bonusCfg.leaderBonusPercent ?? 0, { min: 0, max: 100 });
  const rules = Array.isArray(bonusCfg.rules) ? (bonusCfg.rules as any[]) : [];
  const sortedRules = rules
    .map((r) => ({ minVendas: clampNumber(r?.minVendas ?? 0, { min: 0 }), pixValor: clampNumber(r?.pixValor ?? 0, { min: 0 }) }))
    .sort((a, b) => a.minVendas - b.minVendas);

  const ranking = (teams as any[])
    .map((t: any) => {
      const teamId = String(t.id);
      const vendas = vendasByTeamId.get(teamId) || 0;
      const rescueTotal = rescueConvertedTotalByTeamId.get(teamId) || 0;
      const rescueInternal = rescueConvertedInternalByTeamId.get(teamId) || 0;
      const internalPercent = rescueTotal > 0 ? (rescueInternal / rescueTotal) * 100 : 0;
      const achieved = sortedRules.filter((r) => vendas >= r.minVendas).slice(-1)[0] || null;
      const pixValor = achieved && internalPercent >= minInternal ? achieved.pixValor : 0;
      const leaderId = String((t as any)?.leader?.id || '');
      const leaderPix = leaderBonusEnabled && leaderId && pixValor > 0 ? pixValor * (leaderBonusPercent / 100) : 0;
      return {
        teamId,
        nome: t.nome,
        membros: ((t as any).members || []).length,
        vendas,
        rescueConvertedTotal: rescueTotal,
        rescueConvertedInternal: rescueInternal,
        internalRescuePercent: internalPercent,
        bonusPixValor: pixValor,
        leaderId: leaderId || null,
        leaderPixValor: leaderPix,
      };
    })
    .sort((a: any, b: any) => b.vendas - a.vendas || b.bonusPixValor - a.bonusPixValor || String(a.nome).localeCompare(String(b.nome)));

  const myTeamId = usersTeamIdByUserId.get(String(reqUser.userId)) || null;
  const myIndex = myTeamId ? ranking.findIndex((r) => r.teamId === myTeamId) : -1;
  const myPosition = myIndex >= 0 ? myIndex + 1 : null;

  res.json({
    range: start && endInclusive ? { start: start.toISOString().slice(0, 10), end: endInclusive.toISOString().slice(0, 10) } : null,
    myPosition,
    ranking,
    config: { minInternalRescuePercent: minInternal, leaderBonusEnabled, leaderBonusPercent, rules: sortedRules },
  });
});

export { router as teamsRoutes };

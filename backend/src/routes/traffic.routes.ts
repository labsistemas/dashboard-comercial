import { requireDataPermission } from '../middleware/auth.middleware';
import { Router } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { authenticate, AuthRequest, requireAdmin } from '../middleware/auth.middleware';

const router = Router();

type DbProductName = { id: string; nome: string };

function parseDateOnly(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

const trafficCreateSchema = z.object({
  produto: z.string().min(1),
  semana: z.string().min(1),
  periodoTipo: z.enum(['weekly', 'monthly']).optional(),
  vendedorId: z.string().optional().nullable(),
  investimento: z.number().finite().nonnegative(),
  leads: z.number().int().nonnegative(),
  cpl: z.number().finite().nonnegative().optional(),
  vendas: z.number().int().nonnegative().optional(),
  receita: z.number().finite().nonnegative().optional(),
  roas: z.number().finite().optional(),
  roi: z.number().finite().optional(),
  alcance: z.number().int().nonnegative().optional(),
  impressoes: z.number().int().nonnegative().optional(),
  cliques: z.number().int().nonnegative().optional(),
});

const trafficUpdateSchema = trafficCreateSchema.partial();

function computeCpl(investimento: number, leads: number) {
  if (!leads) return 0;
  return investimento / leads;
}

function computeRoas(investimento: number, receita: number) {
  if (investimento > 0) return receita / investimento;
  if (receita > 0) return receita / 100;
  return 0;
}

function computeCtrPercent(cliques?: number | null, impressoes?: number | null) {
  const c = cliques || 0;
  const i = impressoes || 0;
  if (!i) return 0;
  return (c / i) * 100;
}

function computeCpc(investimento: number, cliques?: number | null) {
  const c = cliques || 0;
  if (!c) return 0;
  return investimento / c;
}

function computeCpm(investimento: number, impressoes?: number | null) {
  const i = impressoes || 0;
  if (!i) return 0;
  return investimento / (i / 1000);
}

const productRankingQuerySchema = z.object({
  start: z.string().min(1),
  end: z.string().min(1),
  limit: z.string().optional(),
});

function normalizeProductKey(value: string) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

const TRAFFIC_CAMPAIGN_PREFIX = '__campanha__:';

function isCampaignStoredProduto(value: string) {
  return String(value || '').startsWith(TRAFFIC_CAMPAIGN_PREFIX);
}

function getCampaignNameFromStoredProduto(value: string) {
  const raw = String(value || '').trim();
  if (!isCampaignStoredProduto(raw)) return raw;
  return raw.slice(TRAFFIC_CAMPAIGN_PREFIX.length).trim();
}

function computeCommercialEntryNetRevenue(entry: {
  saleLines?: Array<{ quantidade?: number | null; precoUnitario?: number | null }>;
  valorLiquido?: number | null;
  descontoValor?: number | null;
  descontoPercent?: number | null;
}) {
  const lines = Array.isArray(entry.saleLines) ? entry.saleLines : [];
  const grossRevenue = lines.reduce((sum, line) => {
    const qty = typeof line.quantidade === 'number' ? line.quantidade : 0;
    const unit = typeof line.precoUnitario === 'number' ? line.precoUnitario : 0;
    if (qty <= 0 || unit <= 0) return sum;
    return sum + qty * unit;
  }, 0);

  if (typeof entry.valorLiquido === 'number' && Number.isFinite(entry.valorLiquido)) {
    return { grossRevenue, netRevenue: Math.max(entry.valorLiquido, 0) };
  }

  const descontoValor =
    typeof entry.descontoValor === 'number' && Number.isFinite(entry.descontoValor)
      ? Math.max(entry.descontoValor, 0)
      : typeof entry.descontoPercent === 'number' && Number.isFinite(entry.descontoPercent)
        ? Math.max(grossRevenue * (entry.descontoPercent / 100), 0)
        : 0;

  return { grossRevenue, netRevenue: Math.max(grossRevenue - descontoValor, 0) };
}

function getPeriodBounds(semana: Date, periodoTipo?: 'weekly' | 'monthly') {
  const startAt = new Date(semana);
  startAt.setHours(0, 0, 0, 0);
  const endExclusive = new Date(startAt);
  const tipo = periodoTipo || 'weekly';
  if (tipo === 'weekly') {
    endExclusive.setDate(endExclusive.getDate() + 7);
  } else {
    endExclusive.setMonth(endExclusive.getMonth() + 1);
  }
  return { startAt, endExclusive };
}

async function computeSalesForTraffic(produtoNome: string, startAt: Date, endExclusive: Date) {
  const normalizedKey = normalizeProductKey(produtoNome);
  const normalizedCampaignKey = normalizeProductKey(getCampaignNameFromStoredProduto(produtoNome));
  const isCampaign = isCampaignStoredProduto(produtoNome);
  const commercial = await prisma.commercialEntry.findMany({
    where: { data: { gte: startAt, lt: endExclusive } },
    include: {
      saleLines: true,
    },
  });
  const productIds = new Set<string>();
  for (const e of commercial) {
    for (const l of e.saleLines) productIds.add(String(l.produtoId));
  }
  const products = productIds.size
    ? ((await prisma.product.findMany({ where: { id: { in: Array.from(productIds) } }, select: { id: true, nome: true } })) as unknown as DbProductName[])
    : [];
  const productNameById = new Map(products.map((p: DbProductName) => [p.id, p.nome]));

  let vendas = 0;
  let receita = 0;
  for (const e of commercial) {
    const { grossRevenue, netRevenue } = computeCommercialEntryNetRevenue(e);

    if (isCampaign) {
      const campaignScope = String((e as any).campaignScope || 'geral');
      const campaignName = String((e as any).campaignName || '').trim();
      if (campaignScope !== 'campanha') continue;
      if (normalizeProductKey(campaignName) !== normalizedCampaignKey) continue;

      const totalQty = e.saleLines.reduce((sum, line) => {
        const qty = typeof line.quantidade === 'number' ? line.quantidade : 0;
        return qty > 0 ? sum + qty : sum;
      }, 0);
      vendas += totalQty > 0 ? totalQty : Math.max(typeof (e as any).vendas === 'number' ? (e as any).vendas : 0, 0);
      receita += netRevenue;
      continue;
    }

    for (const l of e.saleLines) {
      const nome = String(productNameById.get(String(l.produtoId)) || '').trim();
      if (!nome) continue;
      if (normalizeProductKey(nome) !== normalizedKey) continue;
      const qtd = typeof l.quantidade === 'number' ? l.quantidade : 0;
      const preco = typeof l.precoUnitario === 'number' ? l.precoUnitario : 0;
      if (qtd <= 0 || preco <= 0) continue;
      vendas += qtd;
      receita += grossRevenue > 0 ? netRevenue * ((qtd * preco) / grossRevenue) : 0;
    }
  }
  return { vendas, receita };
}

function sameNumber(a: number, b: number, epsilon = 0.0001) {
  return Math.abs(a - b) <= epsilon;
}

router.get('/product-ranking', authenticate, requireDataPermission('trafficRead'), async (req, res) => {
  try {
    const reqUser = req as AuthRequest;
    if (reqUser.userRole !== 'admin' && reqUser.userRole !== 'gestor') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const query = productRankingQuerySchema.parse(req.query);
    const start = parseDateOnly(String(query.start));
    const end = parseDateOnly(String(query.end));
    if (!start || !end) return res.status(400).json({ error: 'Período inválido' });

    const startAt = new Date(start);
    startAt.setHours(0, 0, 0, 0);
    const endExclusive = new Date(end);
    endExclusive.setHours(0, 0, 0, 0);
    endExclusive.setDate(endExclusive.getDate() + 1);

    const limit = Math.min(100, Math.max(1, parseInt(String(query.limit || '20'), 10) || 20));

    const traffic = await prisma.trafficEntry.findMany({
      where: { semana: { gte: startAt, lt: endExclusive } },
      select: { produto: true, leads: true, vendas: true },
    });

    const leadsByKey = new Map<string, { produto: string; leads: number }>();
    for (const t of traffic) {
      const produto = String(t.produto || '').trim();
      if (!produto) continue;
      const key = normalizeProductKey(produto);
      const prev = leadsByKey.get(key);
      leadsByKey.set(key, { produto: prev?.produto || produto, leads: (prev?.leads || 0) + (t.leads || 0) });
    }

    const vendasByKey = new Map<string, { produto: string; vendas: number }>();
    for (const t of traffic) {
      const produto = String(t.produto || '').trim();
      if (!produto) continue;
      const key = normalizeProductKey(produto);
      const prev = vendasByKey.get(key);
      vendasByKey.set(key, { produto: prev?.produto || produto, vendas: (prev?.vendas || 0) + (t.vendas || 0) });
    }

    const keys = new Set<string>([...leadsByKey.keys(), ...vendasByKey.keys()]);
    const rows = Array.from(keys).map((key) => {
      const leadsInfo = leadsByKey.get(key);
      const salesInfo = vendasByKey.get(key);
      const produto = leadsInfo?.produto || salesInfo?.produto || '—';
      const leads = leadsInfo?.leads || 0;
      const vendas = salesInfo?.vendas || 0;
      const conversaoPercent = leads > 0 ? (vendas / leads) * 100 : 0;
      return { produto, leads, vendas, conversaoPercent, topVendedores: [] };
    });

    rows.sort((a, b) => {
      if (b.conversaoPercent !== a.conversaoPercent) return b.conversaoPercent - a.conversaoPercent;
      if (b.vendas !== a.vendas) return b.vendas - a.vendas;
      return b.leads - a.leads;
    });

    res.json({ ranking: rows.slice(0, limit), total: rows.length });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/', authenticate, requireDataPermission('trafficRead'), async (req, res) => {
  const reqUser = req as AuthRequest;
  const entries = await prisma.trafficEntry.findMany({
    where:
      reqUser.userRole === 'admin' || reqUser.userRole === 'gestor'
        ? {}
        : {
            OR: [{ criadoPorId: String(reqUser.userId) }, { vendedorId: String(reqUser.userId) }],
          },
    include: {
      criadoPor: { select: { nome: true } },
      vendedor: { select: { nome: true } },
    },
    orderBy: { semana: 'desc' },
  });

  const computedCache = new Map<string, Promise<{ vendas: number; receita: number }>>();

  const hydratedEntries = await Promise.all(
    entries.map(async (entry) => {
      const periodoTipo = (entry.periodoTipo || 'weekly') as 'weekly' | 'monthly';
      const { startAt, endExclusive } = getPeriodBounds(entry.semana, periodoTipo);
      const cacheKey = `${entry.produto}::${startAt.toISOString()}::${endExclusive.toISOString()}`;
      let computedPromise = computedCache.get(cacheKey);
      if (!computedPromise) {
        computedPromise = computeSalesForTraffic(entry.produto, startAt, endExclusive);
        computedCache.set(cacheKey, computedPromise);
      }

      const computed = await computedPromise;
      const nextRoas = computeRoas(entry.investimento || 0, computed.receita || 0);
      const needsUpdate =
        entry.vendas !== computed.vendas ||
        !sameNumber(entry.receita || 0, computed.receita || 0) ||
        !sameNumber(entry.roi || 0, nextRoas || 0);

      if (!needsUpdate) return entry;

      return prisma.trafficEntry.update({
        where: { id: entry.id },
        data: {
          vendas: computed.vendas,
          receita: computed.receita,
          roi: nextRoas,
        },
        include: {
          criadoPor: { select: { nome: true } },
          vendedor: { select: { nome: true } },
        },
      });
    }),
  );

  res.json({
    entries: hydratedEntries.map((e: any) => ({
      id: e.id,
      produto: e.produto,
      semana: e.semana.toISOString().slice(0, 10),
      periodoTipo: e.periodoTipo || 'weekly',
      investimento: e.investimento,
      leads: e.leads,
      cpl: e.cpl,
      vendas: e.vendas,
      receita: e.receita,
        roas: computeRoas(e.investimento || 0, e.receita || 0),
      alcance: e.alcance ?? null,
      impressoes: e.impressoes ?? null,
      cliques: e.cliques ?? null,
      ctrPercent: e.ctrPercent ?? null,
      cpc: e.cpc ?? null,
      cpm: e.cpm ?? null,
      vendedorId: e.vendedorId ?? null,
      vendedorNome: e.vendedor?.nome ?? null,
      criadoPor: e.criadoPorId,
      criadoPorNome: e.criadoPor?.nome ?? null,
      criadoEm: e.createdAt.toISOString(),
    })),
  });
});

router.post('/', authenticate, requireDataPermission('trafficWrite'), async (req, res) => {
  try {
    const input = trafficCreateSchema.parse(req.body);
    const semana = parseDateOnly(input.semana);
    if (!semana) return res.status(400).json({ error: 'Semana inválida' });

    const reqUser = req as AuthRequest;

    const cpl = computeCpl(input.investimento, input.leads);
    const ctrPercent = computeCtrPercent(input.cliques, input.impressoes);
    const cpc = computeCpc(input.investimento, input.cliques);
    const cpm = computeCpm(input.investimento, input.impressoes);
    const vendedorId =
      reqUser.userRole === 'admin'
        ? input.vendedorId
          ? String(input.vendedorId)
          : null
        : String(reqUser.userId);

    const { startAt, endExclusive } = getPeriodBounds(semana, input.periodoTipo);
    const computed = await computeSalesForTraffic(input.produto, startAt, endExclusive);
    const vendas = computed.vendas;
    const receita = computed.receita;
    const roas = computeRoas(input.investimento, receita);

    const created = await prisma.trafficEntry.create({
      data: {
        produto: input.produto,
        semana,
        periodoTipo: input.periodoTipo || 'weekly',
        investimento: input.investimento,
        leads: input.leads,
        cpl,
        vendas,
        receita,
        roi: roas,
        alcance: input.alcance ?? null,
        impressoes: input.impressoes ?? null,
        cliques: input.cliques ?? null,
        ctrPercent,
        cpc,
        cpm,
        vendedorId,
        criadoPorId: reqUser.userId!,
      },
    });

    res.status(201).json({
      entry: {
        id: created.id,
        produto: created.produto,
        semana: created.semana.toISOString().slice(0, 10),
        periodoTipo: created.periodoTipo || 'weekly',
        investimento: created.investimento,
        leads: created.leads,
        cpl: created.cpl,
        vendas: created.vendas,
        receita: created.receita,
        roas: computeRoas(created.investimento || 0, created.receita || 0),
        alcance: created.alcance ?? null,
        impressoes: created.impressoes ?? null,
        cliques: created.cliques ?? null,
        ctrPercent: created.ctrPercent ?? null,
        cpc: created.cpc ?? null,
        cpm: created.cpm ?? null,
        vendedorId: created.vendedorId ?? null,
        criadoPor: created.criadoPorId,
        criadoEm: created.createdAt.toISOString(),
      },
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id', authenticate, requireDataPermission('trafficWrite'), async (req, res) => {
  try {
    const input = trafficUpdateSchema.parse(req.body);
    const reqUser = req as AuthRequest;

    const existing = await prisma.trafficEntry.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Registro não encontrado' });

    const canEditAll = reqUser.userRole === 'admin' || reqUser.userRole === 'gestor';
    const isOwner = existing.criadoPorId === reqUser.userId;
    const isAssignedSeller = existing.vendedorId && existing.vendedorId === reqUser.userId;
    if (!canEditAll && !isOwner && !isAssignedSeller) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const semana = input.semana ? parseDateOnly(input.semana) : null;
    if (input.semana && !semana) return res.status(400).json({ error: 'Semana inválida' });

    const investimento = canEditAll ? input.investimento ?? existing.investimento : existing.investimento;
    const leads = canEditAll ? input.leads ?? existing.leads : existing.leads;
    const impressoes = canEditAll ? input.impressoes ?? existing.impressoes ?? null : existing.impressoes ?? null;
    const cliques = canEditAll ? input.cliques ?? existing.cliques ?? null : existing.cliques ?? null;
    const cpl = computeCpl(investimento, leads);
    const ctrPercent = computeCtrPercent(cliques, impressoes);
    const cpc = computeCpc(investimento, cliques);
    const cpm = computeCpm(investimento, impressoes);

    const nextProduto = canEditAll ? input.produto ?? existing.produto : existing.produto;
    const nextSemana = canEditAll ? semana ?? existing.semana : existing.semana;
    const nextPeriodo = canEditAll ? input.periodoTipo ?? existing.periodoTipo ?? 'weekly' : existing.periodoTipo ?? 'weekly';
    const { startAt, endExclusive } = getPeriodBounds(nextSemana, nextPeriodo as any);
    const sales = await computeSalesForTraffic(nextProduto, startAt, endExclusive);
    const vendas = sales.vendas;
    const receita = sales.receita;
    const roas = computeRoas(investimento, receita);

    const updated = await prisma.trafficEntry.update({
      where: { id: existing.id },
      data: {
        produto: nextProduto,
        semana: nextSemana,
        periodoTipo: nextPeriodo,
        investimento,
        leads,
        cpl,
        vendas,
        receita,
        roi: roas,
        alcance: canEditAll ? input.alcance ?? existing.alcance ?? null : existing.alcance ?? null,
        impressoes,
        cliques,
        ctrPercent,
        cpc,
        cpm,
        vendedorId:
          canEditAll && input.vendedorId !== undefined ? (input.vendedorId ? String(input.vendedorId) : null) : existing.vendedorId ?? null,
      },
    });

    res.json({
      entry: {
        id: updated.id,
        produto: updated.produto,
        semana: updated.semana.toISOString().slice(0, 10),
        periodoTipo: updated.periodoTipo || 'weekly',
        investimento: updated.investimento,
        leads: updated.leads,
        cpl: updated.cpl,
        vendas: updated.vendas,
        receita: updated.receita,
        roas: computeRoas(updated.investimento || 0, updated.receita || 0),
        alcance: updated.alcance ?? null,
        impressoes: updated.impressoes ?? null,
        cliques: updated.cliques ?? null,
        ctrPercent: updated.ctrPercent ?? null,
        cpc: updated.cpc ?? null,
        cpm: updated.cpm ?? null,
        vendedorId: updated.vendedorId ?? null,
        criadoPor: updated.criadoPorId,
        criadoEm: updated.createdAt.toISOString(),
      },
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:id', authenticate, requireDataPermission('trafficWrite'), async (req, res) => {
  try {
    const reqUser = req as AuthRequest;
    const existing = await prisma.trafficEntry.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Registro não encontrado' });

    if (reqUser.userRole !== 'admin' && reqUser.userRole !== 'gestor' && existing.criadoPorId !== reqUser.userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    await prisma.trafficEntry.delete({ where: { id: existing.id } });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/', authenticate, requireDataPermission('trafficWrite'), requireAdmin, async (req, res) => {
  await prisma.trafficEntry.deleteMany({});
  res.json({ ok: true });
});

export { router as trafficRoutes };

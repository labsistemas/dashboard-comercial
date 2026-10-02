import { requireDataPermission } from '../middleware/auth.middleware';
import { Router } from 'express';
import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';
import rateLimit from 'express-rate-limit';
import prisma from '../lib/prisma';
import { authenticate, AuthRequest, requireAdmin } from '../middleware/auth.middleware';

const configWriteLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

const configReadLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

const router = Router();

function parseDateOnly(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

const saleLineSchema = z.object({
  produtoId: z.string().min(1),
  quantidade: z.number().int().nonnegative(),
  precoUnitario: z.number().nonnegative().optional().nullable(),
});

const campaignScopeSchema = z.enum(['geral', 'campanha']);

const commercialCreateSchema = z.object({
  data: z.string().min(1),
  vendedorId: z.string().optional(),
  campaignScope: campaignScopeSchema.optional(),
  campaignName: z.string().trim().max(120).optional().nullable(),
  leadsAtendidos: z.number().int().nonnegative(),
  agendamentos: z.number().int().nonnegative(),
  vendas: z.number().int().nonnegative(),
  followUps: z.number().int().nonnegative(),
  vendasPorProduto: z.array(saleLineSchema).optional(),
  descontoPercent: z.number().min(0).max(100).optional(),
  alunoNome: z.string().optional().nullable(),
});

const commercialUpdateSchema = commercialCreateSchema.partial();

function mergeLines(lines: Array<{ produtoId: string; quantidade: number; precoUnitario?: number | null }>) {
  const map = new Map<string, { quantidade: number; precoUnitario: number }>();
  for (const l of lines) {
    const id = String(l.produtoId);
    const qty = Number(l.quantidade) || 0;
    if (!id) continue;
    const existing = map.get(id);
    const incomingPrice = clampNumber(Number(l.precoUnitario) || 0, { min: 0 });
    if (!existing) {
      map.set(id, { quantidade: qty, precoUnitario: incomingPrice });
    } else {
      existing.quantidade += qty;
      if (existing.precoUnitario <= 0 && incomingPrice > 0) existing.precoUnitario = incomingPrice;
    }
  }
  return Array.from(map.entries()).map(([produtoId, v]) => ({ produtoId, quantidade: v.quantidade, precoUnitario: v.precoUnitario }));
}

function clampNumber(n: number, { min, max }: { min?: number; max?: number } = {}) {
  let out = Number.isFinite(n) ? n : 0;
  if (min !== undefined) out = Math.max(min, out);
  if (max !== undefined) out = Math.min(max, out);
  return out;
}

function parseISODateOnly(value: string) {
  const v = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function addDaysUTC(date: Date, days: number) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days, 0, 0, 0, 0));
}

function startOfISOWeek(d: Date) {
  const out = new Date(d);
  const day = out.getUTCDay() || 7;
  out.setUTCDate(out.getUTCDate() - (day - 1));
  out.setUTCHours(0, 0, 0, 0);
  return out;
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const AWARDS_FILE = path.join(DATA_DIR, 'commercial-awards.json');
const RESCUE_PENALTY_FILE = path.join(DATA_DIR, 'commercial-rescue-penalty.json');

const awardRuleSchema = z.object({
  id: z.string().min(1),
  vendedorId: z.string().min(1).optional().nullable(),
  minVendas: z.number().int().min(0),
  pixValor: z.number().min(0),
});

const awardsConfigSchema = z.object({
  period: z.enum(['weekly', 'monthly', 'quarterly']).default('weekly'),
  rules: z.array(awardRuleSchema).default([]),
});

type AwardsConfig = z.infer<typeof awardsConfigSchema>;

const rescuePenaltySchema = z.object({
  percentPerSale: z.number().min(0).max(100).default(0),
});

const rescuePenaltyLegacySchema = z.object({
  penaltyPerSale: z.number().min(0).default(0),
});

type RescuePenaltyConfig = z.infer<typeof rescuePenaltySchema>;

type DbProductPrice = { id: string; preco: number };
type DbProductPricing = { id: string; preco: number; maxDescontoPercent: number };
type DbProductActive = { id: string; ativo: boolean };

async function getAwardsConfigFromDb(): Promise<AwardsConfig | null> {
  try {
    const existing = await prisma.commercialAwardsConfig.findUnique({ where: { id: 'default' } }).catch(() => null);
    if (!existing) return null;
    const parsed = awardsConfigSchema.parse({
      period: String(existing.period || 'weekly'),
      rules: Array.isArray(existing.rules) ? existing.rules : [],
    });
    return parsed;
  } catch {
    return null;
  }
}

async function saveAwardsConfigToDb(cfg: AwardsConfig): Promise<void> {
  await prisma.commercialAwardsConfig.upsert({
    where: { id: 'default' },
    update: { period: cfg.period, rules: cfg.rules as any },
    create: { id: 'default', period: cfg.period, rules: cfg.rules as any },
  });
}

async function getAwardsConfigFromFile(): Promise<AwardsConfig> {
  try {
    await fs.access(AWARDS_FILE);
    const raw = await fs.readFile(AWARDS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return awardsConfigSchema.parse(parsed);
  } catch {
    return awardsConfigSchema.parse({ period: 'weekly', rules: [] });
  }
}

async function saveAwardsConfigToFile(cfg: AwardsConfig): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(AWARDS_FILE, JSON.stringify(cfg, null, 2));
}

async function getAwardsConfig(): Promise<AwardsConfig> {
  const fromDb = await getAwardsConfigFromDb();
  if (fromDb) return fromDb;
  const fromFile = await getAwardsConfigFromFile();
  await saveAwardsConfigToDb(fromFile).catch(() => undefined);
  return fromFile;
}

async function saveAwardsConfig(cfg: AwardsConfig): Promise<void> {
  try {
    await saveAwardsConfigToDb(cfg);
  } catch {
    await saveAwardsConfigToFile(cfg);
  }
}

async function getRescuePenaltyConfig(): Promise<RescuePenaltyConfig> {
  try {
    await fs.access(RESCUE_PENALTY_FILE);
    const raw = await fs.readFile(RESCUE_PENALTY_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    try {
      return rescuePenaltySchema.parse(parsed);
    } catch {
      const legacy = rescuePenaltyLegacySchema.parse(parsed);
      const percent = clampNumber(legacy.penaltyPerSale ?? 0, { min: 0, max: 100 });
      return rescuePenaltySchema.parse({ percentPerSale: percent });
    }
  } catch {
    return rescuePenaltySchema.parse({ percentPerSale: 0 });
  }
}

async function saveRescuePenaltyConfig(cfg: RescuePenaltyConfig): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(RESCUE_PENALTY_FILE, JSON.stringify(cfg, null, 2));
}

async function computeEntryTotals(args: {
  tx: { user: typeof prisma.user; product: typeof prisma.product };
  vendedorId: string;
  linhas: Array<{ produtoId: string; quantidade: number; precoUnitario?: number | null }>;
  descontoPercent?: number | null;
}) {
  const produtoIds = Array.from(new Set(args.linhas.map((l) => String(l.produtoId)).filter(Boolean)));

  const seller = await args.tx.user.findUnique({
    where: { id: args.vendedorId },
    select: { comissaoPercent: true },
  });

  const products: DbProductPricing[] =
    produtoIds.length > 0
      ? ((await args.tx.product.findMany({
          where: { id: { in: produtoIds } },
          select: { id: true, preco: true, maxDescontoPercent: true },
        })) as unknown as DbProductPricing[])
      : [];

  const productsById = new Map(products.map((p) => [p.id, p]));
  const sellerCommissionPercent = clampNumber(seller?.comissaoPercent ?? 0, { min: 0, max: 100 });

  let grossRevenue = 0;
  let grossCommission = 0;
  let maxDiscountAllowed = 0;

  if (args.linhas.length > 0) {
    maxDiscountAllowed = 100;
    for (const l of args.linhas) {
      const product = productsById.get(String(l.produtoId));
      const snapshotPrice = clampNumber(Number(l.precoUnitario) || 0, { min: 0 });
      const price = snapshotPrice > 0 ? snapshotPrice : clampNumber(product?.preco ?? 0, { min: 0 });
      const qty = clampNumber(l.quantidade ?? 0, { min: 0 });
      const revenue = price * qty;
      grossRevenue += revenue;

      grossCommission += revenue * (sellerCommissionPercent / 100);

      const maxDesc = clampNumber(product?.maxDescontoPercent ?? 0, { min: 0, max: 100 });
      maxDiscountAllowed = Math.min(maxDiscountAllowed, maxDesc);
    }

    if (!Number.isFinite(maxDiscountAllowed)) maxDiscountAllowed = 0;
    if (maxDiscountAllowed === 100) maxDiscountAllowed = clampNumber(maxDiscountAllowed, { min: 0, max: 100 });
  }

  const descontoPercent = clampNumber(args.descontoPercent ?? 0, { min: 0, max: maxDiscountAllowed });
  const descontoValor = descontoPercent > 0 ? clampNumber(grossRevenue * (descontoPercent / 100), { min: 0 }) : 0;
  const valorLiquido = Math.max(grossRevenue - descontoValor, 0);
  const comissao = grossRevenue > 0 ? grossCommission * (valorLiquido / grossRevenue) : 0;

  return {
    descontoPercent: descontoPercent > 0 ? descontoPercent : null,
    descontoValor: descontoValor > 0 ? descontoValor : null,
    valorBruto: grossRevenue > 0 ? grossRevenue : null,
    valorLiquido: valorLiquido > 0 ? valorLiquido : null,
    comissao: comissao > 0 ? comissao : null,
  };
}

router.get('/ranking', authenticate, requireDataPermission('commercialRead'), configReadLimiter, async (req, res) => {
  const reqUser = req as AuthRequest;
  const period = String(req.query.period || 'mes').toLowerCase();
  const refStr = String(req.query.ref || '').trim();
  const ref = refStr ? parseISODateOnly(refStr) : new Date();
  if (!ref) return res.status(400).json({ error: 'Data inválida' });

  const todayIso = new Date().toISOString().slice(0, 10);
  const today = parseISODateOnly(todayIso) || new Date();

  const base = period === 'hoje' ? today : ref;
  let start: Date | null = null;
  let end: Date | null = null;

  if (period === 'tudo') {
    start = null;
    end = null;
  } else if (period === 'hoje') {
    start = new Date(base);
    start.setUTCHours(0, 0, 0, 0);
    end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);
  } else if (period === 'semana') {
    start = startOfISOWeek(base);
    end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 7);
  } else if (period === 'mes') {
    start = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), 1, 0, 0, 0, 0));
    end = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  } else {
    return res.status(400).json({ error: 'Período inválido' });
  }

  const where =
    start && end
      ? { data: { gte: start, lt: end } }
      : {};

  const entries = await prisma.commercialEntry.findMany({
    where,
    select: {
      vendedorId: true,
      leadsAtendidos: true,
      agendamentos: true,
      vendas: true,
      followUps: true,
      valorBruto: true,
      valorLiquido: true,
      comissao: true,
      vendedor: { select: { id: true, nome: true, avatar: true, emTreinamento: true, treinamentoAte: true } },
    },
  });

  const penaltyCfg = await getRescuePenaltyConfig();
  const rescueGrouped = await prisma.rescueEntry.groupBy({
    by: ['vendedorOrigemId', 'closerId'],
    _sum: { leadsConvertidos: true },
    where: start && end ? { data: { gte: start, lt: end } } : {},
  });
  const penaltyByVendedorOrigem = new Map<string, number>();
  for (const g of rescueGrouped) {
    const origin = String(g.vendedorOrigemId || '');
    const closer = String(g.closerId || '');
    if (!origin) continue;
    if (!closer) continue;
    if (origin === closer) continue;
    const converted = g._sum.leadsConvertidos || 0;
    if (converted <= 0) continue;
    penaltyByVendedorOrigem.set(origin, (penaltyByVendedorOrigem.get(origin) || 0) + converted);
  }

  const map = new Map<
    string,
    {
      vendedorId: string;
      nome: string;
      avatar: string;
      leads: number;
      agendamentos: number;
      vendas: number;
      followUps: number;
      bruto: number;
      liquido: number;
      comissao: number;
      penalidadeQtd: number;
      penalidadePercent: number;
      emTreinamento: boolean;
      treinamentoAte: string | null;
    }
  >();

  for (const e of entries) {
    const id = String(e.vendedorId);
    const nome = String(e.vendedor?.nome || '—');
    if (!map.has(id)) {
      const qtd = penaltyByVendedorOrigem.get(id) || 0;
      const penaltyPercent = clampNumber(qtd * clampNumber(penaltyCfg.percentPerSale ?? 0, { min: 0, max: 100 }), { min: 0, max: 100 });
      map.set(id, {
        vendedorId: id,
        nome,
        avatar: e.vendedor?.avatar ? `/api/upload/proxy/${String(e.vendedor.avatar)}` : '',
        leads: 0,
        agendamentos: 0,
        vendas: 0,
        followUps: 0,
        bruto: 0,
        liquido: 0,
        comissao: 0,
        penalidadeQtd: qtd,
        penalidadePercent: penaltyPercent,
        emTreinamento: Boolean((e.vendedor as any)?.emTreinamento),
        treinamentoAte: (e.vendedor as any)?.treinamentoAte ? new Date((e.vendedor as any).treinamentoAte).toISOString().slice(0, 10) : null,
      });
    }
    const row = map.get(id)!;
    row.leads += e.leadsAtendidos || 0;
    row.agendamentos += e.agendamentos || 0;
    row.vendas += e.vendas || 0;
    row.followUps += e.followUps || 0;
    row.bruto += typeof e.valorBruto === 'number' ? e.valorBruto : 0;
    row.liquido += typeof e.valorLiquido === 'number' ? e.valorLiquido : 0;
    row.comissao += typeof e.comissao === 'number' ? e.comissao : 0;
  }

  const ranking = Array.from(map.values()).sort((a, b) => b.vendas - a.vendas);
  const myIndex = ranking.findIndex((r) => r.vendedorId === String(reqUser.userId));
  const myPosition = myIndex >= 0 ? myIndex + 1 : null;

  res.json({
    period,
    myPosition: reqUser.userRole === 'vendedor' ? myPosition : myPosition,
    ranking,
    rescuePenaltyPercentPerSale: clampNumber(penaltyCfg.percentPerSale ?? 0, { min: 0, max: 100 }),
  });
});

router.get('/rescue-penalty', authenticate, requireDataPermission('commercialRead'), requireAdmin, configReadLimiter, async (_req, res) => {
  const cfg = await getRescuePenaltyConfig();
  res.json(cfg);
});

router.put('/rescue-penalty', authenticate, requireDataPermission('commercialWrite'), requireAdmin, configWriteLimiter, async (req, res) => {
  try {
    const body = req.body || {};
    const cfg =
      typeof body?.percentPerSale !== 'undefined'
        ? rescuePenaltySchema.parse(body)
        : rescuePenaltySchema.parse({ percentPerSale: clampNumber(rescuePenaltyLegacySchema.parse(body).penaltyPerSale ?? 0, { min: 0, max: 100 }) });
    await saveRescuePenaltyConfig(cfg);
    res.json(cfg);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/awards', authenticate, requireDataPermission('commercialRead'), configReadLimiter, async (_req, res) => {
  const cfg = await getAwardsConfig();
  res.json(cfg);
});

router.put('/awards', authenticate, requireDataPermission('commercialWrite'), requireAdmin, configWriteLimiter, async (req, res) => {
  try {
    const cfg = awardsConfigSchema.parse(req.body || {});
    await saveAwardsConfig(cfg);
    res.json(cfg);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/', authenticate, requireDataPermission('commercialRead'), async (req, res) => {
  const reqUser = req as AuthRequest;

  const startQuery = typeof req.query.start === 'string' ? req.query.start : '';
  const endQuery = typeof req.query.end === 'string' ? req.query.end : '';
  const startDate = parseISODateOnly(startQuery);
  const endDateInclusive = parseISODateOnly(endQuery);
  const endDateExclusive = endDateInclusive ? addDaysUTC(endDateInclusive, 1) : null;

  const where: any = reqUser.userRole === 'admin' || reqUser.userRole === 'gestor' ? {} : { vendedorId: String(reqUser.userId) };
  if (startDate || endDateExclusive) {
    where.data = {
      ...(startDate ? { gte: startDate } : {}),
      ...(endDateExclusive ? { lt: endDateExclusive } : {}),
    };
  }

  const entries = await prisma.commercialEntry.findMany({
    where,
    include: { saleLines: true, vendedor: { select: { nome: true } } },
    orderBy: { data: 'desc' },
  });

  res.json({
    entries: entries.map((e: any) => ({
      id: e.id,
      data: e.data.toISOString().slice(0, 10),
      vendedorId: e.vendedorId,
      vendedorNome: e.vendedor?.nome ?? null,
      campaignScope: e.campaignScope === 'campanha' ? 'campanha' : 'geral',
      campaignName: e.campaignName ?? null,
      leadsAtendidos: e.leadsAtendidos,
      agendamentos: e.agendamentos,
      vendas: e.vendas,
      followUps: e.followUps,
      vendasPorProduto: e.saleLines.map((l: any) => ({ produtoId: l.produtoId, quantidade: l.quantidade, precoUnitario: l.precoUnitario })),
      descontoPercent: e.descontoPercent ?? null,
      descontoValor: e.descontoValor ?? null,
      valorBruto: e.valorBruto ?? null,
      valorLiquido: e.valorLiquido ?? null,
      comissao: e.comissao ?? null,
      alunoNome: e.alunoNome ?? null,
      criadoEm: e.createdAt.toISOString(),
    })),
  });
});

router.post('/', authenticate, requireDataPermission('commercialWrite'), async (req, res) => {
  try {
    const input = commercialCreateSchema.parse(req.body);
    const data = parseDateOnly(input.data);
    if (!data) return res.status(400).json({ error: 'Data inválida' });

    const reqUser = req as AuthRequest;
    const alunoNome = String(input.alunoNome || '').trim();
    const clientNames = alunoNome
      .split(/\s*\|\s*|\s*;\s*|\r?\n|,\s*/)
      .map((n) => String(n || '').trim())
      .filter(Boolean);
    const vendasInformadas = clampNumber(input.vendas || 0, { min: 0 });
    if (vendasInformadas > 0 && clientNames.length < vendasInformadas) {
      return res.status(400).json({ error: 'Informe o nome do cliente para cada venda' });
    }
    if (vendasInformadas > 0) {
      const hasMissingDiscount = clientNames.some((token) => !/\((\d+(?:[\.,]\d+)?)%\)$/.test(token));
      if (hasMissingDiscount) {
        return res.status(400).json({ error: 'Informe o desconto (%) em cada venda' });
      }
    }
    const vendedorId =
      reqUser.userRole === 'admin' && input.vendedorId ? String(input.vendedorId) : String(reqUser.userId);
    const campaignScope = input.campaignScope === 'campanha' ? 'campanha' : 'geral';
    const campaignName =
      campaignScope === 'campanha'
        ? String(input.campaignName || '').trim() || null
        : null;
    if (campaignScope === 'campanha' && !campaignName) {
      return res.status(400).json({ error: 'Informe a campanha quando o modo for por campanha' });
    }

    const linhas = mergeLines(input.vendasPorProduto || []);
    if (linhas.length > 0) {
      const ps = (await prisma.product.findMany({
        where: { id: { in: Array.from(new Set(linhas.map((l) => String(l.produtoId)))) } },
        select: { id: true, ativo: true },
      })) as unknown as DbProductActive[];
      if (ps.some((p) => p.ativo === false)) {
        return res.status(409).json({ error: 'Não é possível lançar venda com produto desativado' });
      }
    }

    const created = await prisma.$transaction(async (tx: any) => {
      const totals = await computeEntryTotals({
        tx,
        vendedorId,
        linhas,
        descontoPercent: input.descontoPercent ?? null,
      });
      const entry = await tx.commercialEntry.create({
        data: {
          data,
          vendedorId,
          campaignScope,
          campaignName,
          leadsAtendidos: input.leadsAtendidos,
          agendamentos: input.agendamentos,
          vendas: input.vendas,
          followUps: input.followUps,
          descontoPercent: totals.descontoPercent,
          descontoValor: totals.descontoValor,
          valorBruto: totals.valorBruto,
          valorLiquido: totals.valorLiquido,
          comissao: totals.comissao,
          alunoNome: alunoNome || null,
        },
      });

      if (linhas.length > 0) {
        const products = (await tx.product.findMany({
          where: { id: { in: Array.from(new Set(linhas.map((l) => String(l.produtoId)))) } },
          select: { id: true, preco: true },
        })) as unknown as DbProductPrice[];
        const byId = new Map<string, DbProductPrice>(products.map((p) => [p.id, p]));
        await tx.commercialSaleLine.createMany({
          data: linhas.map((l) => ({
            entryId: entry.id,
            produtoId: l.produtoId,
            quantidade: l.quantidade,
            precoUnitario:
              clampNumber(Number(l.precoUnitario) || 0, { min: 0 }) > 0
                ? clampNumber(Number(l.precoUnitario) || 0, { min: 0 })
                : clampNumber(byId.get(String(l.produtoId))?.preco ?? 0, { min: 0 }),
          })),
        });
      }

      return tx.commercialEntry.findUnique({
        where: { id: entry.id },
        include: { saleLines: true, vendedor: { select: { nome: true } } },
      });
    });

    if (!created) return res.status(500).json({ error: 'Internal server error' });

    res.status(201).json({
      entry: {
        id: created.id,
        data: created.data.toISOString().slice(0, 10),
        vendedorId: created.vendedorId,
        vendedorNome: created.vendedor?.nome ?? null,
        campaignScope: (created as any).campaignScope === 'campanha' ? 'campanha' : 'geral',
        campaignName: (created as any).campaignName ?? null,
        leadsAtendidos: created.leadsAtendidos,
        agendamentos: created.agendamentos,
        vendas: created.vendas,
        followUps: created.followUps,
        vendasPorProduto: created.saleLines.map((l: any) => ({ produtoId: l.produtoId, quantidade: l.quantidade, precoUnitario: l.precoUnitario })),
        descontoPercent: created.descontoPercent ?? null,
        descontoValor: created.descontoValor ?? null,
        valorBruto: created.valorBruto ?? null,
        valorLiquido: created.valorLiquido ?? null,
        comissao: created.comissao ?? null,
        alunoNome: created.alunoNome ?? null,
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

router.put('/:id', authenticate, requireDataPermission('commercialWrite'), async (req, res) => {
  try {
    const input = commercialUpdateSchema.parse(req.body);
    const reqUser = req as AuthRequest;

    const existing = await prisma.commercialEntry.findUnique({
      where: { id: req.params.id },
      include: { saleLines: true, vendedor: { select: { nome: true } } },
    });
    if (!existing) return res.status(404).json({ error: 'Registro não encontrado' });

    if (reqUser.userRole !== 'admin' && existing.vendedorId !== reqUser.userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const data = input.data ? parseDateOnly(input.data) : null;
    if (input.data && !data) return res.status(400).json({ error: 'Data inválida' });

    const linhas = input.vendasPorProduto ? mergeLines(input.vendasPorProduto) : null;

    const produtosIdsToCheck = new Set<string>(existing.saleLines.map((l: any) => String(l.produtoId)));
    if (linhas) {
      for (const l of linhas) produtosIdsToCheck.add(String(l.produtoId));
    }
    if (produtosIdsToCheck.size > 0) {
      const ps = (await prisma.product.findMany({
        where: { id: { in: Array.from(produtosIdsToCheck) } },
        select: { id: true, ativo: true },
      })) as unknown as DbProductActive[];
      if (ps.some((p) => p.ativo === false)) {
        return res.status(409).json({ error: 'Registro contém produto desativado e não pode ser alterado' });
      }
    }

    const updated = await prisma.$transaction(async (tx: any) => {
      const vendedorId =
        reqUser.userRole === 'admin' && input.vendedorId ? String(input.vendedorId) : existing.vendedorId;
      const existingCampaignScope = (existing as any).campaignScope === 'campanha' ? 'campanha' : 'geral';
      const inputCampaignScope = input.campaignScope ? (input.campaignScope === 'campanha' ? 'campanha' : 'geral') : null;
      const campaignScope = inputCampaignScope ?? existingCampaignScope;
      const inputCampaignNameProvided = Object.prototype.hasOwnProperty.call(input, 'campaignName');
      const existingCampaignName = String((existing as any).campaignName || '').trim();
      const campaignName =
        campaignScope === 'campanha'
          ? (inputCampaignNameProvided ? String(input.campaignName || '').trim() : existingCampaignName) || null
          : null;
      if (campaignScope === 'campanha' && !campaignName) {
        throw new z.ZodError([
          {
            code: z.ZodIssueCode.custom,
            message: 'Informe a campanha quando o modo for por campanha',
            path: ['campaignName'],
          },
        ]);
      }

      const finalLines =
        linhas ??
        existing.saleLines.map((l: any) => ({ produtoId: l.produtoId, quantidade: l.quantidade, precoUnitario: l.precoUnitario }));
      const existingDiscount = clampNumber(existing.descontoPercent ?? 0, { min: 0, max: 100 });
      const inputDiscountProvided = input.descontoPercent !== undefined;
      const nextDiscount = clampNumber(input.descontoPercent ?? existingDiscount, { min: 0, max: 100 });
      const shouldRecomputeTotals = Boolean(linhas) || vendedorId !== existing.vendedorId || (inputDiscountProvided && nextDiscount !== existingDiscount);
      const totals = shouldRecomputeTotals
        ? await computeEntryTotals({
            tx,
            vendedorId,
            linhas: finalLines,
            descontoPercent: inputDiscountProvided ? nextDiscount : existingDiscount,
          })
        : {
            descontoPercent: existing.descontoPercent ?? null,
            descontoValor: existing.descontoValor ?? null,
            valorBruto: existing.valorBruto ?? null,
            valorLiquido: existing.valorLiquido ?? null,
            comissao: existing.comissao ?? null,
          };

      const entry = await tx.commercialEntry.update({
        where: { id: existing.id },
        data: {
          data: data ?? existing.data,
          vendedorId,
          campaignScope,
          campaignName,
          leadsAtendidos: input.leadsAtendidos ?? existing.leadsAtendidos,
          agendamentos: input.agendamentos ?? existing.agendamentos,
          vendas: input.vendas ?? existing.vendas,
          followUps: input.followUps ?? existing.followUps,
          descontoPercent: totals.descontoPercent,
          descontoValor: totals.descontoValor,
          valorBruto: totals.valorBruto,
          valorLiquido: totals.valorLiquido,
          comissao: totals.comissao,
          ...(input.alunoNome !== undefined ? { alunoNome: input.alunoNome ? String(input.alunoNome).trim() : null } : {}),
        },
      });

      if (linhas) {
        await tx.commercialSaleLine.deleteMany({ where: { entryId: entry.id } });
        if (linhas.length > 0) {
          const products = (await tx.product.findMany({
            where: { id: { in: Array.from(new Set(linhas.map((l) => String(l.produtoId)))) } },
            select: { id: true, preco: true },
          })) as unknown as DbProductPrice[];
          const byId = new Map<string, DbProductPrice>(products.map((p) => [p.id, p]));
          await tx.commercialSaleLine.createMany({
            data: linhas.map((l) => ({
              entryId: entry.id,
              produtoId: l.produtoId,
              quantidade: l.quantidade,
              precoUnitario:
                clampNumber(Number(l.precoUnitario) || 0, { min: 0 }) > 0
                  ? clampNumber(Number(l.precoUnitario) || 0, { min: 0 })
                  : clampNumber(byId.get(String(l.produtoId))?.preco ?? 0, { min: 0 }),
            })),
          });
        }
      }

      return tx.commercialEntry.findUnique({ where: { id: entry.id }, include: { saleLines: true, vendedor: { select: { nome: true } } } });
    });

    if (!updated) return res.status(500).json({ error: 'Internal server error' });

    res.json({
      entry: {
        id: updated.id,
        data: updated.data.toISOString().slice(0, 10),
        vendedorId: updated.vendedorId,
        vendedorNome: updated.vendedor?.nome ?? null,
        campaignScope: (updated as any).campaignScope === 'campanha' ? 'campanha' : 'geral',
        campaignName: (updated as any).campaignName ?? null,
        leadsAtendidos: updated.leadsAtendidos,
        agendamentos: updated.agendamentos,
        vendas: updated.vendas,
        followUps: updated.followUps,
        vendasPorProduto: updated.saleLines.map((l: any) => ({ produtoId: l.produtoId, quantidade: l.quantidade, precoUnitario: l.precoUnitario })),
        descontoPercent: updated.descontoPercent ?? null,
        descontoValor: updated.descontoValor ?? null,
        valorBruto: updated.valorBruto ?? null,
        valorLiquido: updated.valorLiquido ?? null,
        comissao: updated.comissao ?? null,
        alunoNome: updated.alunoNome ?? null,
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

router.delete('/:id', authenticate, requireDataPermission('commercialWrite'), async (req, res) => {
  try {
    const reqUser = req as AuthRequest;
    const existing = await prisma.commercialEntry.findUnique({ where: { id: req.params.id }, include: { saleLines: true } });
    if (!existing) return res.status(404).json({ error: 'Registro não encontrado' });

    if (reqUser.userRole !== 'admin' && existing.vendedorId !== reqUser.userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    if (existing.saleLines.length > 0) {
      const ps = (await prisma.product.findMany({
        where: { id: { in: Array.from(new Set(existing.saleLines.map((l: any) => String(l.produtoId)))) } },
        select: { id: true, ativo: true },
      })) as unknown as DbProductActive[];
      if (ps.some((p) => p.ativo === false)) {
        return res.status(409).json({ error: 'Registro contém produto desativado e não pode ser removido' });
      }
    }

    await prisma.commercialEntry.delete({ where: { id: existing.id } });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/', authenticate, requireDataPermission('commercialWrite'), requireAdmin, async (req, res) => {
  await prisma.commercialEntry.deleteMany({});
  res.json({ ok: true });
});

export { router as commercialRoutes };

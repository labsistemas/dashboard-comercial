import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import prisma from '../lib/prisma';
import { authenticate, AuthRequest, requireAdmin } from '../middleware/auth.middleware';
import path from 'path';
import fs from 'fs/promises';

const router = Router();

const configReadLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

const configWriteLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

type UserRole = string;

type DbProductActive = { id: string; ativo: boolean; preco: number };

type EligibleUser = {
  id: string;
  nome: string | null;
  email: string | null;
  avatar: string | null;
  role: UserRole;
};

type RescueEntryWithNames = {
  id: string;
  data: Date;
  closerId: string;
  leadsResgatados: number;
  leadsConvertidos: number;
  vendedorOrigemId: string;
  createdAt: Date;
  closer: { nome: string | null } | null;
  vendedorOrigem: { nome: string | null; comissaoPercent?: number | null } | null;
  saleLines?: Array<{ produtoId: string; quantidade: number; precoUnitario?: number }>;
};

function clampNumber(value: any, bounds: { min?: number; max?: number }) {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return bounds.min ?? 0;
  if (typeof bounds.min === 'number' && num < bounds.min) return bounds.min;
  if (typeof bounds.max === 'number' && num > bounds.max) return bounds.max;
  return num;
}

const DATA_DIR = path.join(process.cwd(), 'data');
const RESCUE_COMMISSION_FILE = path.join(DATA_DIR, 'rescue-commission.json');

const rescueCommissionSplitSchema = z.object({
  originPercent: z.number().min(0).max(100),
  closerPercent: z.number().min(0).max(100),
});

const rescueCommissionRuleSchema = z.object({
  id: z.string().min(1),
  userIds: z.array(z.string().min(1)).min(1),
  originPercent: z.number().min(0).max(100),
  closerPercent: z.number().min(0).max(100),
});

const rescueCommissionConfigV2Schema = z.object({
  default: rescueCommissionSplitSchema,
  rules: z.array(rescueCommissionRuleSchema).default([]),
});

const rescueCommissionConfigInputSchema = z.union([rescueCommissionSplitSchema, rescueCommissionConfigV2Schema]);

type RescueCommissionSplit = z.infer<typeof rescueCommissionSplitSchema>;
type RescueCommissionRule = z.infer<typeof rescueCommissionRuleSchema>;
type RescueCommissionConfig = z.infer<typeof rescueCommissionConfigV2Schema>;

function normalizeSplit(split: RescueCommissionSplit): RescueCommissionSplit {
  const originPercent = clampNumber(split.originPercent, { min: 0, max: 100 });
  const closerPercent = clampNumber(split.closerPercent, { min: 0, max: 100 });
  const sum = originPercent + closerPercent;
  if (!Number.isFinite(sum) || sum <= 0) return { originPercent: 100, closerPercent: 0 };
  if (sum === 100) return { originPercent, closerPercent };
  const o = clampNumber((originPercent / sum) * 100, { min: 0, max: 100 });
  return { originPercent: o, closerPercent: clampNumber(100 - o, { min: 0, max: 100 }) };
}

function normalizeRules(rules: RescueCommissionRule[]): RescueCommissionRule[] {
  return (Array.isArray(rules) ? rules : [])
    .map((r) => ({
      id: String(r.id),
      userIds: Array.from(new Set((r.userIds || []).map((x) => String(x)).filter(Boolean))),
      ...normalizeSplit({ originPercent: r.originPercent, closerPercent: r.closerPercent }),
    }))
    .filter((r) => r.id && r.userIds.length > 0);
}

function findOverlappingUserIds(rules: RescueCommissionRule[]): string[] {
  const seen = new Set<string>();
  const overlaps = new Set<string>();
  for (const r of rules) {
    for (const userId of r.userIds) {
      if (seen.has(userId)) overlaps.add(userId);
      else seen.add(userId);
    }
  }
  return Array.from(overlaps);
}

function getSplitForOrigin(cfg: RescueCommissionConfig, vendedorOrigemId: string): RescueCommissionSplit {
  const id = String(vendedorOrigemId || '').trim();
  if (!id) return cfg.default;
  const match = (cfg.rules || []).find((r) => Array.isArray(r.userIds) && r.userIds.includes(id));
  return match ? normalizeSplit({ originPercent: match.originPercent, closerPercent: match.closerPercent }) : cfg.default;
}

async function getRescueCommissionConfig(): Promise<RescueCommissionConfig> {
  try {
    await fs.access(RESCUE_COMMISSION_FILE);
    const raw = await fs.readFile(RESCUE_COMMISSION_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    const legacy = rescueCommissionSplitSchema.safeParse(parsed);
    if (legacy.success) {
      return { default: normalizeSplit(legacy.data), rules: [] };
    }
    const v2 = rescueCommissionConfigV2Schema.safeParse(parsed);
    if (v2.success) {
      const normalized: RescueCommissionConfig = {
        default: normalizeSplit(v2.data.default),
        rules: normalizeRules(v2.data.rules || []),
      };
      return normalized;
    }
    return { default: { originPercent: 100, closerPercent: 0 }, rules: [] };
  } catch {
    return { default: { originPercent: 100, closerPercent: 0 }, rules: [] };
  }
}

async function saveRescueCommissionConfig(cfg: RescueCommissionConfig): Promise<void> {
  const normalized: RescueCommissionConfig = {
    default: normalizeSplit(cfg.default),
    rules: normalizeRules(cfg.rules || []),
  };
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(RESCUE_COMMISSION_FILE, JSON.stringify(normalized, null, 2));
}

function parseDateOnly(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

const rescueCreateSchema = z.object({
  data: z.string().min(1),
  closerId: z.string().optional(),
  vendedorOrigemId: z.string().min(1),
  leadsResgatados: z.number().int().nonnegative(),
  leadsConvertidos: z.number().int().nonnegative().optional(),
  produtosVendidos: z
    .array(z.object({ produtoId: z.string().min(1), quantidade: z.number().int().nonnegative() }))
    .optional(),
});

const rescueUpdateSchema = rescueCreateSchema.partial();

function mergeLines(lines: Array<{ produtoId: string; quantidade: number }>) {
  const map = new Map<string, number>();
  for (const l of lines) {
    const id = String(l.produtoId || '').trim();
    if (!id) continue;
    const qty = Math.max(0, Number(l.quantidade) || 0);
    map.set(id, (map.get(id) || 0) + qty);
  }
  return Array.from(map.entries()).map(([produtoId, quantidade]) => ({ produtoId, quantidade }));
}

router.get('/commission-config', authenticate, requireAdmin, configReadLimiter, async (_req, res) => {
  const cfg = await getRescueCommissionConfig();
  res.json({ config: cfg });
});

router.put('/commission-config', authenticate, requireAdmin, configWriteLimiter, async (req, res) => {
  try {
    const input = rescueCommissionConfigInputSchema.parse(req.body || {});
    const current = await getRescueCommissionConfig();
    const next: RescueCommissionConfig =
      'default' in input
        ? { default: normalizeSplit(input.default), rules: normalizeRules(input.rules || []) }
        : { ...current, default: normalizeSplit(input) };

    const overlaps = findOverlappingUserIds(next.rules || []);
    if (overlaps.length > 0) {
      return res.status(409).json({ error: 'As regras não podem ser sobrepostas', overlaps });
    }

    await saveRescueCommissionConfig(next);
    res.json({ config: await getRescueCommissionConfig() });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/eligible-sources', authenticate, configReadLimiter, async (req, res) => {
  try {
    const reqUser = req as AuthRequest;
    const all = (await prisma.user.findMany({
      where: { role: 'vendedor' },
      select: { id: true, nome: true, email: true, avatar: true, role: true },
      orderBy: { nome: 'asc' },
    })) as EligibleUser[];
    const list = all
      .filter((u: EligibleUser) => u.id !== reqUser.userId)
      .map((u: EligibleUser) => ({
        id: u.id,
        nome: u.nome || 'Vendedor',
        email: u.email || '',
        avatar: u.avatar ? `/api/upload/proxy/${u.avatar}` : '',
        role: u.role,
      }));
    res.json({ eligible: list });
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/', authenticate, configReadLimiter, async (req, res) => {
  const reqUser = req as AuthRequest;
  const commissionCfg = await getRescueCommissionConfig();
  const entries = (await prisma.rescueEntry.findMany({
    where: reqUser.userRole === 'admin' ? {} : { closerId: String(reqUser.userId) },
    include: {
      closer: { select: { nome: true, comissaoPercent: true } },
      vendedorOrigem: { select: { nome: true, comissaoPercent: true } },
      saleLines: { select: { produtoId: true, quantidade: true, precoUnitario: true } },
    } as any,
    orderBy: { data: 'desc' },
  })) as unknown as RescueEntryWithNames[];

  res.json({
    entries: entries.map((e: RescueEntryWithNames) => ({
      ...(function () {
        const lines = Array.isArray(e.saleLines) ? e.saleLines : [];
        const bruto = lines.reduce((acc, l) => acc + clampNumber(l.precoUnitario || 0, { min: 0 }) * clampNumber(l.quantidade || 0, { min: 0 }), 0);
        const originPercentBase = clampNumber((e as any).vendedorOrigem?.comissaoPercent ?? 0, { min: 0, max: 100 });
        const split = getSplitForOrigin(commissionCfg, e.vendedorOrigemId);
        const comissaoTotal = bruto * (originPercentBase / 100);
        const comissaoOrigem = comissaoTotal * (clampNumber(split.originPercent, { min: 0, max: 100 }) / 100);
        const comissaoCloser = comissaoTotal * (clampNumber(split.closerPercent, { min: 0, max: 100 }) / 100);
        return {
          valorVendas: bruto,
          comissaoTotal,
          comissaoOrigem,
          comissaoCloser,
        };
      })(),
      id: e.id,
      data: e.data.toISOString().slice(0, 10),
      closerId: e.closerId,
      closerNome: e.closer?.nome ?? null,
      vendedorOrigem: e.vendedorOrigemId,
      vendedorOrigemNome: e.vendedorOrigem?.nome ?? null,
      leadsResgatados: e.leadsResgatados,
      leadsConvertidos: e.leadsConvertidos,
      produtosVendidos: Array.isArray(e.saleLines)
        ? e.saleLines.map((l) => ({ produtoId: l.produtoId, quantidade: l.quantidade, precoUnitario: l.precoUnitario || 0 }))
        : [],
      criadoEm: e.createdAt.toISOString(),
    })),
  });
});

router.post('/', authenticate, configWriteLimiter, async (req, res) => {
  try {
    const input = rescueCreateSchema.parse(req.body);
    const data = parseDateOnly(input.data);
    if (!data) return res.status(400).json({ error: 'Data inválida' });

    const reqUser = req as AuthRequest;
    const closerId =
      reqUser.userRole === 'admin' && input.closerId ? String(input.closerId) : String(reqUser.userId);

    const linhas = Array.isArray(input.produtosVendidos) ? mergeLines(input.produtosVendidos) : [];
    const computedConvertidos =
      input.leadsConvertidos !== undefined ? input.leadsConvertidos : linhas.reduce((acc, l) => acc + clampNumber(l.quantidade, { min: 0 }), 0);
    let psById: Map<string, DbProductActive> | null = null;
    if (linhas.length > 0) {
      const ps = (await prisma.product.findMany({
        where: { id: { in: Array.from(new Set(linhas.map((l) => String(l.produtoId)))) } },
        select: { id: true, ativo: true, preco: true },
      })) as unknown as DbProductActive[];
      psById = new Map(ps.map((p) => [String(p.id), p]));
      if (ps.length !== new Set(linhas.map((l) => String(l.produtoId))).size) {
        return res.status(400).json({ error: 'Produto inválido' });
      }
      if (ps.some((p) => p.ativo === false)) {
        return res.status(409).json({ error: 'Não é possível salvar resgate com produto desativado' });
      }
    }

    const created = await prisma.$transaction(async (tx) => {
      const entry = await tx.rescueEntry.create({
        data: {
          data,
          closerId,
          vendedorOrigemId: input.vendedorOrigemId,
          leadsResgatados: input.leadsResgatados,
          leadsConvertidos: computedConvertidos,
        },
      });
      if (linhas.length > 0) {
        await (tx as any).rescueSaleLine.createMany({
          data: linhas.map((l) => ({
            entryId: entry.id,
            produtoId: l.produtoId,
            quantidade: l.quantidade,
            precoUnitario: clampNumber(psById?.get(String(l.produtoId))?.preco ?? 0, { min: 0 }),
          })),
        });
      }
      return tx.rescueEntry.findUnique({
        where: { id: entry.id },
        include: {
          closer: { select: { nome: true, comissaoPercent: true } },
          vendedorOrigem: { select: { nome: true, comissaoPercent: true } },
          saleLines: { select: { produtoId: true, quantidade: true, precoUnitario: true } },
        } as any,
      });
    });

    if (!created) return res.status(500).json({ error: 'Internal server error' });
    const createdAny = created as any;
    const commissionCfg = await getRescueCommissionConfig();
    const bruto = Array.isArray(createdAny.saleLines)
      ? createdAny.saleLines.reduce((acc: number, l: any) => acc + clampNumber(l.precoUnitario || 0, { min: 0 }) * clampNumber(l.quantidade || 0, { min: 0 }), 0)
      : 0;
    const originPercentBase = clampNumber(createdAny?.vendedorOrigem?.comissaoPercent ?? 0, { min: 0, max: 100 });
    const split = getSplitForOrigin(commissionCfg, createdAny.vendedorOrigemId);
    const comissaoTotal = bruto * (originPercentBase / 100);
    const comissaoOrigem = comissaoTotal * (clampNumber(split.originPercent, { min: 0, max: 100 }) / 100);
    const comissaoCloser = comissaoTotal * (clampNumber(split.closerPercent, { min: 0, max: 100 }) / 100);

    res.status(201).json({
      entry: {
        id: createdAny.id,
        data: createdAny.data.toISOString().slice(0, 10),
        closerId: createdAny.closerId,
        closerNome: createdAny.closer?.nome ?? null,
        vendedorOrigem: createdAny.vendedorOrigemId,
        vendedorOrigemNome: createdAny.vendedorOrigem?.nome ?? null,
        leadsResgatados: createdAny.leadsResgatados,
        leadsConvertidos: createdAny.leadsConvertidos,
        produtosVendidos: createdAny.saleLines
          ? createdAny.saleLines.map((l: any) => ({ produtoId: l.produtoId, quantidade: l.quantidade, precoUnitario: l.precoUnitario || 0 }))
          : [],
        valorVendas: bruto,
        comissaoTotal,
        comissaoOrigem,
        comissaoCloser,
        criadoEm: createdAny.createdAt.toISOString(),
      },
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id', authenticate, configWriteLimiter, async (req, res) => {
  try {
    const input = rescueUpdateSchema.parse(req.body);
    const reqUser = req as AuthRequest;

    const existing = await prisma.rescueEntry.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Registro não encontrado' });

    if (reqUser.userRole !== 'admin' && existing.closerId !== reqUser.userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const data = input.data ? parseDateOnly(input.data) : null;
    if (input.data && !data) return res.status(400).json({ error: 'Data inválida' });

    const linhas = input.produtosVendidos !== undefined ? mergeLines(input.produtosVendidos || []) : null;
    let psById: Map<string, DbProductActive> | null = null;
    if (linhas && linhas.length > 0) {
      const ps = (await prisma.product.findMany({
        where: { id: { in: Array.from(new Set(linhas.map((l) => String(l.produtoId)))) } },
        select: { id: true, ativo: true, preco: true },
      })) as unknown as DbProductActive[];
      psById = new Map(ps.map((p) => [String(p.id), p]));
      if (ps.length !== new Set(linhas.map((l) => String(l.produtoId))).size) {
        return res.status(400).json({ error: 'Produto inválido' });
      }
      if (ps.some((p) => p.ativo === false)) {
        return res.status(409).json({ error: 'Não é possível salvar resgate com produto desativado' });
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      const entry = await tx.rescueEntry.update({
        where: { id: existing.id },
        data: {
          data: data ?? existing.data,
          closerId:
            reqUser.userRole === 'admin' && input.closerId ? String(input.closerId) : existing.closerId,
          vendedorOrigemId: input.vendedorOrigemId ?? existing.vendedorOrigemId,
          leadsResgatados: input.leadsResgatados ?? existing.leadsResgatados,
          leadsConvertidos: input.leadsConvertidos ?? existing.leadsConvertidos,
        },
      });
      if (linhas) {
        await (tx as any).rescueSaleLine.deleteMany({ where: { entryId: entry.id } });
        if (linhas.length > 0) {
          await (tx as any).rescueSaleLine.createMany({
            data: linhas.map((l) => ({
              entryId: entry.id,
              produtoId: l.produtoId,
              quantidade: l.quantidade,
              precoUnitario: clampNumber(psById?.get(String(l.produtoId))?.preco ?? 0, { min: 0 }),
            })),
          });
        }
      }
      return tx.rescueEntry.findUnique({
        where: { id: entry.id },
        include: {
          closer: { select: { nome: true, comissaoPercent: true } },
          vendedorOrigem: { select: { nome: true, comissaoPercent: true } },
          saleLines: { select: { produtoId: true, quantidade: true, precoUnitario: true } },
        } as any,
      });
    });

    if (!updated) return res.status(500).json({ error: 'Internal server error' });
    const updatedAny = updated as any;
    const commissionCfg = await getRescueCommissionConfig();
    const bruto = Array.isArray(updatedAny.saleLines)
      ? updatedAny.saleLines.reduce((acc: number, l: any) => acc + clampNumber(l.precoUnitario || 0, { min: 0 }) * clampNumber(l.quantidade || 0, { min: 0 }), 0)
      : 0;
    const originPercentBase = clampNumber(updatedAny?.vendedorOrigem?.comissaoPercent ?? 0, { min: 0, max: 100 });
    const split = getSplitForOrigin(commissionCfg, updatedAny.vendedorOrigemId);
    const comissaoTotal = bruto * (originPercentBase / 100);
    const comissaoOrigem = comissaoTotal * (clampNumber(split.originPercent, { min: 0, max: 100 }) / 100);
    const comissaoCloser = comissaoTotal * (clampNumber(split.closerPercent, { min: 0, max: 100 }) / 100);

    res.json({
      entry: {
        id: updatedAny.id,
        data: updatedAny.data.toISOString().slice(0, 10),
        closerId: updatedAny.closerId,
        closerNome: updatedAny.closer?.nome ?? null,
        vendedorOrigem: updatedAny.vendedorOrigemId,
        vendedorOrigemNome: updatedAny.vendedorOrigem?.nome ?? null,
        leadsResgatados: updatedAny.leadsResgatados,
        leadsConvertidos: updatedAny.leadsConvertidos,
        produtosVendidos: updatedAny.saleLines
          ? updatedAny.saleLines.map((l: any) => ({ produtoId: l.produtoId, quantidade: l.quantidade, precoUnitario: l.precoUnitario || 0 }))
          : [],
        valorVendas: bruto,
        comissaoTotal,
        comissaoOrigem,
        comissaoCloser,
        criadoEm: updatedAny.createdAt.toISOString(),
      },
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:id', authenticate, async (req, res) => {
  try {
    const reqUser = req as AuthRequest;
    const existing = await prisma.rescueEntry.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Registro não encontrado' });

    if (reqUser.userRole !== 'admin' && existing.closerId !== reqUser.userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    await prisma.rescueEntry.delete({ where: { id: existing.id } });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/', authenticate, requireAdmin, async (req, res) => {
  await prisma.rescueEntry.deleteMany({});
  res.json({ ok: true });
});

export { router as rescueRoutes };

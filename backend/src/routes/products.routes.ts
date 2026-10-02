import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import * as ExcelJS from 'exceljs';
import prisma from '../lib/prisma';
import { authenticate, AuthRequest } from '../middleware/auth.middleware';

const router = Router();

const PRODUCT_PERMISSION_TOKENS = {
  create: 'products:create',
  update: 'products:update',
  delete: 'products:delete',
} as const;

function normalizeRoleToken(value: unknown) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function hasOtherPermissionToken(permissionClass: any, token: string) {
  const target = String(token || '').trim().toLowerCase();
  if (!target) return false;
  const list = Array.isArray(permissionClass?.otherPermissions) ? permissionClass.otherPermissions : [];
  return list.some((item: any) => String(item || '').trim().toLowerCase() === target);
}

async function resolvePermissionClassForRequestUser(req: AuthRequest) {
  if (!req.userId) return null;
  const currentUser = await prisma.user.findUnique({
    where: { id: req.userId },
    select: { id: true, role: true, permissionClassId: true },
  });
  if (!currentUser) return null;
  if (String(currentUser.role || '') === 'admin') return 'admin';

  if (currentUser.permissionClassId) {
    const permissionClass = await prisma.permissionClass.findUnique({ where: { id: String(currentUser.permissionClassId) } });
    if (permissionClass) return permissionClass;
  }

  const roleToken = normalizeRoleToken(currentUser.role);
  if (!roleToken) return null;
  const classes = await prisma.permissionClass.findMany();
  return (
    classes.find(
      (item: any) => normalizeRoleToken(item.id) === roleToken || normalizeRoleToken(item.nome) === roleToken,
    ) || null
  );
}

const requireProductsPermission = (action: 'create' | 'update' | 'delete') => async (req: AuthRequest, res: any, next: any) => {
  const access = await resolvePermissionClassForRequestUser(req);
  if (access === 'admin') return next();
  if (!access) return res.status(403).json({ error: 'Admin access required' });

  const allowed =
    (action === 'create' && hasOtherPermissionToken(access, PRODUCT_PERMISSION_TOKENS.create)) ||
    (action === 'update' && hasOtherPermissionToken(access, PRODUCT_PERMISSION_TOKENS.update)) ||
    (action === 'delete' && hasOtherPermissionToken(access, PRODUCT_PERMISSION_TOKENS.delete));

  if (!allowed) return res.status(403).json({ error: 'Admin access required' });
  return next();
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

function normalizeProductName(name: string) {
  return String(name || '').trim().replace(/\s+/g, ' ');
}

const productCreateSchema = z.object({
  nome: z.string().min(1),
  capaUrl: z.string().optional(),
  descricao: z.string().optional(),
  preco: z.number().nonnegative().optional(),
  maxDescontoPercent: z.number().min(0).max(100).optional(),
});

const productUpdateSchema = z.object({
  nome: z.string().min(1).optional(),
  capaUrl: z.string().optional(),
  descricao: z.string().optional(),
  preco: z.number().nonnegative().optional(),
  maxDescontoPercent: z.number().min(0).max(100).optional(),
});

function toProxyUrl(keyOrUrl: string | null | undefined) {
  const value = String(keyOrUrl || '').trim();
  if (!value) return '';
  if (value.startsWith('http://') || value.startsWith('https://') || value.startsWith('/api/upload/proxy/')) return value;
  if (value.startsWith('data:')) return value;
  return `/api/upload/proxy/${value}`;
}

type ProductRow = {
  id: string;
  nome: string;
  capaUrl: string | null;
  descricao: string | null;
  preco: number;
  maxDescontoPercent: number;
  ativo: boolean;
  createdAt: Date;
};

router.get('/', authenticate, async (req, res) => {
  const reqUser = req as AuthRequest;
  const items = (await prisma.product.findMany({
    where: reqUser.userRole === 'admin' || reqUser.userRole === 'gestor' ? {} : { ativo: true },
    orderBy: { nome: 'asc' },
  })) as ProductRow[];
  res.json({
    products: items.map((p) => ({
      id: p.id,
      nome: p.nome,
      capaUrl: toProxyUrl(p.capaUrl),
      descricao: p.descricao || '',
      preco: p.preco,
      maxDescontoPercent: p.maxDescontoPercent,
      ativo: p.ativo,
      criadoEm: p.createdAt.toISOString(),
    })),
  });
});

router.post('/', authenticate, requireProductsPermission('create'), async (req, res) => {
  try {
    const input = productCreateSchema.parse(req.body);
    const nome = normalizeProductName(input.nome);
    const created = await prisma.product.create({
      data: {
        nome,
        capaUrl: input.capaUrl ? String(input.capaUrl) : null,
        descricao: input.descricao ? String(input.descricao) : null,
        preco: typeof input.preco === 'number' ? input.preco : 0,
        maxDescontoPercent: typeof input.maxDescontoPercent === 'number' ? input.maxDescontoPercent : 0,
      },
    });
    res.status(201).json({
      product: {
        id: created.id,
        nome: created.nome,
        capaUrl: toProxyUrl(created.capaUrl),
        descricao: created.descricao || '',
        preco: created.preco,
        maxDescontoPercent: created.maxDescontoPercent,
        ativo: created.ativo,
        criadoEm: created.createdAt.toISOString(),
      },
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    if (error?.code === 'P2002') {
      return res.status(400).json({ error: 'Produto já existe' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id', authenticate, requireProductsPermission('update'), async (req, res) => {
  try {
    const input = productUpdateSchema.parse(req.body);
    const nome = input.nome ? normalizeProductName(input.nome) : null;
    const updated = await prisma.product.update({
      where: { id: req.params.id },
      data: {
        ...(nome ? { nome } : {}),
        ...(input.capaUrl !== undefined ? { capaUrl: input.capaUrl ? String(input.capaUrl) : null } : {}),
        ...(input.descricao !== undefined ? { descricao: input.descricao ? String(input.descricao) : null } : {}),
        ...(input.preco !== undefined ? { preco: input.preco } : {}),
        ...(input.maxDescontoPercent !== undefined ? { maxDescontoPercent: input.maxDescontoPercent } : {}),
      },
    });
    res.json({
      product: {
        id: updated.id,
        nome: updated.nome,
        capaUrl: toProxyUrl(updated.capaUrl),
        descricao: updated.descricao || '',
        preco: updated.preco,
        maxDescontoPercent: updated.maxDescontoPercent,
        ativo: updated.ativo,
        criadoEm: updated.createdAt.toISOString(),
      },
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    if (error?.code === 'P2025') {
      return res.status(404).json({ error: 'Produto não encontrado' });
    }
    if (error?.code === 'P2002') {
      return res.status(400).json({ error: 'Produto já existe' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:id', authenticate, requireProductsPermission('delete'), async (req, res) => {
  try {
    await prisma.product.update({ where: { id: req.params.id }, data: { ativo: false } });
    res.json({ ok: true });
  } catch (error: any) {
    if (error?.code === 'P2025') {
      return res.status(404).json({ error: 'Produto não encontrado' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/import/excel', authenticate, requireProductsPermission('create'), upload.single('file'), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });

  try {
    const workbook = new ExcelJS.Workbook();
    const buffer = Buffer.isBuffer(file.buffer) ? file.buffer : Buffer.from(file.buffer as any);
    await workbook.xlsx.load(buffer as unknown as any);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) return res.status(400).json({ error: 'Planilha inválida' });

    const names: string[] = [];
    for (let rowNumber = 1; rowNumber <= worksheet.rowCount; rowNumber++) {
      const row = worksheet.getRow(rowNumber);
      const cell = row.getCell(1).value;
      const nome = normalizeProductName(cell?.toString() || '');
      if (!nome) continue;
      if (nome.toLowerCase() === 'nome') continue;
      names.push(nome);
    }

    const unique = Array.from(new Set(names));
    if (unique.length === 0) return res.json({ count: 0 });

    const created = await prisma.product.createMany({
      data: unique.map((nome) => ({ nome })),
      skipDuplicates: true,
    });

    res.json({ count: created.count });
  } catch {
    res.status(500).json({ error: 'Erro ao importar produtos' });
  }
});

export { router as productRoutes };

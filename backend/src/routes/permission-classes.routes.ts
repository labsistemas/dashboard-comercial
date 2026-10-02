import { Router } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import prisma from '../lib/prisma';
import { authenticate, requireAdmin, AuthRequest } from '../middleware/auth.middleware';

const router = Router();

const PRODUCT_PERMISSION_TOKENS = {
  create: 'products:create',
  update: 'products:update',
  delete: 'products:delete',
} as const;

function normalizePermissionToken(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function normalizePermissionList(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return Array.from(new Set(value.map((item) => normalizePermissionToken(item)).filter(Boolean)));
}

const DEFAULT_PERMISSION_CLASSES = [
  {
    nome: 'Admin',
    trafficRead: true,
    trafficWrite: true,
    commercialRead: true,
    commercialWrite: true,
    adminMetricsRead: true,
    usersRead: true,
    usersCreate: true,
    usersDeactivate: true,
    otherPermissions: [
      PRODUCT_PERMISSION_TOKENS.create,
      PRODUCT_PERMISSION_TOKENS.update,
      PRODUCT_PERMISSION_TOKENS.delete,
    ],
  },
  {
    nome: 'Gestor de Tráfego',
    trafficRead: true,
    trafficWrite: true,
    commercialRead: true,
    commercialWrite: false,
    adminMetricsRead: true,
    usersRead: false,
    usersCreate: false,
    usersDeactivate: false,
    otherPermissions: [],
  },
  {
    nome: 'Vendedor',
    trafficRead: false,
    trafficWrite: false,
    commercialRead: true,
    commercialWrite: true,
    adminMetricsRead: false,
    usersRead: false,
    usersCreate: false,
    usersDeactivate: false,
    otherPermissions: [],
  },
  {
    nome: 'Closer de Resgate',
    trafficRead: false,
    trafficWrite: false,
    commercialRead: true,
    commercialWrite: false,
    adminMetricsRead: false,
    usersRead: false,
    usersCreate: false,
    usersDeactivate: false,
    otherPermissions: [],
  },
] as const;

function normalizeRoleToken(value: unknown) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

async function ensureDefaultPermissionClasses() {
  const count = await prisma.permissionClass.count();
  if (count === 0) {
    await prisma.permissionClass.createMany({
      data: DEFAULT_PERMISSION_CLASSES.map((item) => ({
        id: crypto.randomUUID(),
        nome: item.nome,
        trafficRead: item.trafficRead,
        trafficWrite: item.trafficWrite,
        commercialRead: item.commercialRead,
        commercialWrite: item.commercialWrite,
        adminMetricsRead: item.adminMetricsRead,
        usersRead: item.usersRead,
        usersCreate: item.usersCreate,
        usersDeactivate: item.usersDeactivate,
        otherPermissions: item.otherPermissions,
      })),
    });
    return;
  }

  const classes = await prisma.permissionClass.findMany();
  const adminClass =
    classes.find(
      (item: any) => normalizeRoleToken(item.id) === 'admin' || normalizeRoleToken(item.nome) === 'admin',
    ) || null;
  if (!adminClass) return;

  const current = normalizePermissionList((adminClass as any).otherPermissions);
  const next = new Set(current);
  next.add(PRODUCT_PERMISSION_TOKENS.create);
  next.add(PRODUCT_PERMISSION_TOKENS.update);
  next.add(PRODUCT_PERMISSION_TOKENS.delete);
  const nextArray = Array.from(next);
  if (nextArray.length === current.length) return;

  await prisma.permissionClass.update({
    where: { id: adminClass.id },
    data: { otherPermissions: nextArray },
  });
}

async function dedupePermissionClasses() {
  const classes = await prisma.permissionClass.findMany({
    orderBy: [{ createdAt: 'asc' }],
    include: { users: { select: { id: true } } },
  });

  const groups = new Map<string, typeof classes>();
  for (const item of classes) {
    const key = normalizeRoleToken(item.nome);
    if (!key) continue;
    const group = groups.get(key) || [];
    group.push(item);
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    if (group.length <= 1) continue;

    const sorted = group.slice().sort((a, b) => {
      const byUsers = b.users.length - a.users.length;
      if (byUsers !== 0) return byUsers;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
    const canonical = sorted[0];
    const duplicates = sorted.slice(1);
    const duplicateIds = duplicates.map((item) => item.id);
    if (duplicateIds.length === 0) continue;

    await prisma.$transaction(async (tx) => {
      await tx.user.updateMany({
        where: { permissionClassId: { in: duplicateIds } },
        data: { permissionClassId: canonical.id },
      });
      await tx.permissionClass.deleteMany({ where: { id: { in: duplicateIds } } });
    });
  }
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

const requirePermissionClassRead = async (req: AuthRequest, res: any, next: any) => {
  const access = await resolvePermissionClassForRequestUser(req);
  if (access === 'admin') return next();
  if (access && (access.usersRead || access.adminMetricsRead || access.usersCreate)) return next();
  return res.status(403).json({ error: 'Admin access required' });
};

const permissionClassSchema = z.object({
  id: z.string().optional(),
  nome: z.string().min(1),
  trafficRead: z.boolean().optional(),
  trafficWrite: z.boolean().optional(),
  commercialRead: z.boolean().optional(),
  commercialWrite: z.boolean().optional(),
  adminMetricsRead: z.boolean().optional(),
  usersRead: z.boolean().optional(),
  usersCreate: z.boolean().optional(),
  usersDeactivate: z.boolean().optional(),
  otherPermissions: z.array(z.string()).optional(),
});

router.get('/', authenticate, requirePermissionClassRead, async (req, res) => {
  if ((req as AuthRequest).userRole === 'admin') {
    await ensureDefaultPermissionClasses();
    await dedupePermissionClasses();
  }
  const classes = await prisma.permissionClass.findMany({
    orderBy: { createdAt: 'desc' },
    include: { users: { select: { id: true } } },
  });
  res.json({
    classes: classes.map((item) => ({
      id: item.id,
      nome: item.nome,
      trafficRead: item.trafficRead,
      trafficWrite: item.trafficWrite,
      commercialRead: item.commercialRead,
      commercialWrite: item.commercialWrite,
      adminMetricsRead: (item as any).adminMetricsRead,
      usersRead: item.usersRead,
      usersCreate: item.usersCreate,
      usersDeactivate: item.usersDeactivate,
      otherPermissions: Array.isArray(item.otherPermissions) ? item.otherPermissions : [],
      usersCount: item.users.length,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    })),
  });
});

router.post('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const input = permissionClassSchema.parse(req.body || {});
    const nome = String(input.nome || '').trim();
    if (!nome) return res.status(400).json({ error: 'Nome inválido' });
    const normalizedName = normalizeRoleToken(nome);
    const existing = (await prisma.permissionClass.findMany()).find(
      (item: any) => normalizeRoleToken(item.nome) === normalizedName,
    );
    if (existing) return res.status(400).json({ error: 'Classe com este nome já existe' });
    const created = await prisma.permissionClass.create({
      data: {
        id: input.id ? String(input.id) : crypto.randomUUID(),
        nome,
        trafficRead: Boolean(input.trafficRead),
        trafficWrite: Boolean(input.trafficWrite),
        commercialRead: Boolean(input.commercialRead),
        commercialWrite: Boolean(input.commercialWrite),
        adminMetricsRead: Boolean(input.adminMetricsRead),
        usersRead: Boolean(input.usersRead),
        usersCreate: Boolean(input.usersCreate),
        usersDeactivate: Boolean(input.usersDeactivate),
        otherPermissions: Array.isArray(input.otherPermissions) ? input.otherPermissions : [],
      },
    });
    res.status(201).json({
      class: {
        id: created.id,
        nome: created.nome,
        trafficRead: created.trafficRead,
        trafficWrite: created.trafficWrite,
        commercialRead: created.commercialRead,
        commercialWrite: created.commercialWrite,
        adminMetricsRead: (created as any).adminMetricsRead,
        usersRead: created.usersRead,
        usersCreate: created.usersCreate,
        usersDeactivate: created.usersDeactivate,
        otherPermissions: created.otherPermissions,
        createdAt: created.createdAt,
        updatedAt: created.updatedAt,
      },
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    if (error?.code === 'P2002') {
      return res.status(400).json({ error: 'Classe com este nome já existe' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const input = permissionClassSchema.partial().parse(req.body || {});
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    if (input.nome !== undefined) {
      const normalizedName = normalizeRoleToken(String(input.nome || '').trim());
      const existing = (await prisma.permissionClass.findMany({ where: { NOT: { id } } })).find(
        (item: any) => normalizeRoleToken(item.nome) === normalizedName,
      );
      if (existing) return res.status(400).json({ error: 'Classe com este nome já existe' });
    }
    const updated = await prisma.permissionClass.update({
      where: { id },
      data: {
        ...(input.nome !== undefined ? { nome: String(input.nome).trim() } : {}),
        ...(input.trafficRead !== undefined ? { trafficRead: input.trafficRead } : {}),
        ...(input.trafficWrite !== undefined ? { trafficWrite: input.trafficWrite } : {}),
        ...(input.commercialRead !== undefined ? { commercialRead: input.commercialRead } : {}),
        ...(input.commercialWrite !== undefined ? { commercialWrite: input.commercialWrite } : {}),
        ...(input.adminMetricsRead !== undefined ? { adminMetricsRead: input.adminMetricsRead } : {}),
        ...(input.usersRead !== undefined ? { usersRead: input.usersRead } : {}),
        ...(input.usersCreate !== undefined ? { usersCreate: input.usersCreate } : {}),
        ...(input.usersDeactivate !== undefined ? { usersDeactivate: input.usersDeactivate } : {}),
        ...(input.otherPermissions !== undefined ? { otherPermissions: input.otherPermissions } : {}),
      },
    });
    res.json({
      class: {
        id: updated.id,
        nome: updated.nome,
        trafficRead: updated.trafficRead,
        trafficWrite: updated.trafficWrite,
        commercialRead: updated.commercialRead,
        commercialWrite: updated.commercialWrite,
        adminMetricsRead: (updated as any).adminMetricsRead,
        usersRead: updated.usersRead,
        usersCreate: updated.usersCreate,
        usersDeactivate: updated.usersDeactivate,
        otherPermissions: updated.otherPermissions,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      },
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    if (error?.code === 'P2025') return res.status(404).json({ error: 'Classe não encontrada' });
    if (error?.code === 'P2002') return res.status(400).json({ error: 'Classe com este nome já existe' });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    const usersCount = await prisma.user.count({ where: { permissionClassId: id } });
    if (usersCount > 0) {
      return res.status(409).json({ error: 'Não é possível excluir uma função que possui usuários vinculados' });
    }
    const result = await prisma.permissionClass.deleteMany({ where: { id } });
    if (result.count === 0) {
      return res.status(404).json({ error: 'Classe não encontrada' });
    }
    res.json({ ok: true });
  } catch (error: any) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export { router as permissionClassesRoutes };
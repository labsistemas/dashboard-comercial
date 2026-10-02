import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { passwordSchema } from '../lib/security';
import prisma from '../lib/prisma';
import { authenticate, requireAdmin, AuthRequest } from '../middleware/auth.middleware';

function normalizeRoleToken(value: unknown) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function inferRoleFromToken(value: unknown) {
  const token = normalizeRoleToken(value);
  if (!token) return '';
  if (token === 'admin') return 'admin';
  if (token === 'gestor' || token.includes('gestor')) return 'gestor';
  if (token === 'vendedor' || token.includes('vendedor')) return 'vendedor';
  if (token === 'closer' || token.includes('closer') || token.includes('resgate')) return 'closer';
  return '';
}

function mapUserResponse(u: any) {
  const effectiveRole =
    inferRoleFromToken(u?.permissionClass?.nome) ||
    inferRoleFromToken(u?.permissionClass?.id) ||
    inferRoleFromToken(u?.role) ||
    String(u?.role || '');

  return {
    id: u.id,
    nome: u.nome,
    email: u.email,
    role: effectiveRole,
    comissaoPercent: u.comissaoPercent,
    emTreinamento: Boolean(u.emTreinamento),
    treinamentoAte: u.treinamentoAte ? u.treinamentoAte.toISOString().slice(0, 10) : null,
    ativo: typeof u.ativo === 'boolean' ? u.ativo : true,
    teamId: u.teamId,
    permissionClassId: u.permissionClassId,
    avatar: u.avatar ? `/api/upload/proxy/${u.avatar}` : '',
  };
}

async function resolvePermissionClass(input: string | null | undefined) {
  const target = String(input || '').trim();
  if (!target) return null;

  const direct = await prisma.permissionClass.findUnique({ where: { id: target } });
  if (direct) return direct;

  const normalizedTarget = normalizeRoleToken(target);
  if (!normalizedTarget) return null;

  const classes = await prisma.permissionClass.findMany();
  return (
    classes.find(
      (item: any) =>
        normalizeRoleToken(item.id) === normalizedTarget || normalizeRoleToken(item.nome) === normalizedTarget,
    ) || null
  );
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

const router = Router();

const createUserSchema = z.object({
  nome: z.string().min(1),
  email: z.string().trim().email().max(254).transform(v => v.toLowerCase()),
  senha: passwordSchema,
  role: z.string().min(1),
  comissaoPercent: z.number().min(0).max(100).optional(),
  emTreinamento: z.boolean().optional(),
  treinamentoAte: z.string().optional().nullable(),
  ativo: z.boolean().optional(),
  permissionClassId: z.string().optional().nullable(),
});

const updateUserSchema = z.object({
  nome: z.string().min(1).optional(),
  email: z.string().trim().email().max(254).transform(v => v.toLowerCase()).optional(),
  role: z.string().min(1).optional(),
  comissaoPercent: z.number().min(0).max(100).optional(),
  emTreinamento: z.boolean().optional(),
  treinamentoAte: z.string().optional().nullable(),
  ativo: z.boolean().optional(),
  permissionClassId: z.string().optional().nullable(),
});

const updateUserPasswordSchema = z.object({
  novaSenha: passwordSchema,
});

router.get('/', authenticate, async (req, res) => {
  const reqUser = req as AuthRequest;
  const currentUser = await (prisma as any).user.findUnique({
    where: { id: reqUser.userId! },
    select: { id: true, role: true, permissionClassId: true },
  });
  if (!currentUser) return res.status(401).json({ error: 'Usuário não autenticado' });
  if (String(currentUser.role || '') !== 'admin') {
    let permissionClass = currentUser.permissionClassId
      ? await (prisma as any).permissionClass.findUnique({ where: { id: String(currentUser.permissionClassId) } })
      : null;
    if (!permissionClass) {
      const roleToken = normalizeRoleToken(currentUser.role);
      if (roleToken) {
        const classes = await (prisma as any).permissionClass.findMany();
        permissionClass =
          classes.find((item: any) => normalizeRoleToken(item.id) === roleToken || normalizeRoleToken(item.nome) === roleToken) ||
          null;
      }
    }
    if (!permissionClass?.adminMetricsRead) {
      return res.status(403).json({ error: 'Admin access required' });
    }
  }
  const users = await (prisma as any).user.findMany({
    select: {
      id: true,
      nome: true,
      email: true,
      role: true,
      comissaoPercent: true,
      emTreinamento: true,
      treinamentoAte: true,
      ativo: true,
      createdAt: true,
      avatar: true,
      teamId: true,
      permissionClassId: true,
      permissionClass: { select: { id: true, nome: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json({
    users: (users as any[]).map(mapUserResponse),
  });
});

router.post('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const input = createUserSchema.parse(req.body);
    const role = String(input.role || '').trim();
    if (!role) return res.status(400).json({ error: 'Role inválido' });
    const treinamentoAte = input.treinamentoAte ? new Date(String(input.treinamentoAte)) : null;
    if (input.emTreinamento && !treinamentoAte) {
      return res.status(400).json({ error: 'Informe a data limite do treinamento' });
    }
    if (input.emTreinamento && treinamentoAte && Number.isNaN(treinamentoAte.getTime())) {
      return res.status(400).json({ error: 'Data limite inválida' });
    }
    const exists = await prisma.user.findUnique({ where: { email: input.email } });
    if (exists) return res.status(400).json({ error: 'Usuário com este email já existe' });

    if (input.permissionClassId) {
      const permissionClass = await resolvePermissionClass(input.permissionClassId);
      if (!permissionClass) return res.status(400).json({ error: 'Classe de permissão inválida' });
      input.permissionClassId = String(permissionClass.id);
    }

    const hashed = await bcrypt.hash(input.senha, 10);
    const created = await prisma.user.create({
      data: {
        nome: input.nome,
        email: input.email,
        senha: hashed,
        role,
        comissaoPercent: typeof input.comissaoPercent === 'number' ? input.comissaoPercent : 0,
        emTreinamento: Boolean(input.emTreinamento),
        treinamentoAte: input.emTreinamento ? treinamentoAte : null,
        ativo: typeof input.ativo === 'boolean' ? input.ativo : true,
        permissionClassId: input.permissionClassId ? String(input.permissionClassId) : null,
      },
      select: {
        id: true,
        nome: true,
        email: true,
        role: true,
        comissaoPercent: true,
        emTreinamento: true,
        treinamentoAte: true,
        ativo: true,
        permissionClassId: true,
        permissionClass: { select: { id: true, nome: true } },
      },
    });

    res.status(201).json({ user: mapUserResponse(created) });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    if (error?.code === 'P2002') {
      return res.status(400).json({ error: 'Usuário com este email já existe' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    const input = updateUserSchema.parse(req.body);
    const role = input.role !== undefined ? String(input.role || '').trim() : undefined;
    if (input.role !== undefined && !role) return res.status(400).json({ error: 'Role inválido' });
    const treinamentoAte =
      input.treinamentoAte === undefined
        ? undefined
        : input.treinamentoAte === null || input.treinamentoAte === ''
          ? null
          : new Date(String(input.treinamentoAte));
    if (treinamentoAte instanceof Date && Number.isNaN(treinamentoAte.getTime())) {
      return res.status(400).json({ error: 'Data limite inválida' });
    }

    if (input.permissionClassId !== undefined && input.permissionClassId !== null) {
      const permissionClass = await resolvePermissionClass(String(input.permissionClassId));
      if (!permissionClass) return res.status(400).json({ error: 'Classe de permissão inválida' });
      input.permissionClassId = String(permissionClass.id);
    }

    const updated = await prisma.user.update({
      where: { id },
      data: {
        ...(input.nome !== undefined ? { nome: input.nome } : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(role !== undefined ? { role } : {}),
        ...(input.comissaoPercent !== undefined ? { comissaoPercent: input.comissaoPercent } : {}),
        ...(input.emTreinamento !== undefined ? { emTreinamento: input.emTreinamento } : {}),
        ...(treinamentoAte !== undefined ? { treinamentoAte } : {}),
        ...(input.ativo !== undefined ? { ativo: input.ativo } : {}),
        ...(input.permissionClassId !== undefined ? { permissionClassId: input.permissionClassId ? String(input.permissionClassId) : null } : {}),
      },
      select: {
        id: true,
        nome: true,
        email: true,
        role: true,
        comissaoPercent: true,
        emTreinamento: true,
        treinamentoAte: true,
        ativo: true,
        permissionClassId: true,
        permissionClass: { select: { id: true, nome: true } },
      },
    });

    res.json({ user: mapUserResponse(updated) });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    if (error?.code === 'P2025') return res.status(404).json({ error: 'Usuário não encontrado' });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  const reqUser = req as AuthRequest;
  const id = String(req.params.id || '').trim();
  if (!id) return res.status(400).json({ error: 'Invalid id' });
  if (id === reqUser.userId) return res.status(400).json({ error: 'Você não pode deletar sua própria conta' });

  try {
    const updated = await prisma.user.update({
      where: { id },
      data: { ativo: false },
      select: {
        id: true,
        nome: true,
        email: true,
        role: true,
        comissaoPercent: true,
        emTreinamento: true,
        treinamentoAte: true,
        ativo: true,
        permissionClassId: true,
        permissionClass: { select: { id: true, nome: true } },
      },
    });
    res.json({ ok: true, user: mapUserResponse(updated) });
  } catch (error: any) {
    if (error?.code === 'P2025') return res.status(404).json({ error: 'Usuário não encontrado' });
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:id/password', authenticate, requireAdmin, async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'Invalid id' });
    const input = updateUserPasswordSchema.parse(req.body);

    const hashed = await bcrypt.hash(input.novaSenha, 10);
    await prisma.user.update({
      where: { id },
      data: { senha: hashed },
      select: { id: true },
    });

    res.json({ ok: true });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    if (error?.code === 'P2025') return res.status(404).json({ error: 'Usuário não encontrado' });
    res.status(500).json({ error: 'Internal server error' });
  }
});

export { router as dashboardUsersRoutes };

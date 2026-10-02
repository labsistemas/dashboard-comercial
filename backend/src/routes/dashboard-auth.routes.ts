import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import jwt, { SignOptions } from 'jsonwebtoken';
import multer from 'multer';
import sharp from 'sharp';
import prisma from '../lib/prisma';
import { authenticate, AuthRequest } from '../middleware/auth.middleware';
import { uploadFileToS3 } from '../lib/s3';
import { passwordSchema, sessionFingerprint } from '../lib/security';
import { verifyAdminSetupCode, completeAdminSetup } from '../lib/bootstrap-admin';

const router = Router();

// In-memory brute-force protection (per email + IP)
type AttemptState = { attempts: number; expiresAt: number; lockoutUntil?: number };
const LOGIN_GUARD = new Map<string, AttemptState>();
setInterval(() => {
  for (const [key, state] of LOGIN_GUARD) {
    if (state.expiresAt <= Date.now()) LOGIN_GUARD.delete(key);
  }
}, 60_000).unref();
const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 10;
const nowMs = () => Date.now();
function guardKey(email: string, ip?: string) {
  const e = String(email || '').trim().toLowerCase();
  const addr = String(ip || '').trim();
  return `${e}::${addr}`;
}
function isLocked(state?: AttemptState) {
  return Boolean(state?.lockoutUntil && state.lockoutUntil > nowMs());
}
function remainingMinutes(until?: number) {
  if (!until) return 0;
  return Math.ceil((until - nowMs()) / 60000);
}
function recordFailure(key: string) {
  const stored = LOGIN_GUARD.get(key);
  const cur = stored && stored.expiresAt > nowMs() ? stored : { attempts: 0 };
  if (LOGIN_GUARD.size >= 10_000 && !stored) LOGIN_GUARD.delete(LOGIN_GUARD.keys().next().value!);
  const attempts = cur.attempts + 1;
  const next: AttemptState = { attempts, expiresAt: nowMs() + LOCK_MINUTES * 60_000 };
  if (attempts >= MAX_ATTEMPTS) {
    next.lockoutUntil = nowMs() + LOCK_MINUTES * 60 * 1000;
  }
  LOGIN_GUARD.set(key, next);
  return next;
}
function clearGuard(key: string) {
  LOGIN_GUARD.delete(key);
}

const loginSchema = z.object({
  email: z.string().trim().min(1).max(254).transform(v => v.toLowerCase()),
  senha: z.string().min(1).max(1024),
  code: z.string().optional(),
});

const uploadAvatar = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) return cb(null, true);
    return cb(new Error('Tipo de arquivo não permitido'));
  },
});

const changePasswordSchema = z.object({
  senhaAtual: z.string().min(1),
  novaSenha: passwordSchema,
});

function normalizeRoleToken(value: unknown) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const PRODUCT_PERMISSION_TOKENS = {
  create: 'products:create',
  update: 'products:update',
  delete: 'products:delete',
} as const;

function hasOtherPermissionToken(permissionClass: any, token: string) {
  const normalizedTarget = String(token || '').trim().toLowerCase();
  if (!normalizedTarget) return false;
  const list = Array.isArray(permissionClass?.otherPermissions) ? permissionClass.otherPermissions : [];
  return list.some((item: any) => String(item || '').trim().toLowerCase() === normalizedTarget);
}

function toPermissionFlags(permissionClass: any) {
  if (!permissionClass) return null;
  return {
    trafficRead: Boolean(permissionClass.trafficRead),
    trafficWrite: Boolean(permissionClass.trafficWrite),
    commercialRead: Boolean(permissionClass.commercialRead),
    commercialWrite: Boolean(permissionClass.commercialWrite),
    adminMetricsRead: Boolean(permissionClass.adminMetricsRead),
    usersRead: Boolean(permissionClass.usersRead),
    usersCreate: Boolean(permissionClass.usersCreate),
    usersDeactivate: Boolean(permissionClass.usersDeactivate),
    productsCreate: hasOtherPermissionToken(permissionClass, PRODUCT_PERMISSION_TOKENS.create),
    productsUpdate: hasOtherPermissionToken(permissionClass, PRODUCT_PERMISSION_TOKENS.update),
    productsDelete: hasOtherPermissionToken(permissionClass, PRODUCT_PERMISSION_TOKENS.delete),
  };
}

async function resolvePermissionClassForUser(user: any) {
  if (!user) return null;
  if (user.permissionClassId) {
    return prisma.permissionClass.findUnique({ where: { id: String(user.permissionClassId) } });
  }
  const roleToken = normalizeRoleToken(user.role);
  if (!roleToken) return null;
  const classes = await prisma.permissionClass.findMany();
  return (
    classes.find((item) => normalizeRoleToken(item.id) === roleToken || normalizeRoleToken(item.nome) === roleToken) ||
    null
  );
}

router.get('/bootstrap', async (req, res) => {
  try {
    res.json({ needsAdmin: await prisma.user.count() === 0 });
  } catch {
    res.status(503).json({ error: 'Serviço indisponível' });
  }
});

router.post('/bootstrap/admin', async (req, res) => {
  try {
    if (!verifyAdminSetupCode(req.headers['x-bootstrap-token'])) {
      return res.status(403).json({ error: 'Código de instalação inválido. Consulte o terminal do backend.' });
    }
    const input = z.object({
      nome: z.string().trim().min(1).max(120),
      email: z.string().trim().email().max(254).transform(value => value.toLowerCase()),
      senha: passwordSchema,
    }).parse(req.body);
    const senha = await bcrypt.hash(input.senha, 10);
    const user = await prisma.$transaction(async tx => {
      // Serialize competing setup requests, including requests to other instances.
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(834921706)`;
      if (await tx.user.count() !== 0) return null;
      return tx.user.create({
        data: { ...input, senha, role: 'admin' },
        select: { id: true, nome: true, email: true, role: true },
      });
    });
    if (!user) return res.status(409).json({ error: 'Administrador já configurado' });
    completeAdminSetup();
    return res.status(201).json({ ok: true, user });
  } catch (error) {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Dados inválidos', issues: error.issues });
    return res.status(500).json({ error: 'Falha ao configurar o administrador' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const input = loginSchema.parse(req.body);
    const key = guardKey(input.email, req.ip);
    const state = LOGIN_GUARD.get(key);
    if (isLocked(state)) {
      return res
        .status(429)
        .json({ error: `Conta temporariamente bloqueada. Tente novamente em ${remainingMinutes(state?.lockoutUntil)} minutos.` });
    }
    const user = await prisma.user.findUnique({ where: { email: input.email } });
    if (!user) {
      const after = recordFailure(key);
      if (after.lockoutUntil) {
        return res
          .status(429)
          .json({ error: `Conta temporariamente bloqueada por excesso de tentativas falhas. Tente novamente em ${LOCK_MINUTES} minutos.` });
      }
      return res.status(401).json({ error: 'Usuário ou senha incorretos' });
    }

    const ok = await bcrypt.compare(input.senha, user.senha);
    if (!ok) {
      const after = recordFailure(key);
      if (after.lockoutUntil) {
        return res
          .status(429)
          .json({ error: `Conta temporariamente bloqueada por excesso de tentativas falhas. Tente novamente em ${LOCK_MINUTES} minutos.` });
      }
      return res.status(401).json({ error: 'Usuário ou senha incorretos' });
    }
    clearGuard(key);

    if (user.ativo === false) {
      return res.status(403).json({ error: 'Acesso desativado para este usuário' });
    }

    const JWT_SECRET = process.env.JWT_SECRET;
    const JWT_EXPIRES_IN = process.env.JWT_EXPIRATION_TIME || '7d';
    if (!JWT_SECRET) return res.status(500).json({ error: 'JWT_SECRET is not defined' });

    const token = jwt.sign(
      { userId: user.id, role: user.role, session: sessionFingerprint(user.senha) },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN, algorithm: 'HS256' } as SignOptions,
    );

    const permissionClass = await resolvePermissionClassForUser(user as any);

    res.json({
      token,
      user: {
        id: user.id,
        nome: user.nome,
        email: user.email,
        role: user.role,
        avatar: user.avatar ? `/api/upload/proxy/${user.avatar}` : '',
        comissaoPercent: user.comissaoPercent,
        emTreinamento: Boolean((user as any).emTreinamento),
        treinamentoAte: (user as any).treinamentoAte ? (user as any).treinamentoAte.toISOString().slice(0, 10) : null,
        ativo: typeof (user as any).ativo === 'boolean' ? (user as any).ativo : true,
        permissionClassId: (user as any).permissionClassId ?? null,
        permissionFlags: toPermissionFlags(permissionClass),
      },
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/me', authenticate, async (req, res) => {
  const reqUser = req as AuthRequest;
  const user = await prisma.user.findUnique({
    where: { id: reqUser.userId! },
    select: {
      id: true,
      nome: true,
      email: true,
      role: true,
      avatar: true,
      comissaoPercent: true,
      emTreinamento: true,
      treinamentoAte: true,
      ativo: true,
      permissionClassId: true,
    },
  });
  if (!user) return res.status(404).json({ error: 'User not found' });
  const permissionClass = await resolvePermissionClassForUser(user as any);
  res.json({
    user: {
      id: user.id,
      nome: user.nome,
      email: user.email,
      role: user.role,
      avatar: user.avatar ? `/api/upload/proxy/${user.avatar}` : '',
      comissaoPercent: user.comissaoPercent,
      emTreinamento: Boolean((user as any).emTreinamento),
      treinamentoAte: (user as any).treinamentoAte ? (user as any).treinamentoAte.toISOString().slice(0, 10) : null,
      ativo: typeof (user as any).ativo === 'boolean' ? (user as any).ativo : true,
      permissionClassId: (user as any).permissionClassId ?? null,
      permissionFlags: toPermissionFlags(permissionClass),
    },
  });
});

router.post('/me/avatar', authenticate, uploadAvatar.single('file'), async (req, res) => {
  try {
    const reqUser = req as AuthRequest;
    if (!req.file) return res.status(400).json({ error: 'Nenhuma imagem enviada' });

    const buffer = await sharp(req.file.buffer, { limitInputPixels: 20_000_000 })
      .resize({ width: 512, height: 512, fit: 'cover' })
      .webp({ quality: 82 })
      .toBuffer();

    const key = await uploadFileToS3({
      file: buffer,
      fileName: req.file.originalname.replace(/\.[^/.]+$/, '') + '.webp',
      contentType: 'image/webp',
      folder: 'avatars',
    });

    await prisma.user.update({ where: { id: reqUser.userId! }, data: { avatar: key } });

    res.json({ ok: true, avatar: `/api/upload/proxy/${key}`, key });
  } catch (error: any) {
    res.status(500).json({ error: 'Falha ao salvar avatar' });
  }
});

router.post('/me/password', authenticate, async (req, res) => {
  try {
    const reqUser = req as AuthRequest;
    const input = changePasswordSchema.parse(req.body);

    const user = await prisma.user.findUnique({
      where: { id: reqUser.userId! },
      select: { id: true, senha: true },
    });

    if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });

    const ok = await bcrypt.compare(input.senhaAtual, user.senha);
    if (!ok) return res.status(400).json({ error: 'Senha atual incorreta' });

    const hashed = await bcrypt.hash(input.novaSenha, 10);
    await prisma.user.update({
      where: { id: user.id },
      data: { senha: hashed },
    });

    res.json({ ok: true });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    res.status(500).json({ error: 'Falha ao atualizar senha' });
  }
});

export { router as dashboardAuthRoutes };

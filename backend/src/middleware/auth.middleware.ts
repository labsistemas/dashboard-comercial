import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../lib/prisma';
import { verifySession, sessionFingerprint } from '../lib/security';

export interface AuthRequest extends Request {
  userId?: string;
  userRole?: string;
}

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

export const authenticate = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.substring(7);
    const JWT_SECRET = process.env.JWT_SECRET;

    if (!JWT_SECRET) {
      throw new Error('JWT_SECRET is not defined');
    }

    const decoded = verifySession(token, JWT_SECRET);
    
    // Security enhancement: Verify against database
    // This prevents use of tokens for deleted users and ensures role is up-to-date
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, role: true, ativo: true, senha: true, permissionClassId: true },
    });

    if (!user || decoded.session !== sessionFingerprint(user.senha)) {
      return res.status(401).json({ error: 'Invalid session: User not found' });
    }

    if ((user as any).ativo === false) {
      return res.status(401).json({ error: 'Acesso desativado para este usuário' });
    }

    req.userId = user.id;
    let effectiveRole = inferRoleFromToken(user.role);
    if (user.permissionClassId) {
      const permissionClass = await prisma.permissionClass.findUnique({
        where: { id: String(user.permissionClassId) },
        select: { id: true, nome: true },
      });
      effectiveRole = inferRoleFromToken(permissionClass?.nome) || inferRoleFromToken(permissionClass?.id) || effectiveRole;
    }
    req.userRole = effectiveRole || user.role;

    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

export const requireAdmin = (req: AuthRequest, res: Response, next: NextFunction) => {
  (async () => {
    if (req.userRole === 'admin') {
      next();
      return;
    }

    if (!req.userId) {
      res.status(403).json({ error: 'Admin access required' });
      return;
    }

    const currentUser = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { id: true, role: true, permissionClassId: true },
    });
    if (!currentUser) {
      res.status(403).json({ error: 'Admin access required' });
      return;
    }

    if (String(currentUser.role || '') === 'admin') {
      next();
      return;
    }

    let permissionClass = currentUser.permissionClassId
      ? await prisma.permissionClass.findUnique({ where: { id: String(currentUser.permissionClassId) } })
      : null;

    if (!permissionClass) {
      const roleToken = normalizeRoleToken(currentUser.role);
      if (roleToken) {
        const classes = await prisma.permissionClass.findMany();
        permissionClass =
          classes.find(
            (item: any) =>
              normalizeRoleToken(item.id) === roleToken || normalizeRoleToken(item.nome) === roleToken,
          ) || null;
      }
    }

    const isAdminPermissionClass = Boolean(
      permissionClass &&
      (normalizeRoleToken(permissionClass.id) === 'admin' || normalizeRoleToken(permissionClass.nome) === 'admin'),
    );

    if (!isAdminPermissionClass) {
      res.status(403).json({ error: 'Admin access required' });
      return;
    }

    next();
  })().catch(() => {
    res.status(403).json({ error: 'Admin access required' });
  });
};

export function requireDataPermission(permission: 'trafficRead' | 'trafficWrite' | 'commercialRead' | 'commercialWrite') {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (req.userRole === 'admin') return next();
      const user = await prisma.user.findUnique({
        where: { id: req.userId! }, include: { permissionClass: true },
      });
      if (!user || !user.ativo) return res.status(403).json({ error: 'Acesso negado' });
      if (user.permissionClass) {
        if (user.permissionClass[permission]) return next();
      } else {
        const allowed = permission.startsWith('traffic')
          ? req.userRole === 'gestor'
          : permission === 'commercialRead'
            ? ['gestor', 'vendedor', 'closer'].includes(req.userRole || '')
            : req.userRole === 'vendedor';
        if (allowed) return next();
      }
      return res.status(403).json({ error: 'Permissão insuficiente' });
    } catch (error) {
      next(error);
    }
  };
}

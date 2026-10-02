import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import { execSync } from 'child_process';
import { createServer as createHttpsServer } from 'https';
import { readFileSync } from 'fs';
import path from 'path';
import { Server as IOServer } from 'socket.io';
import { verifySession, sessionFingerprint, passwordSchema } from './lib/security';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import prisma from './lib/prisma';
import { ZodError } from 'zod';
import { dashboardAuthRoutes } from './routes/dashboard-auth.routes';
import { dashboardUsersRoutes } from './routes/dashboard-users.routes';
import { productRoutes } from './routes/products.routes';
import { trafficRoutes } from './routes/traffic.routes';
import { commercialRoutes } from './routes/commercial.routes';
import { rescueRoutes } from './routes/rescue.routes';
import { abandonmentRoutes } from './routes/abandonment.routes';
import { uploadRoutes } from './routes/upload.routes';
import { agentRoutes } from './routes/agent.routes';
import { teamsRoutes } from './routes/teams.routes';
import { permissionClassesRoutes } from './routes/permission-classes.routes';
import { initializeAdminSetup } from './lib/bootstrap-admin';

dotenv.config();

function wrapAsyncHandler(handler: any): any {
  if (Array.isArray(handler)) return handler.map(wrapAsyncHandler);
  if (typeof handler !== 'function') return handler;
  if (handler.length === 4) return handler;
  return (req: express.Request, res: express.Response, next: express.NextFunction) =>
    Promise.resolve(handler(req, res, next)).catch(next);
}

function patchExpressRouterAsyncErrors() {
  const proto = (express.Router as any).prototype;
  const methods = [
    'use',
    'all',
    'get',
    'post',
    'put',
    'patch',
    'delete',
    'options',
    'head',
  ];

  for (const method of methods) {
    const original = proto[method];
    if (typeof original !== 'function') continue;
    if ((original as any).__asyncPatched) continue;

    proto[method] = function (...args: any[]) {
      const wrapped = args.map(wrapAsyncHandler);
      return original.apply(this, wrapped);
    };
    (proto[method] as any).__asyncPatched = true;
  }
}

patchExpressRouterAsyncErrors();

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 'loopback');
app.disable('x-powered-by');
app.set('etag', false);

function stripWrappingQuotes(value: string) {
  return value.replace(/^['"`\s]+|['"`\s]+$/g, '').trim();
}

const getCorsOrigin = () => {
  const raw = [process.env.FRONTEND, process.env.FRONTEND_URL].filter(Boolean) as string[];
  const normalized = raw
    .map((v) => stripWrappingQuotes(String(v)))
    .filter((v) => v.length > 0)
    .map((v) => v.replace(/\/$/, ''));
  return Array.from(new Set(normalized));
};

const CORS_ORIGINS = getCorsOrigin();

app.use(
  helmet({
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }),
);

const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

app.use(
  cors({
    origin: CORS_ORIGINS.length > 0 ? CORS_ORIGINS : false,
    credentials: true,
  }),
);

app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

app.use('/api/auth', authLimiter, dashboardAuthRoutes);
app.use('/api/users', dashboardUsersRoutes);
app.use('/api/products', productRoutes);
app.use('/api/traffic/entries', trafficRoutes);
app.use('/api/commercial/entries', commercialRoutes);
app.use('/api/rescue/entries', rescueRoutes);
app.use('/api/abandonment', abandonmentRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/agent', agentRoutes);
app.use('/api/teams', teamsRoutes);
app.use('/api/permission-classes', permissionClassesRoutes);

app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'Dados inválidos',
      issues: err.issues,
    });
  }
  const status = Number.isInteger(err.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
  res.status(status).json({ error: status >= 500 ? 'Internal server error' : 'Requisição inválida' });
});

async function ensureAdminUser() {
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminEmail || !adminPassword) return;

  const existing = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (existing) {
    return;
  }

  passwordSchema.parse(adminPassword);
  const hashed = await bcrypt.hash(adminPassword, 10);
  await prisma.user.create({
    data: {
      nome: 'Administrador',
      email: adminEmail,
      senha: hashed,
      role: 'admin',
    },
  });
}

async function bootstrap() {
  if (!process.env.JWT_SECRET || Buffer.byteLength(process.env.JWT_SECRET) < 32) {
    throw new Error('JWT_SECRET precisa ter pelo menos 32 bytes');
  }
  execSync('node ./node_modules/prisma/build/index.js migrate deploy', { stdio: 'inherit' });
  await ensureAdminUser();
  if (await prisma.user.count() === 0) initializeAdminSetup();

  const certPath = path.join(process.cwd(), 'certs', 'internal.crt');
  const keyPath = path.join(process.cwd(), 'certs', 'internal.key');
  const httpServer = createHttpsServer({ cert: readFileSync(certPath), key: readFileSync(keyPath) }, app);
  const io = new IOServer(httpServer, {
    cors: {
      origin: CORS_ORIGINS.length > 0 ? CORS_ORIGINS : false,
      credentials: true,
    },
  });

  io.use(async (socket, next) => {
    try {
      const token = String((socket.handshake.auth as any)?.token || '');
      if (!token) return next(new Error('Unauthorized'));
      const JWT_SECRET = process.env.JWT_SECRET;
      if (!JWT_SECRET) return next(new Error('JWT_SECRET is not defined'));
      const decoded = verifySession(token, JWT_SECRET);
      const user = await prisma.user.findUnique({ where: { id: decoded.userId }, select: { id: true, role: true, ativo: true, senha: true } });
      if (!user || !user.ativo || decoded.session !== sessionFingerprint(user.senha)) return next(new Error('Unauthorized'));
      (socket.data as any).userId = user.id;
      (socket.data as any).userRole = user.role;
      (socket.data as any).sessionToken = token;
      next();
    } catch {
      next(new Error('Unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const userId = String((socket.data as any).userId || '');
    const userRole = String((socket.data as any).userRole || '');
    if (userId) socket.join(`user:${userId}`);
    if (userRole === 'admin') socket.join('admins');
    const sessionCheck = setInterval(async () => {
      try {
        const decoded = verifySession(socket.data.sessionToken, process.env.JWT_SECRET!);
        const user = await prisma.user.findUnique({ where: { id: userId }, select: { ativo: true, senha: true, role: true } });
        if (!user || !user.ativo || user.role !== userRole || decoded.session !== sessionFingerprint(user.senha)) {
          socket.disconnect(true);
        }
      } catch { socket.disconnect(true); }
    }, 30_000);
    sessionCheck.unref();
    socket.on('disconnect', () => clearInterval(sessionCheck));
  });

  app.set('io', io);

  const server = httpServer.listen(Number(PORT), process.env.NODE_ENV === 'production' ? '127.0.0.1' : '::', () => {
    console.log(`Server running on port ${PORT}`);
  });

  const shutdown = async () => {
    server.close(async () => {
      io.close();
      await prisma.$disconnect();
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});

import { Router } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import multer from 'multer';
import ExcelJS from 'exceljs';
import prisma from '../lib/prisma';
import { authenticate, AuthRequest, requireAdmin } from '../middleware/auth.middleware';

const router = Router();
const upload = multer();

function emitSocketEvent(req: any, room: string, event: string, payload: unknown) {
  try {
    const io = req?.app?.get?.('io');
    if (!io) return;
    io.to(room).emit(event, payload);
  } catch {
  }
}

function emitChatMessage(req: any, payload: { userId: string; conversationId: string; conversationNumber: number; message: { id: string; sender: string; content: string; createdAt: string } }) {
  emitSocketEvent(req, `user:${payload.userId}`, 'agent_chat_message', payload);
  emitSocketEvent(req, 'admins', 'agent_chat_message', payload);
}

function normalizeUrl(value: unknown) {
  const v = String(value ?? '').trim();
  if (!v) return null;
  return v;
}

function pickTokenFromHeaders(req: AuthRequest) {
  const header = String(req.headers['x-agent-token'] || '').trim();
  if (header) return header;
  const auth = String(req.headers.authorization || '').trim();
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return '';
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

async function ensureConfig() {
  const existing = await prisma.agentConfig.findUnique({ where: { id: 'default' } });
  if (existing) {
    if (!existing.inboundWebhookToken) {
      return prisma.agentConfig.update({
        where: { id: 'default' },
        data: { inboundWebhookToken: generateToken() },
      });
    }
    return existing;
  }
  return prisma.agentConfig.create({
    data: {
      id: 'default',
      inboundWebhookToken: generateToken(),
    },
  });
}

async function postWebhook(url: string, payload: unknown) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function tryPushFaqToWebhook(
  cfg: { faqWebhookUrl: string | null },
  faq: Array<{ question: string; answer: string }>,
) {
  if (!cfg.faqWebhookUrl) return false;
  try {
    await postWebhook(cfg.faqWebhookUrl, { event: 'faq_update', faq });
    return true;
  } catch {
    return false;
  }
}

function parseCsv(content: string) {
  const text = String(content || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = text.split('\n').filter((l) => String(l).trim().length > 0);
  if (lines.length === 0) return [];

  const delimiter = lines[0].includes(';') ? ';' : lines[0].includes('\t') ? '\t' : ',';

  const parseLine = (line: string) => {
    const out: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
          continue;
        }
        inQuotes = !inQuotes;
        continue;
      }
      if (!inQuotes && ch === delimiter) {
        out.push(cur);
        cur = '';
        continue;
      }
      cur += ch;
    }
    out.push(cur);
    return out.map((v) => String(v ?? '').trim());
  };

  return lines.map(parseLine);
}

async function parseFaqFromUpload(file: Express.Multer.File) {
  const name = String(file.originalname || '').toLowerCase();
  const isCsv = name.endsWith('.csv') || String(file.mimetype || '').includes('csv');

  if (isCsv) {
    const rows = parseCsv(file.buffer.toString('utf8'));
    const out: Array<{ question: string; answer: string }> = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i] || [];
      const question = String(row[0] || '').trim();
      const answer = String(row[1] || '').trim();
      if (!question && !answer) continue;
      out.push({ question, answer });
    }
    return out;
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(file.buffer as any);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];

  const out: Array<{ question: string; answer: string }> = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const a = String(row.getCell(1).text || '').trim();
    const b = String(row.getCell(2).text || '').trim();
    if (!a && !b) return;
    out.push({ question: a, answer: b });
  });
  return out;
}

const configSchema = z.object({
  faqWebhookUrl: z.string().trim().optional().nullable(),
  chatWebhookUrl: z.string().trim().optional().nullable(),
  inboundWebhookToken: z.string().trim().optional().nullable(),
  rotateInboundToken: z.boolean().optional(),
});

router.get('/config', authenticate, requireAdmin, async (_req, res) => {
  const cfg = await ensureConfig();
  res.json({
    config: {
      faqWebhookUrl: cfg.faqWebhookUrl ?? null,
      chatWebhookUrl: cfg.chatWebhookUrl ?? null,
      inboundWebhookToken: cfg.inboundWebhookToken ?? null,
    },
  });
});

router.put('/config', authenticate, requireAdmin, async (req, res) => {
  const input = configSchema.parse(req.body || {});
  const cfg = await ensureConfig();
  const nextToken = input.rotateInboundToken ? generateToken() : normalizeUrl(input.inboundWebhookToken) ?? cfg.inboundWebhookToken;

  const updated = await prisma.agentConfig.update({
    where: { id: cfg.id },
    data: {
      faqWebhookUrl: normalizeUrl(input.faqWebhookUrl),
      chatWebhookUrl: normalizeUrl(input.chatWebhookUrl),
      inboundWebhookToken: nextToken,
    },
  });

  res.json({
    config: {
      faqWebhookUrl: updated.faqWebhookUrl ?? null,
      chatWebhookUrl: updated.chatWebhookUrl ?? null,
      inboundWebhookToken: updated.inboundWebhookToken ?? null,
    },
  });
});

router.get('/faq', authenticate, async (_req, res) => {
  const items = await prisma.agentFaqItem.findMany({ orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] });
  res.json({
    items: items.map((i) => ({ id: i.id, question: i.question, answer: i.answer, order: i.order })),
  });
});

const faqUpsertSchema = z.object({
  items: z.array(
    z.object({
      question: z.string().trim().min(1),
      answer: z.string().trim().min(1),
    }),
  ),
});

router.put('/faq', authenticate, requireAdmin, async (req, res) => {
  const input = faqUpsertSchema.parse(req.body || {});
  const items = input.items.map((it, idx) => ({ question: it.question, answer: it.answer, order: idx }));

  await prisma.$transaction(async (tx) => {
    await tx.agentFaqItem.deleteMany({});
    if (items.length > 0) {
      await tx.agentFaqItem.createMany({ data: items });
    }
  });

  const cfg = await ensureConfig();
  const pushed = await tryPushFaqToWebhook(
    { faqWebhookUrl: cfg.faqWebhookUrl ?? null },
    items.map((i) => ({ question: i.question, answer: i.answer })),
  );

  res.json({ ok: true, count: items.length, pushed });
});

router.post('/faq/preview-upload', authenticate, requireAdmin, upload.single('file'), async (req, res) => {
  const file = (req as any).file as Express.Multer.File | undefined;
  if (!file) return res.status(400).json({ error: 'Arquivo não enviado' });

  const items = await parseFaqFromUpload(file);
  res.json({ items });
});

router.post('/faq/import-upload', authenticate, requireAdmin, upload.single('file'), async (req, res) => {
  const file = (req as any).file as Express.Multer.File | undefined;
  if (!file) return res.status(400).json({ error: 'Arquivo não enviado' });

  const items = await parseFaqFromUpload(file);

  await prisma.$transaction(async (tx) => {
    await tx.agentFaqItem.deleteMany({});
    if (items.length > 0) {
      await tx.agentFaqItem.createMany({
        data: items.map((it, idx) => ({ question: it.question, answer: it.answer, order: idx })),
      });
    }
  });

  const cfg = await ensureConfig();
  const pushed = await tryPushFaqToWebhook({ faqWebhookUrl: cfg.faqWebhookUrl ?? null }, items);

  res.json({ ok: true, count: items.length, pushed, items });
});

router.post('/faq/push-to-webhook', authenticate, requireAdmin, async (_req, res) => {
  const cfg = await ensureConfig();
  if (!cfg.faqWebhookUrl) return res.status(400).json({ error: 'Webhook de FAQ não configurado' });
  const items = await prisma.agentFaqItem.findMany({ orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] });
  const pushed = await tryPushFaqToWebhook(
    { faqWebhookUrl: cfg.faqWebhookUrl ?? null },
    items.map((i) => ({ question: i.question, answer: i.answer })),
  );
  res.json({ ok: true, count: items.length, pushed });
});

async function ensureConversationForUser(userId: string) {
  const latest = await prisma.agentChatConversation.findFirst({
    where: { userId },
    orderBy: [{ number: 'desc' }, { createdAt: 'desc' }],
  });
  const nextNumber = (latest?.number || 0) + 1;
  return prisma.agentChatConversation.create({
    data: { userId, number: nextNumber },
  });
}

router.get('/chat/conversations', authenticate, async (req, res) => {
  const reqUser = req as AuthRequest;
  const queryUserId = String(req.query.userId || '').trim();
  const targetUserId = reqUser.userRole === 'admin' && queryUserId ? queryUserId : String(reqUser.userId);

  const conversations = await prisma.agentChatConversation.findMany({
    where: { userId: targetUserId },
    orderBy: [{ number: 'desc' }],
    select: {
      id: true,
      number: true,
      createdAt: true,
      updatedAt: true,
      messages: {
        select: { id: true, createdAt: true, content: true, sender: true },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  });

  res.json({
    conversations: conversations.map((c) => ({
      id: c.id,
      number: c.number,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
      lastMessage: c.messages[0]
        ? {
            id: c.messages[0].id,
            createdAt: c.messages[0].createdAt.toISOString(),
            content: c.messages[0].content,
            sender: c.messages[0].sender,
          }
        : null,
    })),
  });
});

router.post('/chat/conversations', authenticate, async (req, res) => {
  const reqUser = req as AuthRequest;
  const userId = String(reqUser.userId);
  const [conv, user] = await Promise.all([
    ensureConversationForUser(userId),
    prisma.user.findUnique({ where: { id: userId }, select: { id: true, nome: true } }),
  ]);

  emitSocketEvent(req, `user:${userId}`, 'agent_chat_conversation_started', {
    userId,
    userName: user?.nome ?? '',
    conversation: { id: conv.id, number: conv.number, createdAt: conv.createdAt.toISOString() },
  });
  emitSocketEvent(req, 'admins', 'agent_chat_conversation_started', {
    userId,
    userName: user?.nome ?? '',
    conversation: { id: conv.id, number: conv.number, createdAt: conv.createdAt.toISOString() },
  });

  res.json({ conversation: { id: conv.id, number: conv.number, createdAt: conv.createdAt.toISOString() } });
});

router.get('/chat/conversations/:id/messages', authenticate, async (req, res) => {
  const reqUser = req as AuthRequest;
  const id = String(req.params.id);
  const conv = await prisma.agentChatConversation.findUnique({
    where: { id },
    select: { id: true, userId: true, number: true },
  });
  if (!conv) return res.status(404).json({ error: 'Conversa não encontrada' });
  if (reqUser.userRole !== 'admin' && conv.userId !== String(reqUser.userId)) {
    return res.status(403).json({ error: 'Sem acesso' });
  }

  const messages = await prisma.agentChatMessage.findMany({
    where: { conversationId: conv.id },
    orderBy: { createdAt: 'asc' },
  });

  res.json({
    conversation: { id: conv.id, number: conv.number },
    messages: messages.map((m) => ({
      id: m.id,
      sender: m.sender,
      content: m.content,
      createdAt: m.createdAt.toISOString(),
    })),
  });
});

const sendMessageSchema = z.object({
  content: z.string().trim().min(1).max(10_000),
});

router.post('/chat/conversations/:id/messages', authenticate, async (req, res) => {
  const reqUser = req as AuthRequest;
  const id = String(req.params.id);
  const input = sendMessageSchema.parse(req.body || {});
  const conv = await prisma.agentChatConversation.findUnique({
    where: { id },
    select: { id: true, userId: true, number: true, createdAt: true },
  });
  if (!conv) return res.status(404).json({ error: 'Conversa não encontrada' });
  if (reqUser.userRole !== 'admin' && conv.userId !== String(reqUser.userId)) {
    return res.status(403).json({ error: 'Sem acesso' });
  }

  const created = await prisma.agentChatMessage.create({
    data: {
      conversationId: conv.id,
      sender: 'user',
      content: input.content,
    },
  });

  const [cfg, user] = await Promise.all([
    ensureConfig(),
    prisma.user.findUnique({ where: { id: conv.userId }, select: { id: true, nome: true } }),
  ]);

  emitChatMessage(req, {
    userId: conv.userId,
    conversationId: conv.id,
    conversationNumber: conv.number,
    message: { id: created.id, sender: created.sender, content: created.content, createdAt: created.createdAt.toISOString() },
  });

  if (cfg.chatWebhookUrl) {
    try {
      await postWebhook(cfg.chatWebhookUrl, {
        event: 'user_message',
        userId: conv.userId,
        userName: user?.nome ?? '',
        conversationId: conv.id,
        conversationNumber: conv.number,
        messageId: created.id,
        content: created.content,
        createdAt: created.createdAt.toISOString(),
      });
    } catch {
    }
  }

  res.json({
    message: {
      id: created.id,
      sender: created.sender,
      content: created.content,
      createdAt: created.createdAt.toISOString(),
    },
  });
});

const inboundSchema = z.object({
  userId: z.string().min(1),
  conversationId: z.string().optional().nullable(),
  content: z.string().trim().min(1).max(10_000),
});

router.post('/chat/inbound', async (req, res) => {
  const token = pickTokenFromHeaders(req as AuthRequest);
  const cfg = await ensureConfig();
  if (!cfg.inboundWebhookToken || token !== cfg.inboundWebhookToken) {
    return res.status(401).json({ error: 'Token inválido' });
  }

  const rawBody = (req.body || {}) as any;
  const normalized = {
    userId: rawBody.userId ?? rawBody.userID ?? rawBody.userid ?? rawBody.user_id,
    conversationId: rawBody.conversationId ?? rawBody.conversationID ?? rawBody.conversation_id,
    content: rawBody.content ?? rawBody.Content ?? rawBody.message ?? rawBody.text,
  };
  const parsed = inboundSchema.safeParse(normalized);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Dados inválidos', issues: parsed.error.issues });
  }
  const input = parsed.data;
  const userId = String(input.userId);

  const conv =
    input.conversationId
      ? await prisma.agentChatConversation.findUnique({ where: { id: String(input.conversationId) } })
      : await prisma.agentChatConversation.findFirst({
          where: { userId },
          orderBy: [{ number: 'desc' }, { createdAt: 'desc' }],
        });

  const finalConv =
    conv && conv.userId === userId
      ? conv
      : await prisma.agentChatConversation.create({
          data: { userId, number: ((await prisma.agentChatConversation.findFirst({ where: { userId }, orderBy: [{ number: 'desc' }] }))?.number || 0) + 1 },
        });

  const created = await prisma.agentChatMessage.create({
    data: { conversationId: finalConv.id, sender: 'agent', content: input.content },
  });

  emitChatMessage(req, {
    userId,
    conversationId: finalConv.id,
    conversationNumber: finalConv.number,
    message: { id: created.id, sender: created.sender, content: created.content, createdAt: created.createdAt.toISOString() },
  });

  res.json({
    ok: true,
    conversation: { id: finalConv.id, number: finalConv.number },
    message: { id: created.id, sender: created.sender, content: created.content, createdAt: created.createdAt.toISOString() },
  });
});

export { router as agentRoutes };

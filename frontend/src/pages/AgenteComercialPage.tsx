import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getAuthToken, getBackendBaseUrl } from '@/lib/storage';
import { AgentChatConversation, AgentChatMessage, AgentConfig, AgentFaqItem } from '@/types/dashboard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/hooks/use-toast';
import { Copy, Loader2, Plus, RefreshCcw, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';
import { io, Socket } from 'socket.io-client';

function asErrorMessage(err: unknown) {
  if (err instanceof Error) return err.message;
  return String(err || 'Erro desconhecido');
}

function formatTimestampBR(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('pt-BR');
}

export default function AgenteComercialPage() {
  const { user } = useAuth();
  const backend = getBackendBaseUrl();
  const token = getAuthToken();
  const isAdmin = user?.role === 'admin';
  const [tab, setTab] = useState<string>(isAdmin ? 'config' : 'conversas');

  const [config, setConfig] = useState<AgentConfig | null>(null);
  const [configDraft, setConfigDraft] = useState<AgentConfig>({
    faqWebhookUrl: null,
    chatWebhookUrl: null,
    inboundWebhookToken: null,
  });
  const [isSavingConfig, setIsSavingConfig] = useState(false);

  const [faqItems, setFaqItems] = useState<AgentFaqItem[]>([]);
  const [faqModalOpen, setFaqModalOpen] = useState(false);
  const [faqUploadPreview, setFaqUploadPreview] = useState<AgentFaqItem[]>([]);
  const [isFaqLoading, setIsFaqLoading] = useState(false);
  const [isFaqSaving, setIsFaqSaving] = useState(false);
  const [faqProcessingOpen, setFaqProcessingOpen] = useState(false);
  const [faqProcessingLabel, setFaqProcessingLabel] = useState('');
  const [faqProcessingLines, setFaqProcessingLines] = useState(0);
  const [faqProcessingTotalSeconds, setFaqProcessingTotalSeconds] = useState(0);
  const [faqProcessingRemainingSeconds, setFaqProcessingRemainingSeconds] = useState(0);
  const [faqProcessingRequestDone, setFaqProcessingRequestDone] = useState(false);

  const [conversations, setConversations] = useState<AgentChatConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AgentChatMessage[]>([]);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [isCreatingConversation, setIsCreatingConversation] = useState(false);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState('');
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const [socketConnected, setSocketConnected] = useState(false);
  const activeConversationIdRef = useRef<string | null>(null);
  const [monitorUsers, setMonitorUsers] = useState<Array<{ id: string; nome: string; role: string }>>([]);
  const [monitorUserId, setMonitorUserId] = useState<string>('me');
  const watchedUserId = useMemo(() => {
    if (isAdmin && monitorUserId !== 'me') return monitorUserId;
    return String(user?.id || '');
  }, [isAdmin, monitorUserId, user?.id]);
  const watchedUserIdRef = useRef<string>('');

  const headers = useMemo(() => {
    const h: Record<string, string> = {};
    if (token) h.Authorization = `Bearer ${token}`;
    return h;
  }, [token]);

  const startFaqProcessing = useCallback((lines: number, label: string) => {
    const safeLines = Math.max(0, Math.floor(lines || 0));
    const totalSeconds = safeLines * 3;
    setFaqProcessingLabel(label);
    setFaqProcessingLines(safeLines);
    setFaqProcessingTotalSeconds(totalSeconds);
    setFaqProcessingRemainingSeconds(totalSeconds);
    setFaqProcessingRequestDone(false);
    setFaqProcessingOpen(true);
  }, []);

  useEffect(() => {
    if (!faqProcessingOpen) return;
    if (faqProcessingRemainingSeconds <= 0) return;
    const t = setInterval(() => {
      setFaqProcessingRemainingSeconds((s) => Math.max(0, s - 1));
    }, 1000);
    return () => clearInterval(t);
  }, [faqProcessingOpen, faqProcessingRemainingSeconds]);

  useEffect(() => {
    if (!faqProcessingOpen) return;
    if (!faqProcessingRequestDone) return;
    if (faqProcessingRemainingSeconds > 0) return;
    setFaqProcessingOpen(false);
  }, [faqProcessingOpen, faqProcessingRequestDone, faqProcessingRemainingSeconds]);

  const apiFetch = useCallback(
    async (path: string, init?: RequestInit) => {
      if (!backend) throw new Error('BACKEND não configurado (import.meta.env.BACKEND)');
      const res = await fetch(`${backend}${path}`, {
        ...init,
        headers: {
          ...(init?.headers || {}),
          ...headers,
        },
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const msg = String(data?.error || res.statusText || 'Erro');
        throw new Error(msg);
      }
      return data;
    },
    [backend, headers],
  );

  const loadConfig = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const data = await apiFetch('/api/agent/config');
      const cfg = (data?.config || null) as AgentConfig | null;
      if (cfg) {
        setConfig(cfg);
        setConfigDraft(cfg);
      }
    } catch (err) {
      toast({ title: 'Erro ao carregar configurações', description: asErrorMessage(err), variant: 'destructive' });
    }
  }, [apiFetch, isAdmin]);

  const loadFaq = useCallback(async () => {
    if (!backend || !token) return;
    try {
      const data = await apiFetch('/api/agent/faq');
      const items = (data?.items || []) as Array<{ id: string; question: string; answer: string; order?: number }>;
      setFaqItems(items.map((i) => ({ id: i.id, question: i.question, answer: i.answer, order: i.order })));
    } catch {
      setFaqItems([]);
    }
  }, [apiFetch, backend, token]);

  const loadConversations = useCallback(async () => {
    if (!backend || !token) return;
    try {
      const query =
        isAdmin && monitorUserId !== 'me'
          ? `?userId=${encodeURIComponent(monitorUserId)}`
          : '';
      const data = await apiFetch(`/api/agent/chat/conversations${query}`);
      const list = (data?.conversations || []) as AgentChatConversation[];
      setConversations(list);
      setActiveConversationId((prev) => (prev ? prev : list.length > 0 ? list[0].id : null));
    } catch {
      setConversations([]);
    }
  }, [apiFetch, backend, token, isAdmin, monitorUserId]);

  const loadMessages = useCallback(async (conversationId: string, opts?: { silent?: boolean }) => {
    if (!backend || !token) return;
    const silent = !!opts?.silent;
    if (!silent) setIsChatLoading(true);
    try {
      const data = await apiFetch(`/api/agent/chat/conversations/${conversationId}/messages`);
      const list = (data?.messages || []) as AgentChatMessage[];
      setMessages(list);
    } catch (err) {
      if (!silent) {
        toast({ title: 'Erro ao carregar chat', description: asErrorMessage(err), variant: 'destructive' });
        setMessages([]);
      }
    } finally {
      if (!silent) setIsChatLoading(false);
    }
  }, [apiFetch, backend, token]);

  const loadMonitorUsers = useCallback(async () => {
    if (!backend || !token || !isAdmin) return;
    try {
      const data = await apiFetch('/api/users');
      const list = (data?.users ?? data ?? []) as Array<{ id: string; nome?: string; name?: string; role?: string }>;
      const mapped = list.map((u) => ({ id: String(u.id), nome: String(u.nome || u.name || ''), role: String(u.role || '') }));
      setMonitorUsers(mapped.filter((u) => u.role === 'vendedor'));
    } catch {
      setMonitorUsers([]);
    }
  }, [apiFetch, backend, token, isAdmin]);

  useEffect(() => {
    if (!backend || !token) return;
    loadFaq();
    loadConversations();
    if (isAdmin) loadConfig();
  }, [backend, token, loadFaq, loadConversations, loadConfig, isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    loadMonitorUsers();
  }, [isAdmin, loadMonitorUsers]);

  useEffect(() => {
    if (!isAdmin) return;
    setActiveConversationId(null);
    setMessages([]);
    loadConversations();
  }, [isAdmin, monitorUserId, loadConversations]);

  useEffect(() => {
    if (!activeConversationId) return;
    loadMessages(activeConversationId);
  }, [activeConversationId, loadMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, activeConversationId]);

  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

  useEffect(() => {
    watchedUserIdRef.current = watchedUserId;
  }, [watchedUserId]);

  useEffect(() => {
    if (!backend || !token) return;
    const s = io(backend, { auth: { token }, transports: ['websocket'] });
    socketRef.current = s;
    setSocketConnected(s.connected);

    const onConnect = () => setSocketConnected(true);
    const onDisconnect = () => setSocketConnected(false);
    const onMessage = (payload: any) => {
      const userId = String(payload?.userId || '');
      if (!userId || userId !== watchedUserIdRef.current) return;
      const conversationId = String(payload?.conversationId || '');
      const conversationNumber = Number(payload?.conversationNumber || 0);
      const message = payload?.message as AgentChatMessage | undefined;
      if (!message?.id || !conversationId) return;

      setConversations((prev) => {
        const next = [...prev];
        const idx = next.findIndex((c) => c.id === conversationId);
        const lastMessage: NonNullable<AgentChatConversation['lastMessage']> = {
          id: message.id,
          createdAt: message.createdAt,
          content: message.content,
          sender: message.sender,
        };
        if (idx >= 0) {
          next[idx] = { ...next[idx], lastMessage, updatedAt: message.createdAt };
        } else {
          next.unshift({ id: conversationId, number: conversationNumber || 0, createdAt: message.createdAt, updatedAt: message.createdAt, lastMessage });
        }
        next.sort((a, b) => {
          const ad = a.updatedAt || a.lastMessage?.createdAt || a.createdAt;
          const bd = b.updatedAt || b.lastMessage?.createdAt || b.createdAt;
          return String(bd).localeCompare(String(ad));
        });
        return next;
      });

      if (conversationId === String(activeConversationIdRef.current || '')) {
        setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]));
      }
    };

    s.on('connect', onConnect);
    s.on('disconnect', onDisconnect);
    s.on('agent_chat_message', onMessage);

    return () => {
      s.off('connect', onConnect);
      s.off('disconnect', onDisconnect);
      s.off('agent_chat_message', onMessage);
      s.disconnect();
      socketRef.current = null;
      setSocketConnected(false);
    };
  }, [backend, token]);

  const activeConversation = useMemo(() => {
    return conversations.find((c) => c.id === activeConversationId) || null;
  }, [conversations, activeConversationId]);

  const handleSaveConfig = async () => {
    if (!isAdmin) return;
    setIsSavingConfig(true);
    try {
      const data = await apiFetch('/api/agent/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(configDraft),
      });
      const cfg = (data?.config || null) as AgentConfig | null;
      if (cfg) {
        setConfig(cfg);
        setConfigDraft(cfg);
      }
      toast({ title: 'Configurações salvas' });
    } catch (err) {
      toast({ title: 'Erro ao salvar', description: asErrorMessage(err), variant: 'destructive' });
    } finally {
      setIsSavingConfig(false);
    }
  };

  const handleRotateToken = async () => {
    if (!isAdmin) return;
    setIsSavingConfig(true);
    try {
      const data = await apiFetch('/api/agent/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...configDraft, rotateInboundToken: true }),
      });
      const cfg = (data?.config || null) as AgentConfig | null;
      if (cfg) {
        setConfig(cfg);
        setConfigDraft(cfg);
      }
      toast({ title: 'Token rotacionado' });
    } catch (err) {
      toast({ title: 'Erro ao rotacionar token', description: asErrorMessage(err), variant: 'destructive' });
    } finally {
      setIsSavingConfig(false);
    }
  };

  const handleCopy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast({ title: 'Copiado' });
    } catch {
      toast({ title: 'Não foi possível copiar', variant: 'destructive' });
    }
  };

  const handleFaqFile = async (file: File) => {
    if (!isAdmin) return;
    setIsFaqLoading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const data = await apiFetch('/api/agent/faq/preview-upload', {
        method: 'POST',
        body: form,
      });
      const items = (data?.items || []) as Array<{ question: string; answer: string }>;
      setFaqUploadPreview(items.map((it) => ({ question: it.question, answer: it.answer })));
      setFaqModalOpen(true);
    } catch (err) {
      toast({ title: 'Erro ao ler planilha', description: asErrorMessage(err), variant: 'destructive' });
      setFaqUploadPreview([]);
    } finally {
      setIsFaqLoading(false);
    }
  };

  const handleSaveFaqFromModal = async () => {
    if (!isAdmin) return;
    const cleaned = faqUploadPreview
      .map((it) => ({ question: String(it.question || '').trim(), answer: String(it.answer || '').trim() }))
      .filter((it) => it.question.length > 0 && it.answer.length > 0);

    setFaqModalOpen(false);
    startFaqProcessing(cleaned.length, 'Processando FAQ');
    setIsFaqSaving(true);
    try {
      await apiFetch('/api/agent/faq', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: cleaned }),
      });
      setFaqUploadPreview([]);
      await loadFaq();
      toast({ title: 'FAQ atualizado', description: `${cleaned.length} itens` });
    } catch (err) {
      toast({ title: 'Erro ao salvar FAQ', description: asErrorMessage(err), variant: 'destructive' });
      setFaqProcessingRemainingSeconds(0);
    } finally {
      setIsFaqSaving(false);
      setFaqProcessingRequestDone(true);
    }
  };

  const handlePushFaqToWebhook = async () => {
    if (!isAdmin) return;
    startFaqProcessing(faqItems.length, 'Enviando FAQ para o webhook');
    try {
      await apiFetch('/api/agent/faq/push-to-webhook', { method: 'POST' });
      toast({ title: 'FAQ enviado para o webhook' });
    } catch (err) {
      toast({ title: 'Erro ao enviar FAQ', description: asErrorMessage(err), variant: 'destructive' });
      setFaqProcessingRemainingSeconds(0);
    } finally {
      setFaqProcessingRequestDone(true);
    }
  };

  const isMonitoringOtherUser = useMemo(() => {
    if (!isAdmin) return false;
    return monitorUserId !== 'me';
  }, [isAdmin, monitorUserId]);

  const handleNewConversation = async () => {
    if (!backend || !token) return;
    if (isMonitoringOtherUser) return;
    setIsCreatingConversation(true);
    try {
      const data = await apiFetch('/api/agent/chat/conversations', { method: 'POST' });
      const conv = data?.conversation as { id: string; number: number } | undefined;
      await loadConversations();
      if (conv?.id) setActiveConversationId(conv.id);
      toast({ title: 'Nova conversa criada', description: conv ? `Conversa #${conv.number}` : undefined });
    } catch (err) {
      toast({ title: 'Erro ao criar conversa', description: asErrorMessage(err), variant: 'destructive' });
    } finally {
      setIsCreatingConversation(false);
    }
  };

  const handleSend = async () => {
    if (isMonitoringOtherUser) return;
    if (!activeConversationId) {
      await handleNewConversation();
      return;
    }
    const content = String(draft || '').trim();
    if (!content) return;
    setSending(true);
    try {
      await apiFetch(`/api/agent/chat/conversations/${activeConversationId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      setDraft('');
      await loadMessages(activeConversationId);
      await loadConversations();
    } catch (err) {
      toast({ title: 'Erro ao enviar mensagem', description: asErrorMessage(err), variant: 'destructive' });
    } finally {
      setSending(false);
    }
  };

  const inboundDoc = useMemo(() => {
    if (!backend) return '';
    const base = `${backend}/api/agent/chat/inbound`;
    const exampleToken = configDraft.inboundWebhookToken || 'SEU_TOKEN';
    const exampleUserId = user?.id || 'USER_ID';
    return [
      `POST ${base}`,
      ``,
      `Headers:`,
      `  Authorization: Bearer ${exampleToken}`,
      `  Content-Type: application/json`,
      ``,
      `Body (JSON):`,
      `  {`,
      `    "userId": "${exampleUserId}",`,
      `    "content": "Mensagem do agente (via webhook externo)"`,
      `  }`,
      ``,
      `Opcional: "conversationId" para forçar em qual conversa a mensagem entra.`,
    ].join('\n');
  }, [backend, configDraft.inboundWebhookToken, user?.id]);

  const chatDisabledReason = useMemo(() => {
    if (!backend) return 'BACKEND não configurado';
    if (!token) return 'Usuário não autenticado';
    if (isMonitoringOtherUser) return 'Modo monitoramento (somente leitura)';
    return '';
  }, [backend, token, isMonitoringOtherUser]);

  return (
    <div className="space-y-6">
      <Dialog open={faqProcessingOpen} onOpenChange={(open) => (faqProcessingRequestDone && faqProcessingRemainingSeconds <= 0 ? setFaqProcessingOpen(open) : null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{faqProcessingLabel || 'Processando'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-muted-foreground">
                {faqProcessingLines} linhas × 3s = {faqProcessingTotalSeconds}s
              </span>
            </div>
            <Progress
              value={
                faqProcessingTotalSeconds > 0
                  ? ((faqProcessingTotalSeconds - faqProcessingRemainingSeconds) / faqProcessingTotalSeconds) * 100
                  : faqProcessingRequestDone
                    ? 100
                    : 0
              }
            />
            <p className="text-sm">
              Tempo restante: <span className="tabular-nums font-semibold">{faqProcessingRemainingSeconds}s</span>
            </p>
            <p className="text-xs text-muted-foreground">
              {faqProcessingRequestDone ? 'Webhook concluído. Aguardando finalização do processamento.' : 'Enviando conteúdo completo para o webhook.'}
            </p>
          </div>
        </DialogContent>
      </Dialog>

      <div>
        <h1 className="text-[1.625rem] leading-tight font-semibold tracking-tight">Agente Comercial</h1>
        <p className="text-muted-foreground text-sm mt-1">FAQ + Chat + Webhooks</p>
      </div>

      {!backend && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="p-5">
            <p className="font-medium text-destructive">BACKEND não configurado</p>
            <p className="text-sm text-muted-foreground mt-1">Defina import.meta.env.BACKEND no frontend para ativar webhooks e histórico do chat.</p>
          </CardContent>
        </Card>
      )}

      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList>
          {isAdmin && <TabsTrigger value="config">Configuração</TabsTrigger>}
          <TabsTrigger value="conversas">Conversas</TabsTrigger>
        </TabsList>

        {isAdmin && (
          <TabsContent value="config" className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Webhooks</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>Webhook de saída (FAQ)</Label>
                    <Input
                      value={configDraft.faqWebhookUrl || ''}
                      onChange={(e) => setConfigDraft((v) => ({ ...v, faqWebhookUrl: e.target.value }))}
                      placeholder="https://..."
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Webhook de saída (Chat)</Label>
                    <Input
                      value={configDraft.chatWebhookUrl || ''}
                      onChange={(e) => setConfigDraft((v) => ({ ...v, chatWebhookUrl: e.target.value }))}
                      placeholder="https://..."
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Webhook de entrada (Token)</Label>
                    <div className="flex gap-2">
                      <Input
                        value={configDraft.inboundWebhookToken || ''}
                        onChange={(e) => setConfigDraft((v) => ({ ...v, inboundWebhookToken: e.target.value }))}
                        placeholder="token"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => handleCopy(configDraft.inboundWebhookToken || '')}
                        disabled={!configDraft.inboundWebhookToken}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                      <Button type="button" variant="outline" size="icon" onClick={handleRotateToken} disabled={isSavingConfig || !backend}>
                        <RefreshCcw className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button onClick={handleSaveConfig} disabled={isSavingConfig || !backend}>
                      Salvar
                    </Button>
                    <Button variant="outline" onClick={handlePushFaqToWebhook} disabled={!backend || !configDraft.faqWebhookUrl}>
                      Enviar FAQ
                    </Button>
                  </div>

                  {config && <p className="text-xs text-muted-foreground">Atualizado. Entrada (token) ativo.</p>}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Webhook de entrada (mini documentação)</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <pre className="text-xs whitespace-pre-wrap rounded-md border border-border bg-muted/20 p-3">{inboundDoc}</pre>
                  <Button variant="outline" onClick={() => handleCopy(inboundDoc)} disabled={!inboundDoc}>
                    <Copy className="h-4 w-4 mr-2" />
                    Copiar exemplo
                  </Button>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-4">
                <CardTitle className="text-base">FAQ</CardTitle>
                <Dialog open={faqModalOpen} onOpenChange={setFaqModalOpen}>
                  <DialogTrigger asChild>
                    <Button variant="outline" disabled={!backend || isFaqLoading}>
                      <Upload className="h-4 w-4 mr-2" />
                      Importar planilha
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-5xl">
                    <DialogHeader>
                      <DialogTitle>Importar FAQ (colunas A = Pergunta, B = Resposta)</DialogTitle>
                    </DialogHeader>

                    <div className="flex items-center gap-2">
                      <Input
                        type="file"
                        accept=".xlsx,.csv"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) handleFaqFile(f);
                        }}
                        disabled={!backend || isFaqLoading}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setFaqUploadPreview((prev) => [{ question: '', answer: '' }, ...prev])}
                        disabled={isFaqSaving}
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        Linha
                      </Button>
                    </div>

                    <div className="max-h-[55vh] overflow-auto rounded-md border border-border">
                      <Table>
                        <TableHeader className="sticky top-0 bg-background">
                          <TableRow>
                            <TableHead className="w-[50%]">Pergunta (A)</TableHead>
                            <TableHead className="w-[50%]">Resposta (B)</TableHead>
                            <TableHead className="w-[80px]" />
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {faqUploadPreview.length === 0 && (
                            <TableRow>
                              <TableCell colSpan={3} className="text-sm text-muted-foreground">
                                Envie um arquivo .xlsx (Excel) ou .csv. A primeira linha será ignorada.
                              </TableCell>
                            </TableRow>
                          )}
                          {faqUploadPreview.map((row, idx) => (
                            <TableRow key={idx}>
                              <TableCell className="align-top">
                                <Input
                                  value={row.question}
                                  onChange={(e) =>
                                    setFaqUploadPreview((prev) => prev.map((r, i) => (i === idx ? { ...r, question: e.target.value } : r)))
                                  }
                                />
                              </TableCell>
                              <TableCell className="align-top">
                                <Input
                                  value={row.answer}
                                  onChange={(e) =>
                                    setFaqUploadPreview((prev) => prev.map((r, i) => (i === idx ? { ...r, answer: e.target.value } : r)))
                                  }
                                />
                              </TableCell>
                              <TableCell className="align-top">
                                <Button type="button" variant="ghost" onClick={() => setFaqUploadPreview((prev) => prev.filter((_, i) => i !== idx))}>
                                  Remover
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>

                    <DialogFooter className="gap-2">
                      <Button variant="outline" onClick={() => setFaqModalOpen(false)} disabled={isFaqSaving}>
                        Cancelar
                      </Button>
                      <Button onClick={handleSaveFaqFromModal} disabled={isFaqSaving || faqUploadPreview.length === 0}>
                        Salvar FAQ
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </CardHeader>
              <CardContent>
                <div className="rounded-md border border-border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Pergunta</TableHead>
                        <TableHead>Resposta</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {faqItems.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={2} className="text-sm text-muted-foreground">
                            Nenhum item no FAQ
                          </TableCell>
                        </TableRow>
                      )}
                      {faqItems.slice(0, 20).map((i) => (
                        <TableRow key={String(i.id)}>
                          <TableCell className="font-medium">{i.question}</TableCell>
                          <TableCell>{i.answer}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {faqItems.length > 20 && <p className="text-xs text-muted-foreground mt-2">Mostrando 20 de {faqItems.length} itens</p>}
              </CardContent>
            </Card>
          </TabsContent>
        )}

        <TabsContent value="conversas">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="lg:col-span-1">
              <CardHeader className="flex flex-row items-center justify-between gap-2">
                <div className="space-y-1">
                  <CardTitle className="text-base">Conversas</CardTitle>
                  {isAdmin && (
                    <Select value={monitorUserId} onValueChange={setMonitorUserId}>
                      <SelectTrigger className="h-8 w-[240px]">
                        <SelectValue placeholder="Selecionar vendedor" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="me">Minhas conversas</SelectItem>
                        {monitorUsers.map((u) => (
                          <SelectItem key={u.id} value={u.id}>
                            {u.nome || u.id}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
                <Button variant="outline" size="sm" onClick={handleNewConversation} disabled={!!chatDisabledReason || isCreatingConversation}>
                  <Plus className="h-4 w-4 mr-2" />
                  Nova
                </Button>
              </CardHeader>
              <CardContent className="space-y-2">
                {chatDisabledReason && <p className="text-sm text-muted-foreground">{chatDisabledReason}</p>}
                {!chatDisabledReason && conversations.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma conversa ainda</p>}
                {!chatDisabledReason &&
                  conversations.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className={cn(
                        'w-full text-left rounded-md border border-border p-3 hover:bg-muted/20 transition-colors',
                        activeConversationId === c.id ? 'bg-muted/30' : 'bg-background',
                      )}
                      onClick={() => setActiveConversationId(c.id)}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-medium">Conversa #{c.number}</p>
                        <p className="text-xs text-muted-foreground">
                          {c.lastMessage ? formatTimestampBR(c.lastMessage.createdAt) : formatTimestampBR(c.createdAt)}
                        </p>
                      </div>
                      {c.lastMessage && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                          {c.lastMessage.sender === 'user' ? (isMonitoringOtherUser ? 'Vendedor: ' : 'Você: ') : 'Agente: '}
                          {c.lastMessage.content}
                        </p>
                      )}
                    </button>
                  ))}
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-base">{activeConversation ? `Chat · Conversa #${activeConversation.number}` : 'Chat'}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="h-[420px] overflow-auto rounded-md border border-border p-3 bg-muted/10">
                  {isChatLoading && <p className="text-sm text-muted-foreground">Carregando...</p>}
                  {!isChatLoading && activeConversationId && messages.length === 0 && <p className="text-sm text-muted-foreground">Sem mensagens</p>}
                  {!isChatLoading &&
                    messages.map((m) => {
                      const mine = m.sender === 'user';
                      return (
                        <div key={m.id} className={cn('flex mb-2', mine ? 'justify-end' : 'justify-start')}>
                          <div
                            className={cn(
                              'max-w-[85%] rounded-lg px-3 py-2 text-sm border',
                              mine ? 'bg-primary text-primary-foreground border-primary/30' : 'bg-background border-border',
                            )}
                          >
                            <p className="whitespace-pre-wrap">{m.content}</p>
                            <p className={cn('mt-1 text-[10px]', mine ? 'text-primary-foreground/80' : 'text-muted-foreground')}>
                              {formatTimestampBR(m.createdAt)}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  <div ref={messagesEndRef} />
                </div>

                <div className="space-y-2">
                  <Textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder={
                      isMonitoringOtherUser
                        ? 'Monitorando conversas (somente leitura)'
                        : activeConversationId
                          ? 'Digite sua mensagem...'
                          : 'Clique em “Nova” para iniciar ou escreva e envie'
                    }
                    disabled={!!chatDisabledReason || sending}
                  />
                  <div className="flex justify-end gap-2">
                    <Button onClick={handleSend} disabled={!!chatDisabledReason || sending || (!draft.trim() && !!activeConversationId)}>
                      Enviar
                    </Button>
                  </div>
                </div>

                {isAdmin && (
                  <p className="text-xs text-muted-foreground">
                    Saída (chat): envia via webhook o userId, userName, conversationId e conversationNumber em cada mensagem do usuário.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

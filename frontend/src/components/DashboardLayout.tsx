import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Navigate } from 'react-router-dom';
import { NavLink } from '@/components/NavLink';
import { useLocation } from 'react-router-dom';
import {
  BarChart3,
  ChevronLeft,
  LogOut,
  Menu,
  MessageSquare,
  X,
  Settings,
  Shield,
  TrendingUp,
  Users,
  Package,
} from 'lucide-react';
import { LifeBuoy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { UserRole } from '@/types/dashboard';
import { getAuthToken, getBackendBaseUrl, getUsers, saveUsers } from '@/lib/storage';
import { hasPermission } from '@/lib/permissions';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { io, Socket } from 'socket.io-client';
import { toast } from 'sonner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface NavItem {
  title: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
  roles: UserRole[];
  permission?: { area: 'traffic' | 'commercial' | 'users' | 'adminMetrics' | 'products'; action?: 'read' | 'write' | 'create' | 'deactivate' | 'update' | 'delete' };
}

const navItems: NavItem[] = [
  { title: 'Visão Geral', url: '/dashboard', icon: BarChart3, roles: ['admin'], permission: { area: 'adminMetrics', action: 'read' } },
  { title: 'Tráfego', url: '/dashboard/trafego', icon: TrendingUp, roles: ['admin', 'gestor'], permission: { area: 'traffic', action: 'read' } },
  { title: 'Comercial', url: '/dashboard/comercial', icon: Users, roles: ['admin', 'vendedor'], permission: { area: 'commercial', action: 'read' } },
  { title: 'Produtos', url: '/dashboard/produtos', icon: Package, roles: ['vendedor', 'gestor'], permission: { area: 'products', action: 'read' } },
  //{ title: 'Agente Comercial', url: '/dashboard/agente-comercial', icon: MessageSquare, roles: ['admin'] },
  { title: 'Resgate', url: '/dashboard/resgate', icon: LifeBuoy, roles: ['admin', 'closer', 'vendedor'] },
  { title: 'Abandono', url: '/dashboard/abandono', icon: Shield, roles: ['admin'] },
  { title: 'Usuários', url: '/dashboard/usuarios', icon: Settings, roles: ['admin'], permission: { area: 'users', action: 'read' } },
];

function SidebarNav({
  isCollapsed,
  isMobileOpen,
  onToggleMobile,
  onCloseMobile,
  onToggleCollapsed,
}: {
  isCollapsed: boolean;
  isMobileOpen: boolean;
  onToggleMobile: () => void;
  onCloseMobile: () => void;
  onToggleCollapsed: () => void;
}) {
  const { user, logout, refreshUser, patchUser } = useAuth();
  const location = useLocation();
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileTab, setProfileTab] = useState<'avatar' | 'senha'>('avatar');
  const [senhaAtual, setSenhaAtual] = useState('');
  const [novaSenha, setNovaSenha] = useState('');
  const [confirmNovaSenha, setConfirmNovaSenha] = useState('');
  const [savingAvatar, setSavingAvatar] = useState(false);
  const [savingSenha, setSavingSenha] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const backend = getBackendBaseUrl();
  const token = getAuthToken();

  const filtered = useMemo(
    () => navItems.filter((item) => {
      if (!user) return false;
      if (user.role === 'admin') return true;
      if (item.roles.includes(user.role)) return true;
      return item.permission ? hasPermission(user, item.permission.area, item.permission.action || 'read') : false;
    }),
    [user],
  );
  const currentFullPath = useMemo(() => location.pathname + location.search, [location.pathname, location.search]);
  const activeQueryItemUrl = useMemo(() => {
    const hit = filtered.find((i) => i.url.includes('?') && i.url === currentFullPath);
    return hit?.url || null;
  }, [currentFullPath, filtered]);
  const resolvedAvatar = useMemo(() => {
    const raw = String(user?.avatar || '').trim();
    if (!raw) return '';
    if (raw.startsWith('http')) return raw;
    if (raw.startsWith('/') && backend) return `${backend}${raw}`;
    return raw;
  }, [backend, user?.avatar]);

  const openAvatar = () => {
    setProfileTab('avatar');
    setProfileOpen(true);
  };

  const openPassword = () => {
    setProfileTab('senha');
    setProfileOpen(true);
  };

  const uploadAvatar = async (file: File) => {
    if (!file) return;
    setSavingAvatar(true);
    try {
      if (backend && token) {
        const fd = new FormData();
        fd.append('file', file);
        const res = await fetch(`${backend}/api/auth/me/avatar`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
          },
          body: fd,
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(String(data?.error || 'Falha ao atualizar avatar'));
        await refreshUser();
        toast.success('Avatar atualizado');
        return;
      }

      const toDataUrl = (f: File) =>
        new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ''));
          reader.onerror = () => reject(new Error('Falha ao ler arquivo'));
          reader.readAsDataURL(f);
        });

      const dataUrl = await toDataUrl(file);
      const all = getUsers();
      if (user) {
        const nextUsers = all.map((u) => (u.id === user.id ? { ...u, avatar: dataUrl } : u));
        saveUsers(nextUsers);
        patchUser({ avatar: dataUrl });
      }
      toast.success('Avatar atualizado');
    } catch (e: any) {
      toast.error(String(e?.message || 'Falha ao atualizar avatar'));
    } finally {
      setSavingAvatar(false);
    }
  };

  const changePassword = async () => {
    const atual = String(senhaAtual || '');
    const nova = String(novaSenha || '');
    const conf = String(confirmNovaSenha || '');
    if (!atual || !nova) {
      toast.error('Preencha a senha atual e a nova senha');
      return;
    }
    if (nova !== conf) {
      toast.error('A confirmação não confere');
      return;
    }

    setSavingSenha(true);
    try {
      if (backend && token) {
        const res = await fetch(`${backend}/api/auth/me/password`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ senhaAtual: atual, novaSenha: nova }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(String(data?.error || 'Falha ao atualizar senha'));
        setSenhaAtual('');
        setNovaSenha('');
        setConfirmNovaSenha('');
        setProfileOpen(false);
        toast.success('Senha atualizada');
        return;
      }

      const all = getUsers();
      if (user) {
        const current = all.find((u) => u.id === user.id);
        if (!current || String(current.senha || '') !== atual) throw new Error('Senha atual incorreta');
        const nextUsers = all.map((u) => (u.id === user.id ? { ...u, senha: nova } : u));
        saveUsers(nextUsers);
        patchUser({ senha: nova });
      }
      setSenhaAtual('');
      setNovaSenha('');
      setConfirmNovaSenha('');
      setProfileOpen(false);
      toast.success('Senha atualizada');
    } catch (e: any) {
      toast.error(String(e?.message || 'Falha ao atualizar senha'));
    } finally {
      setSavingSenha(false);
    }
  };

  const NavLinkItem = ({ item }: { item: NavItem }) => {
    const isActive = item.url.includes('?')
      ? currentFullPath === item.url
      : !activeQueryItemUrl && (location.pathname === item.url || location.pathname.startsWith(item.url + '/'));
    const Icon = item.icon;
    return (
      <NavLink
        to={item.url}
        end={item.url === '/dashboard'}
        onClick={onCloseMobile}
        className={cn(
          'relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-[background-color,color] duration-150 group',
          isActive
            ? 'bg-sidebar-accent text-foreground before:absolute before:left-0 before:top-2 before:bottom-2 before:w-[3px] before:rounded-full before:bg-primary'
            : 'text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-foreground',
          isCollapsed && 'justify-center px-3',
        )}
      >
        <Icon className={cn('w-[18px] h-[18px] flex-shrink-0', isActive ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground')} />
        {!isCollapsed && <span className={cn('truncate flex-1', isActive ? 'font-semibold' : 'font-medium')}>{item.title}</span>}
      </NavLink>
    );
  };

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="fixed top-4 left-4 z-[70] lg:hidden"
        onClick={onToggleMobile}
        aria-label="Toggle menu"
      >
        {isMobileOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
      </Button>

      {isMobileOpen && (
        <div
          className="fixed inset-0 bg-foreground/20 backdrop-blur-sm z-[60] lg:hidden"
          onClick={onCloseMobile}
        />
      )}

      <aside
        className={cn(
          'fixed left-0 top-0 h-screen bg-sidebar border-r border-sidebar-border z-[60] transition-[width,transform] duration-300 ease-out flex flex-col',
          isCollapsed ? 'w-20' : 'w-64',
          isMobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        )}
      >
        <div
          className={cn(
            'border-b border-sidebar-border flex items-center justify-center transition-all duration-300',
            isCollapsed ? 'p-4' : 'p-6',
          )}
        >
          <div className="flex items-center justify-center w-full">
            <img
              src="/logo.png"
              alt="Lab_Sistemas"
              className={cn('object-contain transition-all duration-300', isCollapsed ? 'w-10 h-10' : 'w-20 h-auto')}
            />
          </div>
        </div>

        {user && (
          <div
            className={cn(
              'px-6 py-6 flex flex-col items-center justify-center border-b border-sidebar-border/50 gap-3',
              isCollapsed && 'px-2',
            )}
          >
            <Avatar
              className={cn('ring-2 ring-primary/70 ring-offset-2 ring-offset-sidebar cursor-pointer', isCollapsed ? 'w-10 h-10' : 'w-20 h-20')}
              onClick={openAvatar}
            >
              <AvatarImage src={resolvedAvatar} alt={user.nome} />
              <AvatarFallback className="text-xl font-bold bg-secondary text-secondary-foreground">
                {(user.nome?.charAt(0) || '').toUpperCase()}
              </AvatarFallback>
            </Avatar>
            {!isCollapsed && (
              <div className="text-center">
                <p className="font-semibold text-foreground truncate max-w-[180px]">{user.nome}</p>
                <p className="text-xs text-muted-foreground truncate max-w-[180px]">{user.email}</p>
              </div>
            )}
          </div>
        )}

        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {filtered.map(item => (
            <NavLinkItem key={item.url} item={item} />
          ))}
        </nav>

        <div className="p-4 border-t border-border mt-auto">
          {user && (
            <div className={cn('flex items-center gap-3', isCollapsed ? 'flex-col justify-center' : 'w-full')}>
              <Avatar className="w-10 h-10 border border-border shrink-0 cursor-pointer" onClick={openAvatar}>
                <AvatarImage src={resolvedAvatar} alt={user.nome} />
                <AvatarFallback>
                  <span className="text-foreground font-medium">{(user.nome?.charAt(0) || '').toUpperCase()}</span>
                </AvatarFallback>
              </Avatar>

              {!isCollapsed && (
                <>
                  <div className="flex-1 min-w-0 cursor-pointer" onClick={openPassword}>
                    <p className="text-sm font-medium text-foreground truncate">{user.nome}</p>
                    <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={logout}
                    className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0"
                    title="Sair"
                  >
                    <LogOut className="w-5 h-5" />
                  </Button>
                </>
              )}

              {isCollapsed && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={logout}
                  className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                  title="Sair"
                >
                  <LogOut className="w-5 h-5" />
                </Button>
              )}
            </div>
          )}
        </div>

        <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Meu Perfil</DialogTitle>
            </DialogHeader>
            <Tabs value={profileTab} onValueChange={(v) => setProfileTab(v as 'avatar' | 'senha')}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="avatar">Avatar</TabsTrigger>
                <TabsTrigger value="senha">Senha</TabsTrigger>
              </TabsList>
              <TabsContent value="avatar" className="mt-4 space-y-4">
                <div className="flex items-center gap-4">
                  <Avatar className="w-16 h-16 border border-border">
                    <AvatarImage src={resolvedAvatar} alt={user?.nome || 'Avatar'} />
                    <AvatarFallback>{(user?.nome?.charAt(0) || '').toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (file) uploadAvatar(file);
                      }}
                    />
                    <Button type="button" onClick={() => fileInputRef.current?.click()} disabled={savingAvatar}>
                      {savingAvatar ? 'Enviando...' : 'Trocar avatar'}
                    </Button>
                  </div>
                </div>
              </TabsContent>
              <TabsContent value="senha" className="mt-4 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="senhaAtual">Senha atual</Label>
                  <Input id="senhaAtual" type="password" value={senhaAtual} onChange={(e) => setSenhaAtual(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="novaSenha">Nova senha</Label>
                  <Input id="novaSenha" type="password" value={novaSenha} onChange={(e) => setNovaSenha(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirmNovaSenha">Confirmar nova senha</Label>
                  <Input
                    id="confirmNovaSenha"
                    type="password"
                    value={confirmNovaSenha}
                    onChange={(e) => setConfirmNovaSenha(e.target.value)}
                  />
                </div>
                <Button type="button" onClick={changePassword} disabled={savingSenha}>
                  {savingSenha ? 'Salvando...' : 'Atualizar senha'}
                </Button>
              </TabsContent>
            </Tabs>
          </DialogContent>
        </Dialog>

        <Button
          variant="ghost"
          size="icon"
          className="absolute -right-3 top-20 w-6 h-6 rounded-full bg-background border border-border shadow-sm hidden lg:flex"
          onClick={onToggleCollapsed}
          aria-label="Collapse sidebar"
        >
          <ChevronLeft className={cn('w-4 h-4 transition-transform', isCollapsed && 'rotate-180')} />
        </Button>
      </aside>
    </>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, isReady } = useAuth();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [activeConversationNumber, setActiveConversationNumber] = useState<number | null>(null);
  const [messages, setMessages] = useState<Array<{ id: string; sender: 'user' | 'agent' | 'system'; content: string; createdAt: string }>>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const activeConversationIdRef = useRef<string | null>(null);
  const [socketConnected, setSocketConnected] = useState(false);
  const backend = getBackendBaseUrl();
  const token = getAuthToken();
  const canUseBubble = user?.role === 'admin' || user?.role === 'vendedor';

  const apiFetch = useCallback(
    async (path: string, init?: RequestInit) => {
      if (!backend) throw new Error('BACKEND não configurado');
      if (!token) throw new Error('Usuário não autenticado');
      const res = await fetch(`${backend}${path}`, {
        ...init,
        headers: {
          ...(init?.headers || {}),
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(String(data?.error || res.statusText || 'Erro'));
      return data;
    },
    [backend, token],
  );

  const loadLatestConversation = useCallback(async () => {
    const data = await apiFetch('/api/agent/chat/conversations');
    const list = (data?.conversations || []) as Array<{ id: string; number: number }>;
    if (list.length > 0) {
      setActiveConversationId(list[0].id);
      setActiveConversationNumber(list[0].number);
      return { id: list[0].id, number: list[0].number };
    }
    return null;
  }, [apiFetch]);

  const loadMessages = useCallback(
    async (conversationId: string) => {
      const data = await apiFetch(`/api/agent/chat/conversations/${conversationId}/messages`);
      const conv = data?.conversation as { id: string; number: number } | undefined;
      const list = (data?.messages || []) as Array<{ id: string; sender: 'user' | 'agent' | 'system'; content: string; createdAt: string }>;
      setMessages(list);
      if (conv?.number !== undefined) setActiveConversationNumber(conv.number);
    },
    [apiFetch],
  );

  const ensureConversation = useCallback(async () => {
    if (activeConversationId) return { id: activeConversationId, number: activeConversationNumber };
    const latest = await loadLatestConversation();
    if (latest) return latest;
    const created = await apiFetch('/api/agent/chat/conversations', { method: 'POST' });
    const conv = created?.conversation as { id: string; number: number } | undefined;
    if (conv?.id) {
      setActiveConversationId(conv.id);
      setActiveConversationNumber(conv.number);
      return conv;
    }
    return null;
  }, [activeConversationId, activeConversationNumber, apiFetch, loadLatestConversation]);

  const handleSend = useCallback(async () => {
    const content = String(draft || '').trim();
    if (!content) return;
    setSending(true);
    try {
      const conv = await ensureConversation();
      if (!conv?.id) return;
      await apiFetch(`/api/agent/chat/conversations/${conv.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      setDraft('');
      await loadMessages(conv.id);
    } finally {
      setSending(false);
    }
  }, [apiFetch, draft, ensureConversation, loadMessages]);

  useEffect(() => {
    if (!chatOpen) return;
    if (!backend || !token) return;
    loadLatestConversation()
      .then((conv) => {
        if (conv?.id) return loadMessages(conv.id);
        return null;
      })
      .catch(() => null);
  }, [chatOpen, backend, token, loadLatestConversation, loadMessages]);

  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

  useEffect(() => {
    if (!chatOpen) return;
    if (!backend || !token || !user?.id) return;
    const s = io(backend, { auth: { token }, transports: ['websocket'] });
    socketRef.current = s;
    setSocketConnected(s.connected);

    const onConnect = () => setSocketConnected(true);
    const onDisconnect = () => setSocketConnected(false);
    const onMessage = (payload: any) => {
      const userId = String(payload?.userId || '');
      const conversationId = String(payload?.conversationId || '');
      const message = payload?.message as { id: string; sender: 'user' | 'agent' | 'system'; content: string; createdAt: string } | undefined;
      if (!message?.id) return;
      if (userId !== user.id) return;
      if (conversationId !== String(activeConversationIdRef.current || '')) return;
      setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]));
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
  }, [chatOpen, backend, token, user?.id, user?.role]);

  useEffect(() => {
    if (!chatOpen) return;
    if (!activeConversationId) return;
    if (socketConnected) return;
    const t = setInterval(() => loadMessages(activeConversationId).catch(() => null), 3000);
    return () => clearInterval(t);
  }, [chatOpen, activeConversationId, loadMessages, socketConnected]);

  useEffect(() => {
    if (!chatOpen) return;
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatOpen, messages.length]);

  if (!isReady) {
    return <div className="dark min-h-screen bg-background text-foreground" />;
  }

  if (!user) return <Navigate to="/login" replace />;

  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <SidebarNav
        isCollapsed={isCollapsed}
        isMobileOpen={isMobileOpen}
        onToggleMobile={() => setIsMobileOpen(v => !v)}
        onCloseMobile={() => setIsMobileOpen(false)}
        onToggleCollapsed={() => setIsCollapsed(v => !v)}
      />

      <main className={cn('min-h-screen transition-[padding] duration-300 ease-out', isCollapsed ? 'lg:pl-20' : 'lg:pl-64')}>
        <div className="mx-auto w-full max-w-[1480px] p-4 sm:p-6 lg:p-8 pt-16 lg:pt-8">
          {children}
        </div>
      </main>

      {canUseBubble && (
        <>
          <Button
            type="button"
            onClick={() => setChatOpen(true)}
            className="fixed bottom-6 right-6 z-[80] h-14 w-14 rounded-full shadow-lg"
            aria-label="Abrir chat IA"
          >
            <MessageSquare className="h-6 w-6" />
          </Button>

          <Dialog open={chatOpen} onOpenChange={setChatOpen}>
            <DialogContent className="max-w-lg">
              <DialogHeader className="flex flex-row items-center justify-between">
                <DialogTitle>Chat IA{activeConversationNumber ? ` · #${activeConversationNumber}` : ''}</DialogTitle>
                <Button type="button" variant="ghost" size="icon" onClick={() => setChatOpen(false)} aria-label="Fechar">
                  <X className="h-4 w-4" />
                </Button>
              </DialogHeader>

              <div className="h-[360px] overflow-auto rounded-md border border-border p-3 bg-muted/10">
                {messages.map((m) => {
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
                          {new Date(m.createdAt).toLocaleString('pt-BR')}
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
                  placeholder="Digite sua mensagem..."
                  disabled={!backend || !token || sending}
                />
                <div className="flex justify-end gap-2">
                  <Button onClick={handleSend} disabled={!backend || !token || sending || !draft.trim()}>
                    Enviar
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}

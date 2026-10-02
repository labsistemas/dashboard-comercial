import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MetricCard } from '@/components/MetricCard';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/contexts/AuthContext';
import { getAuthToken, getBackendBaseUrl, getRescueEntries, getUsers, saveRescueEntries, getCommercialEntries, getProducts, saveProducts, getRescueCommissionConfig, saveRescueCommissionConfig } from '@/lib/storage';
import { Product, RescueCommissionConfig, RescueEntry, RescueSaleLine, User } from '@/types/dashboard';
import { Plus, LifeBuoy, AlertTriangle, Trash2, Pencil } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatDateBR } from '@/lib/utils';

export default function ResgatePage() {
  const { user } = useAuth();
  const createSoldLine = () => ({ id: crypto.randomUUID(), produtoId: '', quantidade: '1' });
  const [entries, setEntries] = useState<RescueEntry[]>(getRescueEntries());
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ data: '', leadsResgatados: '', vendedorOrigem: '' });
  const [soldLines, setSoldLines] = useState<Array<{ id: string; produtoId: string; quantidade: string }>>(() => [createSoldLine()]);
  const [products, setProducts] = useState<Product[]>(() => getProducts());
  const [commissionConfig, setCommissionConfig] = useState<RescueCommissionConfig>(() => getRescueCommissionConfig());
  const [commissionDraft, setCommissionDraft] = useState<RescueCommissionConfig>(() => getRescueCommissionConfig());
  const [savingCommission, setSavingCommission] = useState(false);
  const [exampleOriginId, setExampleOriginId] = useState('');
  const [exampleRescuerId, setExampleRescuerId] = useState('');
  const [exampleProductId, setExampleProductId] = useState('');
  const [exampleProductQty, setExampleProductQty] = useState('1');
  const [ruleDialogOpen, setRuleDialogOpen] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [ruleUserIds, setRuleUserIds] = useState<string[]>([]);
  const [ruleOriginPercent, setRuleOriginPercent] = useState(0);
  const [ruleCloserPercent, setRuleCloserPercent] = useState(0);

  const isAdmin = user?.role === 'admin';
  const [allUsers, setAllUsers] = useState<User[]>(() => getUsers());
  const [vendedores, setVendedores] = useState<User[]>(() => getUsers().filter(u => u.role === 'vendedor'));
  const vendedoresResgataveis = useMemo(() => {
    const base = vendedores.length > 0 ? vendedores : allUsers.filter(u => u.role !== 'admin' && u.role !== 'gestor');
    return base.filter(v => v.id !== user?.id).sort((a, b) => a.nome.localeCompare(b.nome));
  }, [allUsers, user?.id, vendedores]);
  const myEntries = isAdmin ? entries : entries.filter(e => e.closerId === user?.id);

  const backend = getBackendBaseUrl();
  const token = getAuthToken();
  const isBackendEnabled = Boolean(backend && token);
  const rescueApiBase = backend ? `${backend}/api/rescue/entries` : null;
  const productApiBase = backend ? `${backend}/api/products` : null;
  const rescueCommissionApiBase = backend ? `${backend}/api/rescue/entries/commission-config` : null;

  const activeProducts = useMemo(() => products.filter((p) => p.ativo !== false), [products]);
  const productNameById = useMemo(() => new Map(products.map((p) => [p.id, p.nome])), [products]);
  const productPriceById = useMemo(() => new Map(products.map((p) => [p.id, p.preco || 0])), [products]);
  const userNameById = useMemo(() => new Map(allUsers.map((u) => [u.id, u.nome])), [allUsers]);

  const normalizeSplit = (originPercent: number, closerPercent: number) => {
    const origin = Math.max(0, Math.min(100, Number(originPercent) || 0));
    const closer = Math.max(0, Math.min(100, Number(closerPercent) || 0));
    const sum = origin + closer;
    if (!Number.isFinite(sum) || sum <= 0) return { originPercent: 100, closerPercent: 0 };
    if (sum === 100) return { originPercent: origin, closerPercent: closer };
    const o = Math.max(0, Math.min(100, (origin / sum) * 100));
    return { originPercent: o, closerPercent: 100 - o };
  };

  const normalizeCommissionConfig = (raw: any): RescueCommissionConfig => {
    if (raw && typeof raw === 'object' && raw.default) {
      const rules = Array.isArray(raw.rules) ? raw.rules : [];
      const normalizedRules = rules
        .map((r: any) => ({
          id: String(r?.id ?? ''),
          userIds: Array.from(new Set((Array.isArray(r?.userIds) ? r.userIds : []).map((x: any) => String(x)).filter(Boolean))),
          ...normalizeSplit(r?.originPercent ?? 0, r?.closerPercent ?? 0),
        }))
        .filter((r: any) => r.id && Array.isArray(r.userIds) && r.userIds.length > 0);
      return { default: normalizeSplit(raw.default?.originPercent ?? 100, raw.default?.closerPercent ?? 0), rules: normalizedRules };
    }

    return { default: normalizeSplit(raw?.originPercent ?? 100, raw?.closerPercent ?? 0), rules: [] };
  };

  const findOverlappingUserIds = (rules: RescueCommissionConfig['rules']) => {
    const seen = new Set<string>();
    const overlaps = new Set<string>();
    for (const r of rules || []) {
      for (const userId of r.userIds || []) {
        if (seen.has(userId)) overlaps.add(userId);
        else seen.add(userId);
      }
    }
    return Array.from(overlaps);
  };

  const getSplitForOrigin = (cfg: RescueCommissionConfig, vendedorOrigemId: string) => {
    const id = String(vendedorOrigemId || '').trim();
    if (!id) return cfg.default;
    const match = (cfg.rules || []).find((r) => Array.isArray(r.userIds) && r.userIds.includes(id));
    return match ? normalizeSplit(match.originPercent, match.closerPercent) : cfg.default;
  };

  useEffect(() => {
    const localUsers = () => getUsers();
    const localUsersVendedores = () => localUsers().filter(u => u.role === 'vendedor');
    const fromCommercialEntries = () => {
      const entries = getCommercialEntries();
      const map = new Map<string, string>();
      for (const e of entries) {
        const id = String(e.vendedorId || '').trim();
        const nome = String(e.vendedorNome || '').trim();
        if (id) map.set(id, nome || id);
      }
      return Array.from(map.entries()).map(([id, nome]) => ({
        id,
        nome: nome || 'Vendedor',
        email: '',
        senha: '',
        role: 'vendedor' as const,
        comissaoPercent: 0,
      }));
    };

    if (!backend || !token) {
      const localAll = localUsers();
      const local = localUsersVendedores();
      const fall = fromCommercialEntries();
      const merged = [...localAll, ...local, ...fall].reduce((acc: Record<string, User>, u) => {
        if (!acc[u.id]) acc[u.id] = u;
        return acc;
      }, {});
      const arr = Object.values(merged).sort((a, b) => a.nome.localeCompare(b.nome));
      setAllUsers(arr);
      setVendedores(arr.filter(u => u.role === 'vendedor'));
      return;
    }
    let isCancelled = false;
    const loadUsers = async () => {
      try {
        const tryEndpoints: string[] = [
          `${backend}/api/users`,
          `${backend}/api/rescue/entries/eligible-sources`,
          `${backend}/api/rescue/eligible-sources`,
          `${backend}/api/users?role=vendedor`,
        ];
        let list: any[] | null = null;
        for (const url of tryEndpoints) {
          try {
            const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
            const data = await res.json().catch(() => null);
            if (res.ok) {
              if (Array.isArray(data?.users)) list = data.users;
              else if (Array.isArray(data?.eligible)) list = data.eligible;
              else if (Array.isArray(data)) list = data;
              if (list) break;
            }
          } catch {
          }
        }
        if (!list) throw new Error('Falha ao carregar usuários');
        const localById = new Map(localUsers().map((u) => [u.id, u]));
        const mapped: User[] = list.map((u: any) => ({
          id: String(u.id),
          nome: String(u.nome || u.name || ''),
          email: String(u.email || ''),
          senha: '',
          role:
            u.role === 'admin' || u.role === 'gestor' || u.role === 'closer' || u.role === 'vendedor'
              ? u.role
              : 'vendedor',
          comissaoPercent: (() => {
            const fromApi = typeof u.comissaoPercent === 'number' ? u.comissaoPercent : parseFloat(String(u.comissaoPercent || '0')) || 0;
            const local = localById.get(String(u.id));
            const fromLocal = typeof local?.comissaoPercent === 'number' ? local.comissaoPercent : 0;
            return fromApi !== 0 ? fromApi : fromLocal;
          })(),
        }));
        const sortedAll = mapped.sort((a, b) => a.nome.localeCompare(b.nome));
        const onlyVendedores = sortedAll.filter(u => u.role === 'vendedor');
        if (!isCancelled) {
          setAllUsers(sortedAll);
          setVendedores(onlyVendedores);
        }
        return;
      } catch {
        try {
          const periods = ['mes', 'tudo', 'semana'];
          let mappedLevels: User[] = [];
          for (const period of periods) {
            try {
              const res2 = await fetch(`${backend}/api/abandonment/levels?period=${encodeURIComponent(period)}`, {
                headers: { Authorization: `Bearer ${token}` },
              });
              const data2 = await res2.json().catch(() => null);
              if (!res2.ok) continue;
              const levels = Array.isArray(data2?.levels) ? data2.levels : [];
              const usersFromLevels: User[] = levels
                .map((l: any) => ({
                  id: String(l?.vendedorId || ''),
                  nome: String(l?.vendedorNome || 'Vendedor'),
                  email: '',
                  senha: '',
                  role: 'vendedor',
                  comissaoPercent: 0,
                }))
                .filter((u: User) => u.id);
              if (usersFromLevels.length > 0) {
                mappedLevels = usersFromLevels;
                break;
              }
            } catch {
            }
          }
          if (!isCancelled && mappedLevels.length > 0) {
            const uniq: Record<string, User> = {};
            for (const u of mappedLevels) uniq[u.id] = u;
            const arr = Object.values(uniq).sort((a, b) => a.nome.localeCompare(b.nome));
            setAllUsers(arr);
            setVendedores(arr);
            return;
          }
        } catch {
        }
        if (!isCancelled) {
          const localAll = localUsers();
          const local = localUsersVendedores();
          const fall = fromCommercialEntries();
          const merged = [...localAll, ...local, ...fall].reduce((acc: Record<string, User>, u) => {
            if (!acc[u.id]) acc[u.id] = u;
            return acc;
          }, {});
          const arr = Object.values(merged).sort((a, b) => a.nome.localeCompare(b.nome));
          setAllUsers(arr);
          setVendedores(arr.filter(u => u.role === 'vendedor'));
        }
      }
    };
    loadUsers();
    return () => {
      isCancelled = true;
    };
  }, [backend, token]);

  useEffect(() => {
    if (!isBackendEnabled || !productApiBase) return;
    let isCancelled = false;

    const load = async () => {
      try {
        const res = await fetch(productApiBase, { headers: { Authorization: `Bearer ${token}` } });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error || 'Falha ao carregar produtos');
        const list = Array.isArray(data?.products) ? data.products : [];
        const mapped: Product[] = list.map((p: any) => ({
          id: String(p.id),
          nome: String(p.nome || ''),
          capaUrl: p?.capaUrl ? String(p.capaUrl) : '',
          descricao: p?.descricao ? String(p.descricao) : '',
          preco: typeof p.preco === 'number' ? p.preco : parseFloat(String(p.preco || '0')) || 0,
          comissaoPercent:
            typeof p.comissaoPercent === 'number' ? p.comissaoPercent : parseFloat(String(p.comissaoPercent || '0')) || 0,
          maxDescontoPercent:
            typeof p.maxDescontoPercent === 'number' ? p.maxDescontoPercent : parseFloat(String(p.maxDescontoPercent || '0')) || 0,
          ativo: typeof p.ativo === 'boolean' ? p.ativo : true,
          criadoEm: String(p.criadoEm || p.createdAt || ''),
        }));
        if (!isCancelled) {
          setProducts(mapped);
          saveProducts(mapped);
        }
      } catch (err: any) {
        toast.error(String(err?.message || 'Falha ao carregar produtos'));
      }
    };

    load();
    return () => {
      isCancelled = true;
    };
  }, [isBackendEnabled, productApiBase, token]);

  useEffect(() => {
    if (!isAdmin) return;
    if (!isBackendEnabled || !rescueCommissionApiBase) {
      const cfg = getRescueCommissionConfig();
      setCommissionConfig(cfg);
      setCommissionDraft(cfg);
      return;
    }
    let isCancelled = false;
    const load = async () => {
      try {
        const res = await fetch(rescueCommissionApiBase, { headers: { Authorization: `Bearer ${token}` } });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error || 'Falha ao carregar configuração');
        const cfg = (data?.config || data) as any;
        const next = normalizeCommissionConfig(cfg);
        if (!isCancelled) {
          setCommissionConfig(next);
          setCommissionDraft(next);
          saveRescueCommissionConfig(next);
        }
      } catch (e: any) {
        toast.error(String(e?.message || 'Falha ao carregar configuração'));
      }
    };
    load();
    return () => {
      isCancelled = true;
    };
  }, [isAdmin, isBackendEnabled, rescueCommissionApiBase, token]);

  useEffect(() => {
    if (!isBackendEnabled) return;
    if (!rescueApiBase) return;
    let isCancelled = false;

    const load = async () => {
      try {
        const res = await fetch(rescueApiBase, { headers: { Authorization: `Bearer ${token}` } });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error || 'Falha ao carregar resgates');
        const list = Array.isArray(data?.entries) ? data.entries : [];
        const mapped: RescueEntry[] = list.map((e: any) => ({
          id: String(e.id),
          data: String(e.data || ''),
          closerId: String(e.closerId || ''),
          closerNome: e?.closerNome ? String(e.closerNome) : undefined,
          leadsResgatados: parseInt(String(e.leadsResgatados || '0')) || 0,
          leadsConvertidos: parseInt(String(e.leadsConvertidos || '0')) || 0,
          vendedorOrigem: String(e.vendedorOrigem || ''),
          vendedorOrigemNome: e?.vendedorOrigemNome ? String(e.vendedorOrigemNome) : undefined,
          produtosVendidos: Array.isArray(e?.produtosVendidos)
            ? (e.produtosVendidos as any[]).map((l) => ({
                produtoId: String(l?.produtoId || ''),
                quantidade: parseInt(String(l?.quantidade || '0')) || 0,
                precoUnitario: typeof l?.precoUnitario === 'number' ? l.precoUnitario : parseFloat(String(l?.precoUnitario || '0')) || 0,
              }))
            : [],
          valorVendas: typeof e?.valorVendas === 'number' ? e.valorVendas : parseFloat(String(e?.valorVendas || '0')) || 0,
          comissaoTotal: typeof e?.comissaoTotal === 'number' ? e.comissaoTotal : parseFloat(String(e?.comissaoTotal || '0')) || 0,
          comissaoOrigem: typeof e?.comissaoOrigem === 'number' ? e.comissaoOrigem : parseFloat(String(e?.comissaoOrigem || '0')) || 0,
          comissaoCloser: typeof e?.comissaoCloser === 'number' ? e.comissaoCloser : parseFloat(String(e?.comissaoCloser || '0')) || 0,
          criadoEm: String(e.criadoEm || ''),
        }));
        if (!isCancelled) {
          setEntries(mapped);
          saveRescueEntries(mapped);
        }
      } catch (err: any) {
        toast.error(String(err?.message || 'Falha ao carregar resgates'));
      }
    };

    load();
    return () => {
      isCancelled = true;
    };
  }, [isBackendEnabled, rescueApiBase, token]);

  // Penalidade removida conforme solicitação

  const handleSaveCommissionConfig = async () => {
    if (!isAdmin) return;
    const normalized = normalizeCommissionConfig(commissionDraft);
    const overlaps = findOverlappingUserIds(normalized.rules || []);
    if (overlaps.length > 0) {
      const names = overlaps.map((id) => userNameById.get(id) || id).join(', ');
      toast.error(`As regras não podem ser sobrepostas. Usuários em conflito: ${names}`);
      return;
    }

    if (!isBackendEnabled || !rescueCommissionApiBase) {
      setCommissionConfig(normalized);
      setCommissionDraft(normalized);
      saveRescueCommissionConfig(normalized);
      toast.success('Configuração salva');
      return;
    }

    setSavingCommission(true);
    try {
      const res = await fetch(rescueCommissionApiBase, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(normalized),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        if (res.status === 409) {
          const overlaps = Array.isArray(data?.overlaps) ? data.overlaps : [];
          const names = overlaps.map((id: string) => userNameById.get(String(id)) || String(id)).join(', ');
          throw new Error(names ? `As regras não podem ser sobrepostas. Usuários em conflito: ${names}` : 'As regras não podem ser sobrepostas');
        }
        throw new Error(data?.error || 'Falha ao salvar configuração');
      }
      const cfg = (data?.config || data) as any;
      const next = normalizeCommissionConfig(cfg);
      setCommissionConfig(next);
      setCommissionDraft(next);
      saveRescueCommissionConfig(next);
      toast.success('Configuração salva');
    } catch (e: any) {
      toast.error(String(e?.message || 'Falha ao salvar configuração'));
    } finally {
      setSavingCommission(false);
    }
  };

  const handleSave = async () => {
    const produtosVendidos: RescueSaleLine[] = soldLines
      .map((l) => ({ produtoId: String(l.produtoId || ''), quantidade: parseInt(String(l.quantidade || '0')) || 0 }))
      .filter((l) => l.produtoId && l.quantidade > 0);

    const payload = {
      data: form.data,
      vendedorOrigemId: form.vendedorOrigem,
      leadsResgatados: parseInt(form.leadsResgatados) || 0,
      produtosVendidos,
    };

    if (isBackendEnabled && rescueApiBase) {
      try {
        const res = await fetch(rescueApiBase, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error || 'Falha ao salvar resgate');
        const e = data?.entry || data?.rescue || null;
        const soldLinesArr: RescueSaleLine[] = Array.isArray(e?.produtosVendidos) ? e.produtosVendidos : produtosVendidos;
        const valorLocal = soldLinesArr.reduce((sum, l) => sum + (productPriceById.get(l.produtoId) || 0) * (l.quantidade || 0), 0);
        const originIdLocal = String(e?.vendedorOrigem || payload.vendedorOrigemId || '');
        const originUserLocal = allUsers.find((u) => u.id === originIdLocal) || null;
        const baseOriginPercent = originUserLocal && typeof originUserLocal.comissaoPercent === 'number' ? originUserLocal.comissaoPercent : 0;
        const comTotalLocal = valorLocal * (baseOriginPercent / 100);
        const splitLocal = getSplitForOrigin(commissionConfig, originIdLocal);
        const comOrigemLocal = comTotalLocal * (splitLocal.originPercent / 100);
        const comCloserLocal = comTotalLocal * (splitLocal.closerPercent / 100);
        const created: RescueEntry = {
          id: String(e?.id || crypto.randomUUID()),
          data: String(e?.data || payload.data || ''),
          closerId: String(e?.closerId || user?.id || ''),
          closerNome: e?.closerNome ? String(e.closerNome) : undefined,
          leadsResgatados: parseInt(String(e?.leadsResgatados || payload.leadsResgatados || 0)) || 0,
          leadsConvertidos: ((Array.isArray(e?.produtosVendidos) ? e.produtosVendidos : produtosVendidos) || []).reduce(
            (q: number, l: RescueSaleLine) => q + (l?.quantidade || 0),
            0
          ),
          vendedorOrigem: String(e?.vendedorOrigem || payload.vendedorOrigemId || ''),
          vendedorOrigemNome: e?.vendedorOrigemNome ? String(e.vendedorOrigemNome) : undefined,
          produtosVendidos: Array.isArray(e?.produtosVendidos) ? e.produtosVendidos : produtosVendidos,
          valorVendas: typeof e?.valorVendas === 'number' ? e.valorVendas : valorLocal,
          comissaoTotal: typeof e?.comissaoTotal === 'number' ? e.comissaoTotal : comTotalLocal,
          comissaoOrigem: typeof e?.comissaoOrigem === 'number' ? e.comissaoOrigem : comOrigemLocal,
          comissaoCloser: typeof e?.comissaoCloser === 'number' ? e.comissaoCloser : comCloserLocal,
          criadoEm: String(e?.criadoEm || new Date().toISOString()),
        };
        const updated = [created, ...entries];
        setEntries(updated);
        saveRescueEntries(updated);
        setShowForm(false);
        setForm({ data: '', leadsResgatados: '', vendedorOrigem: '' });
        setSoldLines([createSoldLine()]);
        toast.success('Resgate salvo');
      } catch (err: any) {
        toast.error(String(err?.message || 'Falha ao salvar resgate'));
      }
      return;
    }

    const entry: RescueEntry = {
      id: crypto.randomUUID(),
      data: form.data,
      closerId: user?.id || '',
      closerNome: user?.nome || '',
      leadsResgatados: payload.leadsResgatados,
      leadsConvertidos: produtosVendidos.reduce((q: number, l: RescueSaleLine) => q + (l?.quantidade || 0), 0),
      vendedorOrigem: form.vendedorOrigem,
      produtosVendidos,
      ...(function () {
        const valorVendas = produtosVendidos.reduce((sum, l) => sum + (productPriceById.get(l.produtoId) || 0) * (l.quantidade || 0), 0);
        const originPct = (allUsers.find((u) => u.id === form.vendedorOrigem)?.comissaoPercent || 0) as number;
        const comissaoTotal = valorVendas * (originPct / 100);
        const split = getSplitForOrigin(commissionConfig, form.vendedorOrigem);
        const comissaoOrigem = comissaoTotal * (split.originPercent / 100);
        const comissaoCloser = comissaoTotal * (split.closerPercent / 100);
        return { valorVendas, comissaoTotal, comissaoOrigem, comissaoCloser };
      })(),
      criadoEm: new Date().toISOString(),
    };
    const updated = [...entries, entry];
    setEntries(updated);
    saveRescueEntries(updated);
    setShowForm(false);
    setForm({ data: '', leadsResgatados: '',  vendedorOrigem: '' });
    setSoldLines([createSoldLine()]);
    toast.success('Resgate salvo');
  };

  // Stats
  const totalResgatados = myEntries.reduce((s, e) => s + e.leadsResgatados, 0);
  const totalConvertidos = myEntries.reduce(
    (s, e) =>
      s +
      ((e.produtosVendidos || []).reduce((q: number, l: RescueSaleLine) => q + (l?.quantidade || 0), 0) || e.leadsConvertidos || 0),
    0
  );
  const taxaConversao = totalResgatados > 0 ? (totalConvertidos / totalResgatados * 100) : 0;

  // Penalidade removida conforme solicitação

  const vendedorStats = useMemo(() => {
    return vendedores
      .map((v) => ({
        ...v,
        resgatados: entries.filter((e) => e.vendedorOrigem === v.id).reduce((s, e) => s + e.leadsResgatados, 0),
      }))
      .sort((a, b) => b.resgatados - a.resgatados);
  }, [entries, vendedores]);

  const commissionOverlaps = findOverlappingUserIds(commissionDraft.rules || []);

  const startCreateRule = () => {
    setEditingRuleId(null);
    setRuleUserIds([]);
    setRuleOriginPercent(commissionDraft.default.originPercent);
    setRuleCloserPercent(commissionDraft.default.closerPercent);
    setRuleDialogOpen(true);
  };

  const startEditRule = (ruleId: string) => {
    const r = (commissionDraft.rules || []).find((x) => x.id === ruleId) || null;
    if (!r) return;
    setEditingRuleId(ruleId);
    setRuleUserIds(Array.isArray(r.userIds) ? r.userIds.slice() : []);
    setRuleOriginPercent(r.originPercent);
    setRuleCloserPercent(r.closerPercent);
    setRuleDialogOpen(true);
  };

  const saveRuleToDraft = () => {
    const selected = Array.from(new Set(ruleUserIds.map((x) => String(x)).filter(Boolean)));
    if (selected.length === 0) {
      toast.error('Selecione pelo menos 1 vendedor');
      return;
    }

    const otherRules = (commissionDraft.rules || []).filter((r) => r.id !== editingRuleId);
    const usedByOthers = new Set(otherRules.flatMap((r) => r.userIds || []));
    const conflicts = selected.filter((id) => usedByOthers.has(id));
    if (conflicts.length > 0) {
      const names = conflicts.map((id) => userNameById.get(id) || id).join(', ');
      toast.error(`As regras não podem ser sobrepostas. Usuários em conflito: ${names}`);
      return;
    }

    const split = normalizeSplit(ruleOriginPercent, ruleCloserPercent);
    const nextRule = {
      id: editingRuleId || crypto.randomUUID(),
      userIds: selected,
      originPercent: split.originPercent,
      closerPercent: split.closerPercent,
    };

    setCommissionDraft((prev) => {
      const base = normalizeCommissionConfig(prev);
      const rules = (base.rules || []).filter((r) => r.id !== nextRule.id);
      return { ...base, rules: [nextRule, ...rules] };
    });
    setRuleDialogOpen(false);
  };

  const removeRuleFromDraft = (ruleId: string) => {
    setCommissionDraft((prev) => {
      const base = normalizeCommissionConfig(prev);
      return { ...base, rules: (base.rules || []).filter((r) => r.id !== ruleId) };
    });
  };

  const commissionContent = (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Comissão do Resgate</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs defaultValue="todos" className="space-y-4">
            <TabsList>
              <TabsTrigger value="todos">Para todos</TabsTrigger>
              <TabsTrigger value="individual">Individual</TabsTrigger>
            </TabsList>
            <TabsContent value="todos">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <Label>% da comissão para vendedor de origem</Label>
                  <Input
                    type="number"
                    value={commissionDraft.default.originPercent}
                    onChange={(e) =>
                      setCommissionDraft((prev) => ({
                        ...prev,
                        default: { ...prev.default, originPercent: parseFloat(e.target.value || '0') || 0 },
                      }))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>% da comissão para quem resgatou</Label>
                  <Input
                    type="number"
                    value={commissionDraft.default.closerPercent}
                    onChange={(e) =>
                      setCommissionDraft((prev) => ({
                        ...prev,
                        default: { ...prev.default, closerPercent: parseFloat(e.target.value || '0') || 0 },
                      }))
                    }
                  />
                </div>
                <div className="flex items-end justify-end">
                  <Button onClick={handleSaveCommissionConfig} disabled={savingCommission}>
                    Salvar
                  </Button>
                </div>
              </div>
              <div className="text-xs text-muted-foreground">
                Esses percentuais são sobre a comissão total do resgate (não sobre o valor do produto). Se não somar 100%, o sistema ajusta proporcionalmente ao salvar.
              </div>
              <div className="text-sm text-muted-foreground">
                Distribuição padrão atual: {commissionConfig.default.originPercent.toFixed(1)}% origem •{' '}
                {commissionConfig.default.closerPercent.toFixed(1)}% resgate
              </div>
            </TabsContent>
            <TabsContent value="individual" className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm text-muted-foreground">
                  Regras individuais: {(commissionDraft.rules || []).length}
                </div>
                <Button variant="outline" size="sm" onClick={startCreateRule}>
                  <Plus className="mr-2 h-4 w-4" /> Nova regra
                </Button>
              </div>
              {commissionOverlaps.length > 0 && (
                <div className="text-sm text-destructive">
                  As regras não podem ser sobrepostas. Usuários em conflito: {commissionOverlaps.map((id) => userNameById.get(id) || id).join(', ')}
                </div>
              )}
              {(commissionDraft.rules || []).length === 0 ? (
                <div className="text-sm text-muted-foreground">Nenhuma regra individual cadastrada.</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Vendedores</TableHead>
                      <TableHead className="text-right">Origem</TableHead>
                      <TableHead className="text-right">Resgate</TableHead>
                      <TableHead className="text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(commissionDraft.rules || []).map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="text-sm">
                          {(r.userIds || []).map((id) => userNameById.get(id) || id).join(', ')}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{r.originPercent.toFixed(1)}%</TableCell>
                        <TableCell className="text-right tabular-nums">{r.closerPercent.toFixed(1)}%</TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button variant="outline" size="icon" onClick={() => startEditRule(r.id)} aria-label="Editar regra">
                              <Pencil className="h-4 w-4 text-muted-foreground" />
                            </Button>
                            <Button variant="outline" size="icon" onClick={() => removeRuleFromDraft(r.id)} aria-label="Remover regra">
                              <Trash2 className="h-4 w-4 text-muted-foreground" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              <div className="flex justify-end">
                <Button onClick={handleSaveCommissionConfig} disabled={savingCommission || commissionOverlaps.length > 0}>
                  Salvar
                </Button>
              </div>
              <div className="text-xs text-muted-foreground">
                Regra individual sempre sobrescreve a distribuição padrão para os vendedores selecionados.
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Simulação</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label>Vendedor de origem</Label>
            <Select value={exampleOriginId} onValueChange={setExampleOriginId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {allUsers
                  .slice()
                  .sort((a, b) => a.nome.localeCompare(b.nome))
                  .map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.nome}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            {(() => {
              const selected = allUsers.find((u) => u.id === exampleOriginId);
              if (!selected) return null;
              const pct = typeof selected.comissaoPercent === 'number' ? selected.comissaoPercent : 0;
              return <p className="text-xs text-muted-foreground">Comissão do vendedor de origem: {pct.toFixed(1)}%</p>;
            })()}
          </div>
          <div className="space-y-1.5">
            <Label>Quem resgatou</Label>
            <Select value={exampleRescuerId} onValueChange={setExampleRescuerId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {allUsers
                  .slice()
                  .sort((a, b) => a.nome.localeCompare(b.nome))
                  .map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.nome}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Produto</Label>
            <Select value={exampleProductId} onValueChange={setExampleProductId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {activeProducts
                  .slice()
                  .sort((a, b) => a.nome.localeCompare(b.nome))
                  .map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.nome}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Quantidade</Label>
            <Input type="number" min={1} value={exampleProductQty} onChange={(e) => setExampleProductQty(e.target.value)} />
          </div>
          <div className="md:col-span-3 text-sm">
            {(() => {
              const origin = allUsers.find((u) => u.id === exampleOriginId) || null;
              const rescuer = allUsers.find((u) => u.id === exampleRescuerId) || null;
              const qty = Math.max(1, parseInt(String(exampleProductQty || '1')) || 1);
              const valor = exampleProductId ? (productPriceById.get(exampleProductId) || 0) * qty : 0;
              const originPct = origin && typeof origin.comissaoPercent === 'number' ? origin.comissaoPercent : 0;
              const comissaoTotal = valor * (originPct / 100);
              const split = getSplitForOrigin(commissionDraft, exampleOriginId);
              const origemValor = comissaoTotal * (split.originPercent / 100);
              const resgateValor = comissaoTotal * (split.closerPercent / 100);
              if (!origin || !rescuer || !exampleProductId) {
                return <p className="text-muted-foreground">Selecione os dois vendedores e o produto para ver a simulação.</p>;
              }
              const pctOrigemFinal = originPct * (split.originPercent / 100);
              const pctResgateFinal = originPct * (split.closerPercent / 100);
              return (
                <div className="space-y-1">
                  <p className="text-muted-foreground">
                    Valor de vendas (produto): R$ {valor.toLocaleString('pt-BR')} ({qty}×)
                  </p>
                  <p className="text-muted-foreground">
                    Comissão base (da origem) = R$ {valor.toLocaleString('pt-BR')} × {originPct.toFixed(1)}% = R$ {comissaoTotal.toLocaleString('pt-BR')}
                  </p>
                  <p>
                    {origin.nome} (origem) recebe {split.originPercent.toFixed(1)}% da comissão → {pctOrigemFinal.toFixed(1)}% do valor → R$ {origemValor.toLocaleString('pt-BR')}
                  </p>
                  <p>
                    {rescuer.nome} (resgate) recebe {split.closerPercent.toFixed(1)}% da comissão → {pctResgateFinal.toFixed(1)}% do valor → R$ {resgateValor.toLocaleString('pt-BR')}
                  </p>
                </div>
              );
            })()}
          </div>
        </CardContent>
      </Card>

      <Dialog
        open={ruleDialogOpen}
        onOpenChange={(open) => {
          setRuleDialogOpen(open);
          if (!open) setEditingRuleId(null);
        }}
      >
        <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>{editingRuleId ? 'Editar regra individual' : 'Nova regra individual'}</DialogTitle>
            <DialogDescription>Selecione vendedores de origem e defina a divisão da comissão para eles.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Vendedores de origem</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {vendedores
                  .slice()
                  .sort((a, b) => a.nome.localeCompare(b.nome))
                  .map((v) => {
                    const checked = ruleUserIds.includes(v.id);
                    return (
                      <label key={v.id} className="flex items-center gap-2 rounded-md border border-border/60 px-3 py-2">
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(next) => {
                            const isChecked = next === true;
                            setRuleUserIds((prev) => (isChecked ? Array.from(new Set([...prev, v.id])) : prev.filter((id) => id !== v.id)));
                          }}
                        />
                        <span className="text-sm">{v.nome}</span>
                      </label>
                    );
                  })}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>% da comissão para origem</Label>
                <Input type="number" value={ruleOriginPercent} onChange={(e) => setRuleOriginPercent(parseFloat(e.target.value || '0') || 0)} />
              </div>
              <div className="space-y-1.5">
                <Label>% da comissão para resgate</Label>
                <Input type="number" value={ruleCloserPercent} onChange={(e) => setRuleCloserPercent(parseFloat(e.target.value || '0') || 0)} />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setRuleDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={saveRuleToDraft}>Salvar regra</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );

  const overviewContent = (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <MetricCard label="Resgatados" icon={LifeBuoy} tone="info" value={totalResgatados} />
        <MetricCard label="Convertidos" icon={LifeBuoy} tone="success" value={totalConvertidos} />
        <MetricCard featured label="Conversão Resgate" icon={LifeBuoy} value={`${taxaConversao.toFixed(1)}%`} />
      </div>

      {isAdmin && vendedorStats.length > 0 && vendedorStats[0].resgatados > 0 && (
        <Card className="border-warning/30 bg-warning/5">
          <CardContent className="p-4 flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-warning shrink-0" />
            <div>
              <p className="font-medium text-warning">Vendedor com mais leads resgatados: {vendedorStats[0].nome}</p>
              <p className="text-sm text-muted-foreground">{vendedorStats[0].resgatados} leads resgatados — indica possível falha no atendimento.</p>
            </div>
          </CardContent>
        </Card>
      )}

      {myEntries.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Histórico</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Vendedor Origem</TableHead>
                  {isAdmin && <TableHead>Recuperado por</TableHead>}
                  <TableHead className="text-right">Resgatados</TableHead>
                  <TableHead className="text-right">Convertidos</TableHead>
                  {isAdmin && <TableHead className="text-right">Vendas</TableHead>}
                  {isAdmin && <TableHead className="text-right">Com. Origem</TableHead>}
                  {isAdmin && <TableHead className="text-right">Com. Resgate</TableHead>}
                  <TableHead>Produtos</TableHead>
                  <TableHead className="text-right">Conversão</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {myEntries.sort((a, b) => b.data.localeCompare(a.data)).map(e => {
                  const v = vendedores.find(v => v.id === e.vendedorOrigem);
                  const closerLabel =
                    String(e.closerNome || '').trim() ||
                    allUsers.find((u) => u.id === e.closerId)?.nome ||
                    e.closerId ||
                    '—';
                  const convertedQtd =
                    (e.produtosVendidos || []).reduce((q: number, l: RescueSaleLine) => q + (l?.quantidade || 0), 0) || e.leadsConvertidos || 0;
                  const conv = e.leadsResgatados > 0 ? (convertedQtd / e.leadsResgatados * 100).toFixed(1) : '0.0';
                  const produtos = (e.produtosVendidos || [])
                    .filter((l) => l && l.produtoId && l.quantidade > 0)
                    .map((l) => `${productNameById.get(l.produtoId) || l.produtoId} x${l.quantidade}`)
                    .join(', ');
                  return (
                    <TableRow key={e.id}>
                      <TableCell>{formatDateBR(e.data)}</TableCell>
                      <TableCell>{v?.nome || '—'}</TableCell>
                      {isAdmin && <TableCell>{closerLabel}</TableCell>}
                      <TableCell className="text-right tabular-nums">{e.leadsResgatados}</TableCell>
                      <TableCell className="text-right tabular-nums">{convertedQtd}</TableCell>
                      {isAdmin && (
                        <TableCell className="text-right tabular-nums">
                          R$ {(e.valorVendas || 0).toLocaleString('pt-BR')}
                        </TableCell>
                      )}
                      {isAdmin && (
                        <TableCell className="text-right tabular-nums">
                          R$ {(e.comissaoOrigem || 0).toLocaleString('pt-BR')}
                        </TableCell>
                      )}
                      {isAdmin && (
                        <TableCell className="text-right tabular-nums">
                          R$ {(e.comissaoCloser || 0).toLocaleString('pt-BR')}
                        </TableCell>
                      )}
                      <TableCell className="text-sm">{produtos || '—'}</TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">{conv}%</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[1.625rem] leading-tight font-semibold tracking-tight">Módulo Resgate</h1>
          <p className="text-muted-foreground text-sm mt-1">Recuperação de leads não atendidos</p>
        </div>
        {!isAdmin && (
          <Button onClick={() => setShowForm(!showForm)} className="active:scale-[0.97]">
            <Plus className="mr-2 h-4 w-4" /> Novo Registro
          </Button>
        )}
      </div>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent>
          <DialogHeader><DialogTitle>Novo Registro de Resgate</DialogTitle></DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Data</Label>
              <Input type="date" value={form.data} onChange={e => setForm({ ...form, data: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Vendedor de origem</Label>
              <Select value={form.vendedorOrigem} onValueChange={v => setForm({ ...form, vendedorOrigem: v })}>
                <SelectTrigger><SelectValue placeholder="Selecione um vendedor" /></SelectTrigger>
                <SelectContent>
                  {vendedoresResgataveis.length === 0 && (
                    <SelectItem disabled value="__none">Nenhum vendedor disponível</SelectItem>
                  )}
                  {vendedoresResgataveis.map(v => (
                    <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {(() => {
                const selected = allUsers.find((u) => u.id === form.vendedorOrigem);
                if (!selected) return null;
                const pct = typeof selected.comissaoPercent === 'number' ? selected.comissaoPercent : 0;
                return <p className="text-xs text-muted-foreground">Comissão do vendedor de origem: {pct.toFixed(1)}%</p>;
              })()}
            </div>
            <div className="space-y-1.5">
              <Label>Leads resgatados</Label>
              <Input type="number" value={form.leadsResgatados} onChange={e => setForm({ ...form, leadsResgatados: e.target.value })} />
            </div>
            <div className="col-span-full space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label>Produtos vendidos</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setSoldLines((prev) => [...prev, createSoldLine()])}
                  disabled={activeProducts.length === 0}
                >
                  <Plus className="mr-2 h-4 w-4" /> Adicionar
                </Button>
              </div>
              {activeProducts.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum produto ativo cadastrado.</p>
              ) : (
                <div className="space-y-2">
                  {soldLines.map((l) => (
                    <div key={l.id} className="grid grid-cols-12 gap-2 items-center">
                      <div className="col-span-7">
                        <Select
                          value={l.produtoId}
                          onValueChange={(v) => setSoldLines((prev) => prev.map((x) => (x.id === l.id ? { ...x, produtoId: v } : x)))}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Selecione o produto" />
                          </SelectTrigger>
                          <SelectContent>
                            {activeProducts
                              .slice()
                              .sort((a, b) => a.nome.localeCompare(b.nome))
                              .map((p) => (
                                <SelectItem key={p.id} value={p.id}>
                                  {p.nome}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="col-span-3">
                        <Input
                          type="number"
                          min={0}
                          value={l.quantidade}
                          onChange={(e) => setSoldLines((prev) => prev.map((x) => (x.id === l.id ? { ...x, quantidade: e.target.value } : x)))}
                          placeholder="Qtd"
                        />
                      </div>
                      <div className="col-span-2 flex justify-end">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          onClick={() =>
                            setSoldLines((prev) =>
                              prev.length === 1 ? [{ ...prev[0], produtoId: '', quantidade: '1' }] : prev.filter((x) => x.id !== l.id)
                            )
                          }
                          aria-label="Remover produto"
                        >
                          <Trash2 className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="col-span-full flex gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => {
                  setShowForm(false);
                  setForm({ data: '', leadsResgatados: '',  vendedorOrigem: '' });
                  setSoldLines([createSoldLine()]);
                }}
              >
                Cancelar
              </Button>
              <Button onClick={handleSave} disabled={!form.data || !form.vendedorOrigem}>Salvar</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {isAdmin ? (
        <Tabs defaultValue="visao" className="space-y-6">
          <TabsList>
            <TabsTrigger value="visao">Visão</TabsTrigger>
            <TabsTrigger value="comissao">Comissão</TabsTrigger>
          </TabsList>
          <TabsContent value="visao" className="space-y-6">
            {overviewContent}
          </TabsContent>
          <TabsContent value="comissao" className="space-y-6">
            {commissionContent}
          </TabsContent>
        </Tabs>
      ) : (
        overviewContent
      )}
    </div>
  );
}

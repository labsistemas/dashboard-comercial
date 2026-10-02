import { useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MetricCard } from '@/components/MetricCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/AuthContext';
import {
  getAuthToken,
  getBackendBaseUrl,
  getCommercialEntries,
  getProducts,
  getTrafficEntries,
  saveCommercialEntries,
  saveProducts,
  saveTrafficEntries,
  getTrafficThresholds,
  saveTrafficThresholds,
} from '@/lib/storage';
import { formatDateBR } from '@/lib/utils';
import { hasPermission } from '@/lib/permissions';
import { CommercialEntry, Product, TrafficEntry } from '@/types/dashboard';
import { Plus, TrendingUp, Target, Zap, AlertTriangle, Trash2, Pencil } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';

type ProductRankingRow = {
  produto: string;
  leads: number;
  vendas: number;
  conversaoPercent: number;
  topVendedores: { vendedorId: string; vendedorNome: string; vendas: number }[];
};

function addDaysISO(startISO: string, days: number) {
  const s = String(startISO || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(`${s}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function normalizeProductKey(value: string) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
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

const TRAFFIC_CAMPAIGN_PREFIX = '__campanha__:';

function isCampaignStoredProduto(value: string) {
  return String(value || '').startsWith(TRAFFIC_CAMPAIGN_PREFIX);
}

function getCampaignNameFromStoredProduto(value: string) {
  const raw = String(value || '').trim();
  if (!isCampaignStoredProduto(raw)) return raw;
  return raw.slice(TRAFFIC_CAMPAIGN_PREFIX.length).trim();
}

function toStoredProdutoName(mode: 'produto' | 'campanha', value: string) {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  return mode === 'campanha' ? `${TRAFFIC_CAMPAIGN_PREFIX}${normalized}` : normalized;
}

function getTrafficDisplayName(value: string) {
  const raw = String(value || '').trim();
  if (!raw) return '—';
  if (!isCampaignStoredProduto(raw)) return raw;
  const campaign = getCampaignNameFromStoredProduto(raw);
  return campaign ? `Campanha - ${campaign}` : 'Campanha';
}

function computeRoas(investimento: number, receita: number) {
  if (investimento > 0) return receita / investimento;
  if (receita > 0) return receita / 100;
  return 0;
}

function computeCommercialEntryNetRevenue(entry: CommercialEntry) {
  const lines = Array.isArray(entry.vendasPorProduto) ? entry.vendasPorProduto : [];
  const grossRevenue = lines.reduce((sum, line) => {
    const qty = typeof line.quantidade === 'number' ? line.quantidade : parseInt(String(line.quantidade || '0'), 10) || 0;
    const unit =
      typeof line.precoUnitario === 'number' ? line.precoUnitario : parseFloat(String(line.precoUnitario || '0')) || 0;
    if (qty <= 0 || unit <= 0) return sum;
    return sum + qty * unit;
  }, 0);

  if (typeof entry.valorLiquido === 'number' && Number.isFinite(entry.valorLiquido)) {
    return { grossRevenue, netRevenue: Math.max(entry.valorLiquido, 0) };
  }

  const descontoValor =
    typeof entry.descontoValor === 'number' && Number.isFinite(entry.descontoValor)
      ? Math.max(entry.descontoValor, 0)
      : typeof entry.descontoPercent === 'number' && Number.isFinite(entry.descontoPercent)
        ? Math.max(grossRevenue * (entry.descontoPercent / 100), 0)
        : 0;

  return { grossRevenue, netRevenue: Math.max(grossRevenue - descontoValor, 0) };
}

function computeTrafficSalesFromCommercial(args: {
  trafficProduto: string;
  startISO: string;
  endISO: string;
  commercialEntries: CommercialEntry[];
  productNameById: Map<string, string>;
}) {
  const trafficProduto = String(args.trafficProduto || '').trim();
  const startISO = String(args.startISO || '').slice(0, 10);
  const endISO = String(args.endISO || '').slice(0, 10);
  if (!trafficProduto) return { vendas: 0, receita: 0 };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startISO) || !/^\d{4}-\d{2}-\d{2}$/.test(endISO)) {
    return { vendas: 0, receita: 0 };
  }

  const isCampaign = isCampaignStoredProduto(trafficProduto);
  const targetKey = normalizeProductKey(isCampaign ? getCampaignNameFromStoredProduto(trafficProduto) : trafficProduto);
  let vendas = 0;
  let receita = 0;

  for (const entry of args.commercialEntries) {
    const dataISO = String(entry.data || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dataISO)) continue;
    if (dataISO < startISO || dataISO > endISO) continue;

    const lines = Array.isArray(entry.vendasPorProduto) ? entry.vendasPorProduto : [];
    const { grossRevenue, netRevenue } = computeCommercialEntryNetRevenue(entry);

    if (isCampaign) {
      if (entry.campaignScope !== 'campanha') continue;
      if (normalizeProductKey(String(entry.campaignName || '')) !== targetKey) continue;

      const totalQty = lines.reduce((sum, line) => {
        const qty = typeof line.quantidade === 'number' ? line.quantidade : parseInt(String(line.quantidade || '0'), 10) || 0;
        return qty > 0 ? sum + qty : sum;
      }, 0);

      vendas += totalQty > 0 ? totalQty : Math.max(typeof entry.vendas === 'number' ? entry.vendas : 0, 0);
      receita += netRevenue;
      continue;
    }

    for (const line of lines) {
      const nome = String(args.productNameById.get(String(line.produtoId || '')) || '').trim();
      if (!nome) continue;
      if (normalizeProductKey(nome) !== targetKey) continue;
      const qty = typeof line.quantidade === 'number' ? line.quantidade : parseInt(String(line.quantidade || '0'), 10) || 0;
      const unit =
        typeof line.precoUnitario === 'number' ? line.precoUnitario : parseFloat(String(line.precoUnitario || '0')) || 0;
      if (qty <= 0 || unit <= 0) continue;
      const grossLine = qty * unit;
      vendas += qty;
      receita += grossRevenue > 0 ? netRevenue * (grossLine / grossRevenue) : 0;
    }
  }

  return { vendas, receita };
}

export default function TrafegoPage() {
  const { user } = useAuth();
  const todayISO = new Date().toISOString().slice(0, 10);
  const backend = getBackendBaseUrl();
  const token = getAuthToken();
  const isBackendEnabled = Boolean(backend && token);
  const [entries, setEntries] = useState<TrafficEntry[]>(getTrafficEntries());
  const [products, setProducts] = useState<Product[]>(getProducts());
  const [commercialEntries, setCommercialEntries] = useState<CommercialEntry[]>(getCommercialEntries());
  const [trafficLoadError, setTrafficLoadError] = useState<string | null>(null);
  const [commercialLoadError, setCommercialLoadError] = useState<string | null>(null);
  const [productRanking, setProductRanking] = useState<ProductRankingRow[]>([]);
  const [rankingLoading, setRankingLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const commercialQuotaBlockedUntilRef = useRef<number>(0);
  const trafficQuotaBlockedUntilRef = useRef<number>(0);
  const roleToken = normalizeRoleToken(user?.role);
  const isAdmin = roleToken === 'admin';
  const isGestor = roleToken === 'gestor' || roleToken.includes('gestor');
  const canManageTraffic = isAdmin || isGestor || (Boolean(user) && hasPermission(user, 'traffic', 'write'));
  const [trafficThresholds, setTrafficThresholds] = useState(() => getTrafficThresholds());
  const [filterMode, setFilterMode] = useState<'daily' | 'weekly' | 'monthly' | 'custom'>('monthly');
  const [filterStart, setFilterStart] = useState(() => new Date().toISOString().slice(0, 10));
  const [filterEnd, setFilterEnd] = useState(() => new Date().toISOString().slice(0, 10));
  const [filterProduto, setFilterProduto] = useState<string>('__todos__');
  const [roasChartProduto, setRoasChartProduto] = useState<string>('__geral__');
  const [form, setForm] = useState({
    produto: '',
    semana: '',
    fim: '',
    investimento: '',
    leads: '',
    cpl: '',
  });
  const [launchMode, setLaunchMode] = useState<'produto' | 'campanha'>('produto');
  const [campaignName, setCampaignName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);


  const handleSave = async () => {
    const investimento = Math.max(0, parseFloat(String(form.investimento || '').replace(',', '.')) || 0);
    const leads = Math.max(0, parseInt(String(form.leads || ''), 10) || 0);
    const cpl = leads > 0 ? investimento / leads : 0;
    const semanaISO = String(form.semana || '').slice(0, 10);
    const fimISO = String(form.fim || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(semanaISO)) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fimISO)) return;
    if (fimISO < semanaISO) return;

    const produtoBase = String(launchMode === 'campanha' ? campaignName : form.produto || '').trim();
    const produto = toStoredProdutoName(launchMode, produtoBase);
    if (!produto) return;
    const derived = computeTrafficSalesFromCommercial({
      trafficProduto: produto,
      startISO: semanaISO,
      endISO: fimISO,
      commercialEntries,
      productNameById: new Map(products.map((p) => [String(p.id), String(p.nome || '')])),
    });

    if (isBackendEnabled && backend && !editingId) {
      try {
        const res = await fetch(`${backend}/api/traffic/entries`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            produto,
            semana: semanaISO,
            periodoTipo: 'weekly',
            investimento,
            leads,
          }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(String(data?.error || 'Falha ao salvar'));
        const created = data?.entry ?? data;
        const createdSemana = String(created?.semana || semanaISO).slice(0, 10);
        const entry: TrafficEntry = {
          id: String(created?.id || crypto.randomUUID()),
          produto: String(created?.produto || produto),
          semana: createdSemana,
          fim: fimISO || addDaysISO(createdSemana, 6),
          periodoTipo: 'weekly',
          investimento: typeof created?.investimento === 'number' ? created.investimento : investimento,
          leads: typeof created?.leads === 'number' ? created.leads : leads,
          cpl: typeof created?.cpl === 'number' ? created.cpl : cpl,
          vendas: typeof created?.vendas === 'number' ? created.vendas : derived.vendas,
          receita: typeof created?.receita === 'number' ? created.receita : derived.receita,
          roas:
            typeof created?.roas === 'number'
              ? created.roas
              : computeRoas(investimento, typeof created?.receita === 'number' ? created.receita : derived.receita),
          criadoPor: String(created?.criadoPor || user?.id || ''),
          criadoPorNome: String(created?.criadoPorNome || user?.nome || ''),
          criadoEm: String(created?.criadoEm || new Date().toISOString()),
        };
        const updated = [entry, ...entries];
        setEntries(updated);
        saveTrafficEntries(updated);
        setShowForm(false);
        setForm({ produto: '', semana: '', fim: '', investimento: '', leads: '', cpl: '' });
        return;
      } catch (e: any) {
        toast.error(String(e?.message || 'Falha ao salvar tráfego'));
        return;
      }
    }
    if (isBackendEnabled && backend && editingId) {
      try {
        const res = await fetch(`${backend}/api/traffic/entries/${editingId}`, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            produto,
            semana: semanaISO,
            periodoTipo: 'weekly',
            investimento,
            leads,
          }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(String(data?.error || 'Falha ao atualizar'));
        const updated = data?.entry ?? data;
        const semanaFinal = String(updated?.semana || semanaISO).slice(0, 10);
        const e: TrafficEntry = {
          id: String(updated?.id || editingId),
          produto: String(updated?.produto || produto),
          semana: semanaFinal,
          fim: fimISO || addDaysISO(semanaFinal, 6),
          periodoTipo: 'weekly',
          investimento: typeof updated?.investimento === 'number' ? updated.investimento : investimento,
          leads: typeof updated?.leads === 'number' ? updated.leads : leads,
          cpl: typeof updated?.cpl === 'number' ? updated.cpl : investimento > 0 && leads > 0 ? investimento / leads : 0,
          vendas: typeof updated?.vendas === 'number' ? updated.vendas : derived.vendas,
          receita: typeof updated?.receita === 'number' ? updated.receita : derived.receita,
          roas:
            typeof updated?.roas === 'number'
              ? updated.roas
              : computeRoas(investimento, typeof updated?.receita === 'number' ? updated.receita : derived.receita),
          criadoPor: String(updated?.criadoPor || user?.id || ''),
          criadoPorNome: String(updated?.criadoPorNome || user?.nome || ''),
          criadoEm: String(updated?.criadoEm || new Date().toISOString()),
        };
        const next = entries.map((x) => (x.id === e.id ? e : x));
        setEntries(next);
        saveTrafficEntries(next);
        setEditingId(null);
        setShowForm(false);
        setForm({ produto: '', semana: '', fim: '', investimento: '', leads: '', cpl: '' });
        return;
      } catch (e: any) {
        toast.error(String(e?.message || 'Falha ao atualizar lançamento'));
        return;
      }
    }

    const entry: TrafficEntry = {
      id: crypto.randomUUID(),
      produto,
      semana: semanaISO,
      fim: fimISO || addDaysISO(semanaISO, 6),
      periodoTipo: 'weekly',
      investimento,
      leads,
      cpl,
      vendas: derived.vendas,
      receita: derived.receita,
      roas: computeRoas(investimento, derived.receita),
      criadoPor: user?.id || '',
      criadoPorNome: user?.nome || '',
      criadoEm: new Date().toISOString(),
    };
    if (editingId) {
      const next = entries.map((x) => (x.id === editingId ? { ...entry, id: editingId } : x));
      setEntries(next);
      saveTrafficEntries(next);
    } else {
      const updated = [entry, ...entries];
      setEntries(updated);
      saveTrafficEntries(updated);
    }
    setEditingId(null);
    setShowForm(false);
    setForm({ produto: '', semana: '', fim: '', investimento: '', leads: '', cpl: '' });
  };

  const handleDeleteTrafficEntry = async (id: string) => {
    if (!canManageTraffic) return;
    if (!confirm('Excluir este lançamento de tráfego?')) return;

    if (!isBackendEnabled || !backend) {
      const next = entries.filter((e) => e.id !== id);
      setEntries(next);
      saveTrafficEntries(next);
      toast.success('Lançamento removido');
      return;
    }

    try {
      const res = await fetch(`${backend}/api/traffic/entries/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 404) {
        const next = entries.filter((e) => e.id !== id);
        setEntries(next);
        saveTrafficEntries(next);
        toast.success('Lançamento removido (local)');
        return;
      }
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(String(data?.error || 'Falha ao remover lançamento'));
      const next = entries.filter((e) => e.id !== id);
      setEntries(next);
      saveTrafficEntries(next);
      toast.success('Lançamento removido');
    } catch (e: any) {
      toast.error(String(e?.message || 'Falha ao remover lançamento'));
    }
  };

  const activeProducts = useMemo(() => products.filter((p) => p.ativo !== false), [products]);

  useEffect(() => {
    let isCancelled = false;
    const loadProducts = async () => {
      if (!isBackendEnabled || !backend) {
        const local = getProducts();
        if (!isCancelled) setProducts(local);
        return;
      }
      try {
        const res = await fetch(`${backend}/api/products`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(String(data?.error || 'Falha ao carregar produtos'));
        const list = Array.isArray(data?.products) ? data.products : [];
        const mapped: Product[] = list.map((p: any) => ({
          id: String(p.id),
          nome: String(p.nome || ''),
          capaUrl: String(p.capaUrl || ''),
          descricao: String(p.descricao || ''),
          preco: typeof p.preco === 'number' ? p.preco : parseFloat(String(p.preco || '0')) || 0,
          maxDescontoPercent:
            typeof p.maxDescontoPercent === 'number' ? p.maxDescontoPercent : parseFloat(String(p.maxDescontoPercent || '0')) || 0,
          ativo: typeof p.ativo === 'boolean' ? p.ativo : true,
          criadoEm: String(p.criadoEm || ''),
        }));
        if (!isCancelled) {
          setProducts(mapped);
          saveProducts(mapped);
        }
      } catch {
        const local = getProducts();
        if (!isCancelled) setProducts(local);
      }
    };
    loadProducts();
    return () => {
      isCancelled = true;
    };
  }, [backend, isBackendEnabled, token]);

  useEffect(() => {
    let isCancelled = false;
    const loadCommercial = async () => {
      if (!isBackendEnabled || !backend) {
        const local = getCommercialEntries();
        if (!isCancelled) setCommercialEntries(local);
        return;
      }

      if (Date.now() < commercialQuotaBlockedUntilRef.current) {
        const local = getCommercialEntries();
        if (!isCancelled) {
          setCommercialLoadError(null);
          setCommercialEntries(local);
        }
        return;
      }

      if (!isCancelled) setCommercialLoadError(null);
      try {
        const buildCommercialQuery = () => {
          const start = String(filterStart || '').slice(0, 10);
          let end = start;
          if (filterMode === 'weekly') {
            const d = new Date(`${start}T00:00:00`);
            d.setDate(d.getDate() + 6);
            end = d.toISOString().slice(0, 10);
          } else if (filterMode === 'monthly') {
            const monthStart = new Date(`${start.slice(0, 7)}-01T00:00:00`);
            const monthEnd = new Date(monthStart);
            monthEnd.setMonth(monthEnd.getMonth() + 1);
            monthEnd.setDate(monthEnd.getDate() - 1);
            end = monthEnd.toISOString().slice(0, 10);
          } else if (filterMode === 'custom') {
            end = String(filterEnd || '').slice(0, 10) || start;
          }
          const params = new URLSearchParams({ ts: String(Date.now()) });
          if (/^\d{4}-\d{2}-\d{2}$/.test(start)) params.set('start', start);
          if (/^\d{4}-\d{2}-\d{2}$/.test(end)) params.set('end', end);
          return params.toString();
        };

        const query = buildCommercialQuery();
        const res = await fetch(`${backend}/api/commercial/entries?${query}`, {
          headers: { Authorization: `Bearer ${token}`, 'Cache-Control': 'no-cache' },
          cache: 'no-store',
        });
        if (res.status === 304) {
          const local = getCommercialEntries();
          if (!isCancelled) setCommercialEntries(local);
          return;
        }
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(String(data?.error || 'Falha ao carregar registros'));
        let list = Array.isArray(data?.entries) ? data.entries : [];
        const mapped: CommercialEntry[] = list.map((e: any) => ({
          id: String(e.id),
          data: String(e.data || ''),
          vendedorId: String(e.vendedorId || ''),
          vendedorNome: String(e.vendedorNome || ''),
          campaignScope: e.campaignScope === 'campanha' ? 'campanha' : 'geral',
          campaignName: String(e.campaignName || ''),
          leadsAtendidos: parseInt(String(e.leadsAtendidos || '0')) || 0,
          agendamentos: parseInt(String(e.agendamentos || '0')) || 0,
          vendas: parseInt(String(e.vendas || '0')) || 0,
          followUps: parseInt(String(e.followUps || '0')) || 0,
          vendasPorProduto: Array.isArray(e.vendasPorProduto)
            ? e.vendasPorProduto.map((l: any) => ({
                produtoId: String(l.produtoId),
                quantidade: parseInt(String(l.quantidade || '0')) || 0,
                precoUnitario:
                  typeof l.precoUnitario === 'number' ? l.precoUnitario : parseFloat(String(l.precoUnitario || '0')) || 0,
              }))
            : undefined,
          alunoNome: String(e.alunoNome || ''),
          descontoPercent: typeof e.descontoPercent === 'number' ? e.descontoPercent : undefined,
          descontoValor: typeof e.descontoValor === 'number' ? e.descontoValor : undefined,
          valorBruto: typeof e.valorBruto === 'number' ? e.valorBruto : undefined,
          valorLiquido: typeof e.valorLiquido === 'number' ? e.valorLiquido : undefined,
          comissao: typeof e.comissao === 'number' ? e.comissao : undefined,
          criadoEm: String(e.criadoEm || ''),
          criadoPor: '',
          criadoPorNome: '',
        }));
        if (!isCancelled) {
          commercialQuotaBlockedUntilRef.current = 0;
          const merged = (() => {
            const local = getCommercialEntries();
            const byId = new Map<string, CommercialEntry>();
            for (const item of local) byId.set(String(item.id), item);
            for (const item of mapped) byId.set(String(item.id), item);
            return Array.from(byId.values());
          })();
          setCommercialEntries(merged);
          saveCommercialEntries(merged);
        }
      } catch (e: any) {
        const msg = String(e?.message || 'Falha ao carregar registros (comercial)');
        const normalized = msg.toLowerCase();
        const isQuotaError =
          normalized.includes('quota has been exceeded') ||
          normalized.includes('too many requests') ||
          normalized.includes('rate limit');

        if (isQuotaError) {
          // Avoid hammering backend when provider quota is exhausted.
          commercialQuotaBlockedUntilRef.current = Date.now() + 2 * 60 * 1000;
        }

        if (!isCancelled) setCommercialLoadError(isQuotaError ? null : msg);
        const local = getCommercialEntries();
        if (!isCancelled) setCommercialEntries(local);
      }
    };
    loadCommercial();
    return () => {
      isCancelled = true;
    };
  }, [backend, isBackendEnabled, token, filterMode, filterStart, filterEnd]);

  useEffect(() => {
    let isCancelled = false;
    const loadTraffic = async () => {
      if (!isBackendEnabled || !backend) {
        const local = getTrafficEntries();
        if (!isCancelled) setEntries(local);
        return;
      }

      if (Date.now() < trafficQuotaBlockedUntilRef.current) {
        const local = getTrafficEntries();
        if (!isCancelled) {
          setTrafficLoadError(null);
          setEntries(local);
        }
        return;
      }

      if (!isCancelled) setTrafficLoadError(null);
      try {
        const res = await fetch(`${backend}/api/traffic/entries?ts=${Date.now()}`, {
          headers: { Authorization: `Bearer ${token}`, 'Cache-Control': 'no-cache' },
          cache: 'no-store',
        });
        if (res.status === 304) {
          const local = getTrafficEntries();
          if (!isCancelled) {
            setEntries(local);
            saveTrafficEntries(local);
          }
          return;
        }
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(String(data?.error || 'Falha ao carregar tráfego'));
        let list = Array.isArray(data?.entries) ? data.entries : [];
        // Retry once with stronger no-cache headers if empty
        if (list.length === 0) {
          const res2 = await fetch(`${backend}/api/traffic/entries?ts=${Date.now()}&retry=1`, {
            headers: { Authorization: `Bearer ${token}`, 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
            cache: 'no-store',
          });
          const data2 = await res2.json().catch(() => null);
          if (res2.ok && Array.isArray(data2?.entries)) list = data2.entries;
        }
        const mapped: TrafficEntry[] = list.map((e: any) => {
          const semana = String(e.semana || '').slice(0, 10);
          const periodoTipo = String(e.periodoTipo || 'weekly') as any;
          const fim =
            periodoTipo === 'weekly'
              ? addDaysISO(semana, 6)
              : /^\d{4}-\d{2}-\d{2}$/.test(semana)
                ? (() => {
                    const monthStart = new Date(`${semana.slice(0, 7)}-01T00:00:00`);
                    const monthEnd = new Date(monthStart);
                    monthEnd.setMonth(monthEnd.getMonth() + 1);
                    monthEnd.setDate(monthEnd.getDate() - 1);
                    return monthEnd.toISOString().slice(0, 10);
                  })()
                : semana;

          return {
            id: String(e.id),
            produto: String(e.produto || ''),
            semana,
            fim,
            periodoTipo,
            investimento: typeof e.investimento === 'number' ? e.investimento : parseFloat(String(e.investimento || '0')) || 0,
            leads: typeof e.leads === 'number' ? e.leads : parseInt(String(e.leads || '0'), 10) || 0,
            cpl: typeof e.cpl === 'number' ? e.cpl : parseFloat(String(e.cpl || '0')) || 0,
            vendas: typeof e.vendas === 'number' ? e.vendas : parseInt(String(e.vendas || '0'), 10) || 0,
            receita: typeof e.receita === 'number' ? e.receita : parseFloat(String(e.receita || '0')) || 0,
            roas:
              typeof e.roas === 'number'
                ? e.roas
                : (() => {
                    const investimento = typeof e.investimento === 'number' ? e.investimento : parseFloat(String(e.investimento || '0')) || 0;
                    const receita = typeof e.receita === 'number' ? e.receita : parseFloat(String(e.receita || '0')) || 0;
                    return computeRoas(investimento, receita);
                  })(),
            criadoPor: String(e.criadoPor || ''),
            criadoPorNome: String(e.criadoPorNome || ''),
            criadoEm: String(e.criadoEm || ''),
          };
        });
        if (!isCancelled) {
          trafficQuotaBlockedUntilRef.current = 0;
          const merged = (() => {
            const local = getTrafficEntries();
            const byId = new Map<string, TrafficEntry>();
            for (const item of local) byId.set(String(item.id), item);
            for (const item of mapped) byId.set(String(item.id), item);
            return Array.from(byId.values());
          })();
          // Preserve local 'fim' when present
          const localById = new Map(getTrafficEntries().map((x) => [String(x.id), x]));
          const withEnd = merged.map((m) => {
            const local = localById.get(String(m.id));
            if (local && local.fim) return { ...m, fim: local.fim };
            return m;
          });
          setEntries(withEnd);
          saveTrafficEntries(withEnd);
        }
      } catch (e: any) {
        const msg = String(e?.message || 'Falha ao carregar tráfego');
        const normalized = msg.toLowerCase();
        const isQuotaError =
          normalized.includes('quota has been exceeded') ||
          normalized.includes('too many requests') ||
          normalized.includes('rate limit');

        if (isQuotaError) {
          trafficQuotaBlockedUntilRef.current = Date.now() + 2 * 60 * 1000;
        }

        if (!isCancelled) setTrafficLoadError(isQuotaError ? null : msg);
        const local = getTrafficEntries();
        if (!isCancelled) setEntries(local);
      }
    };
    loadTraffic();
    return () => {
      isCancelled = true;
    };
  }, [backend, isBackendEnabled, token]);

  const canSave =
    Boolean(String(launchMode === 'campanha' ? campaignName : form.produto || '').trim()) &&
    Boolean(String(form.semana || '').slice(0, 10)) &&
    Boolean(String(form.fim || '').slice(0, 10)) &&
    String(form.fim || '').slice(0, 10) >= String(form.semana || '').slice(0, 10) &&
    (parseFloat(String(form.investimento || '').replace(',', '.')) || 0) >= 0 &&
    (parseInt(String(form.leads || ''), 10) || 0) >= 0;

  const campaignOptions = useMemo(() => {
    const productKeys = new Set(
      activeProducts.map((p) => normalizeProductKey(String(p.nome || ''))),
    );
    const set = new Set<string>();
    for (const ce of commercialEntries) {
      if (ce.campaignScope === 'campanha') {
        const name = String(ce.campaignName || '').trim();
        if (name && !productKeys.has(normalizeProductKey(name))) set.add(name);
      }
    }
    for (const e of entries) {
      const raw = String(e.produto || '').trim();
      const name = getCampaignNameFromStoredProduto(raw);
      if (name && !productKeys.has(normalizeProductKey(name))) set.add(name);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [commercialEntries, entries, activeProducts]);

  const openNewEntry = () => {
    setForm({ produto: '', semana: '', fim: '', investimento: '', leads: '', cpl: '' });
    setLaunchMode('produto');
    setCampaignName('');
    setShowForm(true);
  };
  const startEditEntry = (e: TrafficEntry) => {
    const rawProduto = String(e.produto || '');
    const explicitCampaign = isCampaignStoredProduto(rawProduto);
    const produtoComparable = explicitCampaign ? getCampaignNameFromStoredProduto(rawProduto) : rawProduto;
    const isKnownProduct = activeProducts.some((p) => normalizeProductKey(String(p.nome || '')) === normalizeProductKey(produtoComparable));
    const mode: 'produto' | 'campanha' = explicitCampaign ? 'campanha' : isKnownProduct ? 'produto' : 'campanha';
    setLaunchMode(mode);
    setCampaignName(mode === 'campanha' ? getCampaignNameFromStoredProduto(rawProduto) : '');
    setEditingId(e.id);
    setForm({
      produto: mode === 'produto' ? produtoComparable : '',
      semana: String(e.semana || ''),
      fim: String(e.fim || ''),
      investimento: String(e.investimento ?? ''),
      leads: String(e.leads ?? ''),
      cpl: '',
    });
    setShowForm(true);
  };

  const computedEntries = useMemo(() => {
    const productNameById = new Map(products.map((p) => [p.id, p.nome]));
    return entries.map((e) => {
      const entryStart = String(e.semana || '').slice(0, 10);
      const entryEnd = String(e.fim || e.semana || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(entryStart) || !/^\d{4}-\d{2}-\d{2}$/.test(entryEnd)) return e;
      const derived = computeTrafficSalesFromCommercial({
        trafficProduto: String(e.produto || ''),
        startISO: entryStart,
        endISO: entryEnd,
        commercialEntries,
        productNameById,
      });
      const investimento = typeof e.investimento === 'number' ? e.investimento : 0;
      const vendasFinal = isBackendEnabled && typeof e.vendas === 'number' ? e.vendas : derived.vendas;
      const receitaFinal = isBackendEnabled && typeof e.receita === 'number' ? e.receita : derived.receita;
      const roas = computeRoas(investimento, receitaFinal);
      return { ...e, vendas: vendasFinal, receita: receitaFinal, roas };
    });
  }, [commercialEntries, entries, products, isBackendEnabled]);

  // All products available across all time (for the campaign selector)
  const allTrafficProdutos = useMemo(() => {
    const unique = new Set<string>();
    for (const e of computedEntries) {
      const nome = String(e.produto || '').trim();
      if (nome) unique.add(nome);
    }
    return Array.from(unique).sort((a, b) => a.localeCompare(b));
  }, [computedEntries]);

  // Chart data grouped by product
  const filteredEntries = useMemo(() => {
    const entryStart = (e: TrafficEntry) => new Date(`${e.semana}T00:00:00`);
    const entryEnd = (e: TrafficEntry) => new Date(`${String(e.fim || e.semana)}T00:00:00`);
    const overlaps = (e: TrafficEntry, start: Date, endInclusive: Date) => {
      const s = entryStart(e);
      const f = entryEnd(e);
      return s <= endInclusive && f >= start;
    };

    const produtoKey = filterProduto !== '__todos__' ? normalizeProductKey(filterProduto) : null;

    const start = new Date(`${filterStart}T00:00:00`);
    let byTime: typeof computedEntries;
    if (filterMode === 'daily') {
      byTime = computedEntries.filter((e) => overlaps(e, start, start));
    } else if (filterMode === 'weekly') {
      const endWeek = new Date(start);
      endWeek.setDate(endWeek.getDate() + 6);
      byTime = computedEntries.filter((e) => overlaps(e, start, endWeek));
    } else if (filterMode === 'monthly') {
      const monthStart = new Date(`${filterStart.slice(0, 7)}-01T00:00:00`);
      const monthEnd = new Date(monthStart);
      monthEnd.setMonth(monthEnd.getMonth() + 1);
      monthEnd.setDate(monthEnd.getDate() - 1);
      byTime = computedEntries.filter((e) => {
        const s = entryStart(e);
        return s >= monthStart && s <= monthEnd;
      });
    } else {
      const end = new Date(`${filterEnd}T00:00:00`);
      byTime = computedEntries.filter((e) => overlaps(e, start, end));
    }

    if (!produtoKey) return byTime;
    return byTime.filter((e) => normalizeProductKey(String(e.produto || '')) === produtoKey);
  }, [computedEntries, filterEnd, filterMode, filterStart, filterProduto]);

  const bestROAS = filteredEntries.length > 0 ? filteredEntries.reduce((a, b) => a.roas > b.roas ? a : b) : null;
  const bestLeads = filteredEntries.length > 0 ? filteredEntries.reduce((a, b) => a.leads > b.leads ? a : b) : null;
  const bestConv =
    filteredEntries.length > 0
      ? filteredEntries.reduce((a, b) => {
          const aRate = a.leads > 0 ? ((a.vendas || 0) / a.leads) * 100 : 0;
          const bRate = b.leads > 0 ? ((b.vendas || 0) / b.leads) * 100 : 0;
          return bRate > aRate ? b : a;
        })
      : null;

  const rankingRange = useMemo(() => {
    const start = new Date(`${filterStart}T00:00:00`);
    if (filterMode === 'daily') {
      return { startISO: filterStart.slice(0, 10), endISO: filterStart.slice(0, 10) };
    }
    if (filterMode === 'weekly') {
      const endWeek = new Date(start);
      endWeek.setDate(endWeek.getDate() + 6);
      const endISO = endWeek.toISOString().slice(0, 10);
      return { startISO: filterStart.slice(0, 10), endISO };
    }
    if (filterMode === 'monthly') {
      const monthStartISO = `${filterStart.slice(0, 7)}-01`;
      const monthStart = new Date(`${monthStartISO}T00:00:00`);
      const monthEnd = new Date(monthStart);
      monthEnd.setMonth(monthEnd.getMonth() + 1);
      monthEnd.setDate(monthEnd.getDate() - 1);
      const monthEndISO = monthEnd.toISOString().slice(0, 10);
      return { startISO: monthStartISO, endISO: monthEndISO };
    }
    return { startISO: filterStart.slice(0, 10), endISO: filterEnd.slice(0, 10) };
  }, [filterEnd, filterMode, filterStart]);

  const summaryTotals = useMemo(() => {
    const investimentoTotal = filteredEntries.reduce((sum, e) => sum + (typeof e.investimento === 'number' ? e.investimento : 0), 0);
    const receitaTotal = filteredEntries.reduce((sum, e) => sum + (typeof e.receita === 'number' ? e.receita : 0), 0);
    const totalLeads = filteredEntries.reduce((sum, e) => sum + (typeof e.leads === 'number' ? e.leads : 0), 0);
    const custoSobreReceitaPercent = receitaTotal > 0 ? (investimentoTotal / receitaTotal) * 100 : 0;
    const roasAggregated = computeRoas(investimentoTotal, receitaTotal);
    const diferencaLiquida = receitaTotal - investimentoTotal;
    const cpl = totalLeads > 0 ? investimentoTotal / totalLeads : 0;
    return { investimentoTotal, receitaTotal, totalLeads, custoSobreReceitaPercent, roasAggregated, diferencaLiquida, cpl };
  }, [filteredEntries]);

  const alerts = filteredEntries.flatMap((t) => {
    const arr: { msg: string; type: 'warning' | 'danger' | 'success' }[] = [];
    const conversaoPercent = t.leads > 0 ? ((t.vendas || 0) / t.leads) * 100 : 0;
    if (t.leads >= trafficThresholds.highLeadMin && conversaoPercent <= trafficThresholds.lowConversionMaxPercent) {
      arr.push({ msg: `${getTrafficDisplayName(String(t.produto || ''))}: Alto lead + baixa conversão → problema comercial ou oferta`, type: 'warning' });
    }
    if (t.cpl > 0 && t.cpl <= trafficThresholds.lowCplMax && t.leads >= Math.max(1, Math.floor(trafficThresholds.highLeadMin / 2)) && (t.vendas || 0) <= trafficThresholds.lowSalesMax) {
      arr.push({ msg: `${getTrafficDisplayName(String(t.produto || ''))}: Baixo CPL + baixa venda → lead desqualificado`, type: 'warning' });
    }
    if (t.roas >= trafficThresholds.highRoasMin) {
      arr.push({ msg: `${getTrafficDisplayName(String(t.produto || ''))}: Alto ROAS (${t.roas.toFixed(2)}) → produto pronto para escalar`, type: 'success' });
    }
    return arr;
  });

  const gestorCommission = useMemo(() => {
    if (user?.role !== 'gestor') return null;
    const percent = Math.min(100, Math.max(0, Number(user?.comissaoPercent ?? 0)));
    if (percent <= 0) return null;
    const startISO = String(rankingRange.startISO || '').slice(0, 10);
    const endISO = String(rankingRange.endISO || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startISO) || !/^\d{4}-\d{2}-\d{2}$/.test(endISO)) return null;

    let faturamentoTotal = 0;
    for (const ce of commercialEntries) {
      const d = String(ce.data || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
      if (d < startISO || d > endISO) continue;

      const lines = Array.isArray(ce.vendasPorProduto) ? ce.vendasPorProduto : [];
      const linesTotal = lines.reduce((sum, l) => {
        const qtd = typeof l.quantidade === 'number' ? l.quantidade : parseInt(String(l.quantidade || '0'), 10) || 0;
        const precoUnit =
          typeof l.precoUnitario === 'number' ? l.precoUnitario : parseFloat(String(l.precoUnitario || '0')) || 0;
        return sum + qtd * precoUnit;
      }, 0);

      if (linesTotal > 0) {
        faturamentoTotal += linesTotal;
        continue;
      }

      const fallbackLiquido =
        typeof ce.valorLiquido === 'number' ? ce.valorLiquido : parseFloat(String((ce as any)?.valorLiquido || '0')) || 0;
      faturamentoTotal += fallbackLiquido;
    }

    const valor = (faturamentoTotal * percent) / 100;
    return { percent, faturamentoTotal, valor };
  }, [commercialEntries, rankingRange.endISO, rankingRange.startISO, user?.comissaoPercent, user?.role]);

  useEffect(() => {
    const leadsByKey = new Map<string, { produto: string; leads: number }>();
    const vendasByKey = new Map<string, { produto: string; vendas: number }>();
    for (const e of filteredEntries) {
      const produto = getCampaignNameFromStoredProduto(String(e.produto || '').trim());
      if (!produto) continue;
      const key = normalizeProductKey(produto);
      const prevLeads = leadsByKey.get(key);
      leadsByKey.set(key, { produto: prevLeads?.produto || produto, leads: (prevLeads?.leads || 0) + (e.leads || 0) });
      const prevVendas = vendasByKey.get(key);
      vendasByKey.set(key, { produto: prevVendas?.produto || produto, vendas: (prevVendas?.vendas || 0) + (e.vendas || 0) });
    }
    const keys = new Set<string>([...leadsByKey.keys(), ...vendasByKey.keys()]);
    const rows = Array.from(keys).map((key) => {
      const leadsInfo = leadsByKey.get(key);
      const salesInfo = vendasByKey.get(key);
      const produto = leadsInfo?.produto || salesInfo?.produto || '—';
      const leads = leadsInfo?.leads || 0;
      const vendas = salesInfo?.vendas || 0;
      const conversaoPercent = leads > 0 ? (vendas / leads) * 100 : 0;
      return { produto, leads, vendas, conversaoPercent, topVendedores: [] };
    });
    rows.sort((a, b) => {
      if (b.conversaoPercent !== a.conversaoPercent) return b.conversaoPercent - a.conversaoPercent;
      if (b.vendas !== a.vendas) return b.vendas - a.vendas;
      return b.leads - a.leads;
    });
    const next = rows.slice(0, 20);
    const same =
      productRanking.length === next.length &&
      productRanking.every((r, i) => r.produto === next[i].produto && r.leads === next[i].leads && r.vendas === next[i].vendas);
    if (!same) setProductRanking(next);
    if (rankingLoading) setRankingLoading(false);
  }, [filteredEntries]);

  const roasChartProdutosDisponiveis = useMemo(() => {
    const unique = new Set<string>();
    for (const e of filteredEntries) {
      const nome = String(e.produto || '').trim();
      if (nome) unique.add(nome);
    }
    return Array.from(unique).sort((a, b) => a.localeCompare(b));
  }, [filteredEntries]);

  const chartData = useMemo(() => {
    const scope = String(roasChartProduto || '__geral__');
    if (scope !== '__geral__') {
      const key = normalizeProductKey(scope);
      const grouped = new Map<string, { semana: string; investimento: number; receita: number }>();
      for (const e of filteredEntries) {
        if (normalizeProductKey(String(e.produto || '')) !== key) continue;
        const semana = String(e.semana || '').slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(semana)) continue;
        const prev = grouped.get(semana) || { semana, investimento: 0, receita: 0 };
        prev.investimento += typeof e.investimento === 'number' ? e.investimento : 0;
        prev.receita += typeof e.receita === 'number' ? e.receita : 0;
        grouped.set(semana, prev);
      }
      return Array.from(grouped.values())
        .sort((a, b) => a.semana.localeCompare(b.semana))
        .map((g) => ({ semana: g.semana, roas: Number(computeRoas(g.investimento, g.receita).toFixed(2)) }));
    }

    const grouped = new Map<string, { semana: string; investimento: number; receita: number }>();
    for (const e of filteredEntries) {
      const semana = String(e.semana || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(semana)) continue;
      const prev = grouped.get(semana) || { semana, investimento: 0, receita: 0 };
      prev.investimento += typeof e.investimento === 'number' ? e.investimento : 0;
      prev.receita += typeof e.receita === 'number' ? e.receita : 0;
      grouped.set(semana, prev);
    }

    return Array.from(grouped.values())
      .sort((a, b) => a.semana.localeCompare(b.semana))
      .map((g) => {
        return { semana: g.semana, roas: Number(computeRoas(g.investimento, g.receita).toFixed(2)) };
      });
  }, [filteredEntries, roasChartProduto]);

  const filterLabel = useMemo(() => {
    if (filterMode === 'daily') return 'Diário';
    if (filterMode === 'weekly') return 'Semanal';
    if (filterMode === 'monthly') return 'Mensal';
    return 'Personalizado';
  }, [filterMode]);

  return (
    <div className="space-y-6">
      {!isBackendEnabled && (
        <Card className="border-warning/30 bg-warning/5">
          <CardContent className="p-4 text-sm">
            Modo offline: sem conexão autenticada com o backend. Faça login para carregar os dados de tráfego e comercial.
          </CardContent>
        </Card>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-[1.625rem] leading-tight font-semibold tracking-tight">Módulo Tráfego</h1>
          <p className="text-muted-foreground text-sm mt-1">Dados preenchidos semanalmente por produto</p>
        </div>
        <Button onClick={openNewEntry} className="active:scale-[0.97] sm:self-auto self-start">
          <Plus className="mr-2 h-4 w-4" /> Nova Entrada
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filtro ({filterLabel})</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label>Modo</Label>
            <Select value={filterMode} onValueChange={(v) => setFilterMode(v as any)}>
              <SelectTrigger>
                <SelectValue placeholder="Filtro" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">Diário</SelectItem>
                <SelectItem value="weekly">Semanal</SelectItem>
                <SelectItem value="monthly">Mensal</SelectItem>
                <SelectItem value="custom">Personalizado</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>{filterMode === 'monthly' ? 'Mês (referência)' : 'Início'}</Label>
            {filterMode === 'monthly' ? (() => {
              const selectedYear = String(filterStart || '').slice(0, 4) || String(new Date().getFullYear());
              const selectedMonth = String(filterStart || '').slice(5, 7) || String(new Date().getMonth() + 1).padStart(2, '0');
              const months = [
                { value: '01', label: 'Janeiro' },
                { value: '02', label: 'Fevereiro' },
                { value: '03', label: 'Março' },
                { value: '04', label: 'Abril' },
                { value: '05', label: 'Maio' },
                { value: '06', label: 'Junho' },
                { value: '07', label: 'Julho' },
                { value: '08', label: 'Agosto' },
                { value: '09', label: 'Setembro' },
                { value: '10', label: 'Outubro' },
                { value: '11', label: 'Novembro' },
                { value: '12', label: 'Dezembro' },
              ];
              const currentYear = new Date().getFullYear();
              const years = Array.from({ length: 8 }, (_, i) => String(currentYear - 5 + i));
              return (
                <div className="flex gap-2">
                  <Select
                    value={selectedMonth}
                    onValueChange={(m) => setFilterStart(`${selectedYear}-${m}-01`)}
                  >
                    <SelectTrigger className="w-44">
                      <SelectValue placeholder="Mês" />
                    </SelectTrigger>
                    <SelectContent>
                      {months.map((m) => (
                        <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={selectedYear}
                    onValueChange={(y) => setFilterStart(`${y}-${selectedMonth}-01`)}
                  >
                    <SelectTrigger className="w-28">
                      <SelectValue placeholder="Ano" />
                    </SelectTrigger>
                    <SelectContent>
                      {years.map((y) => (
                        <SelectItem key={y} value={y}>{y}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              );
            })() : (
              <Input type="date" value={filterStart} onChange={(e) => setFilterStart(e.target.value)} />
            )}
          </div>
          {filterMode === 'custom' ? (
            <div className="space-y-1.5">
              <Label>Fim</Label>
              <Input type="date" value={filterEnd} onChange={(e) => setFilterEnd(e.target.value)} />
            </div>
          ) : (
            <div className="hidden sm:block" />
          )}
          {allTrafficProdutos.length > 0 && (
            <div className="space-y-1.5 sm:col-span-3">
              <Label>Campanha / Produto</Label>
              <Select value={filterProduto} onValueChange={setFilterProduto}>
                <SelectTrigger className="w-full sm:w-72">
                  <SelectValue placeholder="Todas as campanhas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__todos__">Todas as campanhas</SelectItem>
                  {allTrafficProdutos.map((nome) => (
                    <SelectItem key={nome} value={nome}>{getTrafficDisplayName(nome)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Resumo {filterMode === 'monthly' ? 'Mensal' : 'do Período'}</CardTitle></CardHeader>
        <CardContent className={`grid grid-cols-1 gap-4 ${gestorCommission ? 'sm:grid-cols-2 lg:grid-cols-5' : 'sm:grid-cols-2 lg:grid-cols-4'}`}>
          <div className="p-4 rounded-lg border border-border bg-muted/30">
            <p className="eyebrow">Investimento</p>
            <p className="mt-1.5 text-xl font-semibold tabular-nums tracking-tight">
              R$ {summaryTotals.investimentoTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
          </div>
          <div className="p-4 rounded-lg border border-border bg-muted/30">
            <p className="eyebrow">Receita</p>
            <p className="mt-1.5 text-xl font-semibold tabular-nums tracking-tight">
              R$ {summaryTotals.receitaTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
          </div>
          <div className="p-4 rounded-lg border border-border bg-muted/30">
            <p className="eyebrow">CPL (Custo por Lead)</p>
            <p className="mt-1.5 text-xl font-semibold tabular-nums tracking-tight">
              {summaryTotals.totalLeads > 0
                ? `R$ ${summaryTotals.cpl.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                : '—'}
            </p>
            <p className="text-xs mt-1 text-muted-foreground">
              {summaryTotals.totalLeads} lead{summaryTotals.totalLeads !== 1 ? 's' : ''} no período
            </p>
          </div>
          <div className="p-4 rounded-lg border border-border bg-muted/30">
            <p className="eyebrow">Custo/Campanha vs Receita</p>
            <p className={`mt-1 text-lg font-semibold ${summaryTotals.custoSobreReceitaPercent > 100 ? 'text-destructive' : ''}`}>
              {summaryTotals.custoSobreReceitaPercent.toFixed(1)}%
            </p>
            <p
              className={`text-xs mt-1 ${
                summaryTotals.roasAggregated === 0
                  ? 'text-destructive'
                  : summaryTotals.roasAggregated < 3
                    ? 'text-warning'
                    : 'text-success'
              }`}
            >
              ROAS agregado: {summaryTotals.roasAggregated.toFixed(2)}
            </p>
            <p className={`text-xs mt-1 ${summaryTotals.diferencaLiquida < 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
              Diferença (Receita − Investimento): R{'$ '}
              {Math.abs(summaryTotals.diferencaLiquida).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              {summaryTotals.diferencaLiquida < 0 ? ' (negativo)' : ''}
            </p>
          </div>
          {gestorCommission && (
            <div className="p-4 rounded-lg border border-border bg-muted/30">
              <p className="eyebrow">Comissão do Gestor</p>
              <p className="mt-1.5 text-xl font-semibold tabular-nums tracking-tight">
                {gestorCommission.percent.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}% • R{'$ '}
                {gestorCommission.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
              <p className="text-xs mt-1 text-muted-foreground">
                Base (faturamento): R{'$ '}
                {gestorCommission.faturamentoTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {(trafficLoadError || commercialLoadError) && (
        <Card className="border-warning/30 bg-warning/5">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-warning shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="font-medium text-warning">Problema ao carregar dados do backend</p>
              <p className="text-sm text-muted-foreground break-words">
                {trafficLoadError ? `Tráfego: ${trafficLoadError}` : ''}
                {trafficLoadError && commercialLoadError ? ' • ' : ''}
                {commercialLoadError ? `Comercial: ${commercialLoadError}` : ''}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {!trafficLoadError && entries.length === 0 && (
        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground">Nenhuma entrada de tráfego cadastrada ainda.</CardContent>
        </Card>
      )}

      {!trafficLoadError && entries.length > 0 && filteredEntries.length === 0 && (
        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground">
            Nenhuma entrada encontrada no período selecionado. Existem {entries.length} entradas carregadas no total — ajuste o filtro.
          </CardContent>
        </Card>
      )}

      <Dialog
        open={showForm}
        onOpenChange={(open) => {
          setShowForm(open);
          if (!open) {
            setForm({ produto: '', semana: '', fim: '', investimento: '', leads: '', cpl: '' });
            setLaunchMode('produto');
            setCampaignName('');
            setEditingId(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Editar Entrada de Tráfego' : 'Nova Entrada de Tráfego'}</DialogTitle>
            <DialogDescription>Preencha semanalmente investimento e leads. Vendas e receita são calculadas automaticamente a partir do comercial.</DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Lançamento</Label>
              <Select value={launchMode} onValueChange={(v) => setLaunchMode(v as 'produto' | 'campanha')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="produto">Por produto</SelectItem>
                  <SelectItem value="campanha">Por campanha</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label>{launchMode === 'campanha' ? 'Campanha' : 'Produto'}</Label>
              {launchMode === 'campanha' ? (
                <div className="space-y-2">
                  <Select value={campaignName || '__none__'} onValueChange={(v) => setCampaignName(v === '__none__' ? '' : v)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione uma campanha" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Selecionar campanha</SelectItem>
                      {campaignOptions.map((name) => (
                        <SelectItem key={name} value={name}>
                          {name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    value={campaignName}
                    onChange={(e) => setCampaignName(e.target.value)}
                    placeholder="Digite o nome da campanha"
                  />
                </div>
              ) : activeProducts.length > 0 ? (
                <Select value={form.produto} onValueChange={(v) => setForm((prev) => ({ ...prev, produto: v }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o produto" />
                  </SelectTrigger>
                  <SelectContent>
                    {activeProducts
                      .slice()
                      .sort((a, b) => a.nome.localeCompare(b.nome))
                      .map((p) => (
                        <SelectItem key={p.id} value={p.nome}>
                          {p.nome}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input value={form.produto} onChange={e => setForm({ ...form, produto: e.target.value })} placeholder="Nome do produto" />
              )}
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label>Semana (início)</Label>
              <Input type="date" value={form.semana} onChange={(e) => setForm((prev) => ({ ...prev, semana: e.target.value }))} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Término</Label>
              <Input
                type="date"
                value={form.fim}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    fim: e.target.value,
                  }))
                }
              />
            </div>

            <div className="space-y-1.5">
              <Label>Investimento (R$)</Label>
              <Input type="number" value={form.investimento} onChange={e => setForm({ ...form, investimento: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Leads</Label>
              <Input type="number" value={form.leads} onChange={e => setForm({ ...form, leads: e.target.value })} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <div className="rounded-md border border-border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
                Vendas e receita são preenchidas automaticamente com base nas vendas do comercial dentro do período, considerando os descontos aplicados.
              </div>
            </div>

            <div className="sm:col-span-2 flex gap-2 justify-end">
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                Cancelar
              </Button>
              <Button type="button" onClick={handleSave} disabled={!canSave}>
                Salvar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Insight Cards / Configuração */}
      {isAdmin ? (
        <Tabs defaultValue="insights" className="space-y-4">
          <TabsList>
            <TabsTrigger value="insights">Visão</TabsTrigger>
            <TabsTrigger value="config">Configuração</TabsTrigger>
          </TabsList>
          <TabsContent value="insights">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <MetricCard
                label="Maior ROAS" icon={TrendingUp} tone="success" text
                value={bestROAS?.produto || '—'}
                hint={bestROAS ? <span className={bestROAS.roas === 0 ? 'text-destructive' : bestROAS.roas < 3 ? 'text-warning' : 'text-success'}>{`ROAS ${bestROAS.roas.toFixed(2)}`}</span> : undefined}
              />
              <MetricCard label="Mais Leads" icon={Target} tone="info" text value={bestLeads?.produto || '—'} hint={bestLeads ? `${bestLeads.leads} leads` : undefined} />
              <MetricCard
                label="Maior Conversão" icon={Zap} tone="warning" text
                value={bestConv?.produto || '—'}
                hint={bestConv && bestConv.leads > 0 ? `${(((bestConv.vendas || 0) / bestConv.leads) * 100).toFixed(1)}%` : '—'}
              />
            </div>
          </TabsContent>
          <TabsContent value="config">
            <Card>
              <CardHeader><CardTitle className="text-base">Configurar Limites de Alertas (Tráfego)</CardTitle></CardHeader>
              <CardContent className="flex flex-wrap gap-4 items-end">
                <div className="space-y-1.5">
                  <Label>Leads altos (mínimo)</Label>
                  <Input type="number" className="w-36" value={trafficThresholds.highLeadMin} onChange={(e) => setTrafficThresholds({ ...trafficThresholds, highLeadMin: parseInt(e.target.value || '0', 10) || 0 })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Baixa conversão (≤ %)</Label>
                  <Input type="number" className="w-36" value={trafficThresholds.lowConversionMaxPercent} onChange={(e) => setTrafficThresholds({ ...trafficThresholds, lowConversionMaxPercent: parseFloat(e.target.value || '0') || 0 })} />
                </div>
                <div className="space-y-1.5">
                  <Label>CPL baixo (≤ R$)</Label>
                  <Input type="number" className="w-36" value={trafficThresholds.lowCplMax} onChange={(e) => setTrafficThresholds({ ...trafficThresholds, lowCplMax: parseFloat(e.target.value || '0') || 0 })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Baixa venda (≤ unidades)</Label>
                  <Input type="number" className="w-36" value={trafficThresholds.lowSalesMax} onChange={(e) => setTrafficThresholds({ ...trafficThresholds, lowSalesMax: parseInt(e.target.value || '0', 10) || 0 })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Alto ROAS (≥)</Label>
                  <Input
                    type="number"
                    className="w-36"
                    value={trafficThresholds.highRoasMin}
                    onChange={(e) => setTrafficThresholds({ ...trafficThresholds, highRoasMin: parseFloat(e.target.value || '0') || 0 })}
                  />
                </div>
                <Button onClick={() => saveTrafficThresholds(trafficThresholds)} className="active:scale-[0.97]">Salvar Limites</Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      ) : (
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-5 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-success/10 flex items-center justify-center shrink-0">
              <TrendingUp className="w-5 h-5 text-success" />
            </div>
            <div className="min-w-0">
              <p className="eyebrow">Maior ROAS</p>
              <p className="font-semibold truncate">{bestROAS ? getTrafficDisplayName(String(bestROAS.produto || '')) : '—'}</p>
              <p
                className={`text-xs ${
                  !bestROAS
                    ? 'text-muted-foreground'
                    : bestROAS.roas === 0
                      ? 'text-destructive'
                      : bestROAS.roas < 3
                        ? 'text-warning'
                        : 'text-success'
                }`}
              >
                {bestROAS ? `${bestROAS.roas.toFixed(2)}` : ''}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-info/10 flex items-center justify-center shrink-0">
              <Target className="w-5 h-5 text-info" />
            </div>
            <div className="min-w-0">
              <p className="eyebrow">Mais Leads</p>
              <p className="font-semibold truncate">{bestLeads ? getTrafficDisplayName(String(bestLeads.produto || '')) : '—'}</p>
              <p className="text-xs text-muted-foreground">{bestLeads ? `${bestLeads.leads} leads` : ''}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-warning/10 flex items-center justify-center shrink-0">
              <Zap className="w-5 h-5 text-warning" />
            </div>
            <div className="min-w-0">
              <p className="eyebrow">Maior Conversão</p>
              <p className="font-semibold truncate">{bestConv ? getTrafficDisplayName(String(bestConv.produto || '')) : '—'}</p>
              <p className="text-xs text-muted-foreground">
                {bestConv && bestConv.leads > 0 ? `${(((bestConv.vendas || 0) / bestConv.leads) * 100).toFixed(1)}%` : '—'}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
      )}

      {/* Alerts */}
      {alerts.length > 0 && (
        <div className="space-y-2">
          {alerts.map((a, i) => (
            <Card key={i} className={a.type === 'success' ? 'border-success/30 bg-success/5' : a.type === 'danger' ? 'border-destructive/30 bg-destructive/5' : 'border-warning/30 bg-warning/5'}>
              <CardContent className="p-3 flex items-center gap-2">
                <AlertTriangle className={`w-4 h-4 shrink-0 ${a.type === 'success' ? 'text-success' : a.type === 'danger' ? 'text-destructive' : 'text-warning'}`} />
                <p className="text-sm">{a.msg}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      

      {/* Chart */}
      {filteredEntries.length > 0 && (
        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-base">
              {roasChartProduto === '__geral__' ? 'Evolução do ROAS (Geral)' : `Evolução do ROAS (${getTrafficDisplayName(roasChartProduto)})`}
            </CardTitle>
            <div className="w-full sm:w-64">
              <Select value={roasChartProduto} onValueChange={setRoasChartProduto}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o produto" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__geral__">Geral</SelectItem>
                  {roasChartProdutosDisponiveis.map((p) => (
                    <SelectItem key={p} value={p}>
                      {getTrafficDisplayName(p)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" />
                  <XAxis dataKey="semana" className="text-xs" tickFormatter={(v) => formatDateBR(String(v || ''))} />
                  <YAxis className="text-xs" />
                  <Tooltip
                    labelFormatter={(label) => formatDateBR(String(label || ''))}
                    formatter={(value: any) => [Number(value || 0).toFixed(2), 'ROAS']}
                  />
                  <Line type="monotone" dataKey="roas" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ranking de Produtos (Conversão por Vendas)</CardTitle>
        </CardHeader>
        <CardContent>
          {rankingLoading ? (
            <div className="text-sm text-muted-foreground">Carregando ranking...</div>
          ) : productRanking.length > 0 ? (
            <div className="-mx-6 px-6 overflow-x-auto">
              <Table className="min-w-[720px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Produto</TableHead>
                    <TableHead className="text-right">Leads</TableHead>
                    <TableHead className="text-right">Vendas</TableHead>
                    <TableHead className="text-right">Conversão</TableHead>
                    <TableHead>Top vendedor</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {productRanking.map((r) => {
                    const top = r.topVendedores?.[0];
                    return (
                      <TableRow key={r.produto}>
                        <TableCell className="font-medium">{getTrafficDisplayName(r.produto)}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.leads}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.vendas}</TableCell>
                        <TableCell className="text-right tabular-nums font-semibold">{r.conversaoPercent.toFixed(1)}%</TableCell>
                        <TableCell className="truncate">
                          {top ? `${top.vendedorNome} (${top.vendas})` : '—'}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">Sem dados suficientes para montar o ranking no período.</div>
          )}
        </CardContent>
      </Card>

      {/* Table */}
      {filteredEntries.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Histórico</CardTitle></CardHeader>
          <CardContent>
            <div className="-mx-6 px-6 overflow-x-auto">
              <Table className="min-w-[860px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Produto</TableHead>
                    <TableHead className="hidden md:table-cell">Criado por</TableHead>
                    <TableHead>Período</TableHead>
                    <TableHead className="text-right">Investimento</TableHead>
                    <TableHead className="text-right">Leads</TableHead>
                    <TableHead className="text-right">CPL</TableHead>
                    <TableHead className="text-right">Vendas</TableHead>
                    <TableHead className="text-right">Receita</TableHead>
                    <TableHead className="text-right">ROAS</TableHead>
                  {canManageTraffic && <TableHead className="text-right">Ações</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredEntries.sort((a, b) => b.semana.localeCompare(a.semana)).map(e => (
                    <TableRow key={e.id}>
                      <TableCell className="font-medium">{getTrafficDisplayName(String(e.produto || ''))}</TableCell>
                      <TableCell className="hidden md:table-cell max-w-48 truncate">{e.criadoPorNome || e.vendedorNome || '—'}</TableCell>
                      <TableCell>
                        {e.fim && e.fim !== e.semana ? `${formatDateBR(e.semana)} a ${formatDateBR(e.fim)}` : formatDateBR(e.semana)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">R$ {e.investimento.toLocaleString('pt-BR')}</TableCell>
                      <TableCell className="text-right tabular-nums">{e.leads}</TableCell>
                      <TableCell className="text-right tabular-nums">R$ {e.cpl.toFixed(2)}</TableCell>
                      <TableCell className="text-right tabular-nums">{e.vendas}</TableCell>
                      <TableCell className="text-right tabular-nums">R$ {e.receita.toLocaleString('pt-BR')}</TableCell>
                      <TableCell
                        className={`text-right tabular-nums font-semibold ${
                          e.investimento === 0 && e.receita > 0
                            ? 'text-success'
                            : e.roas === 0
                              ? 'text-destructive'
                              : e.roas < 3
                                ? 'text-warning'
                                : 'text-success'
                        }`}
                      >
                        {e.roas.toFixed(2)}
                      </TableCell>
                    {canManageTraffic && (
                      <TableCell className="text-right">
                        <div className="inline-flex gap-2">
                          <Button variant="outline" size="icon" onClick={() => startEditEntry(e)} aria-label="Editar">
                            <Pencil className="h-4 w-4 text-muted-foreground" />
                          </Button>
                          <Button variant="outline" size="icon" onClick={() => handleDeleteTrafficEntry(e.id)} aria-label="Excluir">
                            <Trash2 className="h-4 w-4 text-muted-foreground" />
                          </Button>
                        </div>
                      </TableCell>
                    )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

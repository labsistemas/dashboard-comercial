import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MetricCard } from '@/components/MetricCard';
import {
  getTrafficEntries,
  saveTrafficEntries,
  getCommercialEntries,
  saveCommercialEntries,
  getRescueEntries,
  saveRescueEntries,
  getUsers,
  getThresholds,
  getProducts,
  saveProducts,
  getCommercialAwards,
  saveCommercialAwards,
} from '@/lib/storage';
import { TrendingUp, TrendingDown, Users, AlertTriangle, Zap, Target, ShoppingCart, Rocket } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getBackendBaseUrl, getAuthToken } from '@/lib/storage';
import { Product, User } from '@/types/dashboard';

export default function AdminDashboard() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [projectionDaysMode, setProjectionDaysMode] = useState<'10' | '20' | '26' | 'month'>('26');
  const [trafficEntries, setTrafficEntries] = useState(() => getTrafficEntries());
  const [commercialEntries, setCommercialEntries] = useState(() => getCommercialEntries());
  const [rescueEntries, setRescueEntries] = useState(() => getRescueEntries());
  const [users, setUsers] = useState<User[]>(getUsers());
  const [products, setProducts] = useState<Product[]>(() => getProducts());
  const thresholds = getThresholds();
  const backend = getBackendBaseUrl();
  const token = getAuthToken();
  const isBackendEnabled = Boolean(backend && token);
  const commercialApiBase = backend ? `${backend}/api/commercial/entries` : null;
  const trafficApiBase = backend ? `${backend}/api/traffic/entries` : null;
  const rescueApiBase = backend ? `${backend}/api/rescue/entries` : null;

  const [overviewPeriod, setOverviewPeriod] = useState<'hoje' | 'semana' | 'mes' | 'personalizado'>('mes');
  const [overviewRefDate, setOverviewRefDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [overviewCustomStart, setOverviewCustomStart] = useState('');
  const [overviewCustomEnd, setOverviewCustomEnd] = useState('');
  const [campaignBase, setCampaignBase] = useState<'campanha' | 'produto'>('campanha');
  const [selectedCampaign, setSelectedCampaign] = useState<string>('all');
  const [campaignPeriod, setCampaignPeriod] = useState<'hoje' | 'semana' | 'mes' | 'personalizado'>('mes');
  const [campaignRefDate, setCampaignRefDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [campaignCustomStart, setCampaignCustomStart] = useState('');
  const [campaignCustomEnd, setCampaignCustomEnd] = useState('');
  const overviewRange = useMemo(() => {
    if (overviewPeriod === 'personalizado') {
      const start = parseISODateOnly(overviewCustomStart) || new Date();
      const end = parseISODateOnly(overviewCustomEnd) || start;
      const startISO = formatISODateOnly(start);
      const endISO = formatISODateOnly(new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate() + 1, 0, 0, 0, 0)));
      const label = `Personalizado (${formatDateBR(startISO)} - ${formatDateBR(formatISODateOnly(end))})`;
      return { startISO, endISO, label };
    }
    const ref = parseISODateOnly(overviewRefDate) || new Date();
    const start =
      overviewPeriod === 'hoje'
        ? new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate(), 0, 0, 0, 0))
        : overviewPeriod === 'semana'
          ? startOfISOWeek(ref)
          : startOfMonthUTC(ref);
    const end =
      overviewPeriod === 'hoje'
        ? new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + 1, 0, 0, 0, 0))
        : overviewPeriod === 'semana'
          ? new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + 7, 0, 0, 0, 0))
          : addMonthsUTC(start, 1);
    const startISO = formatISODateOnly(start);
    const endISO = formatISODateOnly(end);
    const label =
      overviewPeriod === 'hoje'
        ? `Dia (${formatDateBR(startISO)})`
        : overviewPeriod === 'semana'
          ? `Semana (${formatDateBR(startISO)} - ${formatDateBR(formatISODateOnly(new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate() - 1, 0, 0, 0, 0))))})`
          : `Mês (${formatMonthBR(startISO.slice(0, 7))})`;
    return { startISO, endISO, label };
  }, [overviewPeriod, overviewRefDate, overviewCustomStart, overviewCustomEnd]);

  const campaignRange = useMemo(() => {
    if (campaignPeriod === 'personalizado') {
      const start = parseISODateOnly(campaignCustomStart) || new Date();
      const end = parseISODateOnly(campaignCustomEnd) || start;
      const startISO = formatISODateOnly(start);
      const endISO = formatISODateOnly(new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate() + 1, 0, 0, 0, 0)));
      const label = `Personalizado (${formatDateBR(startISO)} - ${formatDateBR(formatISODateOnly(end))})`;
      return { startISO, endISO, label };
    }
    const ref = parseISODateOnly(campaignRefDate) || new Date();
    const start =
      campaignPeriod === 'hoje'
        ? new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate(), 0, 0, 0, 0))
        : campaignPeriod === 'semana'
          ? startOfISOWeek(ref)
          : startOfMonthUTC(ref);
    const end =
      campaignPeriod === 'hoje'
        ? new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + 1, 0, 0, 0, 0))
        : campaignPeriod === 'semana'
          ? new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + 7, 0, 0, 0, 0))
          : addMonthsUTC(start, 1);
    const startISO = formatISODateOnly(start);
    const endISO = formatISODateOnly(end);
    const label =
      campaignPeriod === 'hoje'
        ? `Dia (${formatDateBR(startISO)})`
        : campaignPeriod === 'semana'
          ? `Semana (${formatDateBR(startISO)} - ${formatDateBR(formatISODateOnly(new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate() - 1, 0, 0, 0, 0))))})`
          : `Mês (${formatMonthBR(startISO.slice(0, 7))})`;
    return { startISO, endISO, label };
  }, [campaignPeriod, campaignRefDate, campaignCustomStart, campaignCustomEnd]);

  const traffic = useMemo(() => {
    return trafficEntries.filter((t) => {
      const d =
        String(t.fim || '').slice(0, 10) ||
        (String(t.semana || '').length >= 7 ? `${String(t.semana || '').slice(0, 7)}-01` : '');
      return d && d >= overviewRange.startISO && d < overviewRange.endISO;
    });
  }, [trafficEntries, overviewRange.startISO, overviewRange.endISO]);
  const commercial = useMemo(() => {
    return commercialEntries.filter((c) => {
      const d = String(c.data || '').slice(0, 10);
      return d && d >= overviewRange.startISO && d < overviewRange.endISO;
    });
  }, [commercialEntries, overviewRange.startISO, overviewRange.endISO]);
  const rescue = useMemo(() => {
    return rescueEntries.filter((r) => {
      const d = String(r.data || '').slice(0, 10);
      return d && d >= overviewRange.startISO && d < overviewRange.endISO;
    });
  }, [rescueEntries, overviewRange.startISO, overviewRange.endISO]);

  const vendedores = users.filter(u => u.role === 'vendedor');
  const usersById = useMemo(() => new Map(users.map((u) => [u.id, u.nome])), [users]);
  const userAvatarById = useMemo(() => new Map(users.map((u) => [u.id, String(u.avatar || '')])), [users]);
  const [awards, setAwards] = useState(getCommercialAwards());
  const awardsApiBase = backend ? `${backend}/api/commercial/entries/awards` : null;
  const sellerProgressTargetById = useMemo(() => {
    const byId = new Map<string, number>();
    const rules = awards.rules || [];
    for (const v of vendedores) {
      const applicable = rules
        .filter((r) => !r.vendedorId || String(r.vendedorId) === String(v.id))
        .slice()
        .sort((a, b) => (a.minVendas || 0) - (b.minVendas || 0));
      const target = applicable.length > 0 ? applicable[0].minVendas || 0 : 0;
      byId.set(String(v.id), target);
    }
    return byId;
  }, [awards.rules, vendedores]);

  const resolveAvatarSrc = (src?: string) => {
    const v = String(src || '').trim();
    if (!v) return '';
    if (v.startsWith('http://') || v.startsWith('https://')) return v;
    if (v.startsWith('/') && backend) return `${backend}${v}`;
    return v;
  };

  useEffect(() => {
    if (backend && token && awardsApiBase) {
      let isCancelled = false;
      const loadAwards = async () => {
        try {
          const res = await fetch(awardsApiBase, { headers: { Authorization: `Bearer ${token}` } });
          const data = await res.json().catch(() => null);
          if (!res.ok) return;
          const period = String(data?.period || 'weekly') as any;
          const rules = Array.isArray(data?.rules) ? data.rules : [];
          const mappedRules = rules
            .map((r: any) => ({
              id: String(r?.id || crypto.randomUUID()),
              vendedorId: r?.vendedorId ? String(r.vendedorId) : null,
              minVendas: typeof r?.minVendas === 'number' ? r.minVendas : parseInt(String(r?.minVendas || '0')) || 0,
              pixValor: typeof r?.pixValor === 'number' ? r.pixValor : parseFloat(String(r?.pixValor || '0')) || 0,
            }))
            .filter((r: any) => r.id);
          const next = { period: period === 'weekly' || period === 'monthly' || period === 'quarterly' ? period : 'weekly', rules: mappedRules };
          if (!isCancelled) {
            setAwards(next);
            saveCommercialAwards(next);
          }
        } catch {
        }
      };
      loadAwards();
      return () => {
        isCancelled = true;
      };
    }
  }, [backend, token, awardsApiBase]);

  useEffect(() => {
    let isCancelled = false;
    const loadRemoteUsers = async () => {
      if (!backend || !token) return;
      try {
        const res = await fetch(`${backend}/api/users`, { headers: { Authorization: `Bearer ${token}` } });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error || 'Falha ao carregar usuários');
        const list = (data?.users || []) as Array<any>;
        const mapped: User[] = list.map((u) => ({
          id: String(u.id),
          nome: String(u.nome || ''),
          email: String(u.email || ''),
          senha: '',
          role: String(u.role || 'vendedor') as any,
          avatar: String(u.avatar || ''),
          comissaoPercent: typeof u.comissaoPercent === 'number' ? u.comissaoPercent : 0,
        }));
        if (!isCancelled) setUsers(mapped);
      } catch {
        // ignore
      }
    };
    loadRemoteUsers();
    return () => {
      isCancelled = true;
    };
  }, [backend, token]);

  useEffect(() => {
    if (!isBackendEnabled || !commercialApiBase || !trafficApiBase || !rescueApiBase) return;
    let isCancelled = false;

    const load = async () => {
      try {
        const productsApiBase = backend ? `${backend}/api/products` : null;
        const [commercialRes, trafficRes, rescueRes, productsRes] = await Promise.all([
          fetch(`${commercialApiBase}`, { headers: { Authorization: `Bearer ${token}` } }),
          fetch(`${trafficApiBase}`, { headers: { Authorization: `Bearer ${token}` } }),
          fetch(`${rescueApiBase}`, { headers: { Authorization: `Bearer ${token}` } }),
          productsApiBase
            ? fetch(productsApiBase, { headers: { Authorization: `Bearer ${token}` } })
            : Promise.resolve({ ok: true, json: async () => ({ products: [] }) } as any),
        ]);

        const [commercialData, trafficData, rescueData, productsData] = await Promise.all([
          commercialRes.json().catch(() => null),
          trafficRes.json().catch(() => null),
          rescueRes.json().catch(() => null),
          productsRes.json().catch(() => null),
        ]);

        if (!commercialRes.ok) throw new Error(commercialData?.error || 'Falha ao carregar comercial');
        if (!trafficRes.ok) throw new Error(trafficData?.error || 'Falha ao carregar tráfego');
        if (!rescueRes.ok) throw new Error(rescueData?.error || 'Falha ao carregar resgate');
        if (!productsRes.ok) throw new Error(productsData?.error || 'Falha ao carregar produtos');

        const commercialList = Array.isArray(commercialData?.entries) ? commercialData.entries : [];
        const trafficList = Array.isArray(trafficData?.entries) ? trafficData.entries : [];
        const rescueList = Array.isArray(rescueData?.entries) ? rescueData.entries : [];
        const productsList = Array.isArray(productsData?.products) ? productsData.products : [];

        const mappedCommercial = commercialList.map((e: any) => ({
          id: String(e.id),
          data: String(e.data || ''),
          vendedorId: String(e.vendedorId || ''),
          vendedorNome: String(e.vendedorNome || ''),
          campaignScope: e.campaignScope === 'campanha' ? 'campanha' : 'geral',
          campaignName: String(e.campaignName || ''),
          criadoPor: String(e.criadoPor || ''),
          criadoPorNome: String(e.criadoPorNome || ''),
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
        }));

        const mappedTraffic = trafficList.map((e: any) => ({
          id: String(e.id),
          produto: String(e.produto || ''),
          semana: String(e.semana || ''),
          fim: e.fim ? String(e.fim) : undefined,
          periodoTipo: e.periodoTipo === 'monthly' ? 'monthly' : 'weekly',
          investimento: typeof e.investimento === 'number' ? e.investimento : parseFloat(String(e.investimento || '0')) || 0,
          leads: parseInt(String(e.leads || '0')) || 0,
          cpl: typeof e.cpl === 'number' ? e.cpl : parseFloat(String(e.cpl || '0')) || 0,
          vendas: parseInt(String(e.vendas || '0')) || 0,
          receita: typeof e.receita === 'number' ? e.receita : parseFloat(String(e.receita || '0')) || 0,
          roas:
            typeof e.roas === 'number'
              ? e.roas
              : (() => {
                  const investimento =
                    typeof e.investimento === 'number' ? e.investimento : parseFloat(String(e.investimento || '0')) || 0;
                  const receita = typeof e.receita === 'number' ? e.receita : parseFloat(String(e.receita || '0')) || 0;
                  return computeRoas(investimento, receita);
                })(),
          alcance: e.alcance == null ? undefined : parseInt(String(e.alcance || '0')) || 0,
          impressoes: e.impressoes == null ? undefined : parseInt(String(e.impressoes || '0')) || 0,
          cliques: e.cliques == null ? undefined : parseInt(String(e.cliques || '0')) || 0,
          ctrPercent: e.ctrPercent == null ? undefined : typeof e.ctrPercent === 'number' ? e.ctrPercent : parseFloat(String(e.ctrPercent || '0')) || 0,
          cpc: e.cpc == null ? undefined : typeof e.cpc === 'number' ? e.cpc : parseFloat(String(e.cpc || '0')) || 0,
          cpm: e.cpm == null ? undefined : typeof e.cpm === 'number' ? e.cpm : parseFloat(String(e.cpm || '0')) || 0,
          vendedorId: e.vendedorId ? String(e.vendedorId) : undefined,
          vendedorNome: e.vendedorNome ? String(e.vendedorNome) : undefined,
          criadoPor: String(e.criadoPor || ''),
          criadoPorNome: e.criadoPorNome ? String(e.criadoPorNome) : undefined,
          criadoEm: String(e.criadoEm || ''),
        }));

        const mappedRescue = rescueList.map((e: any) => ({
          id: String(e.id),
          data: String(e.data || ''),
          closerId: String(e.closerId || ''),
          vendedorOrigem: String(e.vendedorOrigem || ''),
          leadsResgatados: parseInt(String(e.leadsResgatados || '0')) || 0,
          leadsConvertidos: parseInt(String(e.leadsConvertidos || '0')) || 0,
          criadoEm: String(e.criadoEm || ''),
        }));

        const mappedProducts: Product[] = productsList.map((p: any) => ({
          id: String(p.id),
          nome: String(p.nome || ''),
          capaUrl: String(p.capaUrl || ''),
          descricao: String(p.descricao || ''),
          preco: parseNumberLikeBR(p.preco),
          maxDescontoPercent:
            typeof p.maxDescontoPercent === 'number' ? p.maxDescontoPercent : parseNumberLikeBR(p.maxDescontoPercent),
          ativo: typeof p.ativo === 'boolean' ? p.ativo : true,
          criadoEm: String(p.criadoEm || ''),
        }));

        if (!isCancelled) {
          setCommercialEntries(mappedCommercial);
          setTrafficEntries(mappedTraffic);
          setRescueEntries(mappedRescue);
          setProducts(mappedProducts);
          saveCommercialEntries(mappedCommercial);
          saveTrafficEntries(mappedTraffic);
          saveRescueEntries(mappedRescue);
          saveProducts(mappedProducts);
        }
      } catch {
        // ignore
      }
    };

    load();
    return () => {
      isCancelled = true;
    };
  }, [isBackendEnabled, backend, commercialApiBase, trafficApiBase, rescueApiBase, token]);
  const nameHints = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of users) {
      if (u.id && u.nome) m.set(u.id, u.nome);
    }
    for (const t of traffic) {
      const id = String(t.vendedorId || '').trim();
      const nm = String(t.vendedorNome || '').trim();
      if (id && nm && !m.get(id)) m.set(id, nm);
    }
    for (const c of commercial) {
      const id = String(c.vendedorId || '').trim();
      const nm = String(c.vendedorNome || '').trim();
      if (id && nm && !m.get(id)) m.set(id, nm);
    }
    return m;
  }, [users, traffic, commercial]);

  function formatMonthBR(ym: string) {
    const v = String(ym || '').trim();
    if (!/^\d{4}-\d{2}$/.test(v)) return v || '—';
    const d = new Date(`${v}-01T00:00:00`);
    const txt = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(d);
    return txt.charAt(0).toUpperCase() + txt.slice(1);
  }
  const addMonths = (ym: string, delta: number) => {
    const d = new Date(`${ym}-01T00:00:00`);
    d.setMonth(d.getMonth() + delta);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  };
  const pickTextColorFromBg = (bg: string) => {
    const v = String(bg || '').trim().toLowerCase();
    if (v.startsWith('#')) {
      const hex = v.replace('#', '');
      const r = parseInt(hex.substring(0, 2), 16) || 0;
      const g = parseInt(hex.substring(2, 4), 16) || 0;
      const b = parseInt(hex.substring(4, 6), 16) || 0;
      const sr = r / 255;
      const sg = g / 255;
      const sb = b / 255;
      const cr = sr <= 0.03928 ? sr / 12.92 : Math.pow((sr + 0.055) / 1.055, 2.4);
      const cg = sg <= 0.03928 ? sg / 12.92 : Math.pow((sg + 0.055) / 1.055, 2.4);
      const cb = sb <= 0.03928 ? sb / 12.92 : Math.pow((sb + 0.055) / 1.055, 2.4);
      const lum = 0.2126 * cr + 0.7152 * cg + 0.0722 * cb;
      return lum > 0.6 ? '#111111' : '#ffffff';
    }
    if (v.startsWith('hsl(')) {
      const parts = v.replace('hsl(', '').replace(')', '').split(',');
      const lraw = parts[2] || '50%';
      const l = parseFloat(lraw) || 50;
      return l > 55 ? '#111111' : '#ffffff';
    }
    return 'var(--foreground)';
  };

  const computeRoas = (investimento: number, receita: number) => {
    if (investimento > 0) return receita / investimento;
    if (receita > 0) return receita / 100;
    return 0;
  };
  const labelFromClassificacao = (c: string) => (c === 'vermelho' ? 'alto' : c === 'amarelo' ? 'médio' : 'baixo');
  const parseHueFromHsl = (bg: string) => {
    const v = String(bg || '').trim().toLowerCase();
    if (!v.startsWith('hsl(')) return NaN;
    const parts = v.replace('hsl(', '').replace(')', '').split(',');
    const hraw = parts[0] || '0';
    const h = parseFloat(hraw);
    return isNaN(h) ? NaN : h;
  };
  const isBgRed = (bg: string) => {
    const h = parseHueFromHsl(bg);
    return !isNaN(h) && h <= 15;
  };
  const chipBgColor = (containerBg: string, label: string) => {
    if (label === 'alto') return '#b00020';
    if (label === 'médio') return 'hsl(var(--warning))';
    if (label === 'baixo' && isBgRed(containerBg)) return 'hsl(120, 60%, 30%)';
    return 'rgba(255,255,255,0.2)';
  };

  function parseISODateOnly(iso: string) {
    const d = new Date(`${String(iso || '').trim()}T00:00:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  function startOfMonthUTC(d: Date) {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0));
  }
  function startOfISOWeek(d: Date) {
    const out = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
    const day = out.getUTCDay() || 7;
    out.setUTCDate(out.getUTCDate() - (day - 1));
    out.setUTCHours(0, 0, 0, 0);
    return out;
  }
  function startOfQuarterUTC(d: Date) {
    const m = d.getUTCMonth();
    const q = Math.floor(m / 3) * 3;
    return new Date(Date.UTC(d.getUTCFullYear(), q, 1, 0, 0, 0, 0));
  }
  function addMonthsUTC(d: Date, months: number) {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, d.getUTCDate(), 0, 0, 0, 0));
  }
  function formatISODateOnly(d: Date) {
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }
  function formatDateBR(dateISO: string) {
    const v = String(dateISO || '').trim();
    if (!v) return '—';
    const d = new Date(`${v}T00:00:00`);
    if (Number.isNaN(d.getTime())) return v;
    return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
  }
  function formatMonthYearBR(dateISO: string) {
    const v = String(dateISO || '').trim();
    if (!v) return '—';
    const d = new Date(`${v}T00:00:00`);
    if (Number.isNaN(d.getTime())) return v.slice(0, 7);
    const txt = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(d);
    return txt.charAt(0).toUpperCase() + txt.slice(1);
  }

  const parseNumberLikeBR = (value: any) => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const raw = String(value ?? '').trim();
    if (!raw) return 0;
    const cleaned = raw.replace(/\s/g, '').replace(/R\$/gi, '');
    if (cleaned.includes(',') && /\d,\d{1,2}$/.test(cleaned)) {
      const n = parseFloat(cleaned.replace(/\./g, '').replace(',', '.'));
      return Number.isFinite(n) ? n : 0;
    }
    const n = parseFloat(cleaned.replace(/,/g, ''));
    return Number.isFinite(n) ? n : 0;
  };
  const [awardsPeriod] = useState<'weekly' | 'monthly' | 'quarterly'>('monthly');
  const [awardsRefDate, setAwardsRefDate] = useState(() => new Date().toISOString().slice(0, 7) + '-01');
  const [awardsSellerFilter, setAwardsSellerFilter] = useState<string>('all');
  const awardsRange = useMemo(() => {
    const ref = parseISODateOnly(awardsRefDate) || new Date();
    const start =
      awardsPeriod === 'weekly'
        ? startOfISOWeek(ref)
        : awardsPeriod === 'monthly'
          ? startOfMonthUTC(ref)
          : startOfQuarterUTC(ref);
    const end =
      awardsPeriod === 'weekly'
        ? new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + 7, 0, 0, 0, 0))
        : awardsPeriod === 'monthly'
          ? addMonthsUTC(start, 1)
          : addMonthsUTC(start, 3);
    const startISO = formatISODateOnly(start);
    const endISO = formatISODateOnly(end);
    const label =
      awardsPeriod === 'weekly'
        ? `Semana (${formatDateBR(startISO)} - ${formatDateBR(formatISODateOnly(new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate() - 1, 0, 0, 0, 0))))})`
        : awardsPeriod === 'monthly'
          ? `Mês (${formatMonthYearBR(startISO)})`
          : `Trimestre (${start.getUTCFullYear()} Q${Math.floor(start.getUTCMonth() / 3) + 1})`;
    return { startISO, endISO, label };
  }, [awardsPeriod, awardsRefDate]);
  const awardsSalesByVendedor = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of commercial) {
      if (e.data >= awardsRange.startISO && e.data < awardsRange.endISO) {
        const id = String(e.vendedorId || '').trim();
        if (!id) continue;
        map.set(id, (map.get(id) || 0) + (e.vendas || 0));
      }
    }
    return map;
  }, [commercial, awardsRange.startISO, awardsRange.endISO]);
  const awardsRows = useMemo(() => {
    const rules = awards.rules || [];
    const hasRules = rules.length > 0;
    const rows = vendedores
      .filter(v => awardsSellerFilter === 'all' || v.id === awardsSellerFilter)
      .map(v => {
        const vendas = awardsSalesByVendedor.get(v.id) || 0;
        const applicable = hasRules
          ? rules
              .filter(r => !r.vendedorId || String(r.vendedorId) === String(v.id))
              .slice()
              .sort((a, b) => (a.minVendas || 0) - (b.minVendas || 0))
          : [];
        const achieved = hasRules
          ? applicable
              .filter(r => vendas >= (r.minVendas || 0))
              .slice()
              .sort((a, b) => (b.minVendas || 0) - (a.minVendas || 0) || (b.pixValor || 0) - (a.pixValor || 0))[0] || null
          : null;
        const next = hasRules
          ? applicable
              .filter(r => vendas < (r.minVendas || 0))
              .slice()
              .sort((a, b) => (a.minVendas || 0) - (b.minVendas || 0) || (a.pixValor || 0) - (b.pixValor || 0))[0] || null
          : null;
        const basePix = achieved ? (achieved.pixValor || 0) : 0;
        const target = hasRules ? (next ? (next.minVendas || 0) : (achieved ? (achieved.minVendas || 0) : 0)) : 20;
        const targetPix = hasRules ? (next ? (next.pixValor || 0) : 0) : 0;
        return { vendedorId: v.id, nome: v.nome, vendas, pixValor: basePix, target, targetPix };
      })
      .sort((a, b) => b.pixValor - a.pixValor || b.vendas - a.vendas || a.nome.localeCompare(b.nome));
    const totalPix = rows.reduce((sum, r) => sum + r.pixValor, 0);
    return { rows, totalPix };
  }, [vendedores, awardsSellerFilter, awardsSalesByVendedor, awards.rules]);
  const insights = useMemo(() => {
    // Melhor produto por vendas (fallback quando não há ROI no tráfego)
    const productSales = new Map<string, number>();
    for (const e of commercial) {
      for (const l of e.vendasPorProduto || []) {
        const pid = String(l.produtoId || '').trim();
        if (!pid) continue;
        productSales.set(pid, (productSales.get(pid) || 0) + (l.quantidade || 0));
      }
    }
    const nameById = new Map(products.map(p => [String(p.id || '').trim(), String(p.nome || '').trim()]));
    const topProducts = Array.from(productSales.entries())
      .map(([produtoId, qtd]) => ({ produtoId, nome: nameById.get(produtoId) || produtoId, qtd }))
      .sort((a, b) => b.qtd - a.qtd)
      .slice(0, 5);
    const bestProduct = topProducts[0] || null;

    // Totais do mês
    const totalVendas = commercial.reduce((s, e) => s + (e.vendas || 0), 0);
    const totalReceitaTraffic = traffic.reduce((s, t) => s + (t.receita || 0), 0);
    const totalReceita = totalReceitaTraffic;
    const totalInvestimento = traffic.reduce((s, t) => s + t.investimento, 0);

    // Best seller
    const sellerStats = (() => {
      if (vendedores.length > 0) {
        return vendedores.map(v => {
          const entries = commercial.filter(c => c.vendedorId === v.id);
          const totalVendas = entries.reduce((s, e) => s + (e.vendas || 0), 0);
          const totalLeads = entries.reduce((s, e) => s + (e.leadsAtendidos || 0), 0);
          return { ...v, totalVendas, totalLeads, conversao: totalLeads > 0 ? (totalVendas / totalLeads * 100) : 0 };
        });
      }
      const byId = new Map<string, { nome: string; totalVendas: number; totalLeads: number; conversao: number }>();
      for (const e of commercial) {
        const id = String(e.vendedorId || '');
        if (!id) continue;
        const suggestedNome =
          nameHints.get(id) ||
          String(e.vendedorNome || '').trim() ||
          (e.criadoPor === id ? String(e.criadoPorNome || '').trim() : '') ||
          usersById.get(id) ||
          '';
        const cur = byId.get(id) || { nome: suggestedNome || id, totalVendas: 0, totalLeads: 0, conversao: 0 };
        if ((!cur.nome || cur.nome === id) && suggestedNome) {
          cur.nome = suggestedNome;
        }
        cur.totalVendas += e.vendas || 0;
        cur.totalLeads += e.leadsAtendidos || 0;
        byId.set(id, cur);
      }
      return Array.from(byId.entries()).map(([id, s]) => ({
        id,
        nome: s.nome,
        role: 'vendedor' as const,
        totalVendas: s.totalVendas,
        totalLeads: s.totalLeads,
        conversao: s.totalLeads > 0 ? (s.totalVendas / s.totalLeads * 100) : 0
      }));
    })();
    const bestSeller = sellerStats.slice().sort((a, b) => b.totalVendas - a.totalVendas)[0] || null;

    // Fica mantido topProducts acima

    // Abandonment
    const abandonStats = vendedores.map(v => {
      const resgatados = rescue.filter(r => r.vendedorOrigem === v.id).reduce((s, r) => s + r.leadsResgatados, 0);
      let classificacao: 'verde' | 'amarelo' | 'vermelho' = 'verde';
      if (resgatados >= thresholds.vermelho) classificacao = 'vermelho';
      else if (resgatados >= thresholds.amarelo) classificacao = 'amarelo';
      return { vendedorId: v.id, vendedorNome: v.nome, totalResgatados: resgatados, classificacao };
    });
    const problemSellers = abandonStats.filter(a => a.classificacao === 'vermelho');
    const rescueByOrigin = new Map<string, number>();
    for (const r of rescue) {
      const origin = String(r.vendedorOrigem || '');
      if (!origin) continue;
      rescueByOrigin.set(origin, (rescueByOrigin.get(origin) || 0) + (r.leadsResgatados || 0));
    }
    const rescueRanking = Array.from(rescueByOrigin.entries())
      .map(([vendedorId, resgatados]) => ({
        vendedorId,
        nome: usersById.get(vendedorId) || vendedorId,
        resgatados
      }))
      .sort((a, b) => b.resgatados - a.resgatados);

    return { bestProduct, totalVendas, totalReceita, totalInvestimento, bestSeller, sellerStats, topProducts, abandonStats, problemSellers, rescueRanking };
  }, [traffic, commercial, rescue, vendedores, thresholds, month, products, usersById]);

  const campaignCommercial = useMemo(() => {
    return commercialEntries.filter((entry) => {
      const d = String(entry.data || '').slice(0, 10);
      return d && d >= campaignRange.startISO && d < campaignRange.endISO;
    });
  }, [commercialEntries, campaignRange.startISO, campaignRange.endISO]);

  const campaignRows = useMemo(() => {
    const grouped = new Map<string, { nome: string; vendas: number; faturamento: number }>();
    const productsById = new Map(products.map((product) => [String(product.id || ''), product]));

    for (const entry of campaignCommercial) {
      const lines = Array.isArray(entry.vendasPorProduto) ? entry.vendasPorProduto : [];

      if (campaignBase === 'campanha') {
        const key =
          entry.campaignScope === 'campanha'
            ? String(entry.campaignName || '').trim() || 'Campanha sem nome'
            : 'Geral';
        const current = grouped.get(key) || { nome: key, vendas: 0, faturamento: 0 };
        current.vendas += Math.max(0, Number(entry.vendas || 0));
        if (typeof entry.valorLiquido === 'number' && Number.isFinite(entry.valorLiquido)) {
          current.faturamento += entry.valorLiquido;
        } else if (typeof entry.valorBruto === 'number' && Number.isFinite(entry.valorBruto)) {
          current.faturamento += entry.valorBruto;
        } else {
          const fallback = lines.reduce((sum, line) => {
            const quantity = Math.max(0, Number(line.quantidade || 0));
            const unitPrice =
              Number(line.precoUnitario || 0) > 0
                ? Number(line.precoUnitario || 0)
                : Math.max(0, Number(productsById.get(String(line.produtoId || ''))?.preco || 0));
            return sum + quantity * unitPrice;
          }, 0);
          current.faturamento += fallback;
        }
        grouped.set(key, current);
        continue;
      }

      if (lines.length === 0) {
        const key = 'Sem produto';
        const current = grouped.get(key) || { nome: key, vendas: 0, faturamento: 0 };
        current.vendas += Math.max(0, Number(entry.vendas || 0));
        current.faturamento += Math.max(0, Number(entry.valorLiquido || entry.valorBruto || 0));
        grouped.set(key, current);
        continue;
      }

      for (const line of lines) {
        const key = String(productsById.get(String(line.produtoId || ''))?.nome || line.produtoId || 'Produto sem nome');
        const current = grouped.get(key) || { nome: key, vendas: 0, faturamento: 0 };
        const quantity = Math.max(0, Number(line.quantidade || 0));
        const unitPrice =
          Number(line.precoUnitario || 0) > 0
            ? Number(line.precoUnitario || 0)
            : Math.max(0, Number(productsById.get(String(line.produtoId || ''))?.preco || 0));
        current.vendas += quantity;
        current.faturamento += quantity * unitPrice;
        grouped.set(key, current);
      }
    }

    const start = parseISODateOnly(campaignRange.startISO) || new Date();
    const end = parseISODateOnly(campaignRange.endISO) || new Date();
    const dayMs = 24 * 60 * 60 * 1000;
    const totalDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / dayMs));

    // Use the last entry date in the period as elapsed base so projection
    // always extrapolates the current pace to the full period.
    let lastEntryDate: Date | null = null;
    for (const entry of campaignCommercial) {
      const d = parseISODateOnly(String(entry.data || '').slice(0, 10));
      if (!d) continue;
      if (!lastEntryDate || d > lastEntryDate) lastEntryDate = d;
    }
    const elapsedRef = lastEntryDate && lastEntryDate < end ? lastEntryDate : new Date(end.getTime() - dayMs);
    const elapsedDays = Math.max(1, Math.round((elapsedRef.getTime() - start.getTime()) / dayMs) + 1);

    return Array.from(grouped.values())
      .map((row) => ({
        ...row,
        projecao: elapsedDays > 0 ? (row.faturamento / elapsedDays) * totalDays : row.faturamento,
      }))
      .sort((a, b) => b.faturamento - a.faturamento || b.vendas - a.vendas || a.nome.localeCompare(b.nome));
  }, [campaignCommercial, campaignBase, campaignRange.startISO, campaignRange.endISO, products]);

  const filteredCampaignRows = useMemo(() => {
    if (selectedCampaign === 'all') return campaignRows;

    // First try: campaign-name match (for entries tagged with campaignScope='campanha')
    const byName = campaignRows.filter((row) => row.nome === selectedCampaign);
    if (byName.length > 0) return byName;

    // Fallback: match commercial entries by product name from vendasPorProduto
    const normalizeKey = (v: string) =>
      String(v || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .replace(/\s+/g, ' ')
        .toLowerCase();
    const selectedKey = normalizeKey(selectedCampaign);
    const productsById = new Map(products.map((p) => [String(p.id || ''), p]));

    let vendas = 0;
    let faturamento = 0;
    for (const entry of campaignCommercial) {
      const lines = Array.isArray(entry.vendasPorProduto) ? entry.vendasPorProduto : [];
      for (const line of lines) {
        const nome = String(productsById.get(String(line.produtoId || ''))?.nome || '').trim();
        if (normalizeKey(nome) !== selectedKey) continue;
        const qty = Math.max(0, Number(line.quantidade || 0));
        const price =
          Number(line.precoUnitario || 0) > 0
            ? Number(line.precoUnitario || 0)
            : Math.max(0, Number(productsById.get(String(line.produtoId || ''))?.preco || 0));
        vendas += qty;
        faturamento += qty * price;
      }
    }

    if (vendas === 0 && faturamento === 0) return [];

    const start = parseISODateOnly(campaignRange.startISO) || new Date();
    const end = parseISODateOnly(campaignRange.endISO) || new Date();
    const dayMs = 24 * 60 * 60 * 1000;
    const totalDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / dayMs));

    // Use last entry date as elapsed reference
    let lastEntryDate2: Date | null = null;
    for (const entry of campaignCommercial) {
      const d = parseISODateOnly(String(entry.data || '').slice(0, 10));
      if (!d) continue;
      if (!lastEntryDate2 || d > lastEntryDate2) lastEntryDate2 = d;
    }
    const elapsedRef2 = lastEntryDate2 && lastEntryDate2 < end ? lastEntryDate2 : new Date(end.getTime() - dayMs);
    const elapsedDays2 = Math.max(1, Math.round((elapsedRef2.getTime() - start.getTime()) / dayMs) + 1);
    const projecao = elapsedDays2 > 0 ? (faturamento / elapsedDays2) * totalDays : faturamento;

    return [{ nome: selectedCampaign, vendas, faturamento, projecao }];
  }, [campaignRows, selectedCampaign, campaignCommercial, products, campaignRange.startISO, campaignRange.endISO]);

  useEffect(() => {
    setSelectedCampaign('all');
  }, [campaignBase]);

  // All options for the selector: names from commercial rows PLUS product names from traffic entries in the period
  const campaignSelectorOptions = useMemo(() => {
    const set = new Set<string>();
    for (const row of campaignRows) set.add(row.nome);
    for (const e of trafficEntries) {
      const semana = String(e.semana || '').slice(0, 10);
      const fim = String((e as any).fim || semana).slice(0, 10);
      if (!semana || !fim) continue;
      if (semana >= campaignRange.endISO || fim < campaignRange.startISO) continue;
      const nome = String(e.produto || '').trim();
      if (nome) set.add(nome);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [campaignRows, trafficEntries, campaignRange.startISO, campaignRange.endISO]);

  const overviewTrafficSummary = useMemo(() => {
    const periodStart = overviewRange.startISO;
    const periodEnd = overviewRange.endISO;
    let investimento = 0;
    let leads = 0;
    let vendas = 0;
    let receita = 0;
    for (const e of trafficEntries) {
      const semana = String(e.semana || '').slice(0, 10);
      const fim = String((e as any).fim || semana).slice(0, 10);
      if (!semana || !fim) continue;
      if (semana >= periodEnd || fim < periodStart) continue;
      investimento += typeof e.investimento === 'number' ? e.investimento : 0;
      leads += typeof e.leads === 'number' ? e.leads : 0;
      vendas += typeof e.vendas === 'number' ? e.vendas : 0;
      receita += typeof e.receita === 'number' ? e.receita : 0;
    }
    const roas = investimento > 0 ? receita / investimento : receita > 0 ? receita / 100 : 0;
    const cpl = leads > 0 ? investimento / leads : 0;
    const conversao = leads > 0 ? (vendas / leads) * 100 : 0;
    return { investimento, leads, vendas, receita, roas, cpl, conversao };
  }, [trafficEntries, overviewRange.startISO, overviewRange.endISO]);

  const campaignTrafficSummary = useMemo(() => {
    const normalizeKey = (v: string) =>
      String(v || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .replace(/\s+/g, ' ')
        .toLowerCase();
    const periodStart = campaignRange.startISO;
    const periodEnd = campaignRange.endISO; // exclusive
    const filterKey = selectedCampaign !== 'all' ? normalizeKey(selectedCampaign) : null;

    let investimento = 0;
    let leads = 0;
    let vendas = 0;
    let receita = 0;
    for (const e of trafficEntries) {
      const semana = String(e.semana || '').slice(0, 10);
      const fim = String((e as any).fim || semana).slice(0, 10);
      if (!semana || !fim) continue;
      // overlap: semana <= periodEnd(exclusive) AND fim >= periodStart
      if (semana >= periodEnd || fim < periodStart) continue;
      if (filterKey && normalizeKey(String(e.produto || '')) !== filterKey) continue;
      investimento += typeof e.investimento === 'number' ? e.investimento : 0;
      leads += typeof e.leads === 'number' ? e.leads : 0;
      vendas += typeof e.vendas === 'number' ? e.vendas : 0;
      receita += typeof e.receita === 'number' ? e.receita : 0;
    }
    const roas = investimento > 0 ? receita / investimento : receita > 0 ? receita / 100 : 0;
    const cpl = leads > 0 ? investimento / leads : 0;
    const conversao = leads > 0 ? (vendas / leads) * 100 : 0;
    return { investimento, leads, vendas, receita, roas, cpl, conversao };
  }, [trafficEntries, campaignRange.startISO, campaignRange.endISO, selectedCampaign]);

  const campaignTotals = useMemo(() => {
    return filteredCampaignRows.reduce(
      (acc, row) => {
        acc.vendas += row.vendas;
        acc.faturamento += row.faturamento;
        acc.projecao += row.projecao;
        return acc;
      },
      { vendas: 0, faturamento: 0, projecao: 0 },
    );
  }, [filteredCampaignRows]);

  // Chart data: vendas por vendedor
  const chartData = insights.sellerStats.map(s => ({
    nome: s.nome.split(' ')[0],
    vendas: s.totalVendas,
    conversao: Math.round(s.conversao),
  }));
  const sellerRanking = insights.sellerStats.slice().sort((a, b) => {
    const conv = b.conversao - a.conversao;
    if (conv !== 0) return conv;
    return b.totalVendas - a.totalVendas;
  });
  const abandonoRanking = insights.abandonStats.slice().sort((a, b) => b.totalResgatados - a.totalResgatados);
  const medalColor = (rank: number) =>
    rank === 1 ? '#FFD700' : rank === 2 ? '#C0C0C0' : rank === 3 ? '#CD7F32' : 'transparent';
  const computeRanks = (items: Array<{ conversao: number; totalVendas: number }>) => {
    const keys = Array.from(
      new Set(
        items.map((x) => `${Math.round(x.conversao * 1000) / 1000}`),
      ),
    )
      .map((k) => parseFloat(k))
      .sort((a, b) => b - a);
    const rankByKey = new Map<number, number>();
    keys.forEach((k, idx) => rankByKey.set(k, idx + 1));
    return items.map((x) => {
      const key = Math.round(x.conversao * 1000) / 1000;
      const r = rankByKey.get(key) || 999;
      return r;
    });
  };
  const sellerRanks = computeRanks(sellerRanking);
  const worstColor = (index: number, total: number) => {
    const t = total <= 1 ? 0 : index / (total - 1);
    const hue = 0 + (120 - 0) * t;
    const light = 25 + (48 - 25) * t;
    const sat = 85;
    return `hsl(${hue}, ${sat}%, ${light}%)`;
  };

  const projection = useMemo(() => {
    const ym = String(month || '').trim().slice(0, 7);
    const startISO = /^\d{4}-\d{2}$/.test(ym) ? `${ym}-01` : new Date().toISOString().slice(0, 10);
    const endISO = /^\d{4}-\d{2}$/.test(ym) ? `${addMonths(ym, 1)}-01` : startISO;
    const monthEntries = commercialEntries.filter((e) => {
      const d = String((e as any).data || '').slice(0, 10);
      return d && d >= startISO && d < endISO;
    });

    let monthDays = 30;
    if (/^\d{4}-\d{2}$/.test(ym)) {
      const year = parseInt(ym.slice(0, 4), 10) || new Date().getUTCFullYear();
      const monthIndex = (parseInt(ym.slice(5, 7), 10) || 1) - 1;
      monthDays = new Date(Date.UTC(year, monthIndex + 1, 0, 0, 0, 0, 0)).getUTCDate();
    }

    const targetDays =
      projectionDaysMode === 'month' ? monthDays : Math.max(1, parseInt(String(projectionDaysMode || '26'), 10) || 26);

    const now = new Date();
    const currentYm = now.toISOString().slice(0, 7);
    let sellingDaysSoFar = 0;
    if (/^\d{4}-\d{2}$/.test(ym) && ym < currentYm) {
      sellingDaysSoFar = targetDays;
    } else if (/^\d{4}-\d{2}$/.test(ym) && ym === currentYm) {
      sellingDaysSoFar = Math.min(targetDays, now.getUTCDate());
    } else {
      let maxDay = 0;
      for (const e of monthEntries) {
        const d = String((e as any).data || '').slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
        const day = parseInt(d.slice(8, 10), 10) || 0;
        if (day > maxDay) maxDay = day;
      }
      sellingDaysSoFar = Math.min(targetDays, Math.max(0, maxDay));
    }

    const minPriceFloor = 1;
    const productNameById = new Map(products.map((p) => [String(p.id || '').trim(), String(p.nome || '').trim()]));
    const pricedProducts = products.filter(
      (p) => p.ativo !== false && Number.isFinite(p.preco) && (p.preco || 0) > minPriceFloor,
    );
    const cheapestCatalog =
      pricedProducts.length > 0 ? pricedProducts.reduce((a, b) => ((a.preco || 0) < (b.preco || 0) ? a : b)) : null;

    let cheapestSoldPrice = 0;
    let cheapestSoldProductId = '';
    for (const e of monthEntries) {
      const lines = Array.isArray((e as any).vendasPorProduto) ? (e as any).vendasPorProduto : [];
      for (const l of lines) {
        const price = parseNumberLikeBR(l?.precoUnitario);
        if (price <= minPriceFloor) continue;
        if (cheapestSoldPrice === 0 || price < cheapestSoldPrice) {
          cheapestSoldPrice = price;
          cheapestSoldProductId = String(l?.produtoId || '').trim();
        }
      }
    }

    let cheapestPrice = cheapestCatalog?.preco || 0;
    let cheapestProductNome = cheapestCatalog?.nome || '';
    if (!cheapestPrice && cheapestSoldPrice > 0) {
      cheapestPrice = cheapestSoldPrice;
      cheapestProductNome = productNameById.get(cheapestSoldProductId) || cheapestSoldProductId;
    }

    const sellerById = new Map<string, { id: string; nome: string; comissaoPercent: number }>();
    for (const u of users) {
      if (u.role !== 'vendedor') continue;
      const id = String(u.id || '').trim();
      if (!id) continue;
      sellerById.set(id, { id, nome: String(u.nome || '').trim() || id, comissaoPercent: Number(u.comissaoPercent || 0) });
    }
    for (const e of monthEntries) {
      const id = String((e as any).vendedorId || '').trim();
      if (!id || sellerById.has(id)) continue;
      const nome = String((e as any).vendedorNome || '').trim() || usersById.get(id) || id;
      sellerById.set(id, { id, nome, comissaoPercent: 0 });
    }

    const vendasBySeller = new Map<string, number>();
    for (const e of monthEntries) {
      const id = String((e as any).vendedorId || '').trim();
      if (!id) continue;
      const vendas = typeof (e as any).vendas === 'number' ? (e as any).vendas : parseInt(String((e as any).vendas || '0'), 10) || 0;
      vendasBySeller.set(id, (vendasBySeller.get(id) || 0) + Math.max(0, vendas));
    }

    const rules = Array.isArray(awards.rules) ? awards.rules : [];
    const rows = Array.from(sellerById.values())
      .map((s) => {
        const vendasSoFar = vendasBySeller.get(s.id) || 0;
        const mediaDia = sellingDaysSoFar > 0 ? vendasSoFar / sellingDaysSoFar : 0;
        const projVendas = Math.round(mediaDia * targetDays);
        const projFaturamento = projVendas * cheapestPrice;
        const projComissao = projFaturamento * (Math.min(100, Math.max(0, Number(s.comissaoPercent || 0))) / 100);

        const applicable = rules
          .filter((r: any) => !r?.vendedorId || String(r.vendedorId) === String(s.id))
          .slice()
          .sort((a: any, b: any) => (b.minVendas || 0) - (a.minVendas || 0) || (b.pixValor || 0) - (a.pixValor || 0));
        const achieved = applicable.find((r: any) => projVendas >= (r.minVendas || 0)) || null;
        const projBonus = achieved ? Number(achieved.pixValor || 0) : 0;

        return {
          vendedorId: s.id,
          vendedorNome: s.nome,
          vendasSoFar,
          mediaDia,
          projVendas,
          projFaturamento,
          projComissao,
          projBonus,
        };
      })
      .sort((a, b) => b.projVendas - a.projVendas || a.vendedorNome.localeCompare(b.vendedorNome));

    const totals = rows.reduce(
      (acc, r) => {
        acc.vendasSoFar += r.vendasSoFar;
        acc.projVendas += r.projVendas;
        acc.projFaturamento += r.projFaturamento;
        acc.projComissao += r.projComissao;
        acc.projBonus += r.projBonus;
        return acc;
      },
      { vendasSoFar: 0, projVendas: 0, projFaturamento: 0, projComissao: 0, projBonus: 0 },
    );

    return { ym, targetDays, sellingDaysSoFar, cheapestProductNome, cheapestPrice, rows, totals };
  }, [awards.rules, commercialEntries, month, products, projectionDaysMode, users, usersById, addMonths]);

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">Painel consolidado</p>
        <h1 className="mt-1 text-[1.625rem] leading-tight font-semibold tracking-tight">Visão Geral</h1>
      </div>
      <Tabs defaultValue="visao" className="space-y-6">
        <TabsList>
          <TabsTrigger value="visao">Visão Geral</TabsTrigger>
          <TabsTrigger value="projecao">Projeção</TabsTrigger>
          <TabsTrigger value="campanha">Por Campanha</TabsTrigger>
        </TabsList>

        <TabsContent value="visao" className="space-y-6">
      <div className="flex items-center gap-2">
        <Card className="max-w-full">
          <CardContent className="p-3 flex items-center gap-3">
            <div className="space-y-1.5">
              <p className="eyebrow">Período</p>
              <div className="flex flex-wrap items-center gap-2">
                <Select value={overviewPeriod} onValueChange={(v) => setOverviewPeriod(v as any)}>
                  <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hoje">Diário</SelectItem>
                    <SelectItem value="semana">Semanal</SelectItem>
                    <SelectItem value="mes">Mensal</SelectItem>
                    <SelectItem value="personalizado">Personalizado</SelectItem>
                  </SelectContent>
                </Select>
                {overviewPeriod === 'personalizado' ? (
                  <>
                    <Input type="date" value={overviewCustomStart} onChange={(e) => setOverviewCustomStart(e.target.value)} className="w-36" />
                    <Input type="date" value={overviewCustomEnd} onChange={(e) => setOverviewCustomEnd(e.target.value)} className="w-36" />
                  </>
                ) : overviewPeriod === 'mes' ? (
                  (() => {
                    const selectedYear = String(overviewRefDate || '').slice(0, 4) || String(new Date().getFullYear());
                    const selectedMonth = String(overviewRefDate || '').slice(5, 7) || String(new Date().getMonth() + 1).padStart(2, '0');
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
                      <div className="flex items-center gap-2">
                        <Select value={selectedMonth} onValueChange={(m) => setOverviewRefDate(`${selectedYear}-${m}-01`)}>
                          <SelectTrigger className="w-44"><SelectValue placeholder="Mês" /></SelectTrigger>
                          <SelectContent>
                            {months.map((m) => (
                              <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Select value={selectedYear} onValueChange={(y) => setOverviewRefDate(`${y}-${selectedMonth}-01`)}>
                          <SelectTrigger className="w-28"><SelectValue placeholder="Ano" /></SelectTrigger>
                          <SelectContent>
                            {years.map((y) => (
                              <SelectItem key={y} value={y}>{y}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    );
                  })()
                ) : (
                  <Input type="date" value={overviewRefDate} onChange={(e) => setOverviewRefDate(e.target.value)} className="w-36" />
                )}
                <span className="text-sm font-medium">{overviewRange.label}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* KPI Cards: um número dominante (receita) + apoio; ritmo 2·1·1 / 2·2 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          featured
          large
          className="sm:col-span-2"
          label="Receita (mês)"
          icon={TrendingUp}
          value={<>R$ {insights.totalReceita.toLocaleString('pt-BR')}</>}
          hint={insights.totalInvestimento > 0 ? `Retorno ${(insights.totalReceita / insights.totalInvestimento).toFixed(2)}×` : undefined}
        />
        <MetricCard label="Investimento (tráfego)" icon={Target} tone="info" value={<>R$ {insights.totalInvestimento.toLocaleString('pt-BR')}</>} />
        <MetricCard label="Vendas" icon={ShoppingCart} tone="primary" value={insights.totalVendas} />
        <MetricCard
          className="sm:col-span-2"
          label="Melhor Produto"
          icon={Zap}
          tone="success"
          text
          value={insights.bestProduct?.nome || '—'}
          hint={insights.bestProduct ? `${insights.bestProduct.qtd} vendas` : '—'}
        />
        <MetricCard
          className="sm:col-span-2"
          label="Top Vendedor"
          icon={Users}
          tone="warning"
          text
          value={
            <span className="flex items-center gap-2 min-w-0">
              {insights.bestSeller?.id ? (
                <Avatar className="w-6 h-6 border border-border">
                  <AvatarImage src={resolveAvatarSrc(userAvatarById.get(insights.bestSeller.id) || '')} alt={insights.bestSeller.nome} />
                  <AvatarFallback>{(insights.bestSeller.nome || '—').charAt(0).toUpperCase()}</AvatarFallback>
                </Avatar>
              ) : null}
              <span className="truncate">{insights.bestSeller?.nome || '—'}</span>
            </span>
          }
          hint={insights.bestSeller ? `${insights.bestSeller.totalVendas} vendas` : '—'}
        />
      </div>

      {/* Tráfego */}
      {(overviewTrafficSummary.investimento > 0 || overviewTrafficSummary.leads > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tráfego ({overviewRange.label})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <div className="p-3 rounded-md border border-border bg-muted/20">
                <p className="eyebrow">Investimento</p>
                <p className="text-lg font-semibold mt-1 tabular-nums">
                  R$ {overviewTrafficSummary.investimento.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              </div>
              <div className="p-3 rounded-md border border-border bg-muted/20">
                <p className="eyebrow">Receita (tráfego)</p>
                <p className="text-lg font-semibold mt-1 tabular-nums">
                  R$ {overviewTrafficSummary.receita.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              </div>
              <div className="p-3 rounded-md border border-border bg-muted/20">
                <p className="eyebrow">ROAS</p>
                <p className={`text-lg font-semibold mt-1 tabular-nums ${
                  overviewTrafficSummary.roas >= 3 ? 'text-success' : overviewTrafficSummary.roas > 0 ? 'text-warning' : ''
                }`}>
                  {overviewTrafficSummary.roas.toFixed(2)}
                </p>
              </div>
              <div className="p-3 rounded-md border border-border bg-muted/20">
                <p className="eyebrow">Leads</p>
                <p className="text-lg font-semibold mt-1 tabular-nums">{overviewTrafficSummary.leads}</p>
              </div>
              <div className="p-3 rounded-md border border-border bg-muted/20">
                <p className="eyebrow">CPL</p>
                <p className="text-lg font-semibold mt-1 tabular-nums">
                  R$ {overviewTrafficSummary.cpl.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              </div>
              <div className="p-3 rounded-md border border-border bg-muted/20">
                <p className="eyebrow">Conversão</p>
                <p className="text-lg font-semibold mt-1 tabular-nums">{overviewTrafficSummary.conversao.toFixed(1)}%</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Ranking de Vendedores */}
      {chartData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Vendas por Vendedor ({overviewRange.label})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} barCategoryGap="28%">
                  <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="nome" tickLine={false} axisLine={false} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} />
                  <YAxis tickLine={false} axisLine={false} width={32} allowDecimals={false} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} />
                  <Tooltip
                    cursor={{ fill: 'hsl(var(--muted) / 0.6)' }}
                    contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12, boxShadow: 'var(--shadow-raised)' }}
                    labelStyle={{ color: 'hsl(var(--foreground))', fontWeight: 600 }}
                  />
                  <Bar dataKey="vendas" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} maxBarSize={44} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

  

      {/* Alerts */}
      {insights.problemSellers.length > 0 && (
        <Card className="border-destructive/30 bg-destructive/5 shadow-none">
          <CardContent className="p-5">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-destructive mt-0.5" />
              <div>
                <p className="font-semibold text-destructive">Alto Abandono Detectado</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {insights.problemSellers.map(s => s.vendedorNome).join(', ')} — muitos leads resgatados indicam falha no atendimento.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tráfego: oportunidades e alertas */}
      {traffic.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {traffic.filter(t => t.leads > 100).map(t => (
            <Card key={t.id} className="border-warning/30 bg-warning/5">
              <CardContent className="p-4">
                <p className="flex items-center gap-1.5 text-sm font-medium text-warning"><AlertTriangle className="h-4 w-4" />{t.produto}</p>
                <p className="text-xs text-muted-foreground mt-1">Muitos leads ({t.leads}) — verificar qualificação e funil</p>
              </CardContent>
            </Card>
          ))}
          {traffic.filter(t => t.roas >= 3).map(t => (
            <Card key={t.id} className="border-success/30 bg-success/5">
              <CardContent className="p-4">
                <p className="flex items-center gap-1.5 text-sm font-medium text-success"><Rocket className="h-4 w-4" />{t.produto}</p>
                <p className="text-xs text-muted-foreground mt-1">ROAS de {t.roas.toFixed(2)} → pronto para escalar</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Ranking completo de vendedores por conversão */}
      {sellerRanking.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Ranking de Vendedores (conversão)</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-0.5">
              {sellerRanking.map((s, idx) => {
                const rank = sellerRanks[idx];
                const bg = medalColor(rank);
                const txt = pickTextColorFromBg(bg);
                const target = sellerProgressTargetById.get(String(s.id)) || 0;
                const progress = target > 0 ? Math.max(0, Math.min(100, (s.totalVendas / target) * 100)) : 0;
                return (
                <div
                  key={s.id}
                  className="grid grid-cols-12 items-center gap-3 rounded-lg px-3 py-2.5 transition-colors duration-150 hover:bg-muted/50"
                >
                  <div className="col-span-5 flex items-center gap-3 min-w-0">
                    <span
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums"
                      style={bg !== 'transparent' ? { backgroundColor: bg, color: txt } : undefined}
                    >
                      {rank}
                    </span>
                    <Avatar className="w-7 h-7 border border-border">
                      <AvatarImage src={resolveAvatarSrc(userAvatarById.get(s.id) || '')} alt={s.nome} />
                      <AvatarFallback>{(s.nome || '—').charAt(0).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <span className="truncate text-sm font-medium">{s.nome}</span>
                  </div>
                  <div className="col-span-3">
                    <Progress value={progress} className="h-1.5" />
                  </div>
                  <span className="col-span-1 text-right text-sm tabular-nums">{s.totalVendas}<span className="eyebrow ml-1 hidden xl:inline">vend.</span></span>
                  <span className="col-span-1 text-right text-sm tabular-nums text-muted-foreground">{s.totalLeads}<span className="eyebrow ml-1 hidden xl:inline">leads</span></span>
                  <span className="col-span-2 text-right text-sm font-semibold tabular-nums">{s.conversao.toFixed(0)}%</span>
                </div>
              )})}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Bonificações (histórico e filtro) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Bonificações (PIX) • {awardsRange.label}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 mb-3">
            <div className="flex items-center gap-2">
              <Input
                type="month"
                value={awardsRefDate.slice(0, 7)}
                onChange={(e) => setAwardsRefDate(`${e.target.value}-01`)}
                className="w-40"
              />
              <span className="text-sm font-medium">{formatMonthYearBR(awardsRefDate)}</span>
            </div>
            <Select value={awardsSellerFilter} onValueChange={(v) => setAwardsSellerFilter(v)}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os vendedores</SelectItem>
                {vendedores.map(v => (
                  <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="ml-auto text-sm">
              Total de PIX: <span className="font-semibold tabular-nums">R$ {awardsRows.totalPix.toLocaleString('pt-BR')}</span>
            </div>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Vendedor</TableHead>
                <TableHead className="text-right">Vendas no período</TableHead>
                <TableHead className="text-right">Progresso</TableHead>
                <TableHead className="text-right">PIX (R$)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {awardsRows.rows.map((r) => {
                const progress = r.target > 0 ? Math.max(0, Math.min(100, (r.vendas / r.target) * 100)) : 0;
                return (
                  <TableRow key={r.vendedorId}>
                    <TableCell className="font-medium">{r.nome}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.vendas}</TableCell>
                    <TableCell className="text-right">
                      <div className="w-40 ml-auto"><Progress value={progress} /></div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.pixValor > 0
                        ? `R$ ${r.pixValor.toLocaleString('pt-BR')}`
                        : r.targetPix > 0
                          ? `Ao atingir ${r.target}: R$ ${r.targetPix.toLocaleString('pt-BR')}`
                          : '—'}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
      {/* Ranking de Abandono (pior no topo) */}
      {abandonoRanking.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Ranking de Abandono (pior no topo)</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-0.5">
              {abandonoRanking.map((a, idx) => {
                const label = labelFromClassificacao(a.classificacao);
                const tone =
                  label === 'alto'
                    ? 'bg-destructive/10 text-destructive'
                    : label === 'médio'
                      ? 'bg-warning/10 text-warning'
                      : 'bg-success/10 text-success';
                return (
                  <div
                    key={a.vendedorId}
                    className="flex items-center justify-between rounded-lg px-3 py-2.5 transition-colors duration-150 hover:bg-muted/50"
                  >
                    <span className="text-sm font-medium"><span className="mr-2 tabular-nums text-muted-foreground">{idx + 1}</span>{a.vendedorNome}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-semibold tabular-nums">{a.totalResgatados}</span>
                      <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium capitalize', tone)}>{label}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Ranking de Resgates (pior no topo) */}
      {insights.rescueRanking.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Ranking de Resgates (pior no topo)</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-0.5">
              {insights.rescueRanking.map((r, idx) => (
                <div key={r.vendedorId} className="flex items-center justify-between rounded-lg px-3 py-2.5 transition-colors duration-150 hover:bg-muted/50">
                  <span className="text-sm font-medium"><span className="mr-2 tabular-nums text-muted-foreground">{idx + 1}</span>{r.nome}</span>
                  <span className="text-sm font-semibold tabular-nums">{r.resgatados}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      </div>

      {traffic.length === 0 && commercial.length === 0 && (
        <Card>
          <CardContent className="p-12 text-center">
            <BarChart className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
            <p className="text-muted-foreground font-medium">Sem dados ainda</p>
            <p className="text-sm text-muted-foreground mt-1">Os módulos de tráfego e comercial precisam ser preenchidos para gerar insights.</p>
          </CardContent>
        </Card>
      )}
        </TabsContent>

        <TabsContent value="projecao" className="space-y-6">
          <div className="flex items-center gap-2">
            <Card>
              <CardContent className="p-3 flex items-center gap-3">
                <div className="space-y-1.5">
                  <p className="text-xs text-muted-foreground">Mês</p>
                  {(() => {
                    const selectedYear = String(month || '').slice(0, 4) || String(new Date().getFullYear());
                    const selectedMonth = String(month || '').slice(5, 7) || String(new Date().getMonth() + 1).padStart(2, '0');
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
                      <div className="flex items-center gap-2">
                        <Select value={selectedMonth} onValueChange={(m) => setMonth(`${selectedYear}-${m}`)}>
                          <SelectTrigger className="w-44"><SelectValue placeholder="Mês" /></SelectTrigger>
                          <SelectContent>
                            {months.map((m) => (
                              <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Select value={selectedYear} onValueChange={(y) => setMonth(`${y}-${selectedMonth}`)}>
                          <SelectTrigger className="w-28"><SelectValue placeholder="Ano" /></SelectTrigger>
                          <SelectContent>
                            {years.map((y) => (
                              <SelectItem key={y} value={y}>{y}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Select value={projectionDaysMode} onValueChange={(v) => setProjectionDaysMode(v as any)}>
                          <SelectTrigger className="w-44"><SelectValue placeholder="Dias úteis" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="10">10 dias</SelectItem>
                            <SelectItem value="20">20 dias</SelectItem>
                            <SelectItem value="26">26 dias</SelectItem>
                            <SelectItem value="month">Mês inteiro</SelectItem>
                          </SelectContent>
                        </Select>
                        <span className="text-sm font-medium">Base: {projection.sellingDaysSoFar} dias (de {projection.targetDays})</span>
                      </div>
                    );
                  })()}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard featured label="Projeção (vendas)" value={projection.totals.projVendas} hint={`Vendas até agora: ${projection.totals.vendasSoFar}`} />
            <MetricCard label="Projeção (faturamento)" tone="info" value={<>R$ {projection.totals.projFaturamento.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</>} hint={`Base: ${projection.cheapestProductNome ? `${projection.cheapestProductNome} • ` : ''}R$ ${projection.cheapestPrice.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} />
            <MetricCard label="Projeção (comissão)" tone="success" value={<>R$ {projection.totals.projComissao.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</>} />
            <MetricCard label="Projeção (bonificação)" tone="warning" value={<>R$ {projection.totals.projBonus.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</>} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Projeção por Vendedor</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table className="min-w-[980px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Vendedor</TableHead>
                      <TableHead className="text-right">Vendas (até agora)</TableHead>
                      <TableHead className="text-right">Média/dia</TableHead>
                      <TableHead className="text-right">Projeção (vendas)</TableHead>
                      <TableHead className="text-right">Projeção (faturamento)</TableHead>
                      <TableHead className="text-right">Projeção (comissão)</TableHead>
                      <TableHead className="text-right">Projeção (bonificação)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {projection.rows.map((r) => (
                      <TableRow key={r.vendedorId}>
                        <TableCell className="font-medium">{r.vendedorNome}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.vendasSoFar}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.mediaDia.toFixed(2)}</TableCell>
                        <TableCell className="text-right tabular-nums font-semibold">{r.projVendas}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          R$ {r.projFaturamento.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          R$ {r.projComissao.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          R$ {r.projBonus.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="campanha" className="space-y-6">
          <Card>
            <CardContent className="p-3 flex items-center gap-3">
              <div className="space-y-1.5 w-full">
                <p className="text-xs text-muted-foreground">Filtro</p>
                <div className="flex flex-wrap items-center gap-2">
                  <Select value={campaignBase} onValueChange={(value) => setCampaignBase(value as any)}>
                    <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="campanha">Campanha</SelectItem>
                      <SelectItem value="produto">Produto</SelectItem>
                    </SelectContent>
                  </Select>

                  {campaignBase === 'campanha' && (
                    <Select value={selectedCampaign} onValueChange={setSelectedCampaign}>
                      <SelectTrigger className="w-52"><SelectValue placeholder="Todas as campanhas" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todas as campanhas</SelectItem>
                        {campaignSelectorOptions.map((nome) => (
                          <SelectItem key={nome} value={nome}>{nome}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}

                  {campaignBase === 'produto' && (
                    <Select value={selectedCampaign} onValueChange={setSelectedCampaign}>
                      <SelectTrigger className="w-52"><SelectValue placeholder="Todos os produtos" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todos os produtos</SelectItem>
                        {campaignSelectorOptions.map((nome) => (
                          <SelectItem key={nome} value={nome}>{nome}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}

                  <Select value={campaignPeriod} onValueChange={(value) => setCampaignPeriod(value as any)}>
                    <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hoje">Diário</SelectItem>
                      <SelectItem value="semana">Semanal</SelectItem>
                      <SelectItem value="mes">Mensal</SelectItem>
                      <SelectItem value="personalizado">Personalizado</SelectItem>
                    </SelectContent>
                  </Select>

                  {campaignPeriod === 'personalizado' ? (
                    <>
                      <Input type="date" value={campaignCustomStart} onChange={(e) => setCampaignCustomStart(e.target.value)} className="w-40" />
                      <Input type="date" value={campaignCustomEnd} onChange={(e) => setCampaignCustomEnd(e.target.value)} className="w-40" />
                    </>
                  ) : campaignPeriod === 'mes' ? (
                    (() => {
                      const selectedYear = String(campaignRefDate || '').slice(0, 4) || String(new Date().getFullYear());
                      const selectedMonth = String(campaignRefDate || '').slice(5, 7) || String(new Date().getMonth() + 1).padStart(2, '0');
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
                        <div className="flex items-center gap-2">
                          <Select value={selectedMonth} onValueChange={(m) => setCampaignRefDate(`${selectedYear}-${m}-01`)}>
                            <SelectTrigger className="w-44"><SelectValue placeholder="Mês" /></SelectTrigger>
                            <SelectContent>
                              {months.map((m) => (
                                <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Select value={selectedYear} onValueChange={(y) => setCampaignRefDate(`${y}-${selectedMonth}-01`)}>
                            <SelectTrigger className="w-28"><SelectValue placeholder="Ano" /></SelectTrigger>
                            <SelectContent>
                              {years.map((y) => (
                                <SelectItem key={y} value={y}>{y}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      );
                    })()
                  ) : (
                    <Input type="date" value={campaignRefDate} onChange={(e) => setCampaignRefDate(e.target.value)} className="w-40" />
                  )}

                  <span className="text-sm font-medium">{campaignRange.label}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <MetricCard label="Vendas" value={campaignTotals.vendas} />
            <MetricCard label="Faturamento" value={<>R$ {campaignTotals.faturamento.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</>} />
            <MetricCard label="Projeção" value={<>R$ {campaignTotals.projecao.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</>} />
          </div>

          {(selectedCampaign !== 'all' || trafficEntries.length > 0) && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Tráfego{selectedCampaign !== 'all' ? ` — ${selectedCampaign}` : ' (período)'}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {campaignTrafficSummary.investimento === 0 && campaignTrafficSummary.leads === 0 ? (
                  <p className="text-sm text-muted-foreground">Sem dados de tráfego para este período{selectedCampaign !== 'all' ? '/produto' : ''}.</p>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                    <div className="p-3 rounded-md border border-border bg-muted/20">
                      <p className="eyebrow">Investimento</p>
                      <p className="text-lg font-semibold mt-1 tabular-nums">
                        R$ {campaignTrafficSummary.investimento.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </p>
                    </div>
                    <div className="p-3 rounded-md border border-border bg-muted/20">
                      <p className="eyebrow">Receita (tráfego)</p>
                      <p className="text-lg font-semibold mt-1 tabular-nums">
                        R$ {campaignTrafficSummary.receita.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </p>
                    </div>
                    <div className="p-3 rounded-md border border-border bg-muted/20">
                      <p className="eyebrow">ROAS</p>
                      <p className={`text-lg font-semibold mt-1 tabular-nums ${campaignTrafficSummary.roas >= 3 ? 'text-success' : campaignTrafficSummary.roas > 0 ? 'text-warning' : ''}`}>
                        {campaignTrafficSummary.roas.toFixed(2)}
                      </p>
                    </div>
                    <div className="p-3 rounded-md border border-border bg-muted/20">
                      <p className="eyebrow">Leads</p>
                      <p className="text-lg font-semibold mt-1 tabular-nums">{campaignTrafficSummary.leads}</p>
                    </div>
                    <div className="p-3 rounded-md border border-border bg-muted/20">
                      <p className="eyebrow">CPL</p>
                      <p className="text-lg font-semibold mt-1 tabular-nums">
                        R$ {campaignTrafficSummary.cpl.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </p>
                    </div>
                    <div className="p-3 rounded-md border border-border bg-muted/20">
                      <p className="eyebrow">Conversão</p>
                      <p className="text-lg font-semibold mt-1 tabular-nums">{campaignTrafficSummary.conversao.toFixed(1)}%</p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Resultado por {campaignBase === 'campanha' ? 'campanha' : 'produto'}</CardTitle>
            </CardHeader>
            <CardContent>
              {filteredCampaignRows.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sem dados para o período selecionado.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{campaignBase === 'campanha' ? 'Campanha' : 'Produto'}</TableHead>
                      <TableHead className="text-right">Vendas</TableHead>
                      <TableHead className="text-right">Faturamento</TableHead>
                      <TableHead className="text-right">Projeção</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredCampaignRows.map((row) => (
                      <TableRow key={row.nome}>
                        <TableCell className="font-medium">{row.nome}</TableCell>
                        <TableCell className="text-right tabular-nums">{row.vendas}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          R$ {row.faturamento.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          R$ {row.projecao.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

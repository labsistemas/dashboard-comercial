import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/AuthContext';
import { getCommercialEntries, saveCommercialEntries, getUsers, getProducts, saveProducts, getBackendBaseUrl, getAuthToken, getCommercialAwards, saveCommercialAwards, CommercialAwardsConfig, CommercialAwardsPeriod, CommercialAwardRule, getBonusLimitPercent, saveBonusLimitPercent, getRescuePenaltyPercentPerSale, saveRescuePenaltyPercentPerSale, getRescueEntries, getThresholds, getTrafficEntries } from '@/lib/storage';
import { AbandonmentLevel, AbandonmentThresholds, CommercialEntry, CommercialSaleLine, Product, RescueEntry, User } from '@/types/dashboard';
import { Plus, Trophy, Medal, Award, Trash2, Upload, CalendarDays, Save, Pencil, Download } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from '@/components/ui/sonner';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Progress } from '@/components/ui/progress';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useLocation } from 'react-router-dom';
import { generateCommercialReportPdf, generateUnifiedCommercialReportPdf } from '@/lib/commercial-report-pdf';
import { hasPermission } from '@/lib/permissions';

type SaleLineForm = {
  id: string;
  produtoId: string;
  quantidade: string;
};

function parseDelimitedText(text: string) {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!normalized) return [];
  const lines = normalized.split('\n').filter(Boolean);
  const delimiter = lines.some(l => l.includes(';')) && !lines.some(l => l.includes(',')) ? ';' : ',';
  const parseLine = (line: string) => {
    const out: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        const next = line[i + 1];
        if (inQuotes && next === '"') {
          cur += '"';
          i++;
          continue;
        }
        inQuotes = !inQuotes;
        continue;
      }
      if (!inQuotes && ch === delimiter) {
        out.push(cur.trim());
        cur = '';
        continue;
      }
      cur += ch;
    }
    out.push(cur.trim());
    return out;
  };
  return lines.map(parseLine);
}

function normalizeProductName(name: string) {
  return name.trim().replace(/\s+/g, ' ');
}

function extractCampaignOptions(entries: Array<{ produto?: string }>) {
  const unique = new Set<string>();
  for (const entry of entries) {
    const value = String(entry?.produto || '').trim();
    if (!value) continue;
    unique.add(value);
  }
  return Array.from(unique).sort((a, b) => a.localeCompare(b));
}

function formatBRL(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatDateBR(dateISO: string) {
  const v = String(dateISO || '').trim();
  if (!v) return '—';
  const d = new Date(`${v}T00:00:00`);
  if (Number.isNaN(d.getTime())) return v;
  return format(d, 'dd/MM/yyyy', { locale: ptBR });
}

function formatMonthYearBR(dateISO: string) {
  const v = String(dateISO || '').trim();
  if (!v) return '—';
  const d = new Date(`${v}T00:00:00`);
  if (Number.isNaN(d.getTime())) return v.slice(0, 7);
  const txt = format(d, 'MMMM yyyy', { locale: ptBR });
  return txt.charAt(0).toUpperCase() + txt.slice(1);
}

function getMonthBounds(monthRefISO: string) {
  const safeRef = String(monthRefISO || '').slice(0, 7);
  const year = parseInt(safeRef.slice(0, 4), 10);
  const month = parseInt(safeRef.slice(5, 7), 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return { startISO: '', endISO: '' };
  }
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mm = String(month).padStart(2, '0');
  return {
    startISO: `${year}-${mm}-01`,
    endISO: `${year}-${mm}-${String(lastDay).padStart(2, '0')}`,
  };
}

function getEffectiveMonthBounds(monthRefISO: string, todayISO: string) {
  const bounds = getMonthBounds(monthRefISO);
  if (!bounds.startISO || !bounds.endISO) return bounds;
  const currentMonthRef = String(todayISO || '').slice(0, 7);
  const selectedMonthRef = String(monthRefISO || '').slice(0, 7);
  if (selectedMonthRef === currentMonthRef) {
    return {
      startISO: bounds.startISO,
      endISO: todayISO,
    };
  }
  return bounds;
}

function getPainelRange(
  periodo: 'hoje' | 'semana' | 'mes' | 'tudo' | 'personalizado',
  todayISO: string,
  customStart: string,
  customEnd: string,
  monthRefISO: string,
) {
  if (periodo === 'hoje') return { startISO: todayISO, endISO: todayISO };
  if (periodo === 'semana') {
    const end = new Date(`${todayISO}T00:00:00`);
    const start = new Date(end);
    start.setDate(start.getDate() - 6);
    return { startISO: start.toISOString().slice(0, 10), endISO: todayISO };
  }
  if (periodo === 'mes') return getEffectiveMonthBounds(monthRefISO, todayISO);
  if (periodo === 'personalizado') return { startISO: customStart, endISO: customEnd };
  return { startISO: '', endISO: '' };
}

function parseClientNames(value: string) {
  return String(value || '')
    .split(/\s*\|\s*|\s*;\s*|\r?\n|,\s*/)
    .map((v) => v.trim())
    .filter(Boolean);
}

function parseClientLaunches(value: string, fallbackDiscountPercent = '0') {
  const names = parseClientNames(value);
  return names.map((raw) => {
    const match = raw.match(/^(.*)\((\d+(?:[\.,]\d+)?)%\)$/);
    if (!match) return { nome: raw.trim(), descontoPercent: fallbackDiscountPercent };
    const nome = String(match[1] || '').trim();
    const descontoPercent = String(match[2] || '').replace(',', '.').trim();
    return { nome, descontoPercent };
  });
}

function clampNumber(n: number, { min, max }: { min?: number; max?: number } = {}) {
  let out = Number.isFinite(n) ? n : 0;
  if (min !== undefined) out = Math.max(min, out);
  if (max !== undefined) out = Math.min(max, out);
  return out;
}

function pickTextColorFromBg(bg: string) {
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
}

function labelFromClassificacao(c: string) {
  return c === 'vermelho' ? 'alto' : c === 'amarelo' ? 'médio' : 'baixo';
}

function parseHueFromHsl(bg: string) {
  const v = String(bg || '').trim().toLowerCase();
  if (!v.startsWith('hsl(')) return NaN;
  const parts = v.replace('hsl(', '').replace(')', '').split(',');
  const hraw = parts[0] || '0';
  const h = parseFloat(hraw);
  return isNaN(h) ? NaN : h;
}

function isBgRed(bg: string) {
  const h = parseHueFromHsl(bg);
  return !isNaN(h) && h <= 15;
}

function chipBgColor(containerBg: string, label: string) {
  if (label === 'alto') return '#b00020';
  if (label === 'médio') return 'hsl(var(--warning))';
  if (label === 'baixo' && isBgRed(containerBg)) return 'hsl(120, 60%, 30%)';
  return 'rgba(255,255,255,0.2)';
}

function worstColor(index: number, total: number) {
  const t = total <= 1 ? 0 : index / (total - 1);
  const hue = 0 + (120 - 0) * t;
  const light = 25 + (48 - 25) * t;
  const sat = 85;
  return `hsl(${hue}, ${sat}%, ${light}%)`;
}

function medalColor(rank: number) {
  if (rank === 1) return '#FFD700';
  if (rank === 2) return '#C0C0C0';
  if (rank === 3) return '#CD7F32';
  return 'transparent';
}

function computeRanks(items: Array<{ conversao: number }>) {
  const keys = Array.from(new Set(items.map((x) => `${Math.round(x.conversao * 1000) / 1000}`)))
    .map((k) => parseFloat(k))
    .sort((a, b) => b - a);
  const rankByKey = new Map<number, number>();
  keys.forEach((k, idx) => rankByKey.set(k, idx + 1));
  return items.map((x) => {
    const key = Math.round(x.conversao * 1000) / 1000;
    const r = rankByKey.get(key) || 999;
    return r;
  });
}

function calculateSaleTotals(args: {
  lines?: CommercialSaleLine[];
  products: Product[];
  discountValue?: number;
  discountPercent?: number;
  sellerCommissionPercent?: number;
}) {
  const productsById = new Map(args.products.map(p => [p.id, p]));
  const discountPercent = clampNumber(args.discountPercent || 0, { min: 0, max: 100 });
  const sellerCommissionPercent = clampNumber(args.sellerCommissionPercent || 0, { min: 0, max: 100 });

  let grossRevenue = 0;
  let grossCommission = 0;

  for (const line of args.lines || []) {
    const product = productsById.get(line.produtoId);
    const snapshotPrice = clampNumber(Number(line.precoUnitario) || 0, { min: 0 });
    const price = snapshotPrice > 0 ? snapshotPrice : clampNumber(product?.preco ?? 0, { min: 0 });
    const commissionPercent = sellerCommissionPercent;
    const qty = clampNumber(line.quantidade, { min: 0 });
    const lineRevenue = price * qty;
    const lineCommission = lineRevenue * (commissionPercent / 100);
    grossRevenue += lineRevenue;
    grossCommission += lineCommission;
  }

  const discountValue = discountPercent > 0
    ? clampNumber(grossRevenue * (discountPercent / 100), { min: 0 })
    : clampNumber(args.discountValue || 0, { min: 0 });

  const netRevenue = Math.max(grossRevenue - discountValue, 0);
  const commission = grossRevenue > 0 ? grossCommission * (netRevenue / grossRevenue) : 0;

  return {
    grossRevenue,
    netRevenue,
    discountValue,
    commission,
  };
}

function parseISODateOnly(value: string) {
  const v = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function formatISODateOnly(d: Date) {
  return d.toISOString().slice(0, 10);
}

function startOfISOWeek(d: Date) {
  const out = new Date(d);
  const day = out.getUTCDay() || 7;
  out.setUTCDate(out.getUTCDate() - (day - 1));
  out.setUTCHours(0, 0, 0, 0);
  return out;
}

function startOfMonthUTC(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0));
}

function startOfQuarterUTC(d: Date) {
  const m = d.getUTCMonth();
  const q = Math.floor(m / 3) * 3;
  return new Date(Date.UTC(d.getUTCFullYear(), q, 1, 0, 0, 0, 0));
}

function addMonthsUTC(d: Date, months: number) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, d.getUTCDate(), 0, 0, 0, 0));
}

function getAwardsRange(period: CommercialAwardsPeriod, refISO: string) {
  const ref = parseISODateOnly(refISO) || new Date();
  const start =
    period === 'weekly'
      ? startOfISOWeek(ref)
      : period === 'monthly'
        ? startOfMonthUTC(ref)
        : startOfQuarterUTC(ref);
  const end =
    period === 'weekly'
      ? new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + 7, 0, 0, 0, 0))
      : period === 'monthly'
        ? addMonthsUTC(start, 1)
        : addMonthsUTC(start, 3);

  const startISO = formatISODateOnly(start);
  const endISO = formatISODateOnly(end);
  const label =
    period === 'weekly'
      ? `Semana (${formatDateBR(startISO)} - ${formatDateBR(formatISODateOnly(new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate() - 1, 0, 0, 0, 0))))})`
      : period === 'monthly'
        ? `Mês (${formatMonthYearBR(startISO)})`
        : `Trimestre (${start.getUTCFullYear()} Q${Math.floor(start.getUTCMonth() / 3) + 1})`;

  return { startISO, endISO, label, fechamentoISO: endISO };
}

export default function ComercialPage() {
  const { user } = useAuth();
  const currentMonthRef = `${new Date().toISOString().slice(0, 7)}-01`;
  const [entries, setEntries] = useState<CommercialEntry[]>(getCommercialEntries());
  const [showForm, setShowForm] = useState(false);
  const [vendedorTab, setVendedorTab] = useState<'painel' | 'treinamento'>('painel');
  const [products, setProducts] = useState<Product[]>(getProducts());
  const [activeTab, setActiveTab] = useState<'painel' | 'produtos' | 'premiacao' | 'baixar'>('painel');
  const [adminSellerView, setAdminSellerView] = useState<'ativos' | 'treinamento'>('ativos');
  const [painelPeriodo, setPainelPeriodo] = useState<'hoje' | 'semana' | 'mes' | 'tudo' | 'personalizado'>('mes');
  const [painelMonthRef, setPainelMonthRef] = useState(currentMonthRef);
  const [painelMonthWasSelected, setPainelMonthWasSelected] = useState(false);
  const [painelCustomStart, setPainelCustomStart] = useState(() => new Date().toISOString().slice(0, 10));
  const [painelCustomEnd, setPainelCustomEnd] = useState(() => new Date().toISOString().slice(0, 10));
  const [productName, setProductName] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [form, setForm] = useState({ data: '', leadsAtendidos: '', agendamentos: '', followUps: '', descontoPercent: '0', alunoNome: '' });
  const [saleLaunches, setSaleLaunches] = useState<Array<{ nome: string; descontoPercent: string }>>([]);
  const [campaignScope, setCampaignScope] = useState<'geral' | 'campanha'>('geral');
  const [campaignName, setCampaignName] = useState('');
  const [campaignOptions, setCampaignOptions] = useState<string[]>(() => extractCampaignOptions(getTrafficEntries()));
  const [trafficEntriesAll, setTrafficEntriesAll] = useState<any[]>(() => getTrafficEntries() as any[]);
  const [saleLines, setSaleLines] = useState<SaleLineForm[]>([{ id: crypto.randomUUID(), produtoId: '', quantidade: '' }]);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [users, setUsersState] = useState<User[]>(getUsers());
  const [awards, setAwards] = useState<CommercialAwardsConfig>(getCommercialAwards());
  const [awardsRefDate, setAwardsRefDate] = useState(() => new Date().toISOString().slice(0, 10));
  const awardsRefMonth = awardsRefDate.slice(5, 7);
  const awardsRefYear = awardsRefDate.slice(0, 4);
  const [awardDraft, setAwardDraft] = useState<{ vendedorId: string; minVendas: string; pixValor: string }>({ vendedorId: 'all', minVendas: '', pixValor: '' });
  const [teamRanking, setTeamRanking] = useState<
    Array<{
      vendedorId: string;
      nome: string;
      avatar?: string;
      emTreinamento?: boolean;
      treinamentoAte?: string | null;
      leads: number;
      agendamentos: number;
      vendas: number;
      followUps: number;
      penalidadeQtd?: number;
      penalidadePercent?: number;
    }>
  >([]);
  const [teamPosition, setTeamPosition] = useState<number | null>(null);
  const [bonusLimitPercent, setBonusLimitPercent] = useState<number>(() => getBonusLimitPercent());
  const [rescuePenaltyPercentPerSale, setRescuePenaltyPercentPerSale] = useState<number>(0);
  const [abandonmentLevels, setAbandonmentLevels] = useState<AbandonmentLevel[]>([]);
  const [abandonmentThresholds, setAbandonmentThresholds] = useState<AbandonmentThresholds>(() => getThresholds());

  const backend = getBackendBaseUrl();
  const token = getAuthToken();
  const commercialApiBase = backend ? `${backend}/api/commercial/entries` : null;
  const isBackendEnabled = Boolean(backend && token);


  const isAdmin = user?.role === 'admin';
  const canViewAdminMetrics = isAdmin || hasPermission(user, 'adminMetrics', 'read');
  const canManageProducts = isAdmin || hasPermission(user, 'products', 'read');
  const canCreateProducts = isAdmin || hasPermission(user, 'products', 'create');
  const canUpdateProducts = isAdmin || hasPermission(user, 'products', 'update');
  const canDeleteProducts = isAdmin || hasPermission(user, 'products', 'delete');
  const vendedores = users.filter(u => u.role === 'vendedor');
  const trainingPeriodStart = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    if (painelPeriodo === 'tudo') return null;
    if (painelPeriodo === 'hoje') return parseISODateOnly(today);
    if (painelPeriodo === 'semana') {
      const end = new Date(`${today}T00:00:00`);
      const start = new Date(end);
      start.setDate(start.getDate() - 6);
      return start;
    }
    if (painelPeriodo === 'mes') {
      const { startISO } = getMonthBounds(painelMonthRef);
      return startISO ? new Date(`${startISO}T00:00:00`) : null;
    }
    if (painelPeriodo === 'personalizado') return new Date(`${painelCustomStart}T00:00:00`);
    return null;
  }, [painelPeriodo, painelCustomStart, painelMonthRef]);

  const trainingUserIds = useMemo(
    () =>
      new Set(
        users
          .filter((u) => u.role === 'vendedor')
          .filter((u) => {
            const inTrainingNow = Boolean(u.emTreinamento);
            const until = parseISODateOnly(String(u.treinamentoAte || ''));
            if (!trainingPeriodStart) return inTrainingNow;
            if (inTrainingNow && !until) return true;
            if (!until) return false;
            return until >= trainingPeriodStart;
          })
          .map((u) => String(u.id)),
      ),
    [users, trainingPeriodStart],
  );
  const isTrainingView = !isAdmin && vendedorTab === 'treinamento';

  useEffect(() => {
    if (painelPeriodo !== 'mes') return;
    if (painelMonthWasSelected) return;
    if (painelMonthRef === currentMonthRef) return;
    setPainelMonthRef(currentMonthRef);
  }, [painelPeriodo, painelMonthWasSelected, painelMonthRef, currentMonthRef]);

  useEffect(() => {
    if ((!canManageProducts && activeTab === 'produtos') || (!isAdmin && activeTab === 'premiacao')) {
      setActiveTab('painel');
    }
  }, [canManageProducts, isAdmin, activeTab]);

  const adminVendedores = useMemo(() => {
    if (!canViewAdminMetrics) return vendedores;
    return vendedores.filter((v) => {
      const inTraining = trainingUserIds.has(String(v.id || ''));
      return adminSellerView === 'treinamento' ? inTraining : !inTraining;
    });
  }, [canViewAdminMetrics, vendedores, trainingUserIds, adminSellerView]);

  const scopedEntries = useMemo(() => {
    if (isAdmin) return entries;
    return entries.filter((e) => {
      const inTraining = trainingUserIds.has(String(e.vendedorId || ''));
      return isTrainingView ? inTraining : !inTraining;
    });
  }, [entries, isAdmin, isTrainingView, trainingUserIds]);

  const adminScopedEntries = useMemo(() => {
    if (!canViewAdminMetrics) return entries;
    return entries.filter((e) => {
      const inTraining = trainingUserIds.has(String(e.vendedorId || ''));
      return adminSellerView === 'treinamento' ? inTraining : !inTraining;
    });
  }, [entries, canViewAdminMetrics, trainingUserIds, adminSellerView]);

  const awardsApiBase = backend ? `${backend}/api/commercial/entries/awards` : null;
  const abandonmentApiBase = backend ? `${backend}/api/abandonment/levels` : null;

  const awardsMonthOptions = useMemo(
    () =>
      Array.from({ length: 12 }, (_, idx) => {
        const month = String(idx + 1).padStart(2, '0');
        const label = format(new Date(2024, idx, 1), 'MMMM', { locale: ptBR });
        return { value: month, label: label.charAt(0).toUpperCase() + label.slice(1) };
      }),
    [],
  );

  const awardsYearOptions = useMemo(() => {
    const years = new Set<number>();
    years.add(new Date().getUTCFullYear());
    years.add(parseInt(awardsRefYear) || new Date().getUTCFullYear());
    for (const e of entries) {
      const y = parseInt(String(e.data || '').slice(0, 4));
      if (Number.isFinite(y)) years.add(y);
    }
    const sorted = Array.from(years).sort((a, b) => b - a);
    if (sorted.length > 0) return sorted.map(String);
    return [String(new Date().getUTCFullYear())];
  }, [entries, awardsRefYear]);

  const painelMonthOptions = awardsMonthOptions;

  const painelYearOptions = useMemo(() => {
    const years = new Set<number>();
    years.add(new Date().getUTCFullYear());
    years.add(parseInt(painelMonthRef.slice(0, 4), 10) || new Date().getUTCFullYear());
    for (const e of entries) {
      const year = parseInt(String(e.data || '').slice(0, 4), 10);
      if (Number.isFinite(year)) years.add(year);
    }
    for (const entry of trafficEntriesAll) {
      const year = parseInt(String(entry?.semana || '').slice(0, 4), 10);
      if (Number.isFinite(year)) years.add(year);
    }
    const sorted = Array.from(years).sort((a, b) => b - a);
    if (sorted.length > 0) return sorted.map(String);
    return [String(new Date().getUTCFullYear())];
  }, [entries, painelMonthRef, trafficEntriesAll]);

  const painelRange = useMemo(() => {
    return getPainelRange(
      painelPeriodo,
      new Date().toISOString().slice(0, 10),
      painelCustomStart,
      painelCustomEnd,
      painelMonthRef,
    );
  }, [painelPeriodo, painelCustomStart, painelCustomEnd, painelMonthRef]);

  const persistAwards = async (next: CommercialAwardsConfig) => {
    const enforced: CommercialAwardsConfig = { ...next, period: 'monthly' };
    setAwards(enforced);
    saveCommercialAwards(enforced);
    if (!isBackendEnabled || !isAdmin || !awardsApiBase) return true;
    try {
      const res = await fetch(awardsApiBase, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(enforced),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Falha ao salvar premiação');
      const period = 'monthly' as CommercialAwardsPeriod;
      const rules = Array.isArray(data?.rules) ? data.rules : [];
      const mappedRules: CommercialAwardRule[] = rules
        .map((r: any) => ({
          id: String(r?.id || crypto.randomUUID()),
          vendedorId: r?.vendedorId ? String(r.vendedorId) : null,
          minVendas: clampNumber(parseInt(String(r?.minVendas || '0')) || 0, { min: 0 }),
          pixValor: clampNumber(parseFloat(String(r?.pixValor || '0')) || 0, { min: 0 }),
        }))
        .filter((r) => r.id);
      const normalized: CommercialAwardsConfig = { period, rules: mappedRules };
      setAwards(normalized);
      saveCommercialAwards(normalized);
      return true;
    } catch (e: any) {
      toast.error(String(e?.message || 'Falha ao salvar premiação'));
      return false;
    }
  };

  useEffect(() => {
    if (!isBackendEnabled) return;
    if (!awardsApiBase) return;
    let isCancelled = false;

    const load = async () => {
      try {
        const sep = awardsApiBase.includes('?') ? '&' : '?';
        const url = `${awardsApiBase}${sep}ts=${Date.now()}`;
        const res = await fetch(url, {
          headers: {
            Authorization: `Bearer ${token}`,
            'Cache-Control': 'no-cache',
            Pragma: 'no-cache',
          },
          cache: 'no-store',
        });
        if (res.status === 304) {
          const local = getCommercialAwards();
          const enforcedLocal: CommercialAwardsConfig = { ...local, period: 'monthly' };
          if (!isCancelled) {
            setAwards(enforcedLocal);
            saveCommercialAwards(enforcedLocal);
          }
          return;
        }
        const data = await res.json().catch(() => null);
        if (!res.ok) return;
        const period = 'monthly' as CommercialAwardsPeriod;
        const rules = Array.isArray(data?.rules) ? data.rules : [];
        const mappedRules: CommercialAwardRule[] = rules
          .map((r: any) => ({
            id: String(r?.id || crypto.randomUUID()),
            vendedorId: r?.vendedorId ? String(r.vendedorId) : null,
            minVendas: clampNumber(parseInt(String(r?.minVendas || '0')) || 0, { min: 0 }),
            pixValor: clampNumber(parseFloat(String(r?.pixValor || '0')) || 0, { min: 0 }),
          }))
          .filter((r) => r.id);
        const next: CommercialAwardsConfig = {
          period,
          rules: mappedRules,
        };
        const local = getCommercialAwards();
        const localHasRules = Array.isArray(local?.rules) && local.rules.length > 0;
        const serverHasRules = next.rules.length > 0;
        if (!isCancelled) {
          if (!serverHasRules && localHasRules) {
            const enforcedLocal: CommercialAwardsConfig = { ...local, period: 'monthly' };
            setAwards(enforcedLocal);
            saveCommercialAwards(enforcedLocal);
            if (isAdmin) await persistAwards(enforcedLocal);
          } else {
            setAwards(next);
            saveCommercialAwards(next);
          }
        }
      } catch {
      }
    };

    load();
    return () => {
      isCancelled = true;
    };
  }, [isBackendEnabled, awardsApiBase, token]);

  const myEntries = canViewAdminMetrics ? adminScopedEntries : scopedEntries.filter(e => e.vendedorId === user?.id);

  const activeProducts = useMemo(() => products.filter((p) => p.ativo !== false), [products]);

  const filteredActiveProducts = useMemo(() => {
    const q = String(productSearch || '').trim().toLowerCase();
    if (!q) return activeProducts;
    return activeProducts.filter((p) => {
      const nome = String(p.nome || '').toLowerCase();
      const descricao = String(p.descricao || '').toLowerCase();
      return nome.includes(q) || descricao.includes(q);
    });
  }, [activeProducts, productSearch]);

  const isProductInactive = (produtoId: string) => {
    const p = products.find((x) => x.id === produtoId);
    return p?.ativo === false;
  };

  const entryHasInactiveProduct = (entry: CommercialEntry) => {
    const ids = new Set((entry.vendasPorProduto || []).map((l) => String(l.produtoId)));
    return products.some((p) => ids.has(p.id) && p.ativo === false);
  };

  const painelEntries = useMemo(() => {
    if (!canViewAdminMetrics) return [];
    const { startISO, endISO } = painelRange;
    if (!startISO || !endISO) return myEntries;
    return myEntries.filter((e) => {
      const dateISO = String(e.data || '').slice(0, 10);
      return dateISO >= startISO && dateISO <= endISO;
    });
  }, [canViewAdminMetrics, myEntries, painelRange]);

  const painelTotals = useMemo(() => {
    return painelEntries.reduce(
      (acc, e) => {
        acc.leads += e.leadsAtendidos || 0;
        acc.agend += e.agendamentos || 0;
        acc.vendas += e.vendas || 0;
        acc.followUps += e.followUps || 0;
        acc.bruto += typeof e.valorBruto === 'number' ? e.valorBruto : 0;
        acc.desconto += typeof e.descontoValor === 'number' ? e.descontoValor : 0;
        acc.liquido += typeof e.valorLiquido === 'number' ? e.valorLiquido : 0;
        acc.comissao += typeof e.comissao === 'number' ? e.comissao : 0;
        return acc;
      },
      { leads: 0, agend: 0, vendas: 0, followUps: 0, bruto: 0, desconto: 0, liquido: 0, comissao: 0 },
    );
  }, [painelEntries]);

  const painelConversaoPercent = useMemo(() => {
    return painelTotals.leads > 0 ? (painelTotals.vendas / painelTotals.leads) * 100 : 0;
  }, [painelTotals.leads, painelTotals.vendas]);

    // CPL from traffic for the current painel period (used to compute CAC per seller)
    const painelCPL = useMemo(() => {
      if (!canViewAdminMetrics || trafficEntriesAll.length === 0) return 0;
      const { startISO, endISO } = painelRange;
      const filtered = trafficEntriesAll.filter((t: any) => {
        const tStart = String(t.semana || '').slice(0, 10);
        const tPeriodoTipo = String(t.periodoTipo || 'weekly');
        let tEnd: string;
        if (tPeriodoTipo === 'monthly') {
          const ms = new Date(`${tStart.slice(0, 7)}-01T00:00:00`);
          ms.setMonth(ms.getMonth() + 1); ms.setDate(ms.getDate() - 1);
          tEnd = ms.toISOString().slice(0, 10);
        } else {
          const d = new Date(`${tStart}T00:00:00`); d.setDate(d.getDate() + 6);
          tEnd = d.toISOString().slice(0, 10);
        }
        if (startISO && endISO) return tStart <= endISO && tEnd >= startISO;
        return true;
      });
      const totalLeads = filtered.reduce((s: number, t: any) => s + (Number(t.leads) || 0), 0);
      const totalInvestimento = filtered.reduce((s: number, t: any) => s + (Number(t.investimento) || 0), 0);
      return totalLeads > 0 ? totalInvestimento / totalLeads : 0;
    }, [canViewAdminMetrics, trafficEntriesAll, painelRange]);

  const vendasPorVendedor = useMemo(() => {
    const sellers = new Map<string, { id: string; nome: string }>();
    const userNameById = new Map(users.map((u) => [u.id, String(u.nome || '').trim()]));
    const sourceVendedores = canViewAdminMetrics ? adminVendedores : vendedores;
    for (const v of sourceVendedores) {
      const fallbackName = userNameById.get(v.id) || String(v.nome || '').trim() || '—';
      sellers.set(v.id, { id: v.id, nome: fallbackName });
    }
    for (const e of painelEntries) {
      const vendedorId = String(e.vendedorId || '');
      if (!vendedorId) continue;
      const entryName = String(e.vendedorNome || '').trim();
      const fallbackName = entryName || userNameById.get(vendedorId) || '—';
      if (!sellers.has(vendedorId)) {
        sellers.set(vendedorId, { id: vendedorId, nome: fallbackName });
        continue;
      }
      const seller = sellers.get(vendedorId)!;
      if ((!seller.nome || seller.nome === '—') && fallbackName !== '—') {
        seller.nome = fallbackName;
      }
    }

    const stats = new Map<
      string,
      {
        id: string;
        nome: string;
        leads: number;
        agend: number;
        vendas: number;
        followUps: number;
        bruto: number;
        desconto: number;
        liquido: number;
        comissao: number;
        cac: number;
      }
    >();

    for (const s of sellers.values()) {
      stats.set(s.id, { id: s.id, nome: s.nome, leads: 0, agend: 0, vendas: 0, followUps: 0, bruto: 0, desconto: 0, liquido: 0, comissao: 0, cac: 0 });
    }

    for (const e of painelEntries) {
      const row = stats.get(e.vendedorId);
      if (!row) continue;
      const bruto = typeof e.valorBruto === 'number' ? e.valorBruto : 0;
      const descontoValor = typeof e.descontoValor === 'number'
        ? e.descontoValor
        : typeof e.descontoPercent === 'number'
          ? bruto * (clampNumber(e.descontoPercent, { min: 0, max: 100 }) / 100)
          : 0;
      const liquido = typeof e.valorLiquido === 'number' ? e.valorLiquido : Math.max(bruto - descontoValor, 0);
      row.leads += e.leadsAtendidos || 0;
      row.agend += e.agendamentos || 0;
      row.vendas += e.vendas || 0;
      row.followUps += e.followUps || 0;
      row.bruto += bruto;
      row.desconto += descontoValor;
      row.liquido += liquido;
      row.comissao += typeof e.comissao === 'number' ? e.comissao : 0;
    }

    const rows = Array.from(stats.values());
    for (const row of rows) {
      row.cac = painelCPL > 0 && row.vendas > 0 ? (painelCPL * row.leads) / row.vendas : 0;
    }
    return rows.sort((a, b) => b.vendas - a.vendas);
  }, [canViewAdminMetrics, adminVendedores, vendedores, painelEntries, painelCPL, users]);

  const vendedorPainelEntries = useMemo(() => {
    if (canViewAdminMetrics) return [];
    const today = new Date().toISOString().slice(0, 10);
    const { startISO: painelMonthStartISO, endISO: painelMonthEndISO } = getEffectiveMonthBounds(painelMonthRef, today);
    if (painelPeriodo === 'hoje') return myEntries.filter((e) => e.data === today);
    if (painelPeriodo === 'semana') {
      const end = new Date(`${today}T00:00:00`);
      const start = new Date(end);
      start.setDate(start.getDate() - 6);
      return myEntries.filter((e) => {
        const d = new Date(`${e.data}T00:00:00`);
        return d >= start && d <= end;
      });
    }
    if (painelPeriodo === 'mes') {
      return myEntries.filter((e) => {
        const dateISO = String(e.data || '').slice(0, 10);
        return dateISO >= painelMonthStartISO && dateISO <= painelMonthEndISO;
      });
    }
    if (painelPeriodo === 'personalizado') {
      const start = new Date(`${painelCustomStart}T00:00:00`);
      const end = new Date(`${painelCustomEnd}T00:00:00`);
      const endPlus = new Date(end); endPlus.setDate(endPlus.getDate() + 1);
      return myEntries.filter((e) => {
        const d = new Date(`${e.data}T00:00:00`);
        return d >= start && d < endPlus;
      });
    }
    return myEntries;
  }, [canViewAdminMetrics, myEntries, painelPeriodo, painelCustomStart, painelCustomEnd, painelMonthRef]);

  const vendedorTotals = useMemo(() => {
    return vendedorPainelEntries.reduce(
      (acc, e) => {
        acc.leads += e.leadsAtendidos || 0;
        acc.agend += e.agendamentos || 0;
        acc.vendas += e.vendas || 0;
        acc.followUps += e.followUps || 0;
        acc.bruto += typeof e.valorBruto === 'number' ? e.valorBruto : 0;
        acc.desconto += typeof e.descontoValor === 'number' ? e.descontoValor : 0;
        acc.liquido += typeof e.valorLiquido === 'number' ? e.valorLiquido : 0;
        acc.comissao += typeof e.comissao === 'number' ? e.comissao : 0;
        return acc;
      },
      { leads: 0, agend: 0, vendas: 0, followUps: 0, bruto: 0, desconto: 0, liquido: 0, comissao: 0 },
    );
  }, [vendedorPainelEntries]);

  const canShowFinancials = useMemo(() => {
    return vendedorPainelEntries.some(
      (e) => typeof e.valorBruto === 'number' || typeof e.valorLiquido === 'number' || typeof e.comissao === 'number',
    );
  }, [vendedorPainelEntries]);

  const vendedorConversaoPercent = useMemo(() => {
    return vendedorTotals.leads > 0 ? (vendedorTotals.vendas / vendedorTotals.leads) * 100 : 0;
  }, [vendedorTotals.leads, vendedorTotals.vendas]);

  const vendasPorDiaDoVendedor = useMemo(() => {
    const map = new Map<string, { data: string; leads: number; agend: number; vendas: number; followUps: number }>();
    for (const e of vendedorPainelEntries) {
      const key = e.data;
      if (!map.has(key)) map.set(key, { data: key, leads: 0, agend: 0, vendas: 0, followUps: 0 });
      const row = map.get(key)!;
      row.leads += e.leadsAtendidos || 0;
      row.agend += e.agendamentos || 0;
      row.vendas += e.vendas || 0;
      row.followUps += e.followUps || 0;
    }
    return Array.from(map.values()).sort((a, b) => b.data.localeCompare(a.data));
  }, [vendedorPainelEntries]);

  const totalVendasDoDia = useMemo(() => {
    return saleLines.reduce((sum, l) => sum + (parseInt(l.quantidade) || 0), 0);
  }, [saleLines]);

  useEffect(() => {
    if (!showForm) return;
    const target = saleLines.length;
    setSaleLaunches((prev) => {
      if (target === prev.length) return prev;
      if (target < prev.length) return prev.slice(0, target);
      return [
        ...prev,
        ...Array.from({ length: target - prev.length }, () => ({
          nome: '',
          descontoPercent: String(form.descontoPercent || '0'),
        })),
      ];
    });
  }, [showForm, saleLines.length, form.descontoPercent]);

  useEffect(() => {
    if (!showForm) return;
    const used = saleLines
      .map((line, idx) => ({ idx, qty: parseInt(line.quantidade) || 0 }))
      .filter((x) => x.qty > 0);
    if (used.length <= 0) return;
    const discounts = saleLaunches
      .map((l, idx) => ({ idx, value: String(l.descontoPercent || '').trim().replace(',', '.') }))
      .filter((x) => used.some((u) => u.idx === x.idx))
      .map((x) => x.value)
      .filter((v) => v !== '')
      .map((v) => clampNumber(parseFloat(v) || 0, { min: 0, max: 100 }));
    if (discounts.length === 0) return;
    const avg = discounts.reduce((sum, v) => sum + v, 0) / discounts.length;
    const avgTxt = avg.toFixed(2);
    setForm((prev) => (prev.descontoPercent === avgTxt ? prev : { ...prev, descontoPercent: avgTxt }));
  }, [showForm, saleLines, saleLaunches]);

  const editingEntry = useMemo(() => {
    if (!editingEntryId) return null;
    return entries.find((e) => e.id === editingEntryId) || null;
  }, [editingEntryId, entries]);

  const editingPriceByProductId = useMemo(() => {
    const map = new Map<string, number>();
    for (const l of editingEntry?.vendasPorProduto || []) {
      const p = clampNumber(Number(l.precoUnitario) || 0, { min: 0 });
      if (p > 0) map.set(String(l.produtoId), p);
    }
    return map;
  }, [editingEntry]);

  const lineFinancialById = useMemo(() => {
    const byId = new Map<string, { price: number; maxDiscount: number; discountPercent: number; gross: number; discountValue: number; net: number }>();
    for (let idx = 0; idx < saleLines.length; idx++) {
      const line = saleLines[idx];
      const qty = clampNumber(parseInt(line.quantidade) || 0, { min: 0 });
      const product = products.find((p) => p.id === line.produtoId);
      const snapshot = editingPriceByProductId.get(line.produtoId);
      const price = clampNumber(typeof snapshot === 'number' && snapshot > 0 ? snapshot : product?.preco ?? 0, { min: 0 });
      const maxDiscount = clampNumber(product?.maxDescontoPercent ?? 100, { min: 0, max: 100 });
      const rawDiscount = clampNumber(parseFloat(String(saleLaunches[idx]?.descontoPercent || '').replace(',', '.')) || 0, { min: 0, max: 100 });
      const discountPercent = clampNumber(rawDiscount, { min: 0, max: maxDiscount });
      const gross = price * qty;
      const discountValue = gross * (discountPercent / 100);
      const net = Math.max(gross - discountValue, 0);
      byId.set(line.id, { price, maxDiscount, discountPercent, gross, discountValue, net });
    }
    return byId;
  }, [saleLines, saleLaunches, products, editingPriceByProductId]);

  const salesForPreview = useMemo(() => {
    return saleLines
      .filter((l) => l.produtoId && (parseInt(l.quantidade) || 0) > 0)
      .map((l) => {
        const produtoId = l.produtoId;
        const precoUnitario = editingPriceByProductId.get(produtoId);
        return {
          produtoId,
          quantidade: parseInt(l.quantidade) || 0,
          precoUnitario: typeof precoUnitario === 'number' ? precoUnitario : undefined,
        } satisfies CommercialSaleLine;
      });
  }, [saleLines, editingPriceByProductId]);

  const selectedProductsForPreview = useMemo(() => {
    const ids = new Set(salesForPreview.map((l) => l.produtoId));
    return products.filter((p) => ids.has(p.id));
  }, [salesForPreview, products]);

  const sellerCommissionPercent = useMemo(() => {
    return clampNumber(user?.comissaoPercent ?? 0, { min: 0, max: 100 });
  }, [user?.comissaoPercent]);

  const maxDiscountAllowed = useMemo(() => {
    if (selectedProductsForPreview.length === 0) return 0;
    return selectedProductsForPreview.reduce((min, p) => {
      const v = clampNumber(p.maxDescontoPercent ?? 0, { min: 0, max: 100 });
      return Math.min(min, v);
    }, 100);
  }, [selectedProductsForPreview]);

  const canShowValues = useMemo(() => {
    if (selectedProductsForPreview.length === 0) return false;
    const allHavePrice = selectedProductsForPreview.every((p) => clampNumber(p.preco ?? 0, { min: 0 }) > 0);
    return allHavePrice && maxDiscountAllowed > 0 && sellerCommissionPercent > 0;
  }, [selectedProductsForPreview, maxDiscountAllowed, sellerCommissionPercent]);

  const discountPercentForPreview = useMemo(() => {
    if (!canShowValues) return 0;
    return clampNumber(parseFloat(form.descontoPercent) || 0, { min: 0, max: maxDiscountAllowed });
  }, [form.descontoPercent, canShowValues, maxDiscountAllowed]);

  const previewTotals = useMemo(() => {
    return calculateSaleTotals({
      lines: salesForPreview,
      products,
      discountPercent: discountPercentForPreview,
      sellerCommissionPercent,
    });
  }, [salesForPreview, products, discountPercentForPreview, sellerCommissionPercent]);

  useEffect(() => {
    if (!showForm) return;
    setForm((prev) => (prev.data ? prev : { ...prev, data: new Date().toISOString().slice(0, 10) }));
  }, [showForm]);

  useEffect(() => {
    if (!isBackendEnabled) {
      setCampaignOptions(extractCampaignOptions(getTrafficEntries() as any));
      return;
    }

    let isCancelled = false;
    const loadCampaignOptions = async () => {
      try {
        const res = await fetch(`${backend}/api/traffic/entries`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error('Falha ao carregar campanhas');
        const list = Array.isArray(data?.entries) ? data.entries : [];
        const options = extractCampaignOptions(list.map((entry: any) => ({ produto: String(entry?.produto || '') })));
        if (!isCancelled) setCampaignOptions(options);
      } catch {
        if (!isCancelled) setCampaignOptions(extractCampaignOptions(getTrafficEntries() as any));
      }
    };

    loadCampaignOptions();
    return () => {
      isCancelled = true;
    };
  }, [isBackendEnabled, backend, token]);
  useEffect(() => {
    if (!isBackendEnabled) {
      const local = getTrafficEntries() as any[];
      setCampaignOptions(extractCampaignOptions(local));
      setTrafficEntriesAll(local);
      return;
    }

    let isCancelled = false;
    const loadTrafficData = async () => {
      try {
        const res = await fetch(`${backend}/api/traffic/entries`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error('Falha ao carregar campanhas');
        const list = Array.isArray(data?.entries) ? data.entries : [];
        const options = extractCampaignOptions(list.map((entry: any) => ({ produto: String(entry?.produto || '') })));
        if (!isCancelled) {
          setCampaignOptions(options);
          setTrafficEntriesAll(list);
        }
      } catch {
        const local = getTrafficEntries() as any[];
        if (!isCancelled) {
          setCampaignOptions(extractCampaignOptions(local));
          setTrafficEntriesAll(local);
        }
      }
    };

    loadTrafficData();
    return () => {
      isCancelled = true;
    };
  }, [isBackendEnabled, backend, token]);

  useEffect(() => {
    if (!isBackendEnabled) return;
    let isCancelled = false;

    const load = async () => {
      try {
        const res = await fetch(`${backend}/api/products`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error || 'Falha ao carregar produtos');
        const remoteProducts = Array.isArray(data?.products) ? data.products : [];
        const localProducts = getProducts();

        if (user?.role === 'admin' && Array.isArray(localProducts) && localProducts.length > 0) {
          const remoteByName = new Set(remoteProducts.map((p: any) => normalizeProductName(String(p?.nome || '')).toLowerCase()));
          const toSync = localProducts.filter((p) => {
            const key = normalizeProductName(p.nome).toLowerCase();
            return key && !remoteByName.has(key);
          });

          if (toSync.length > 0) {
            for (const p of toSync) {
              await fetch(`${backend}/api/products`, {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${token}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  nome: normalizeProductName(p.nome),
                  capaUrl: p.capaUrl || '',
                  descricao: p.descricao || '',
                  preco: typeof p.preco === 'number' ? p.preco : 0,
                  maxDescontoPercent: typeof p.maxDescontoPercent === 'number' ? p.maxDescontoPercent : 0,
                }),
              }).catch(() => undefined);
            }

            const refetch = await fetch(`${backend}/api/products`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            const refetchData = await refetch.json().catch(() => null);
            if (refetch.ok && Array.isArray(refetchData?.products)) {
              remoteProducts.splice(0, remoteProducts.length, ...refetchData.products);
            }
          }
        }

        if (!isCancelled) {
          const mapped = remoteProducts.map((p: any) => ({
              id: String(p.id),
              nome: String(p.nome || ''),
              capaUrl: String(p.capaUrl || ''),
              descricao: String(p.descricao || ''),
              preco: typeof p.preco === 'number' ? p.preco : parseFloat(String(p.preco || '0')) || 0,
              maxDescontoPercent:
                typeof p.maxDescontoPercent === 'number'
                  ? p.maxDescontoPercent
                  : parseFloat(String(p.maxDescontoPercent || '0')) || 0,
              ativo: typeof p.ativo === 'boolean' ? p.ativo : true,
              criadoEm: String(p.criadoEm || ''),
            }));
          setProducts(mapped);
          saveProducts(mapped);
        }
      } catch (e: any) {
        toast.error(String(e?.message || 'Falha ao carregar produtos'));
      }
    };

    load();
    return () => {
      isCancelled = true;
    };
  }, [isBackendEnabled, backend, token, user?.role]);

  useEffect(() => {
    if (!isBackendEnabled) return;
    if (!canViewAdminMetrics) {
      if (user?.id) {
        setUsersState((prev) => {
          const currentUser: User = {
            id: String(user.id),
            nome: String(user.nome || ''),
            email: String(user.email || ''),
            senha: '',
            role: String(user.role || 'vendedor') as any,
            avatar: String(user.avatar || ''),
            comissaoPercent:
              typeof user.comissaoPercent === 'number'
                ? user.comissaoPercent
                : parseFloat(String(user.comissaoPercent || '0')) || 0,
            emTreinamento: Boolean(user.emTreinamento),
            treinamentoAte: user.treinamentoAte ? String(user.treinamentoAte).slice(0, 10) : null,
            permissionClassId: user.permissionClassId ? String(user.permissionClassId) : null,
            permissionFlags: user.permissionFlags || null,
          };
          const filtered = prev.filter((item) => String(item.id) !== currentUser.id);
          return [...filtered, currentUser];
        });
      }
      return;
    }
    let isCancelled = false;

    const loadUsers = async () => {
      try {
        const res = await fetch(`${backend}/api/users`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error || 'Falha ao carregar usuários');
        const list = Array.isArray(data?.users) ? data.users : Array.isArray(data) ? data : [];
        const mapped: User[] = list.map((u: any) => ({
          id: String(u.id),
          nome: String(u.nome || u.name || ''),
          email: String(u.email || ''),
          senha: '',
          role: String(u.role || 'vendedor') as any,
          avatar: String(u.avatar || ''),
          comissaoPercent:
            typeof u.comissaoPercent === 'number'
              ? u.comissaoPercent
              : parseFloat(String(u.comissaoPercent || '0')) || 0,
          emTreinamento: Boolean(u.emTreinamento ?? u.em_treinamento),
          treinamentoAte: u.treinamentoAte
            ? String(u.treinamentoAte).slice(0, 10)
            : u.treinamento_ate
              ? String(u.treinamento_ate).slice(0, 10)
              : null,
        }));
        if (!isCancelled) {
          setUsersState(mapped);
        }
      } catch (e: any) {
        toast.error(String(e?.message || 'Falha ao carregar usuários'));
      }
    };

    loadUsers();
    return () => {
      isCancelled = true;
    };
  }, [isBackendEnabled, backend, token, canViewAdminMetrics, user]);

  useEffect(() => {
    if (!isBackendEnabled) return;
    if (!user?.id) return;
    if (painelPeriodo === 'personalizado') return; // ranking remoto não suporta período custom
    let isCancelled = false;

    const loadEntries = async () => {
      try {
        const res = await fetch(`${commercialApiBase}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error || 'Falha ao carregar registros');
        const list = Array.isArray(data?.entries) ? data.entries : [];
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
        }));
        if (!isCancelled) {
          setEntries(mapped);
          saveCommercialEntries(mapped);
        }
      } catch (e: any) {
        toast.error(String(e?.message || 'Falha ao carregar registros'));
      }
    };

    loadEntries();
    return () => {
      isCancelled = true;
    };
  }, [isBackendEnabled, commercialApiBase, token, user?.id]);

  useEffect(() => {
    if (!isBackendEnabled) return;
    if (!user?.id) return;
    let isCancelled = false;

    const loadRanking = async () => {
      try {
        const params = new URLSearchParams();
        params.set('period', painelPeriodo);
        if (painelPeriodo === 'mes') params.set('ref', painelMonthRef);
        const res = await fetch(
          `${commercialApiBase}/ranking?${params.toString()}`,
          {
            headers: { Authorization: `Bearer ${token}` },
          },
        );
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error || 'Falha ao carregar ranking');
        const items = Array.isArray(data?.ranking) ? data.ranking : [];
        const mapped = items.map((r: any) => ({
          vendedorId: String(r.vendedorId),
          nome: String(r.nome || '—'),
          avatar: String(r.avatar || ''),
          emTreinamento: Boolean(r.emTreinamento ?? r.em_treinamento),
          treinamentoAte: r.treinamentoAte
            ? String(r.treinamentoAte).slice(0, 10)
            : r.treinamento_ate
              ? String(r.treinamento_ate).slice(0, 10)
              : null,
          leads: parseInt(String(r.leads || '0')) || 0,
          agendamentos: parseInt(String(r.agendamentos || '0')) || 0,
          vendas: parseInt(String(r.vendas || '0')) || 0,
          followUps: parseInt(String(r.followUps || '0')) || 0,
          penalidadeQtd: typeof r.penalidadeQtd === 'number' ? r.penalidadeQtd : parseInt(String(r.penalidadeQtd || '0')) || 0,
          penalidadePercent: typeof r.penalidadePercent === 'number' ? r.penalidadePercent : parseFloat(String(r.penalidadePercent || '0')) || 0,
        }));
        const position = typeof data?.myPosition === 'number' ? data.myPosition : null;
        const penaltyPercentPerSale =
          typeof data?.rescuePenaltyPercentPerSale === 'number'
            ? data.rescuePenaltyPercentPerSale
            : parseFloat(String(data?.rescuePenaltyPercentPerSale || '0')) || 0;
        if (!isCancelled) {
          setTeamRanking(mapped);
          setTeamPosition(position);
          setRescuePenaltyPercentPerSale(penaltyPercentPerSale);
        }
      } catch {
        if (!isCancelled) {
          setTeamRanking([]);
          setTeamPosition(null);
          setRescuePenaltyPercentPerSale(0);
        }
      }
    };

    loadRanking();
    return () => {
      isCancelled = true;
    };
  }, [isBackendEnabled, commercialApiBase, token, user?.id, painelPeriodo, painelMonthRef]);

  useEffect(() => {
    if (!isBackendEnabled) return;
    if (!abandonmentApiBase) return;
    if (!user?.id) return;
    let isCancelled = false;

    const load = async () => {
      try {
        const params = new URLSearchParams();
        if (painelPeriodo !== 'personalizado') params.set('period', painelPeriodo);
        if (painelPeriodo === 'personalizado') {
          params.set('start', painelCustomStart);
          params.set('end', painelCustomEnd);
        }
        const url = `${abandonmentApiBase}?${params.toString()}`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error || 'Falha ao carregar abandono');
        const levels = Array.isArray(data?.levels) ? data.levels : [];
        const mappedLevels: AbandonmentLevel[] = levels.map((l: any) => ({
          vendedorId: String(l?.vendedorId || ''),
          vendedorNome: String(l?.vendedorNome || 'Vendedor'),
          avatar: String(l?.avatar || ''),
          totalResgatados: clampNumber(parseInt(String(l?.totalResgatados || '0')) || 0, { min: 0 }),
          classificacao: (String(l?.classificacao || 'verde') as any) === 'vermelho' ? 'vermelho' : (String(l?.classificacao || 'verde') as any) === 'amarelo' ? 'amarelo' : 'verde',
        }));
        const thresholds = data?.thresholds || null;
        const mappedThresholds: AbandonmentThresholds = {
          amarelo: clampNumber(parseInt(String(thresholds?.amarelo || '0')) || 0, { min: 0 }),
          vermelho: clampNumber(parseInt(String(thresholds?.vermelho || '0')) || 0, { min: 0 }),
        };
        if (!isCancelled) {
          setAbandonmentLevels(mappedLevels);
          setAbandonmentThresholds(mappedThresholds);
        }
      } catch {
        if (!isCancelled) {
          setAbandonmentLevels([]);
        }
      }
    };

    load();
    return () => {
      isCancelled = true;
    };
  }, [abandonmentApiBase, isBackendEnabled, painelCustomEnd, painelCustomStart, painelPeriodo, token, user?.id]);

  const localTeam = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const { startISO: painelMonthStartISO, endISO: painelMonthEndISO } = getEffectiveMonthBounds(painelMonthRef, today);
    const filtered = (() => {
      if (painelPeriodo === 'hoje') return scopedEntries.filter((e) => e.data === today);
      if (painelPeriodo === 'semana') {
        return scopedEntries.filter((e) => {
          const end = new Date(`${today}T00:00:00`);
          const start = new Date(end);
          start.setDate(start.getDate() - 6);
          const d = new Date(`${e.data}T00:00:00`);
          return d >= start && d <= end;
        });
      }
      if (painelPeriodo === 'mes') {
        return scopedEntries.filter((e) => {
          const dateISO = String(e.data || '').slice(0, 10);
          return dateISO >= painelMonthStartISO && dateISO <= painelMonthEndISO;
        });
      }
      if (painelPeriodo === 'personalizado') {
        return scopedEntries.filter((e) => {
          const start = new Date(`${painelCustomStart}T00:00:00`);
          const end = new Date(`${painelCustomEnd}T00:00:00`);
          const endPlus = new Date(end); endPlus.setDate(endPlus.getDate() + 1);
          const d = new Date(`${e.data}T00:00:00`);
          return d >= start && d < endPlus;
        });
      }
      return scopedEntries;
    })();

    const vendedoresLocais = users.filter((u) => u.role === 'vendedor');
    const userNameById = new Map(users.map((u) => [u.id, String(u.nome || '').trim()]));
    const avatarById = new Map(users.map((u) => [u.id, String(u.avatar || '')]));
    const map = new Map<string, { vendedorId: string; nome: string; avatar?: string; leads: number; agendamentos: number; vendas: number; followUps: number }>();

    for (const e of filtered) {
      const vendedorId = String(e.vendedorId || '');
      if (!vendedorId) continue;
      const fallbackName = String(e.vendedorNome || '').trim() || userNameById.get(vendedorId) || '—';
      if (!map.has(vendedorId)) {
        map.set(vendedorId, { vendedorId, nome: fallbackName, avatar: avatarById.get(vendedorId) || '', leads: 0, agendamentos: 0, vendas: 0, followUps: 0 });
      }
      const row = map.get(vendedorId)!;
      if ((!row.nome || row.nome === '—') && fallbackName !== '—') {
        row.nome = fallbackName;
      }
      row.leads += e.leadsAtendidos || 0;
      row.agendamentos += e.agendamentos || 0;
      row.vendas += e.vendas || 0;
      row.followUps += e.followUps || 0;
    }

    for (const v of vendedoresLocais) {
      if (!map.has(v.id)) {
        map.set(v.id, { vendedorId: v.id, nome: v.nome || '—', avatar: avatarById.get(v.id) || '', leads: 0, agendamentos: 0, vendas: 0, followUps: 0 });
      }
    }

    const ranking = Array.from(map.values()).sort((a, b) => b.vendas - a.vendas);
    const myIndex = user?.id ? ranking.findIndex((r) => r.vendedorId === user.id) : -1;
    return { ranking, position: myIndex >= 0 ? myIndex + 1 : null };
  }, [scopedEntries, users, painelPeriodo, user?.id, painelCustomStart, painelCustomEnd, painelMonthRef]);

  const effectiveTeamRanking = useMemo(() => {
    const base = isBackendEnabled ? teamRanking : localTeam.ranking;
    if (isAdmin) return base;
    return base.filter((r) => {
      const row: any = r as any;
      const until = parseISODateOnly(String(row?.treinamentoAte || ''));
      const byRow = Boolean(row?.emTreinamento) || (trainingPeriodStart ? Boolean(until && until >= trainingPeriodStart) : false);
      const inTraining = byRow || trainingUserIds.has(String(row?.vendedorId || ''));
      return isTrainingView ? inTraining : !inTraining;
    });
  }, [isBackendEnabled, teamRanking, localTeam.ranking, isAdmin, isTrainingView, trainingUserIds, trainingPeriodStart]);
  const effectiveTeamPosition = isBackendEnabled ? teamPosition : localTeam.position;
  const sellerConversionRanking = useMemo(() => {
    const list = effectiveTeamRanking
      .map((r) => {
        const totalVendas = clampNumber(r.vendas ?? 0, { min: 0 });
        const totalLeads = clampNumber(r.leads ?? 0, { min: 0 });
        const conversao = totalLeads > 0 ? (totalVendas / totalLeads) * 100 : 0;
        return {
          vendedorId: r.vendedorId,
          nome: r.nome,
          avatar: r.avatar,
          totalVendas,
          totalLeads,
          conversao,
        };
      })
      .sort((a, b) => b.conversao - a.conversao || b.totalVendas - a.totalVendas || a.nome.localeCompare(b.nome));
    const ranks = computeRanks(list);
    const rankById = new Map<string, number>();
    ranks.forEach((rk, idx) => rankById.set(list[idx].vendedorId, rk));
    return { list, ranks, rankById };
  }, [effectiveTeamRanking]);

  const mySellerRank = useMemo(() => {
    if (!user?.id) return null;
    return sellerConversionRanking.rankById.get(user.id) ?? null;
  }, [sellerConversionRanking, user?.id]);

  const resolveAvatarSrc = (src?: string) => {
    const v = String(src || '').trim();
    if (!v) return '';
    if (v.startsWith('http://') || v.startsWith('https://')) return v;
    if (v.startsWith('/') && backend) return `${backend}${v}`;
    return v;
  };

  const localAbandonment = useMemo(() => {
    const thresholds = getThresholds();
    const rescue = getRescueEntries();
    const today = new Date().toISOString().slice(0, 10);
    const { startISO: painelMonthStartISO, endISO: painelMonthEndISO } = getEffectiveMonthBounds(painelMonthRef, today);
    const filtered = (() => {
      if (painelPeriodo === 'hoje') return rescue.filter((e) => e.data === today);
      if (painelPeriodo === 'semana') {
        return rescue.filter((e) => {
          const end = new Date(`${today}T00:00:00`);
          const start = new Date(end);
          start.setDate(start.getDate() - 6);
          const d = new Date(`${e.data}T00:00:00`);
          return d >= start && d <= end;
        });
      }
      if (painelPeriodo === 'mes') {
        return rescue.filter((e) => {
          const dateISO = String(e.data || '').slice(0, 10);
          return dateISO >= painelMonthStartISO && dateISO <= painelMonthEndISO;
        });
      }
      if (painelPeriodo === 'personalizado') {
        const start = new Date(`${painelCustomStart}T00:00:00`);
        const end = new Date(`${painelCustomEnd}T00:00:00`);
        const endPlus = new Date(end); endPlus.setDate(endPlus.getDate() + 1);
        return rescue.filter((e) => {
          const d = new Date(`${e.data}T00:00:00`);
          return d >= start && d < endPlus;
        });
      }
      return rescue;
    })();
    const resgatadosByOrigem = new Map<string, number>();
    for (const r of filtered) {
      const origin = String((r as RescueEntry).vendedorOrigem || '');
      if (!origin) continue;
      resgatadosByOrigem.set(origin, (resgatadosByOrigem.get(origin) || 0) + ((r as RescueEntry).leadsResgatados || 0));
    }
    const levels = vendedores
      .map((v) => {
        const totalResgatados = resgatadosByOrigem.get(v.id) || 0;
        const classificacao =
          totalResgatados >= thresholds.vermelho ? 'vermelho' : totalResgatados >= thresholds.amarelo ? 'amarelo' : 'verde';
        return {
          vendedorId: v.id,
          vendedorNome: v.nome,
          avatar: String(v.avatar || ''),
          totalResgatados,
          classificacao,
        } as AbandonmentLevel;
      })
      .sort((a, b) => b.totalResgatados - a.totalResgatados || a.vendedorNome.localeCompare(b.vendedorNome));
    return { levels, thresholds };
  }, [painelCustomEnd, painelCustomStart, painelPeriodo, painelMonthRef, vendedores]);

  const effectiveAbandonment = useMemo(() => {
    if (isBackendEnabled) {
      return { levels: abandonmentLevels.slice().sort((a, b) => b.totalResgatados - a.totalResgatados || a.vendedorNome.localeCompare(b.vendedorNome)), thresholds: abandonmentThresholds };
    }
    return localAbandonment;
  }, [abandonmentLevels, abandonmentThresholds, isBackendEnabled, localAbandonment]);

  const myPenalty = useMemo(() => {
    if (canViewAdminMetrics) return { qtd: 0, percentTotal: 0 };
    if (!user?.id) return { qtd: 0, percentTotal: 0 };
    const row = teamRanking.find((r) => r.vendedorId === user.id) as any;
    const qtd = clampNumber(row?.penalidadeQtd ?? 0, { min: 0 });
    const percentTotal = clampNumber(row?.penalidadePercent ?? 0, { min: 0, max: 100 });
    return { qtd, percentTotal };
  }, [canViewAdminMetrics, teamRanking, user?.id]);

  const awardsRange = useMemo(() => {
    return getAwardsRange(awards.period, awardsRefDate);
  }, [awards.period, awardsRefDate]);

  const awardsSalesByVendedor = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of entries) {
      if (e.data >= awardsRange.startISO && e.data < awardsRange.endISO) {
        const vendedorId = String(e.vendedorId || '');
        if (!vendedorId) continue;
        map.set(vendedorId, (map.get(vendedorId) || 0) + (e.vendas || 0));
      }
    }
    return map;
  }, [entries, awardsRange.startISO, awardsRange.endISO]);

  const awardsPreview = useMemo(() => {
    const rules = awards.rules || [];
    const hasRules = rules.length > 0;
    const rows = vendedores
      .map((v) => {
        const vendas = awardsSalesByVendedor.get(v.id) || 0;
        const penaltyRow = (effectiveTeamRanking.find((r) => r.vendedorId === v.id) as any) || null;
        const penaltyPercent = clampNumber(penaltyRow?.penalidadePercent ?? 0, { min: 0, max: 100 });
        const applicable = hasRules
          ? rules
              .filter((r) => !r.vendedorId || r.vendedorId === v.id)
              .slice()
              .sort((a, b) => clampNumber(a.minVendas || 0, { min: 0 }) - clampNumber(b.minVendas || 0, { min: 0 }) || clampNumber(a.pixValor || 0, { min: 0 }) - clampNumber(b.pixValor || 0, { min: 0 }))
          : [];
        const achieved = hasRules
          ? applicable
              .filter((r) => vendas >= clampNumber(r.minVendas || 0, { min: 0 }))
              .slice()
              .sort((a, b) => clampNumber(b.minVendas || 0, { min: 0 }) - clampNumber(a.minVendas || 0, { min: 0 }) || clampNumber(b.pixValor || 0, { min: 0 }) - clampNumber(a.pixValor || 0, { min: 0 }))[0] || null
          : null;
        const basePix = achieved ? clampNumber(achieved.pixValor || 0, { min: 0 }) : 0;
        const afterPenalty = clampNumber(basePix * ((100 - penaltyPercent) / 100), { min: 0 });
        const pixValor = Math.min(afterPenalty, (basePix * bonusLimitPercent) / 100);
        const next = hasRules
          ? applicable
              .filter((r) => vendas < clampNumber(r.minVendas || 0, { min: 0 }))
              .slice()
              .sort((a, b) => clampNumber(a.minVendas || 0, { min: 0 }) - clampNumber(b.minVendas || 0, { min: 0 }) || clampNumber(a.pixValor || 0, { min: 0 }) - clampNumber(b.pixValor || 0, { min: 0 }))[0] || null
          : null;
        const target = hasRules ? (next ? clampNumber(next.minVendas || 0, { min: 0 }) : (achieved ? clampNumber(achieved.minVendas || 0, { min: 0 }) : 0)) : 20;
        const targetPix = hasRules ? (next ? clampNumber(next.pixValor || 0, { min: 0 }) : 0) : 0;
        const missing = target > vendas ? target - vendas : 0;
        return { vendedorId: v.id, nome: v.nome, vendas, pixValor, target, targetPix, missing };
      })
      .sort((a, b) => b.pixValor - a.pixValor || b.vendas - a.vendas || a.nome.localeCompare(b.nome));

    const totalPix = rows.reduce((sum, r) => sum + r.pixValor, 0);
    return { rows, totalPix };
  }, [awards.rules, awardsSalesByVendedor, vendedores, bonusLimitPercent, effectiveTeamRanking]);

  const entriesBySelectedPeriod = useMemo(() => {
    const { startISO, endISO } = painelRange;
    if (!startISO || !endISO) return entries;
    return entries.filter((e) => {
      const dateISO = String(e.data || '').slice(0, 10);
      return dateISO >= startISO && dateISO <= endISO;
    });
  }, [entries, painelRange]);

  const reportPeriodLabel = useMemo(() => {
    if (painelPeriodo === 'hoje') return 'Diário';
    if (painelPeriodo === 'semana') return 'Semanal';
    if (painelPeriodo === 'mes') return `Mensal (${formatMonthYearBR(painelMonthRef)})`;
    if (painelPeriodo === 'personalizado') return `Personalizado (${formatDateBR(painelCustomStart)} a ${formatDateBR(painelCustomEnd)})`;
    return 'Tudo';
  }, [painelPeriodo, painelMonthRef, painelCustomStart, painelCustomEnd]);

  const reportEntriesBySeller = useMemo(() => {
    const map = new Map<string, CommercialEntry[]>();
    for (const e of entriesBySelectedPeriod) {
      const key = String(e.vendedorId || '');
      if (!key) continue;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    }
    return map;
  }, [entriesBySelectedPeriod]);

  const reportTrafficEntries = useMemo(() => {
    const { startISO, endISO } = painelRange;
    if (!startISO || !endISO) return trafficEntriesAll as any[];
    const toUtcDate = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
    const diffDaysInclusive = (start: string, end: string) => {
      const startDate = toUtcDate(start);
      const endDate = toUtcDate(end);
      const diff = Math.round((endDate.getTime() - startDate.getTime()) / 86400000);
      return diff >= 0 ? diff + 1 : 0;
    };

    return (trafficEntriesAll as any[]).flatMap((t: any) => {
      const tStart = String(t.semana || '').slice(0, 10);
      const tPeriodoTipo = String(t.periodoTipo || 'weekly');
      let tEnd = String(t.fim || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(tEnd)) {
        if (tPeriodoTipo === 'monthly') {
          const monthEnd = new Date(`${tStart.slice(0, 7)}-01T00:00:00`);
          monthEnd.setMonth(monthEnd.getMonth() + 1);
          monthEnd.setDate(monthEnd.getDate() - 1);
          tEnd = monthEnd.toISOString().slice(0, 10);
        } else {
          const end = new Date(`${tStart}T00:00:00`);
          end.setDate(end.getDate() + 6);
          tEnd = end.toISOString().slice(0, 10);
        }
      }
      if (tStart > endISO || tEnd < startISO) return [];

      const overlapStart = tStart < startISO ? startISO : tStart;
      const overlapEnd = tEnd > endISO ? endISO : tEnd;
      const totalDays = diffDaysInclusive(tStart, tEnd);
      const overlapDays = diffDaysInclusive(overlapStart, overlapEnd);
      if (totalDays <= 0 || overlapDays <= 0) return [];

      if (overlapDays >= totalDays) return [{ ...t, fim: tEnd }];

      const factor = overlapDays / totalDays;
      return [{
        ...t,
        semana: overlapStart,
        fim: overlapEnd,
        leads: (Number(t.leads) || 0) * factor,
        investimento: (Number(t.investimento) || 0) * factor,
        receita: (Number(t.receita) || 0) * factor,
      }];
    });
  }, [painelRange, trafficEntriesAll]);

  const activeSellers = useMemo(
    () => vendedores.filter((v) => !trainingUserIds.has(String(v.id || ''))).sort((a, b) => a.nome.localeCompare(b.nome)),
    [vendedores, trainingUserIds],
  );
  const trainingSellers = useMemo(
    () => vendedores.filter((v) => trainingUserIds.has(String(v.id || ''))).sort((a, b) => a.nome.localeCompare(b.nome)),
    [vendedores, trainingUserIds],
  );

  const computeReportMetrics = (sellerEntries: CommercialEntry[]) => {
    return sellerEntries.reduce(
      (acc, e) => {
        const bruto = typeof e.valorBruto === 'number' ? e.valorBruto : 0;
        const desconto = typeof e.descontoValor === 'number'
          ? e.descontoValor
          : typeof e.descontoPercent === 'number'
            ? bruto * (clampNumber(e.descontoPercent, { min: 0, max: 100 }) / 100)
            : 0;
        const liquido = typeof e.valorLiquido === 'number' ? e.valorLiquido : Math.max(bruto - desconto, 0);

        acc.clientes += e.leadsAtendidos || 0;
        acc.agendamentos += e.agendamentos || 0;
        acc.vendas += e.vendas || 0;
        acc.followUps += e.followUps || 0;
        acc.bruto += bruto;
        acc.desconto += desconto;
        acc.liquido += liquido;
        acc.comissao += typeof e.comissao === 'number' ? e.comissao : 0;
        return acc;
      },
      {
        clientes: 0,
        agendamentos: 0,
        vendas: 0,
        followUps: 0,
        bruto: 0,
        desconto: 0,
        liquido: 0,
        comissao: 0,
      },
    );
  };

  const getSellerMonthlyBonus = (seller: User, metricsBase: ReturnType<typeof computeReportMetrics>) => {
    if (painelPeriodo !== 'mes') return null;

    const vendas = metricsBase.vendas;
    const rules = (awards.rules || [])
      .filter((r) => !r.vendedorId || r.vendedorId === seller.id)
      .slice()
      .sort(
        (a, b) =>
          clampNumber(a.minVendas || 0, { min: 0 }) - clampNumber(b.minVendas || 0, { min: 0 }) ||
          clampNumber(a.pixValor || 0, { min: 0 }) - clampNumber(b.pixValor || 0, { min: 0 }),
      );

    const achieved =
      rules
        .filter((r) => vendas >= clampNumber(r.minVendas || 0, { min: 0 }))
        .slice()
        .sort(
          (a, b) =>
            clampNumber(b.minVendas || 0, { min: 0 }) - clampNumber(a.minVendas || 0, { min: 0 }) ||
            clampNumber(b.pixValor || 0, { min: 0 }) - clampNumber(a.pixValor || 0, { min: 0 }),
        )[0] || null;

    const next =
      rules
        .filter((r) => vendas < clampNumber(r.minVendas || 0, { min: 0 }))
        .slice()
        .sort(
          (a, b) =>
            clampNumber(a.minVendas || 0, { min: 0 }) - clampNumber(b.minVendas || 0, { min: 0 }) ||
            clampNumber(a.pixValor || 0, { min: 0 }) - clampNumber(b.pixValor || 0, { min: 0 }),
        )[0] || null;

    const basePix = achieved ? clampNumber(achieved.pixValor || 0, { min: 0 }) : 0;
    const nextBasePix = next ? clampNumber(next.pixValor || 0, { min: 0 }) : 0;
    const penaltyRow = (effectiveTeamRanking.find((r) => r.vendedorId === seller.id) as any) || null;
    const penalidadePercent = clampNumber(penaltyRow?.penalidadePercent ?? 0, { min: 0, max: 100 });
    const afterPenalty = clampNumber(basePix * ((100 - penalidadePercent) / 100), { min: 0 });
    const nextAfterPenalty = clampNumber(nextBasePix * ((100 - penalidadePercent) / 100), { min: 0 });
    const valorFinalAtingido = Math.min(afterPenalty, (basePix * bonusLimitPercent) / 100);
    const proximoValorFinal = Math.min(nextAfterPenalty, (nextBasePix * bonusLimitPercent) / 100);
    const targetVendas = next
      ? clampNumber(next.minVendas || 0, { min: 0 })
      : achieved
        ? clampNumber(achieved.minVendas || 0, { min: 0 })
        : 0;
    const progressoPercent = targetVendas > 0 ? Math.max(0, Math.min(100, (vendas / targetVendas) * 100)) : 0;

    return {
      vendasPeriodo: vendas,
      valorBase: basePix,
      penalidadePercent,
      valorFinal: achieved ? valorFinalAtingido : 0,
      valorReferenciaMeta: achieved ? valorFinalAtingido : proximoValorFinal,
      progressoPercent,
      metaAtingida: achieved ? clampNumber(achieved.minVendas || 0, { min: 0 }) : null,
      proximaMeta: next ? clampNumber(next.minVendas || 0, { min: 0 }) : null,
      faltam: next ? Math.max(clampNumber(next.minVendas || 0, { min: 0 }) - vendas, 0) : 0,
    };
  };

  const handleDownloadSellerReport = async (seller: User) => {
    const sellerEntries = reportEntriesBySeller.get(String(seller.id)) || [];
    if (sellerEntries.length === 0) {
      toast.message('Sem lançamentos para este vendedor no período selecionado');
      return;
    }

    const metricsBase = computeReportMetrics(sellerEntries);
    const conversaoPercent = metricsBase.clientes > 0 ? (metricsBase.vendas / metricsBase.clientes) * 100 : 0;
    const monthlyBonus = getSellerMonthlyBonus(seller, metricsBase);

    try {
      const cac = metricsBase.vendas > 0 && painelCPL > 0 ? (painelCPL * metricsBase.clientes) / metricsBase.vendas : 0;
      await generateCommercialReportPdf({
        sellerName: String(seller.nome || 'Vendedor'),
        periodLabel: reportPeriodLabel,
        entries: sellerEntries,
        products,
        trafficEntries: reportTrafficEntries as any,
        bonus: monthlyBonus,
        metrics: {
          ...metricsBase,
          conversaoPercent,
          cpl: painelCPL,
          cac,
        },
      });
      toast.success('PDF gerado com sucesso');
    } catch {
      toast.error('Falha ao gerar PDF');
    }
  };

  const handleDownloadUnifiedSellerReport = async () => {
    const sellers = [...activeSellers, ...trainingSellers]
      .slice()
      .sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));

    if (sellers.length === 0) {
      toast.message('Sem vendedores para gerar o relatório unificado');
      return;
    }

    try {
      await generateUnifiedCommercialReportPdf({
        periodLabel: reportPeriodLabel,
        cpl: painelCPL,
        products,
        trafficEntries: reportTrafficEntries as any,
        reports: sellers.map((seller) => {
          const sellerEntries = reportEntriesBySeller.get(String(seller.id)) || [];
          const metricsBase = computeReportMetrics(sellerEntries);
          const conversaoPercent = metricsBase.clientes > 0 ? (metricsBase.vendas / metricsBase.clientes) * 100 : 0;
          const cac = metricsBase.vendas > 0 && painelCPL > 0 ? (painelCPL * metricsBase.clientes) / metricsBase.vendas : 0;
          const isTraining = trainingUserIds.has(String(seller.id || ''));
          return {
            sellerName: String(seller.nome || 'Vendedor'),
            periodLabel: reportPeriodLabel,
            entries: sellerEntries,
            products,
            bonus: getSellerMonthlyBonus(seller, metricsBase),
            metrics: {
              ...metricsBase,
              conversaoPercent,
              cpl: painelCPL,
              cac,
            },
            trainingLabel: isTraining ? 'EM TREINAMENTO' : null,
          };
        }),
      });
      toast.success('PDF unificado gerado com sucesso');
    } catch {
      toast.error('Falha ao gerar PDF unificado');
    }
  };

  const myBonusStatus = useMemo(() => {
    if (!user?.id) return null;
    const vendas = awardsSalesByVendedor.get(user.id) || 0;
    const rules = awards.rules || [];
    const applicable = rules
      .filter((r) => !r.vendedorId || r.vendedorId === user.id)
      .slice()
      .sort((a, b) => clampNumber(a.minVendas || 0, { min: 0 }) - clampNumber(b.minVendas || 0, { min: 0 }) || clampNumber(a.pixValor || 0, { min: 0 }) - clampNumber(b.pixValor || 0, { min: 0 }));
    const achieved =
      applicable
        .filter((r) => vendas >= clampNumber(r.minVendas || 0, { min: 0 }))
        .slice()
        .sort((a, b) => clampNumber(b.minVendas || 0, { min: 0 }) - clampNumber(a.minVendas || 0, { min: 0 }) || clampNumber(b.pixValor || 0, { min: 0 }) - clampNumber(a.pixValor || 0, { min: 0 }))[0] || null;
    const next =
      applicable
        .filter((r) => vendas < clampNumber(r.minVendas || 0, { min: 0 }))
        .slice()
        .sort((a, b) => clampNumber(a.minVendas || 0, { min: 0 }) - clampNumber(b.minVendas || 0, { min: 0 }) || clampNumber(a.pixValor || 0, { min: 0 }) - clampNumber(b.pixValor || 0, { min: 0 }))[0] || null;
    const basePix = achieved ? clampNumber(achieved.pixValor || 0, { min: 0 }) : 0;
    const penaltyRow = (effectiveTeamRanking.find((r) => r.vendedorId === user.id) as any) || null;
    const penaltyPercent = clampNumber(penaltyRow?.penalidadePercent ?? 0, { min: 0, max: 100 });
    const afterPenalty = clampNumber(basePix * ((100 - penaltyPercent) / 100), { min: 0 });
    const finalPix = Math.min(afterPenalty, (basePix * bonusLimitPercent) / 100);
    const missing = next ? clampNumber(next.minVendas || 0, { min: 0 }) - vendas : 0;
    const nextBasePix = next ? clampNumber(next.pixValor || 0, { min: 0 }) : 0;
    const nextAfterPenalty = clampNumber(nextBasePix * ((100 - penaltyPercent) / 100), { min: 0 });
    const nextFinalPix = Math.min(nextAfterPenalty, (nextBasePix * bonusLimitPercent) / 100);
    return {
      vendas,
      basePix,
      finalPix,
      penaltyPercent,
      achievedMinVendas: achieved ? clampNumber(achieved.minVendas || 0, { min: 0 }) : null,
      nextMinVendas: next ? clampNumber(next.minVendas || 0, { min: 0 }) : null,
      missing: clampNumber(missing, { min: 0 }),
      rangeLabel: awardsRange.label,
      hasRules: applicable.length > 0,
      nextFinalPix,
      achieved: Boolean(achieved),
    };
  }, [awards.rules, awardsRange.label, awardsSalesByVendedor, bonusLimitPercent, effectiveTeamRanking, user?.id]);

  const handleSave = async () => {
    const productsById = new Map(products.map((p) => [p.id, clampNumber(p.preco ?? 0, { min: 0 })]));
    const vendasPorProduto: CommercialSaleLine[] = saleLines
      .filter(l => l.produtoId && (parseInt(l.quantidade) || 0) > 0)
      .map(l => {
        const produtoId = l.produtoId;
        const snapshot = editingPriceByProductId.get(produtoId);
        const fallback = productsById.get(produtoId) || 0;
        const precoUnitario = typeof snapshot === 'number' && snapshot > 0 ? snapshot : fallback;
        return { produtoId, quantidade: parseInt(l.quantidade) || 0, precoUnitario };
      });

    const usedLaunches = saleLines
      .map((line, idx) => ({
        idx,
        line,
        qty: parseInt(line.quantidade) || 0,
        launch: saleLaunches[idx] || { nome: '', descontoPercent: '0' },
      }))
      .filter((x) => x.qty > 0);

    const normalizedLaunches = usedLaunches.map((item) => ({
      qty: item.qty,
      nome: String(item.launch.nome || '').trim(),
      descontoPercent: String(
        clampNumber(
          parseFloat(String(item.launch.descontoPercent || '').trim().replace(',', '.')) || 0,
          {
            min: 0,
            max: clampNumber(
              products.find((p) => p.id === item.line.produtoId)?.maxDescontoPercent ?? 100,
              { min: 0, max: 100 },
            ),
          },
        ),
      ),
    }));
    const launchDiscountValues = normalizedLaunches.flatMap((l) => {
      const v = clampNumber(parseFloat(l.descontoPercent) || 0, { min: 0, max: 100 });
      const qty = clampNumber(l.qty || 0, { min: 0 });
      return Array.from({ length: qty }, () => v);
    });
    const avgLaunchDiscount =
      launchDiscountValues.length > 0
        ? launchDiscountValues.reduce((sum, v) => sum + v, 0) / launchDiscountValues.length
        : parseFloat(form.descontoPercent) || 0;

    const discountPercent = canShowValues
      ? clampNumber(avgLaunchDiscount, { min: 0, max: maxDiscountAllowed })
      : 0;
    const totals = canShowValues
      ? calculateSaleTotals({ lines: vendasPorProduto, products, discountPercent, sellerCommissionPercent })
      : null;
    const normalizedCampaignScope = campaignScope === 'campanha' ? 'campanha' : 'geral';
    const normalizedCampaignName = String(campaignName || '').trim();
    const hasMissingClientName = totalVendasDoDia > 0 && normalizedLaunches.some((l) => !l.nome);
    const hasMissingLaunchDiscount = totalVendasDoDia > 0 && normalizedLaunches.some((l) => l.descontoPercent === '');
    const normalizedAlunoNome = normalizedLaunches
      .filter((l) => l.nome)
      .flatMap((l) =>
        Array.from(
          { length: clampNumber(l.qty || 0, { min: 0 }) },
          () => `${l.nome} (${(parseFloat(l.descontoPercent) || 0).toFixed(2)}%)`,
        ),
      )
      .join(' | ');
    if (normalizedCampaignScope === 'campanha' && !normalizedCampaignName) {
      toast.error('Selecione ou informe a campanha para lançar venda por campanha');
      return;
    }
    if (!editingEntryId && totalVendasDoDia > 0 && hasMissingClientName) {
      toast.error('Informe o nome do cliente em cada venda');
      return;
    }
    if (!editingEntryId && totalVendasDoDia > 0 && hasMissingLaunchDiscount) {
      toast.error('Informe o desconto (%) em cada venda');
      return;
    }

    if (isBackendEnabled) {
      try {
        const payload: any = {
          data: form.data || new Date().toISOString().slice(0, 10),
          campaignScope: normalizedCampaignScope,
          campaignName: normalizedCampaignScope === 'campanha' ? normalizedCampaignName : null,
          leadsAtendidos: parseInt(form.leadsAtendidos) || 0,
          agendamentos: parseInt(form.agendamentos) || 0,
          vendas: totalVendasDoDia,
          followUps: parseInt(form.followUps) || 0,
          vendasPorProduto: vendasPorProduto.length > 0 ? vendasPorProduto : [],
          descontoPercent: canShowValues && discountPercent > 0 ? discountPercent : 0,
          alunoNome: normalizedAlunoNome,
        };

        const url = editingEntryId ? `${commercialApiBase}/${editingEntryId}` : `${commercialApiBase}`;
        const method = editingEntryId ? 'PUT' : 'POST';

        const res = await fetch(url, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error || 'Falha ao salvar registro');
        const saved = data?.entry;
        if (!saved) throw new Error('Resposta inválida do servidor');

        const mapped: CommercialEntry = {
          criadoPor: String(saved.criadoPor || ''),
          criadoPorNome: String(saved.criadoPorNome || ''),
          id: String(saved.id),
          data: String(saved.data || ''),
          vendedorId: String(saved.vendedorId || user?.id || ''),
          vendedorNome: String(saved.vendedorNome || ''),
          campaignScope: saved.campaignScope === 'campanha' ? 'campanha' : 'geral',
          campaignName: String(saved.campaignName || ''),
          leadsAtendidos: parseInt(String(saved.leadsAtendidos || '0')) || 0,
          agendamentos: parseInt(String(saved.agendamentos || '0')) || 0,
          vendas: parseInt(String(saved.vendas || '0')) || 0,
          followUps: parseInt(String(saved.followUps || '0')) || 0,
          vendasPorProduto: Array.isArray(saved.vendasPorProduto)
            ? saved.vendasPorProduto.map((l: any) => ({
                produtoId: String(l.produtoId),
                quantidade: parseInt(String(l.quantidade || '0')) || 0,
                precoUnitario:
                  typeof l.precoUnitario === 'number' ? l.precoUnitario : parseFloat(String(l.precoUnitario || '0')) || 0,
              }))
            : undefined,
          alunoNome: String(saved.alunoNome || ''),
          descontoPercent: typeof saved.descontoPercent === 'number' ? saved.descontoPercent : undefined,
          descontoValor: typeof saved.descontoValor === 'number' ? saved.descontoValor : undefined,
          valorBruto: typeof saved.valorBruto === 'number' ? saved.valorBruto : undefined,
          valorLiquido: typeof saved.valorLiquido === 'number' ? saved.valorLiquido : undefined,
          comissao: typeof saved.comissao === 'number' ? saved.comissao : undefined,
          criadoEm: String(saved.criadoEm || ''),
        };

        const next = editingEntryId ? entries.map((e) => (e.id === mapped.id ? mapped : e)) : [mapped, ...entries];
        setEntries(next);
        saveCommercialEntries(next);
        toast.success(editingEntryId ? 'Registro atualizado' : 'Registro criado');
        setEditingEntryId(null);
        setShowForm(false);
        setForm({ data: '', leadsAtendidos: '', agendamentos: '', followUps: '', descontoPercent: '0', alunoNome: '' });
        setSaleLaunches([]);
        setCampaignScope('geral');
        setCampaignName('');
        setSaleLines([{ id: crypto.randomUUID(), produtoId: '', quantidade: '' }]);
        return;
      } catch (e: any) {
        toast.error(String(e?.message || 'Falha ao salvar registro'));
        return;
      }
    }

    const entry: CommercialEntry = {
      id: editingEntryId || crypto.randomUUID(),
      data: form.data || new Date().toISOString().slice(0, 10),
      criadoPor: user?.id || '',
      criadoPorNome: user?.nome || '',
      vendedorId: user?.id || '',
      vendedorNome: user?.nome || '',
      campaignScope: normalizedCampaignScope,
      campaignName: normalizedCampaignScope === 'campanha' ? normalizedCampaignName : '',
      leadsAtendidos: parseInt(form.leadsAtendidos) || 0,
      agendamentos: parseInt(form.agendamentos) || 0,
      vendas: totalVendasDoDia,
      followUps: parseInt(form.followUps) || 0,
      vendasPorProduto: vendasPorProduto.length > 0 ? vendasPorProduto : undefined,
      alunoNome: normalizedAlunoNome,
      descontoPercent: canShowValues && discountPercent > 0 ? discountPercent : undefined,
      descontoValor: canShowValues && totals && totals.discountValue > 0 ? totals.discountValue : undefined,
      valorBruto: canShowValues && totals && totals.grossRevenue > 0 ? totals.grossRevenue : undefined,
      valorLiquido: canShowValues && totals && totals.netRevenue > 0 ? totals.netRevenue : undefined,
      comissao: canShowValues && totals && totals.commission > 0 ? totals.commission : undefined,
      criadoEm: new Date().toISOString(),
    };
    const next = editingEntryId ? entries.map((e) => (e.id === entry.id ? entry : e)) : [...entries, entry];
    setEntries(next);
    saveCommercialEntries(next);
    toast.success(editingEntryId ? 'Registro atualizado' : 'Registro criado');
    setEditingEntryId(null);
    setShowForm(false);
    setForm({ data: '', leadsAtendidos: '', agendamentos: '', followUps: '', descontoPercent: '0', alunoNome: '' });
    setSaleLaunches([]);
    setCampaignScope('geral');
    setCampaignName('');
    setSaleLines([{ id: crypto.randomUUID(), produtoId: '', quantidade: '' }]);
  };

  // Ranking
  const ranking = useMemo(() => {
    const allVendedores = canViewAdminMetrics ? adminVendedores : user?.role === 'vendedor' ? [user] : [];
    const sourceEntries = canViewAdminMetrics ? painelEntries : vendedorPainelEntries;

    return allVendedores
      .map((v) => {
        const vEntries = sourceEntries.filter((e) => e.vendedorId === v.id);
        const totalVendas = vEntries.reduce((s, e) => s + e.vendas, 0);
        const totalLeads = vEntries.reduce((s, e) => s + e.leadsAtendidos, 0);
        const totalAgend = vEntries.reduce((s, e) => s + e.agendamentos, 0);
        return {
          ...v,
          totalVendas,
          totalLeads,
          totalAgend,
          conversao: totalLeads > 0 ? (totalVendas / totalLeads) * 100 : 0,
          taxaAgend: totalLeads > 0 ? (totalAgend / totalLeads) * 100 : 0,
        };
      })
      .sort((a, b) => b.totalVendas - a.totalVendas);
  }, [canViewAdminMetrics, adminVendedores, painelEntries, vendedorPainelEntries, user]);

  const podiumIcons = [Trophy, Medal, Award];
  const podiumColors = ['text-primary', 'text-muted-foreground', 'text-foreground/70'];

  const chartData = ranking.map(r => ({
    nome: r.nome.split(' ')[0],
    vendas: r.totalVendas,
    agendamentos: r.totalAgend,
  }));

  const handleEditEntry = (entry: CommercialEntry) => {
    if (entryHasInactiveProduct(entry)) return;
    setEditingEntryId(entry.id);
    setShowForm(true);
    setForm({
      data: entry.data || '',
      leadsAtendidos: String(entry.leadsAtendidos || 0),
      agendamentos: String(entry.agendamentos || 0),
      followUps: String(entry.followUps || 0),
      descontoPercent: typeof entry.descontoPercent === 'number' ? String(entry.descontoPercent) : '0',
      alunoNome: String(entry.alunoNome || ''),
    });
    setCampaignScope(entry.campaignScope === 'campanha' ? 'campanha' : 'geral');
    setCampaignName(String(entry.campaignName || ''));
    const lines = (entry.vendasPorProduto || []).map((l) => ({
      id: crypto.randomUUID(),
      produtoId: l.produtoId,
      quantidade: String(l.quantidade || 0),
    }));
    const finalLines = lines.length > 0 ? lines : [{ id: crypto.randomUUID(), produtoId: '', quantidade: '' }];
    setSaleLines(finalLines);

    const parsed = parseClientLaunches(
      String(entry.alunoNome || ''),
      typeof entry.descontoPercent === 'number' ? String(entry.descontoPercent) : '0',
    );
    setSaleLaunches(
      finalLines.map((line, idx) => {
        const cursor = finalLines
          .slice(0, idx)
          .reduce((sum, l) => sum + clampNumber(parseInt(l.quantidade) || 0, { min: 0 }), 0);
        const token = parsed[cursor] || parsed[idx] || null;
        return {
          nome: token?.nome || '',
          descontoPercent: token?.descontoPercent || (typeof entry.descontoPercent === 'number' ? String(entry.descontoPercent) : '0'),
        };
      }),
    );
  };

  const handleDeleteEntry = async (id: string) => {
    const entry = entries.find((e) => e.id === id);
    if (entry && entryHasInactiveProduct(entry)) return;
    if (isBackendEnabled) {
      try {
        const res = await fetch(`${commercialApiBase}/${id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error || 'Falha ao remover registro');
        const next = entries.filter((e) => e.id !== id);
        setEntries(next);
        saveCommercialEntries(next);
        toast.success('Registro removido');
      } catch (e: any) {
        toast.error(String(e?.message || 'Falha ao remover registro'));
      }
      return;
    }

    const next = entries.filter((e) => e.id !== id);
    setEntries(next);
    saveCommercialEntries(next);
    toast.success('Registro removido');
  };

  const upsertProducts = (names: string[]) => {
    const existingByKey = new Map(products.map(p => [normalizeProductName(p.nome).toLowerCase(), p]));
    const toAdd = names
      .map(normalizeProductName)
      .filter(Boolean)
      .filter(n => !existingByKey.has(n.toLowerCase()))
      .map(n => ({
        id: crypto.randomUUID(),
        nome: n,
        capaUrl: '',
        preco: 0,
        maxDescontoPercent: 0,
        ativo: true,
        criadoEm: new Date().toISOString(),
      } satisfies Product));

    if (toAdd.length === 0) return { added: 0, total: products.length };
    const updated = [...products, ...toAdd].sort((a, b) => a.nome.localeCompare(b.nome));
    setProducts(updated);
    saveProducts(updated);
    return { added: toAdd.length, total: updated.length };
  };

  const handleAddProduct = async () => {
    if (!canCreateProducts) {
      toast.error('Você não tem permissão para criar produtos');
      return;
    }
    const name = normalizeProductName(productName);
    if (!name) return;

    if (isBackendEnabled) {
      try {
        const res = await fetch(`${backend}/api/products`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ nome: name, capaUrl: '', preco: 0, maxDescontoPercent: 0 }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error || 'Falha ao criar produto');
        const p = data?.product;
        if (p) {
          setProducts((prev) =>
            [...prev, {
              id: String(p.id),
              nome: String(p.nome || ''),
              capaUrl: String(p.capaUrl || ''),
              preco: typeof p.preco === 'number' ? p.preco : parseFloat(String(p.preco || '0')) || 0,
              maxDescontoPercent:
                typeof p.maxDescontoPercent === 'number'
                  ? p.maxDescontoPercent
                  : parseFloat(String(p.maxDescontoPercent || '0')) || 0,
              ativo: typeof p.ativo === 'boolean' ? p.ativo : true,
              criadoEm: String(p.criadoEm || ''),
            }].sort((a, b) => a.nome.localeCompare(b.nome)),
          );
          toast.success('Produto criado');
        }
      } catch (e: any) {
        toast.error(String(e?.message || 'Falha ao criar produto'));
      } finally {
        setProductName('');
      }
      return;
    }

    const result = upsertProducts([name]);
    if (result.added > 0) toast.success('Produto criado');
    else toast.message('Produto já existe');
    setProductName('');
  };

  const resetNewEntryForm = () => {
    setEditingEntryId(null);
    setForm({ data: '', leadsAtendidos: '', agendamentos: '', followUps: '', descontoPercent: '0', alunoNome: '' });
    setSaleLaunches([]);
    setCampaignScope('geral');
    setCampaignName('');
    setSaleLines([{ id: crypto.randomUUID(), produtoId: '', quantidade: '' }]);
  };

  const handleDeleteProduct = async (id: string) => {
    if (!canDeleteProducts) {
      toast.error('Você não tem permissão para apagar produtos');
      return;
    }
    if (isBackendEnabled) {
      try {
        const res = await fetch(`${backend}/api/products/${id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error || 'Falha ao remover produto');
        setProducts((prev) => {
          const next = prev.map((p) => (p.id === id ? { ...p, ativo: false } : p));
          saveProducts(next);
          return next;
        });
        toast.success('Produto desativado');
      } catch (e: any) {
        toast.error(String(e?.message || 'Falha ao remover produto'));
      }
      return;
    }

    const updated = products.map((p) => (p.id === id ? { ...p, ativo: false } : p));
    setProducts(updated);
    saveProducts(updated);
    toast.success('Produto desativado');
  };

  const handleUpdateProduct = async (id: string, patch: Partial<Product>) => {
    if (!canUpdateProducts) {
      toast.error('Você não tem permissão para editar produtos');
      return false;
    }
    if (isBackendEnabled) {
      try {
        const res = await fetch(`${backend}/api/products/${id}`, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(patch),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error || 'Falha ao atualizar produto');
        const updatedProduct = data?.product;
        if (updatedProduct) {
          setProducts((prev) =>
            prev.map((p) =>
              p.id === id
                ? {
                    ...p,
                    nome: String(updatedProduct.nome || p.nome),
                    capaUrl: String(updatedProduct.capaUrl || ''),
                            descricao: String(updatedProduct.descricao || ''),
                    ativo: typeof updatedProduct.ativo === 'boolean' ? updatedProduct.ativo : p.ativo,
                    preco:
                      typeof updatedProduct.preco === 'number'
                        ? updatedProduct.preco
                        : parseFloat(String(updatedProduct.preco || '0')) || 0,
                    maxDescontoPercent:
                      typeof updatedProduct.maxDescontoPercent === 'number'
                        ? updatedProduct.maxDescontoPercent
                        : parseFloat(String(updatedProduct.maxDescontoPercent || '0')) || 0,
                  }
                : p,
            ),
          );
        } else {
          setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
        }
        return true;
      } catch (e: any) {
        toast.error(String(e?.message || 'Falha ao atualizar produto'));
      }
      return false;
    }

    const updated = products.map(p => (p.id === id ? { ...p, ...patch } : p));
    setProducts(updated);
    saveProducts(updated);
    return true;
  };

  const handleSetProductCoverFromFile = async (id: string, file: File) => {
    if (isBackendEnabled) {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('folder', 'product-covers');
      const res = await fetch(`${backend}/api/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Falha ao enviar imagem');
      const key = String(data?.key || '').trim();
      if (!key) throw new Error('Upload não retornou chave');
      await handleUpdateProduct(id, { capaUrl: key });
      return;
    }

    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Falha ao ler arquivo'));
      reader.readAsDataURL(file);
    });
    await handleUpdateProduct(id, { capaUrl: dataUrl });
  };

  const handleImportProducts = async (file: File) => {
    const text = await file.text();
    const rows = parseDelimitedText(text);
    if (rows.length === 0) {
      toast.error('Planilha vazia');
      return;
    }
    const header = rows[0].map(h => h.toLowerCase());
    const nameIndex = header.findIndex(h => ['nome', 'produto', 'product', 'name'].includes(h));
    const descriptionIndex = header.findIndex(h => ['descricao', 'descrição', 'description', 'desc'].includes(h));
    const priceIndex = header.findIndex(h => ['preco', 'preço', 'price', 'valor'].includes(h));
    const maxDiscountIndex = header.findIndex(h => ['maxdesconto', 'max_desconto', 'maxdesconto%', 'max_desconto%', 'maximo_desconto', 'maximo_desconto%', 'máx desconto', 'máximo desconto', 'maxdescontopercent', 'maxdescontopercentual', 'maxdescontopercent%'].includes(h));
    const coverIndex = header.findIndex(h => ['capa', 'imagem', 'image', 'cover', 'capa_url', 'imagem_url'].includes(h));
    const dataRows = nameIndex >= 0 ? rows.slice(1) : rows;
    const incoming = dataRows
      .map(r => {
        const nome = (nameIndex >= 0 ? r[nameIndex] : r[0]) || '';
        const descricaoRaw = descriptionIndex >= 0 ? r[descriptionIndex] : '';
        const precoRaw = priceIndex >= 0 ? r[priceIndex] : '';
        const maxDiscountRaw = maxDiscountIndex >= 0 ? r[maxDiscountIndex] : '';
        const capaRaw = coverIndex >= 0 ? r[coverIndex] : '';
        const descricao = String(descricaoRaw || '').trim();
        const preco = clampNumber(parseFloat(String(precoRaw || '').replace(',', '.')) || 0, { min: 0 });
        const maxDescontoPercent = clampNumber(parseFloat(String(maxDiscountRaw || '').replace('%', '').replace(',', '.')) || 0, { min: 0, max: 100 });
        const capaUrl = String(capaRaw || '').trim();
        return { nome: normalizeProductName(nome), descricao, preco, maxDescontoPercent, capaUrl };
      })
      .filter(p => p.nome);

    if (isBackendEnabled) {
      try {
        const existingByKey = new Set(products.map(p => normalizeProductName(p.nome).toLowerCase()));
        const toCreate = incoming.filter(p => !existingByKey.has(p.nome.toLowerCase()));
        if (toCreate.length === 0) {
          toast.message('Nenhum produto novo para importar');
          return;
        }
        for (const p of toCreate) {
          const res = await fetch(`${backend}/api/products`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              nome: p.nome,
              capaUrl: p.capaUrl,
              descricao: p.descricao,
              preco: p.preco,
              maxDescontoPercent: p.maxDescontoPercent,
            }),
          });
          if (!res.ok) {
            const data = await res.json().catch(() => null);
            throw new Error(data?.error || `Falha ao importar: ${p.nome}`);
          }
        }
        const res = await fetch(`${backend}/api/products`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error || 'Falha ao recarregar produtos');
        const remoteProducts = Array.isArray(data?.products) ? data.products : [];
        setProducts(
          remoteProducts.map((p: any) => ({
            id: String(p.id),
            nome: String(p.nome || ''),
            capaUrl: String(p.capaUrl || ''),
            descricao: String(p.descricao || ''),
            preco: typeof p.preco === 'number' ? p.preco : parseFloat(String(p.preco || '0')) || 0,
            maxDescontoPercent:
              typeof p.maxDescontoPercent === 'number'
                ? p.maxDescontoPercent
                : parseFloat(String(p.maxDescontoPercent || '0')) || 0,
            criadoEm: String(p.criadoEm || ''),
          })),
        );
        toast.success(`Importação concluída (${toCreate.length} novos)`);
      } catch (e: any) {
        toast.error(String(e?.message || 'Falha ao importar'));
      }
      return;
    }

    const existingByKey = new Map(products.map(p => [normalizeProductName(p.nome).toLowerCase(), p]));
    const toAdd = incoming
      .filter(p => !existingByKey.has(p.nome.toLowerCase()))
      .map(p => ({
        id: crypto.randomUUID(),
        nome: p.nome,
        capaUrl: p.capaUrl,
        descricao: p.descricao,
        preco: p.preco,
        maxDescontoPercent: p.maxDescontoPercent,
        criadoEm: new Date().toISOString(),
      } satisfies Product));

    const updated = [...products, ...toAdd].sort((a, b) => a.nome.localeCompare(b.nome));
    setProducts(updated);
    saveProducts(updated);
    const result = { added: toAdd.length, total: updated.length };
    toast.success(`Importação concluída (${result.added} novos)`);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[1.625rem] leading-tight font-semibold tracking-tight">Módulo Comercial</h1>
          <p className="text-muted-foreground text-sm mt-1">Registro diário de atendimento</p>
        </div>
        {!isAdmin && (
          <Button
            onClick={() => {
              if (!showForm) resetNewEntryForm();
              setShowForm(!showForm);
            }}
            className="active:scale-[0.97]"
          >
            <Plus className="mr-2 h-4 w-4" /> Novo Registro
          </Button>
        )}
      </div>

      {canViewAdminMetrics ? (
        <>
          <Card>
            <CardContent className="pt-6">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant={adminSellerView === 'ativos' ? 'default' : 'outline'}
                  onClick={() => setAdminSellerView('ativos')}
                >
                  Vendedores ativos
                </Button>
                <Button
                  variant={adminSellerView === 'treinamento' ? 'default' : 'outline'}
                  onClick={() => setAdminSellerView('treinamento')}
                >
                  Vendedores em treinamento
                </Button>
              </div>
            </CardContent>
          </Card>

          <Tabs value={activeTab} onValueChange={v => setActiveTab(v as 'painel' | 'produtos' | 'premiacao' | 'baixar')}>
          <TabsList>
            <TabsTrigger value="painel">Painel</TabsTrigger>
            {canManageProducts && <TabsTrigger value="produtos">Produtos</TabsTrigger>}
            {isAdmin && <TabsTrigger value="premiacao">Premiação</TabsTrigger>}
            <TabsTrigger value="baixar">Baixar registros</TabsTrigger>
          </TabsList>

          <TabsContent value="painel" className="space-y-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-base">Métricas</CardTitle>
                <div className="flex items-center gap-2">
                  <Select value={painelPeriodo} onValueChange={(v) => setPainelPeriodo(v as any)}>
                    <SelectTrigger className="w-44">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hoje">Diário</SelectItem>
                      <SelectItem value="semana">Semanal</SelectItem>
                      <SelectItem value="mes">Mensal</SelectItem>
                      <SelectItem value="personalizado">Personalizado</SelectItem>
                      <SelectItem value="tudo">Tudo</SelectItem>
                    </SelectContent>
                  </Select>
                  {painelPeriodo === 'mes' && (
                    <>
                      <Select
                        value={painelMonthRef.slice(5, 7)}
                        onValueChange={(month) => {
                          setPainelMonthWasSelected(true);
                          setPainelMonthRef(`${painelMonthRef.slice(0, 4)}-${month}-01`);
                        }}
                      >
                        <SelectTrigger className="w-36">
                          <SelectValue placeholder="Mês" />
                        </SelectTrigger>
                        <SelectContent>
                          {painelMonthOptions.map((m) => (
                            <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select
                        value={painelMonthRef.slice(0, 4)}
                        onValueChange={(year) => {
                          setPainelMonthWasSelected(true);
                          setPainelMonthRef(`${year}-${painelMonthRef.slice(5, 7)}-01`);
                        }}
                      >
                        <SelectTrigger className="w-28">
                          <SelectValue placeholder="Ano" />
                        </SelectTrigger>
                        <SelectContent>
                          {painelYearOptions.map((year) => (
                            <SelectItem key={year} value={year}>{year}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </>
                  )}
                  {(painelPeriodo === 'personalizado') && (
                    <>
                      <Input type="date" value={painelCustomStart} onChange={(e) => setPainelCustomStart(e.target.value)} className="w-36" />
                      <Input type="date" value={painelCustomEnd} onChange={(e) => setPainelCustomEnd(e.target.value)} className="w-36" />
                    </>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="rounded-lg border border-border bg-muted/20 px-4 py-3">
                    <p className="text-xs text-muted-foreground">Clientes</p>
                    <p className="text-xl font-bold tabular-nums">{painelTotals.leads}</p>
                  </div>
                  <div className="rounded-lg border border-border bg-muted/20 px-4 py-3">
                    <p className="text-xs text-muted-foreground">Agendamentos</p>
                    <p className="text-xl font-bold tabular-nums">{painelTotals.agend}</p>
                  </div>
                  <div className="rounded-lg border border-border bg-muted/20 px-4 py-3">
                    <p className="text-xs text-muted-foreground">Vendas</p>
                    <p className="text-xl font-bold tabular-nums">{painelTotals.vendas}</p>
                  </div>
                  <div className="rounded-lg border border-border bg-muted/20 px-4 py-3">
                    <p className="text-xs text-muted-foreground">Conversão (vendas/clientes)</p>
                    <p className="text-xl font-bold tabular-nums">{painelConversaoPercent.toFixed(1)}%</p>
                  </div>
                  <div className="rounded-lg border border-border bg-muted/20 px-4 py-3">
                    <p className="text-xs text-muted-foreground">Follow-ups</p>
                    <p className="text-xl font-bold tabular-nums">{painelTotals.followUps}</p>
                  </div>
                  <div className="rounded-lg border border-border bg-muted/20 px-4 py-3">
                    <p className="text-xs text-muted-foreground">Bruto</p>
                    <p className="text-xl font-bold tabular-nums">{formatBRL(painelTotals.bruto)}</p>
                  </div>
                  <div className="rounded-lg border border-border bg-muted/20 px-4 py-3">
                    <p className="text-xs text-muted-foreground">Líquido</p>
                    <p className="text-xl font-bold tabular-nums">{formatBRL(painelTotals.liquido)}</p>
                  </div>
                  <div className="rounded-lg border border-border bg-muted/20 px-4 py-3">
                    <p className="text-xs text-muted-foreground">Comissão (R$)</p>
                    <p className="text-xl font-bold tabular-nums">{formatBRL(painelTotals.comissao)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Vendas por Vendedor</CardTitle></CardHeader>
              <CardContent>
                {vendasPorVendedor.length === 0 ? (
                  <div className="text-sm text-muted-foreground">Nenhum vendedor encontrado.</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Vendedor</TableHead>
                        <TableHead className="text-right">Clientes</TableHead>
                        <TableHead className="text-right">Agendamentos</TableHead>
                        <TableHead className="text-right">Vendas</TableHead>
                        <TableHead className="text-right">Follow-ups</TableHead>
                        <TableHead className="text-right">Conversão (v/c)</TableHead>
                        <TableHead className="text-right">Bruto</TableHead>
                        <TableHead className="text-right">Ticket médio bruto</TableHead>
                        <TableHead className="text-right">Líquido</TableHead>
                        <TableHead className="text-right">Ticket médio líquido</TableHead>
                        <TableHead className="text-right">Comissão (R$)</TableHead>
                        {canViewAdminMetrics && painelCPL > 0 && <TableHead className="text-right">CAC</TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {vendasPorVendedor.map((r) => {
                        const conv = r.leads > 0 ? (r.vendas / r.leads) * 100 : 0;
                        const brutoComDesconto = Math.max(r.bruto - r.desconto, 0);
                        const ticketMedioBruto = r.vendas > 0 ? brutoComDesconto / r.vendas : 0;
                        const ticketMedioLiquido = r.vendas > 0 ? r.liquido / r.vendas : 0;
                        return (
                          <TableRow key={r.id}>
                            <TableCell className="font-medium">{r.nome}</TableCell>
                            <TableCell className="text-right tabular-nums">{r.leads}</TableCell>
                            <TableCell className="text-right tabular-nums">{r.agend}</TableCell>
                            <TableCell className="text-right tabular-nums font-semibold">{r.vendas}</TableCell>
                            <TableCell className="text-right tabular-nums">{r.followUps}</TableCell>
                            <TableCell className="text-right tabular-nums">{conv.toFixed(1)}%</TableCell>
                            <TableCell className="text-right tabular-nums">{formatBRL(r.bruto)}</TableCell>
                            <TableCell className="text-right tabular-nums">{r.vendas > 0 ? formatBRL(ticketMedioBruto) : '—'}</TableCell>
                            <TableCell className="text-right tabular-nums">{formatBRL(r.liquido)}</TableCell>
                            <TableCell className="text-right tabular-nums">{r.vendas > 0 ? formatBRL(ticketMedioLiquido) : '—'}</TableCell>
                            <TableCell className="text-right tabular-nums">{formatBRL(r.comissao)}</TableCell>
                              {canViewAdminMetrics && painelCPL > 0 && (
                                <TableCell className="text-right tabular-nums">
                                  {r.vendas > 0 ? formatBRL(r.cac) : '—'}
                                </TableCell>
                              )}
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            {ranking.length > 0 && (
              <Card>
                <CardHeader><CardTitle className="text-base">🏆 Ranking de Vendas</CardTitle></CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {ranking.slice(0, 5).map((r, i) => {
                      const Icon = podiumIcons[i] || Medal;
                      const color = podiumColors[i] || 'text-muted-foreground';
                      return (
                        <div key={r.id} className="flex items-center gap-3 p-3 rounded-lg bg-muted/40">
                          <span className="text-lg font-bold text-muted-foreground w-6 text-center">{i + 1}</span>
                          <Icon className={`w-5 h-5 ${color}`} />
                          <div className="flex-1 min-w-0">
                            <p className="font-medium truncate">{r.nome}</p>
                            <p className="text-xs text-muted-foreground">Conversão (v/c): {r.conversao.toFixed(1)}% · Agendamento (a/c): {r.taxaAgend.toFixed(1)}%</p>
                          </div>
                          <span className="font-bold tabular-nums">{r.totalVendas} vendas</span>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}

            {chartData.length > 0 && (
              <Card>
                <CardHeader><CardTitle className="text-base">Performance por Vendedor</CardTitle></CardHeader>
                <CardContent>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" />
                        <XAxis dataKey="nome" className="text-xs" />
                        <YAxis className="text-xs" />
                        <Tooltip />
                        <Bar dataKey="vendas" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
                        <Bar dataKey="agendamentos" fill="hsl(var(--primary) / 0.4)" radius={[6, 6, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            )}

            {myEntries.length > 0 && (
              <Card>
                <CardHeader><CardTitle className="text-base">Histórico</CardTitle></CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Data</TableHead>
                        <TableHead>Vendedor</TableHead>
                        <TableHead className="text-right">Clientes</TableHead>
                        <TableHead className="text-right">Agendamentos</TableHead>
                        <TableHead className="text-right">Produtos</TableHead>
                        <TableHead className="text-right">Follow-ups</TableHead>
                        <TableHead className="text-right">Conversão (v/c)</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {myEntries.sort((a, b) => b.data.localeCompare(a.data)).map(e => {
                        const v = vendedores.find(v => v.id === e.vendedorId);
                        const conv = e.leadsAtendidos > 0 ? (e.vendas / e.leadsAtendidos * 100).toFixed(1) : '0.0';
                        return (
                          <TableRow key={e.id}>
                            <TableCell>{formatDateBR(e.data)}</TableCell>
                            <TableCell>{v?.nome || '—'}</TableCell>
                            <TableCell className="text-right tabular-nums">{e.leadsAtendidos}</TableCell>
                            <TableCell className="text-right tabular-nums">{e.agendamentos}</TableCell>
                            <TableCell className="text-right tabular-nums font-semibold">{e.vendas}</TableCell>
                            <TableCell className="text-right tabular-nums">{e.followUps}</TableCell>
                            <TableCell className="text-right tabular-nums font-semibold">{conv}%</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {canManageProducts && (
          <TabsContent value="produtos" className="space-y-6">
            <Card>
              <CardHeader><CardTitle className="text-base">Cadastro de Produtos</CardTitle></CardHeader>
              <CardContent className="space-y-5">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                  <div className="space-y-1.5 md:col-span-2">
                    <Label>Nome do produto</Label>
                    <Input value={productName} onChange={e => setProductName(e.target.value)} placeholder="Ex: Mentoria Premium" />
                  </div>
                  <Button onClick={handleAddProduct} disabled={!normalizeProductName(productName) || !canCreateProducts}>
                    <Plus className="mr-2 h-4 w-4" /> Adicionar
                  </Button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                  <div className="space-y-1.5 md:col-span-2">
                    <Label>Importar planilha (CSV)</Label>
                    <Input
                      type="file"
                      accept=".csv,text/csv"
                      onChange={async e => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        try {
                          await handleImportProducts(file);
                        } catch {
                          toast.error('Falha ao importar');
                        } finally {
                          e.target.value = '';
                        }
                      }}
                    />
                  </div>
                  <Button variant="outline" onClick={() => toast.message('Colunas aceitas: nome/produto (ou primeira coluna), descricao, preco, max_desconto, capa')}>
                    <Upload className="mr-2 h-4 w-4" /> Formato
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 gap-3">
                <CardTitle className="text-base">
                  Produtos ({filteredActiveProducts.length}{productSearch.trim() ? ` de ${activeProducts.length}` : ''})
                </CardTitle>
                <Input
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  placeholder="Buscar por produto ou descrição"
                  className="w-full md:w-80"
                />
              </CardHeader>
              <CardContent>
                {filteredActiveProducts.length === 0 ? (
                  <div className="text-sm text-muted-foreground">
                    {productSearch.trim() ? 'Nenhum produto encontrado para a busca.' : 'Nenhum produto cadastrado.'}
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Capa</TableHead>
                        <TableHead>Produto</TableHead>
                        <TableHead>Descrição</TableHead>
                        <TableHead className="text-right">Preço</TableHead>
                        <TableHead className="text-right">Máx desconto (%)</TableHead>
                        <TableHead className="text-right">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredActiveProducts
                        .slice()
                        .sort((a, b) => a.nome.localeCompare(b.nome))
                        .map(p => (
                          <TableRow key={p.id} className={p.ativo === false ? 'opacity-50' : ''}>
                            <TableCell>
                              <div className="flex items-center gap-3">
                                <div className="w-12 h-12 rounded-md overflow-hidden bg-muted flex items-center justify-center border border-border">
                                  {p.capaUrl ? (
                                    <div
                                      role="img"
                                      aria-label={p.nome}
                                      className="w-full h-full bg-cover bg-center"
                                      style={{ backgroundImage: `url(${JSON.stringify(resolveAvatarSrc(p.capaUrl))})` }}
                                    />
                                  ) : (
                                    <span className="text-xs text-muted-foreground">—</span>
                                  )}
                                </div>
                                <div className="flex items-center gap-2">
                                  <Input
                                    type="file"
                                    accept="image/*"
                                    disabled={p.ativo === false || !canUpdateProducts}
                                    onChange={async (e) => {
                                      const file = e.target.files?.[0];
                                      if (!file) return;
                                      try {
                                        await handleSetProductCoverFromFile(p.id, file);
                                      } catch {
                                        toast.error('Falha ao definir capa');
                                      } finally {
                                        e.target.value = '';
                                      }
                                    }}
                                  />
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handleUpdateProduct(p.id, { capaUrl: '' })}
                                    disabled={!p.capaUrl || p.ativo === false || !canUpdateProducts}
                                  >
                                    Limpar
                                  </Button>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="font-medium">
                              <Input
                                value={String(p.nome || '')}
                                disabled={p.ativo === false || !canUpdateProducts}
                                onChange={(e) => {
                                  const value = e.target.value;
                                  setProducts((prev) => prev.map((x) => (x.id === p.id ? { ...x, nome: value } : x)));
                                }}
                                onBlur={() => handleUpdateProduct(p.id, { nome: normalizeProductName(String(p.nome || '')) })}
                                placeholder="Nome do produto"
                              />
                            </TableCell>
                            <TableCell>
                              <Input
                                value={String(p.descricao || '')}
                                disabled={p.ativo === false || !canUpdateProducts}
                                onChange={(e) => {
                                  const value = e.target.value;
                                  setProducts((prev) => prev.map((x) => (x.id === p.id ? { ...x, descricao: value } : x)));
                                }}
                                onBlur={() => handleUpdateProduct(p.id, { descricao: String(p.descricao || '').trim() })}
                                placeholder="Descrição do produto"
                              />
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="relative w-36 ml-auto">
                                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">R$</span>
                                <Input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  value={String(p.preco ?? 0)}
                                  disabled={p.ativo === false || !canUpdateProducts}
                                  onChange={(e) => {
                                    const value = clampNumber(parseFloat(e.target.value) || 0, { min: 0 });
                                    setProducts((prev) => prev.map((x) => (x.id === p.id ? { ...x, preco: value } : x)));
                                  }}
                                  onBlur={() => handleUpdateProduct(p.id, { preco: clampNumber(p.preco ?? 0, { min: 0 }) })}
                                  className="pl-8 text-right tabular-nums"
                                />
                              </div>
                            </TableCell>
                            <TableCell className="text-right">
                              <Input
                                type="number"
                                step="0.01"
                                min="0"
                                max="100"
                                value={String(p.maxDescontoPercent ?? 0)}
                                disabled={p.ativo === false || !canUpdateProducts}
                                onChange={(e) => {
                                  const value = clampNumber(parseFloat(e.target.value) || 0, { min: 0, max: 100 });
                                  setProducts((prev) => prev.map((x) => (x.id === p.id ? { ...x, maxDescontoPercent: value } : x)));
                                }}
                                onBlur={() => handleUpdateProduct(p.id, { maxDescontoPercent: clampNumber(p.maxDescontoPercent ?? 0, { min: 0, max: 100 }) })}
                                className="w-28 text-right tabular-nums"
                              />
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={p.ativo === false || !canUpdateProducts}
                                  onClick={async () => {
                                    const ok = await handleUpdateProduct(p.id, {
                                      nome: normalizeProductName(String(p.nome || '')),
                                      descricao: String(p.descricao || '').trim(),
                                      preco: clampNumber(p.preco ?? 0, { min: 0 }),
                                      maxDescontoPercent: clampNumber(p.maxDescontoPercent ?? 0, { min: 0, max: 100 }),
                                    });
                                    if (ok) toast.success('Produto salvo');
                                  }}
                                >
                                  <Save className="mr-2 h-4 w-4" /> Salvar
                                </Button>
                                <Button variant="ghost" size="icon" onClick={() => handleDeleteProduct(p.id)} aria-label="Remover" disabled={p.ativo === false || !canDeleteProducts}>
                                  <Trash2 className="h-4 w-4 text-muted-foreground" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
          )}

          {isAdmin && (
          <TabsContent value="premiacao" className="space-y-6">
            <Card>
        <CardHeader><CardTitle className="text-base">Configuração de Premiação (PIX)</CardTitle></CardHeader>
              <CardContent className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
            <div className="space-y-1.5">
              <Label>Período</Label>
              <div className="rounded-md border border-border bg-muted/20 px-3 py-2 text-sm">Mensal (fecha dia 1)</div>
            </div>
            <div className="space-y-1.5">
              <Label>Mês de referência</Label>
              <div className="flex items-center gap-2">
                <Select
                  value={awardsRefMonth}
                  onValueChange={(month) => setAwardsRefDate(`${awardsRefYear}-${month}-01`)}
                >
                  <SelectTrigger className="w-36">
                    <SelectValue placeholder="Mês" />
                  </SelectTrigger>
                  <SelectContent>
                    {awardsMonthOptions.map((m) => (
                      <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={awardsRefYear}
                  onValueChange={(year) => setAwardsRefDate(`${year}-${awardsRefMonth}-01`)}
                >
                  <SelectTrigger className="w-28">
                    <SelectValue placeholder="Ano" />
                  </SelectTrigger>
                  <SelectContent>
                    {awardsYearOptions.map((year) => (
                      <SelectItem key={year} value={year}>{year}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-sm font-medium">{formatMonthYearBR(awardsRefDate)}</span>
              </div>
            </div>
                  <div className="rounded-md border border-border bg-muted/20 px-4 py-3 text-sm">
                    <div className="font-medium">{awardsRange.label}</div>
                    <div className="text-muted-foreground mt-0.5">Fechamento: {formatDateBR(awardsRange.fechamentoISO)}</div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                  <div className="space-y-1.5">
                    <Label>Limite de bônus (%)</Label>
                    <Input
                      type="number"
                      min="0"
                      max="100"
                      step="1"
                      value={bonusLimitPercent}
                      onChange={(e) => setBonusLimitPercent(Math.max(0, Math.min(100, parseFloat(e.target.value) || 0)))}
                    />
                    <p className="text-xs text-muted-foreground mt-1">Limita o PIX calculado a este percentual</p>
                  </div>
                  <div className="md:col-span-2 flex justify-end">
                    <Button
                      onClick={() => {
                        saveBonusLimitPercent(bonusLimitPercent);
                        toast.success('Limite de bônus salvo');
                      }}
                    >
                      Salvar limite
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
                  <div className="space-y-1.5 md:col-span-2">
                    <Label>Vendedor</Label>
                    <Select value={awardDraft.vendedorId} onValueChange={(v) => setAwardDraft((prev) => ({ ...prev, vendedorId: v }))}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todos</SelectItem>
                        {vendedores
                          .slice()
                          .sort((a, b) => a.nome.localeCompare(b.nome))
                          .map((v) => (
                            <SelectItem key={v.id} value={v.id}>{v.nome}</SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Mínimo de vendas</Label>
                    <Input type="number" min="0" value={awardDraft.minVendas} onChange={(e) => setAwardDraft((prev) => ({ ...prev, minVendas: e.target.value }))} placeholder="Ex: 20" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Valor do PIX (R$)</Label>
                    <Input type="number" min="0" step="0.01" value={awardDraft.pixValor} onChange={(e) => setAwardDraft((prev) => ({ ...prev, pixValor: e.target.value }))} placeholder="Ex: 1000" />
                  </div>
                </div>

                <div className="flex justify-end">
                  <Button
                    onClick={() => {
                      const minVendas = clampNumber(parseInt(String(awardDraft.minVendas || '0')) || 0, { min: 0 });
                      const pixValor = clampNumber(parseFloat(String(awardDraft.pixValor || '0').replace(',', '.')) || 0, { min: 0 });
                      if (minVendas <= 0 || pixValor <= 0) {
                        toast.error('Preencha mínimo de vendas e valor do PIX');
                        return;
                      }
                      const rule: CommercialAwardRule = {
                        id: crypto.randomUUID(),
                        vendedorId: awardDraft.vendedorId === 'all' ? null : awardDraft.vendedorId,
                        minVendas,
                        pixValor,
                      };
                      (async () => {
                        const ok = await persistAwards({ ...awards, rules: [...(awards.rules || []), rule] });
                        if (!ok) return;
                        setAwardDraft({ vendedorId: awardDraft.vendedorId, minVendas: '', pixValor: '' });
                        toast.success('Regra adicionada');
                      })();
                    }}
                    disabled={!awardDraft.minVendas || !awardDraft.pixValor}
                  >
                    <Plus className="mr-2 h-4 w-4" /> Adicionar regra
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Regras ({awards.rules.length})</CardTitle></CardHeader>
              <CardContent>
                {awards.rules.length === 0 ? (
                  <div className="text-sm text-muted-foreground">Nenhuma regra configurada.</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Vendedor</TableHead>
                        <TableHead className="text-right">Mín. vendas</TableHead>
                        <TableHead className="text-right">PIX (R$)</TableHead>
                        <TableHead className="text-right">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {awards.rules.map((r) => {
                        const vendedorNome =
                          !r.vendedorId ? 'Todos' : (vendedores.find((v) => v.id === r.vendedorId)?.nome || '—');
                        return (
                          <TableRow key={r.id}>
                            <TableCell className="font-medium">{vendedorNome}</TableCell>
                            <TableCell className="text-right tabular-nums">{clampNumber(r.minVendas || 0, { min: 0 })}</TableCell>
                            <TableCell className="text-right tabular-nums">{formatBRL(clampNumber(r.pixValor || 0, { min: 0 }))}</TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => {
                                    (async () => {
                                      const ok = await persistAwards({ ...awards, rules: awards.rules.filter((x) => x.id !== r.id) });
                                      if (!ok) return;
                                      toast.success('Regra removida');
                                    })();
                                  }}
                                >
                                  <Trash2 className="mr-2 h-4 w-4" /> Remover
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Prévia do Período</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="rounded-lg border border-border bg-muted/20 px-4 py-3">
                    <p className="text-xs text-muted-foreground">Período</p>
                    <p className="text-sm font-semibold">{awardsRange.label}</p>
                  </div>
                  <div className="rounded-lg border border-border bg-muted/20 px-4 py-3">
                    <p className="text-xs text-muted-foreground">Fechamento</p>
                    <p className="text-sm font-semibold">{formatDateBR(awardsRange.fechamentoISO)}</p>
                  </div>
                  <div className="rounded-lg border border-border bg-muted/20 px-4 py-3">
                    <p className="text-xs text-muted-foreground">Total de PIX</p>
                    <p className="text-xl font-bold tabular-nums">{formatBRL(awardsPreview.totalPix)}</p>
                  </div>
                </div>

                {vendedores.length === 0 ? (
                  <div className="text-sm text-muted-foreground">Nenhum vendedor encontrado.</div>
                ) : (
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
                      {awardsPreview.rows.map((r) => {
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
                                ? formatBRL(r.pixValor)
                                : r.targetPix > 0
                                  ? `Ao atingir ${r.target}: ${formatBRL(r.targetPix)}`
                                  : '—'}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
          )}

          <TabsContent value="baixar" className="space-y-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-base">Baixar Registros por Vendedor</CardTitle>
                <div className="flex items-center gap-2">
                  <Select value={painelPeriodo} onValueChange={(v) => setPainelPeriodo(v as any)}>
                    <SelectTrigger className="w-44">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hoje">Diário</SelectItem>
                      <SelectItem value="semana">Semanal</SelectItem>
                      <SelectItem value="mes">Mensal</SelectItem>
                      <SelectItem value="personalizado">Personalizado</SelectItem>
                      <SelectItem value="tudo">Tudo</SelectItem>
                    </SelectContent>
                  </Select>
                  {painelPeriodo === 'mes' && (
                    <>
                      <Select
                        value={painelMonthRef.slice(5, 7)}
                        onValueChange={(month) => {
                          setPainelMonthWasSelected(true);
                          setPainelMonthRef(`${painelMonthRef.slice(0, 4)}-${month}-01`);
                        }}
                      >
                        <SelectTrigger className="w-36">
                          <SelectValue placeholder="Mês" />
                        </SelectTrigger>
                        <SelectContent>
                          {painelMonthOptions.map((m) => (
                            <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select
                        value={painelMonthRef.slice(0, 4)}
                        onValueChange={(year) => {
                          setPainelMonthWasSelected(true);
                          setPainelMonthRef(`${year}-${painelMonthRef.slice(5, 7)}-01`);
                        }}
                      >
                        <SelectTrigger className="w-28">
                          <SelectValue placeholder="Ano" />
                        </SelectTrigger>
                        <SelectContent>
                          {painelYearOptions.map((year) => (
                            <SelectItem key={year} value={year}>{year}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </>
                  )}
                  {painelPeriodo === 'personalizado' && (
                    <>
                      <Input
                        type="date"
                        value={painelCustomStart}
                        onChange={(e) => setPainelCustomStart(e.target.value)}
                        className="w-36"
                      />
                      <Input
                        type="date"
                        value={painelCustomEnd}
                        onChange={(e) => setPainelCustomEnd(e.target.value)}
                        className="w-36"
                      />
                    </>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-lg border border-border bg-muted/20 px-4 py-3">
                  <p className="text-xs text-muted-foreground">Período selecionado</p>
                  <p className="text-sm font-semibold">{reportPeriodLabel}</p>
                </div>

                <div className="rounded-lg border border-border px-4 py-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-sm font-semibold">Relatório unificado</p>
                    <p className="text-xs text-muted-foreground">
                      Gera um único PDF com todos os vendedores ativos e em treinamento em ordem alfabética.
                    </p>
                  </div>
                  <Button size="sm" onClick={handleDownloadUnifiedSellerReport} disabled={activeSellers.length + trainingSellers.length === 0}>
                    <Download className="mr-2 h-4 w-4" /> PDF unificado
                  </Button>
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm">Vendedores ativos</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {activeSellers.length === 0 ? (
                        <div className="text-sm text-muted-foreground">Nenhum vendedor ativo encontrado.</div>
                      ) : (
                        activeSellers.map((seller) => {
                          const count = (reportEntriesBySeller.get(String(seller.id)) || []).length;
                          return (
                            <div key={seller.id} className="rounded-md border border-border px-3 py-2 flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <p className="text-sm font-medium truncate">{seller.nome}</p>
                                <p className="text-xs text-muted-foreground">Lançamentos no período: {count}</p>
                              </div>
                              <Button size="sm" onClick={() => handleDownloadSellerReport(seller)} disabled={count === 0}>
                                <Download className="mr-2 h-4 w-4" /> PDF
                              </Button>
                            </div>
                          );
                        })
                      )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm">Vendedores em treinamento</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {trainingSellers.length === 0 ? (
                        <div className="text-sm text-muted-foreground">Nenhum vendedor em treinamento encontrado.</div>
                      ) : (
                        trainingSellers.map((seller) => {
                          const count = (reportEntriesBySeller.get(String(seller.id)) || []).length;
                          return (
                            <div key={seller.id} className="rounded-md border border-border px-3 py-2 flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <p className="text-sm font-medium truncate">{seller.nome}</p>
                                <p className="text-xs text-muted-foreground">Lançamentos no período: {count}</p>
                              </div>
                              <Button size="sm" onClick={() => handleDownloadSellerReport(seller)} disabled={count === 0}>
                                <Download className="mr-2 h-4 w-4" /> PDF
                              </Button>
                            </div>
                          );
                        })
                      )}
                    </CardContent>
                  </Card>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
          </Tabs>
        </>
      ) : (
        <>
          <Tabs value={vendedorTab} onValueChange={(v) => setVendedorTab(v as 'painel' | 'treinamento')}>
            <TabsList>
              <TabsTrigger value="painel">Painel</TabsTrigger>
              <TabsTrigger value="treinamento">Treinamento</TabsTrigger>
            </TabsList>
          </Tabs>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">{vendedorTab === 'treinamento' ? 'Painel de Treinamento' : 'Meu Painel'}</CardTitle>
              <div className="flex items-center gap-2">
                <Select value={painelPeriodo} onValueChange={(v) => setPainelPeriodo(v as any)}>
                  <SelectTrigger className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hoje">Diário</SelectItem>
                    <SelectItem value="semana">Semanal</SelectItem>
                    <SelectItem value="mes">Mensal</SelectItem>
                    <SelectItem value="personalizado">Personalizado</SelectItem>
                    <SelectItem value="tudo">Tudo</SelectItem>
                  </SelectContent>
                </Select>
                {(painelPeriodo === 'personalizado') && (
                  <>
                    <Input type="date" value={painelCustomStart} onChange={(e) => setPainelCustomStart(e.target.value)} className="w-36" />
                    <Input type="date" value={painelCustomEnd} onChange={(e) => setPainelCustomEnd(e.target.value)} className="w-36" />
                  </>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="rounded-lg border border-border bg-muted/20 px-4 py-3">
                  <p className="text-xs text-muted-foreground">Clientes</p>
                  <p className="text-xl font-bold tabular-nums">{vendedorTotals.leads}</p>
                </div>
                <div className="rounded-lg border border-border bg-muted/20 px-4 py-3">
                  <p className="text-xs text-muted-foreground">Agendamentos</p>
                  <p className="text-xl font-bold tabular-nums">{vendedorTotals.agend}</p>
                </div>
                <div className="rounded-lg border border-border bg-muted/20 px-4 py-3">
                  <p className="text-xs text-muted-foreground">Vendas</p>
                  <p className="text-xl font-bold tabular-nums">{vendedorTotals.vendas}</p>
                </div>
                <div className="rounded-lg border border-border bg-muted/20 px-4 py-3">
                  <p className="text-xs text-muted-foreground">Conversão (vendas/clientes)</p>
                  <p className="text-xl font-bold tabular-nums">{vendedorConversaoPercent.toFixed(1)}%</p>
                </div>
                <div className="rounded-lg border border-border bg-muted/20 px-4 py-3">
                  <p className="text-xs text-muted-foreground">Follow-ups</p>
                  <p className="text-xl font-bold tabular-nums">{vendedorTotals.followUps}</p>
                </div>
                <div className="rounded-lg border border-border bg-muted/20 px-4 py-3">
                  <p className="text-xs text-muted-foreground">Bruto</p>
                  <p className="text-xl font-bold tabular-nums">{canShowFinancials ? formatBRL(vendedorTotals.bruto) : '—'}</p>
                </div>
                <div className="rounded-lg border border-border bg-muted/20 px-4 py-3">
                  <p className="text-xs text-muted-foreground">Líquido</p>
                  <p className="text-xl font-bold tabular-nums">{canShowFinancials ? formatBRL(vendedorTotals.liquido) : '—'}</p>
                </div>
                <div className="rounded-lg border border-border bg-muted/20 px-4 py-3">
                  <p className="text-xs text-muted-foreground">Comissão (R$)</p>
                  <p className="text-xl font-bold tabular-nums">{canShowFinancials ? formatBRL(vendedorTotals.comissao) : '—'}</p>
                  <p className="text-xs text-muted-foreground tabular-nums mt-1">Taxa: {sellerCommissionPercent.toFixed(2)}%</p>
                </div>
              </div>
              {myBonusStatus && myBonusStatus.hasRules ? (
                <div className="mt-6 rounded-lg border border-border bg-muted/20 p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold">Premiação (PIX) • {myBonusStatus.rangeLabel}</p>
                    <p className="text-sm font-medium tabular-nums">
                      {typeof myBonusStatus.achievedMinVendas === 'number'
                        ? `PIX no mês: ${formatBRL(myBonusStatus.finalPix)}`
                        : myBonusStatus.nextMinVendas
                          ? `Ao atingir ${myBonusStatus.nextMinVendas}: ${formatBRL(myBonusStatus.nextFinalPix)}`
                          : 'Sem regras aplicáveis'}
                    </p>
                  </div>
                  <div className="mt-2">
                    <Progress
                      value={
                        myBonusStatus.nextMinVendas
                          ? Math.max(0, Math.min(100, (myBonusStatus.vendas / myBonusStatus.nextMinVendas) * 100))
                          : 100
                      }
                    />
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    {typeof myBonusStatus.nextMinVendas === 'number'
                      ? `Faltam ${myBonusStatus.missing} vendas para alcançar a meta de ${myBonusStatus.nextMinVendas}.`
                      : myBonusStatus.achievedMinVendas
                        ? `Meta de ${myBonusStatus.achievedMinVendas} vendas atingida.`
                        : 'Sem regras aplicáveis.'}
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>

          

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Relatório por dia</CardTitle>
            </CardHeader>
            <CardContent>
              {vendasPorDiaDoVendedor.length === 0 ? (
                <div className="text-sm text-muted-foreground">Nenhum registro no período selecionado.</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data</TableHead>
                      <TableHead className="text-right">Clientes</TableHead>
                      <TableHead className="text-right">Agendamentos</TableHead>
                      <TableHead className="text-right">Vendas</TableHead>
                      <TableHead className="text-right">Follow-ups</TableHead>
                      <TableHead className="text-right">Conversão (v/c)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {vendasPorDiaDoVendedor.map((r) => {
                      const conv = r.leads > 0 ? (r.vendas / r.leads) * 100 : 0;
                      return (
                        <TableRow key={r.data}>
                          <TableCell>{formatDateBR(r.data)}</TableCell>
                          <TableCell className="text-right tabular-nums">{r.leads}</TableCell>
                          <TableCell className="text-right tabular-nums">{r.agend}</TableCell>
                          <TableCell className="text-right tabular-nums font-semibold">{r.vendas}</TableCell>
                          <TableCell className="text-right tabular-nums">{r.followUps}</TableCell>
                          <TableCell className="text-right tabular-nums font-semibold">{conv.toFixed(1)}%</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Histórico da Equipe</CardTitle>
              <div className="text-xs text-muted-foreground">
                {painelPeriodo === 'hoje'
                  ? 'Diário'
                  : painelPeriodo === 'semana'
                    ? 'Semanal'
                    : painelPeriodo === 'mes'
                      ? 'Mensal'
                      : painelPeriodo === 'tudo'
                        ? 'Tudo'
                        : 'Personalizado'}
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Vendedor</TableHead>
                    <TableHead className="text-right">Clientes</TableHead>
                    <TableHead className="text-right">Agendamentos</TableHead>
                    <TableHead className="text-right">Vendas</TableHead>
                    <TableHead className="text-right">Follow-ups</TableHead>
                    <TableHead className="text-right">Conversão (v/c)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {effectiveTeamRanking.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                        {vendedorTab === 'treinamento'
                          ? 'Nenhum vendedor em treinamento no período selecionado.'
                          : 'Sem dados de vendedores fora de treinamento no período selecionado.'}
                      </TableCell>
                    </TableRow>
                  )}
                  {effectiveTeamRanking.map((r) => {
                    const conv = r.leads > 0 ? (r.vendas / r.leads) * 100 : 0;
                    return (
                      <TableRow key={r.vendedorId}>
                        <TableCell className="flex items-center gap-2">
                          <Avatar className="w-6 h-6 border border-border">
                            <AvatarImage src={resolveAvatarSrc(r.avatar)} alt={r.nome} />
                            <AvatarFallback>{(r.nome || '—').charAt(0).toUpperCase()}</AvatarFallback>
                          </Avatar>
                          <span className="font-medium">{r.nome}</span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{r.leads}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.agendamentos}</TableCell>
                        <TableCell className="text-right tabular-nums font-semibold">{r.vendas}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.followUps}</TableCell>
                        <TableCell className="text-right tabular-nums font-semibold">{conv.toFixed(1)}%</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {sellerConversionRanking.list.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Ranking de Vendedores (conversão)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {typeof mySellerRank === 'number' && (
                  <div className="rounded-lg border border-border bg-muted/20 px-4 py-3 text-sm">
                    Sua posição: <span className="font-semibold tabular-nums">{mySellerRank}º</span>
                  </div>
                )}
                <div className="grid grid-cols-1 gap-2">
                  {sellerConversionRanking.list.map((s, idx) => {
                    const rank = sellerConversionRanking.ranks[idx];
                    const bg = medalColor(rank);
                    const txt = pickTextColorFromBg(bg);
                    return (
                      <div
                        key={s.vendedorId}
                        className="rounded-md border border-border px-4 py-3 grid grid-cols-12 gap-2 items-center"
                        style={bg !== 'transparent' ? { backgroundColor: bg, color: txt } : undefined}
                      >
                        <div className="col-span-5 flex items-center gap-2 min-w-0">
                          <span className="text-sm font-medium">{rank}.</span>
                          <Avatar className="w-6 h-6 border border-border">
                            <AvatarImage src={resolveAvatarSrc(s.avatar)} alt={s.nome} />
                            <AvatarFallback style={{ color: txt }}>{(s.nome || '—').charAt(0).toUpperCase()}</AvatarFallback>
                          </Avatar>
                          <span className="text-sm font-medium truncate" style={{ color: txt }}>{s.nome}</span>
                        </div>
                        <span className="col-span-2 text-sm tabular-nums" style={{ color: txt }}>Vendas: {s.totalVendas}</span>
                        <span className="col-span-2 text-sm tabular-nums" style={{ color: txt }}>Leads: {s.totalLeads}</span>
                        <span className="col-span-3 text-sm font-semibold tabular-nums" style={{ color: txt }}>{s.conversao.toFixed(0)}%</span>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {effectiveAbandonment.levels.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Ranking de Abandono (pior no topo)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {effectiveAbandonment.levels.map((a, idx) => {
                    const baseBg = worstColor(idx, effectiveAbandonment.levels.length);
                    const label = labelFromClassificacao(a.classificacao);
                    const rowBg = label === 'alto' ? baseBg : label === 'baixo' && isBgRed(baseBg) ? 'hsl(120, 60%, 30%)' : baseBg;
                    const rowTxt = pickTextColorFromBg(rowBg);
                    const chipBg = chipBgColor(rowBg, label);
                    const chipTxt = pickTextColorFromBg(chipBg);
                    return (
                      <div
                        key={a.vendedorId}
                        className="rounded-md border border-border px-4 py-3 flex items-center justify-between"
                        style={{ backgroundColor: rowBg, color: rowTxt }}
                      >
                        <div className="min-w-0 flex items-center gap-2">
                          <span className="text-sm font-medium tabular-nums">{idx + 1}.</span>
                          <Avatar className="w-6 h-6 border border-border">
                            <AvatarImage src={resolveAvatarSrc(a.avatar)} alt={a.vendedorNome} />
                            <AvatarFallback style={{ color: rowTxt }}>{(a.vendedorNome || '—').charAt(0).toUpperCase()}</AvatarFallback>
                          </Avatar>
                          <span className="text-sm font-medium truncate" style={{ color: rowTxt }}>{a.vendedorNome}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-semibold tabular-nums" style={{ color: rowTxt }}>{a.totalResgatados}</span>
                          <span className="text-xs font-medium px-2 py-1 rounded-full" style={{ backgroundColor: chipBg, color: chipTxt }}>
                            {label}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          <Dialog
            open={showForm}
            onOpenChange={(open) => {
              if (open && !editingEntryId) resetNewEntryForm();
              setShowForm(open);
            }}
          >
            <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
              <DialogHeader><DialogTitle>{editingEntryId ? 'Editar registro' : 'Registro do dia'}</DialogTitle></DialogHeader>
              <div className="space-y-5">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <Label>Data</Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" className="w-full justify-start text-left font-normal">
                          <CalendarDays className="mr-2 h-4 w-4" />
                          {form.data ? format(new Date(`${form.data}T00:00:00`), 'dd/MM/yyyy', { locale: ptBR }) : format(new Date(), 'dd/MM/yyyy', { locale: ptBR })}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          locale={ptBR}
                          weekStartsOn={0}
                          formatters={{
                            formatWeekdayName: (date) => ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'][date.getDay()],
                          }}
                          classNames={{
                            weekday: 'w-9 text-center text-[0.8rem] font-medium',
                          }}
                          selected={form.data ? new Date(`${form.data}T00:00:00`) : undefined}
                          onSelect={(d) => setForm((prev) => ({ ...prev, data: d ? d.toISOString().slice(0, 10) : '' }))}
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Clientes atendidos</Label>
                    <Input type="number" value={form.leadsAtendidos} onChange={e => setForm({ ...form, leadsAtendidos: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Agendamentos</Label>
                    <Input type="number" value={form.agendamentos} onChange={e => setForm({ ...form, agendamentos: e.target.value })} />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>Lançamento</Label>
                    <Select
                      value={campaignScope}
                      onValueChange={(value) => {
                        const nextScope = value === 'campanha' ? 'campanha' : 'geral';
                        setCampaignScope(nextScope);
                        if (nextScope === 'geral') setCampaignName('');
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Tipo" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="geral">Geral</SelectItem>
                        <SelectItem value="campanha">Por campanha</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {campaignScope === 'campanha' ? (
                    <div className="space-y-1.5">
                      <Label>Campanha</Label>
                      <Select value={campaignName || '__none__'} onValueChange={(value) => setCampaignName(value === '__none__' ? '' : value)}>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione uma campanha" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">Selecionar campanha</SelectItem>
                          {campaignOptions.map((option) => (
                            <SelectItem key={option} value={option}>{option}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        value={campaignName}
                        onChange={(e) => setCampaignName(e.target.value)}
                        placeholder="Digite a campanha se não estiver na lista"
                      />
                    </div>
                  ) : null}
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium">Produtos vendidos</p>
                      <p className="text-xs text-muted-foreground">Informe a quantidade por produto</p>
                    </div>
                    <div className="text-sm font-semibold tabular-nums">Total: {totalVendasDoDia}</div>
                  </div>

                  {activeProducts.length === 0 ? (
                    <div className="text-sm text-muted-foreground">Nenhum produto cadastrado. Peça ao admin para cadastrar ou importar.</div>
                  ) : (
                    <div className="space-y-3">
                      {saleLines.map((line, idx) => (
                        <div key={line.id} className="rounded-md border border-border p-3 space-y-2">
                          <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
                            <div className="md:col-span-4">
                              <Label className="text-xs text-muted-foreground">Produto</Label>
                              <Select
                                value={line.produtoId}
                                disabled={isProductInactive(line.produtoId)}
                                onValueChange={v => {
                                  setSaleLines(lines => lines.map(l => (l.id === line.id ? { ...l, produtoId: v } : l)));
                                }}
                              >
                                <SelectTrigger>
                                  <SelectValue placeholder="Selecione um produto" />
                                </SelectTrigger>
                                <SelectContent>
                                  {products
                                    .filter((p) => p.ativo !== false || p.id === line.produtoId)
                                    .slice()
                                    .sort((a, b) => a.nome.localeCompare(b.nome))
                                    .map((p) => (
                                      <SelectItem key={p.id} value={p.id} disabled={p.ativo === false && p.id !== line.produtoId}>
                                        {p.nome}{p.ativo === false ? ' (desativado)' : ''}
                                      </SelectItem>
                                    ))}
                                </SelectContent>
                              </Select>
                            </div>

                            <div className="md:col-span-3">
                              <Label className="text-xs text-muted-foreground">Nome do cliente</Label>
                              <Input
                                value={saleLaunches[idx]?.nome || ''}
                                onChange={(e) => {
                                  const value = e.target.value;
                                  setSaleLaunches((prev) =>
                                    prev.map((item, i) => (i === idx ? { ...item, nome: value } : item)),
                                  );
                                }}
                                placeholder="Ex: Maria Silva"
                              />
                            </div>

                            <div className="md:col-span-3">
                              <Label className="text-xs text-muted-foreground">
                                Desconto (%) máx {(lineFinancialById.get(line.id)?.maxDiscount ?? 100).toFixed(2)}
                              </Label>
                              <Input
                                type="number"
                                step="0.01"
                                min="0"
                                max={String(lineFinancialById.get(line.id)?.maxDiscount ?? 100)}
                                value={saleLaunches[idx]?.descontoPercent || ''}
                                onChange={(e) => {
                                  const maxLineDiscount = lineFinancialById.get(line.id)?.maxDiscount ?? 100;
                                  const parsed = clampNumber(parseFloat(e.target.value) || 0, {
                                    min: 0,
                                    max: maxLineDiscount,
                                  });
                                  const value = String(parsed);
                                  setSaleLaunches((prev) =>
                                    prev.map((item, i) => (i === idx ? { ...item, descontoPercent: value } : item)),
                                  );
                                }}
                                placeholder="0"
                              />
                            </div>

                            <div className="md:col-span-1">
                              <Label className="text-xs text-muted-foreground">Quantidade</Label>
                              <Input
                                type="number"
                                placeholder="Qtd"
                                value={line.quantidade}
                                disabled={isProductInactive(line.produtoId)}
                                className="min-w-[72px]"
                                onChange={e => {
                                  const v = e.target.value;
                                  setSaleLines(lines => lines.map(l => (l.id === line.id ? { ...l, quantidade: v } : l)));
                                }}
                              />
                            </div>

                            <div className="md:col-span-1 flex items-end">
                              <Button
                                variant="outline"
                                size="icon"
                                onClick={() => setSaleLines(lines => lines.filter(l => l.id !== line.id))}
                                disabled={saleLines.length === 1 || isProductInactive(line.produtoId)}
                                aria-label="Remover"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>

                          {(() => {
                            const lineFinancial = lineFinancialById.get(line.id);
                            if (!lineFinancial) return null;
                            return (
                              <div className="text-xs text-muted-foreground rounded-md bg-muted/20 px-3 py-2 flex flex-wrap gap-x-4 gap-y-1">
                                <span>Preço: <span className="font-semibold text-foreground">{formatBRL(lineFinancial.price)}</span></span>
                                <span>Desconto: <span className="font-semibold text-foreground">{lineFinancial.discountPercent.toFixed(2)}%</span></span>
                                <span>Valor desconto: <span className="font-semibold text-foreground">{formatBRL(lineFinancial.discountValue)}</span></span>
                                <span>Líquido: <span className="font-semibold text-foreground">{formatBRL(lineFinancial.net)}</span></span>
                              </div>
                            );
                          })()}
                        </div>
                      ))}
                      <Button
                        variant="outline"
                        onClick={() => setSaleLines(lines => [...lines, { id: crypto.randomUUID(), produtoId: '', quantidade: '' }])}
                      >
                        <Plus className="mr-2 h-4 w-4" /> Adicionar produto
                      </Button>
                    </div>
                  )}
                </div>

                {selectedProductsForPreview.length > 0 && !canShowValues && (
                  <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
                    {selectedProductsForPreview.some((p) => clampNumber(p.preco ?? 0, { min: 0 }) <= 0)
                      ? 'O admin precisa configurar o preço do(s) produto(s) selecionado(s) para liberar os valores.'
                      : maxDiscountAllowed <= 0
                        ? 'O admin precisa configurar o máximo de desconto do(s) produto(s) para liberar os valores.'
                        : sellerCommissionPercent <= 0
                          ? 'O admin precisa configurar a comissão do vendedor para liberar os valores.'
                          : 'Configurações insuficientes para calcular valores.'}
                  </div>
                )}

                {canShowValues && (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="space-y-1.5">
                        <Label>Desconto médio (%)</Label>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={form.descontoPercent}
                          disabled
                          placeholder="Calculado pelos lançamentos"
                        />
                      </div>
                      <div className="space-y-1.5 md:col-span-2">
                        <Label>Comissão do vendedor</Label>
                        <div className="h-10 rounded-md border border-input bg-background px-3 flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">%</span>
                          <span className="tabular-nums font-semibold">{sellerCommissionPercent.toFixed(2)}%</span>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="space-y-1.5">
                        <Label>Valor bruto</Label>
                        <div className="h-10 rounded-md border border-input bg-background px-3 flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">Bruto</span>
                          <span className="tabular-nums font-semibold">{formatBRL(previewTotals.grossRevenue)}</span>
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <Label>Desconto</Label>
                        <div className="h-10 rounded-md border border-input bg-background px-3 flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">-</span>
                          <span className="tabular-nums font-semibold">{formatBRL(previewTotals.discountValue)}</span>
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <Label>Valor líquido</Label>
                        <div className="h-10 rounded-md border border-input bg-background px-3 flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">Líquido</span>
                          <span className="tabular-nums font-semibold">{formatBRL(previewTotals.netRevenue)}</span>
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <Label>Comissão</Label>
                        <div className="h-10 rounded-md border border-input bg-background px-3 flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">Estim.</span>
                          <span className="tabular-nums font-semibold">{formatBRL(previewTotals.commission)}</span>
                        </div>
                      </div>
                    </div>
                  </>
                )}

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <Label>Follow-ups</Label>
                    <Input type="number" value={form.followUps} onChange={e => setForm({ ...form, followUps: e.target.value })} />
                  </div>
                </div>

                <div className="flex gap-2 justify-end mt-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setEditingEntryId(null);
                      setShowForm(false);
                      setForm({ data: '', leadsAtendidos: '', agendamentos: '', followUps: '', descontoPercent: '0', alunoNome: '' });
                      setSaleLaunches([]);
                      setCampaignScope('geral');
                      setCampaignName('');
                      setSaleLines([{ id: crypto.randomUUID(), produtoId: '', quantidade: '' }]);
                    }}
                  >
                    Cancelar
                  </Button>
                  <Button onClick={handleSave} disabled={!user?.id}>{editingEntryId ? 'Atualizar' : 'Salvar'}</Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          {myEntries.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Histórico</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Data</TableHead>
                      <TableHead>Aluno</TableHead>
                        <TableHead>Campanha</TableHead>
                      <TableHead className="text-right">Clientes</TableHead>
                      <TableHead className="text-right">Agendamentos</TableHead>
                      <TableHead className="text-right">Produtos</TableHead>
                      <TableHead className="text-right">Follow-ups</TableHead>
                      <TableHead className="text-right">Bruto</TableHead>
                      <TableHead className="text-right">Desconto (%)</TableHead>
                      <TableHead className="text-right">Líquido</TableHead>
                      <TableHead className="text-right">Comissão (R$)</TableHead>
                      <TableHead className="text-right">Conversão (v/c)</TableHead>
                      <TableHead className="text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {myEntries.sort((a, b) => b.data.localeCompare(a.data)).map(e => {
                      const conv = e.leadsAtendidos > 0 ? (e.vendas / e.leadsAtendidos * 100).toFixed(1) : '0.0';
                      return (
                        <TableRow key={e.id}>
                          <TableCell>{formatDateBR(e.data)}</TableCell>
                          <TableCell className="max-w-48 truncate">{e.alunoNome ? e.alunoNome : '—'}</TableCell>
                          <TableCell className="max-w-56 truncate">
                            {e.campaignScope === 'campanha' ? (e.campaignName || 'Campanha') : 'Geral'}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{e.leadsAtendidos}</TableCell>
                          <TableCell className="text-right tabular-nums">{e.agendamentos}</TableCell>
                          <TableCell className="text-right tabular-nums font-semibold">{e.vendas}</TableCell>
                          <TableCell className="text-right tabular-nums">{e.followUps}</TableCell>
                          <TableCell className="text-right tabular-nums">{typeof e.valorBruto === 'number' ? formatBRL(e.valorBruto) : '—'}</TableCell>
                          <TableCell className="text-right tabular-nums">{typeof e.descontoPercent === 'number' ? `${e.descontoPercent.toFixed(2)}%` : '—'}</TableCell>
                          <TableCell className="text-right tabular-nums">{typeof e.valorLiquido === 'number' ? formatBRL(e.valorLiquido) : '—'}</TableCell>
                          <TableCell className="text-right tabular-nums">{typeof e.comissao === 'number' ? formatBRL(e.comissao) : '—'}</TableCell>
                          <TableCell className="text-right tabular-nums font-semibold">{conv}%</TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-2">
                              <Button variant="outline" size="sm" onClick={() => handleEditEntry(e)} disabled={entryHasInactiveProduct(e)}>
                                <Pencil className="h-4 w-4 mr-2" />
                                Editar
                              </Button>
                              <Button variant="outline" size="icon" onClick={() => handleDeleteEntry(e.id)} aria-label="Excluir" disabled={entryHasInactiveProduct(e)}>
                                <Trash2 className="h-4 w-4 text-muted-foreground" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {myEntries.length === 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Histórico</CardTitle></CardHeader>
              <CardContent>
                <div className="text-sm text-muted-foreground">
                  {vendedorTab === 'treinamento'
                    ? 'Sem registros de treinamento no período selecionado.'
                    : 'Sem registros fora de treinamento no período selecionado.'}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

    </div>
  );
}

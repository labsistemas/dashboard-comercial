import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { getAuthToken, getBackendBaseUrl, getRescueEntries, getThresholds, getUsers, saveThresholds } from '@/lib/storage';
import { AbandonmentLevel, AbandonmentThresholds, RescueEntry } from '@/types/dashboard';
import { Shield, AlertTriangle } from 'lucide-react';
import { toast } from '@/components/ui/sonner';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useAuth } from '@/contexts/AuthContext';

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

export default function AbandonoPage() {
  const { user } = useAuth();
  const backend = getBackendBaseUrl();
  const token = getAuthToken();
  const isBackendEnabled = Boolean(backend && token);
  const isAdmin = user?.role === 'admin';

  const [thresholds, setThresholdsState] = useState<AbandonmentThresholds>(() => getThresholds());
  const [levels, setLevels] = useState<AbandonmentLevel[]>([]);
  const [savingThresholds, setSavingThresholds] = useState(false);

  useEffect(() => {
    let isCancelled = false;
    const load = async () => {
      if (!isBackendEnabled || !backend) {
        if (isCancelled) return;
        const localThresholds = getThresholds();
        setThresholdsState(localThresholds);
        const vendedores = getUsers().filter((u) => u.role === 'vendedor');
        const rescue = getRescueEntries();
        const resgatadosByOrigem = new Map<string, number>();
        for (const r of rescue) {
          const origin = String((r as RescueEntry).vendedorOrigem || '');
          if (!origin) continue;
          resgatadosByOrigem.set(origin, (resgatadosByOrigem.get(origin) || 0) + ((r as RescueEntry).leadsResgatados || 0));
        }
        const localLevels = vendedores
          .map((v) => {
            const totalResgatados = resgatadosByOrigem.get(v.id) || 0;
            const classificacao =
              totalResgatados >= localThresholds.vermelho
                ? 'vermelho'
                : totalResgatados >= localThresholds.amarelo
                  ? 'amarelo'
                  : 'verde';
            return {
              vendedorId: v.id,
              vendedorNome: v.nome,
              avatar: String(v.avatar || ''),
              totalResgatados,
              classificacao,
            } as AbandonmentLevel;
          })
          .sort((a, b) => b.totalResgatados - a.totalResgatados || a.vendedorNome.localeCompare(b.vendedorNome));
        setLevels(localLevels);
        return;
      }

      try {
        const res = await fetch(`${backend}/api/abandonment/levels?period=mes`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(String(data?.error || 'Falha ao carregar abandono'));
        const incoming = Array.isArray(data?.levels) ? data.levels : [];
        const mapped = incoming.map((l: any) => ({
          vendedorId: String(l?.vendedorId || ''),
          vendedorNome: String(l?.vendedorNome || 'Vendedor'),
          avatar: String(l?.avatar || ''),
          totalResgatados: typeof l?.totalResgatados === 'number' ? l.totalResgatados : parseInt(String(l?.totalResgatados || '0')) || 0,
          classificacao: (String(l?.classificacao || 'verde') as any) === 'vermelho' ? 'vermelho' : (String(l?.classificacao || 'verde') as any) === 'amarelo' ? 'amarelo' : 'verde',
        })) as AbandonmentLevel[];
        const th = data?.thresholds || null;
        const nextThresholds: AbandonmentThresholds = {
          amarelo: typeof th?.amarelo === 'number' ? th.amarelo : parseInt(String(th?.amarelo || '0')) || 0,
          vermelho: typeof th?.vermelho === 'number' ? th.vermelho : parseInt(String(th?.vermelho || '0')) || 0,
        };
        if (!isCancelled) {
          setThresholdsState(nextThresholds);
          setLevels(mapped);
        }
      } catch (e: any) {
        if (!isCancelled) toast.error(String(e?.message || 'Falha ao carregar abandono'));
      }
    };
    load();
    return () => {
      isCancelled = true;
    };
  }, [backend, isBackendEnabled, token]);

  const resolvedAvatarSrc = (src?: string) => {
    const raw = String(src || '').trim();
    if (!raw) return '';
    if (raw.startsWith('http')) return raw;
    if (raw.startsWith('/') && backend) return `${backend}${raw}`;
    return raw;
  };

  const problemSellers = useMemo(() => levels.filter((l) => l.classificacao === 'vermelho'), [levels]);

  const handleSaveThresholds = async () => {
    if (!isAdmin) return;
    if (!isBackendEnabled || !backend) {
      saveThresholds(thresholds);
      toast.success('Limites salvos');
      return;
    }
    setSavingThresholds(true);
    try {
      const res = await fetch(`${backend}/api/abandonment/thresholds`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ amarelo: thresholds.amarelo, vermelho: thresholds.vermelho }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(String(data?.error || 'Falha ao salvar limites'));
      toast.success('Limites salvos');
    } catch (e: any) {
      toast.error(String(e?.message || 'Falha ao salvar limites'));
    } finally {
      setSavingThresholds(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[1.625rem] leading-tight font-semibold tracking-tight">Indicador de Abandono</h1>
        <p className="text-muted-foreground text-sm mt-1">Ranking de Abandono (pior no topo)</p>
      </div>

      {isAdmin && (
        <Card>
          <CardHeader><CardTitle className="text-base">Configurar Limites</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-4 items-end">
            <div className="space-y-1.5">
              <Label>🟡 Risco (a partir de)</Label>
              <Input
                type="number"
                className="w-32"
                value={thresholds.amarelo}
                onChange={e => setThresholdsState({ ...thresholds, amarelo: parseInt(e.target.value) || 0 })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>🔴 Alto Abandono (a partir de)</Label>
              <Input
                type="number"
                className="w-32"
                value={thresholds.vermelho}
                onChange={e => setThresholdsState({ ...thresholds, vermelho: parseInt(e.target.value) || 0 })}
              />
            </div>
            <Button onClick={handleSaveThresholds} disabled={savingThresholds} className="active:scale-[0.97]">Salvar Limites</Button>
          </CardContent>
        </Card>
      )}

      {problemSellers.length > 0 && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="p-5">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-destructive mt-0.5" />
              <div>
                <p className="font-semibold text-destructive">Alto Abandono Detectado</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {problemSellers.map(s => s.vendedorNome).join(', ')} — muitos leads resgatados indicam falha no atendimento.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {levels.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Ranking de Abandono (pior no topo)</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {levels.map((a, idx) => {
                const baseBg = worstColor(idx, levels.length);
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
                        <AvatarImage src={resolvedAvatarSrc(a.avatar)} alt={a.vendedorNome} />
                        <AvatarFallback style={{ color: rowTxt }}>{(a.vendedorNome || '—').charAt(0).toUpperCase()}</AvatarFallback>
                      </Avatar>
                      <span className="text-sm font-medium truncate" style={{ color: rowTxt }}>{a.vendedorNome}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-semibold tabular-nums" style={{ color: rowTxt }}>{a.totalResgatados}</span>
                      <span
                        className="text-xs font-medium px-2 py-1 rounded-full"
                        style={{ backgroundColor: chipBg, color: chipTxt }}
                      >
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

      {levels.length === 0 && (
        <Card>
          <CardContent className="p-12 text-center">
            <Shield className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
            <p className="text-muted-foreground font-medium">Sem dados ainda</p>
            <p className="text-sm text-muted-foreground mt-1">O módulo de Resgate precisa ter registros para gerar o ranking.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

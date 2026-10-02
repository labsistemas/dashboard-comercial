import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { getAuthToken, getBackendBaseUrl, getProducts, saveProducts } from '@/lib/storage';
import { Product } from '@/types/dashboard';
import { useAuth } from '@/contexts/AuthContext';
import { hasPermission } from '@/lib/permissions';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

function formatBRL(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export default function ProdutosPage() {
  const { user } = useAuth();
  const backend = getBackendBaseUrl();
  const token = getAuthToken();
  const isBackendEnabled = Boolean(backend && token);
  const canCreateProducts = Boolean(user) && hasPermission(user, 'products', 'create');
  const canUpdateProducts = Boolean(user) && hasPermission(user, 'products', 'update');
  const canDeleteProducts = Boolean(user) && hasPermission(user, 'products', 'delete');

  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newProductName, setNewProductName] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [descriptionFullscreenOpen, setDescriptionFullscreenOpen] = useState(false);

  useEffect(() => {
    let isCancelled = false;
    const load = async () => {
      if (!isBackendEnabled || !backend) {
        const raw = getProducts();
        const sanitized = raw.map((p) => ({
          ...p,
          capaUrl: (p.capaUrl?.startsWith('https://') || p.capaUrl?.startsWith('http://') || p.capaUrl?.startsWith('/'))
            ? p.capaUrl
            : '',
        }));
        if (!isCancelled) setAllProducts(sanitized);
        return;
      }
      try {
        const res = await fetch(`${backend}/api/products`, { headers: { Authorization: `Bearer ${token}` } });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(String(data?.error || 'Falha ao carregar produtos'));
        const list = Array.isArray(data?.products) ? data.products : [];
        const mapped: Product[] = list.map((p: any) => {
          const rawCapa = String(p.capaUrl || '').trim();
          const safeCapa = rawCapa.startsWith('https://') || rawCapa.startsWith('http://')
            ? rawCapa
            : rawCapa.startsWith('/')
              ? rawCapa
              : '';
          return {
            id: String(p.id),
            nome: String(p.nome || ''),
            capaUrl: safeCapa,
            descricao: String(p.descricao || ''),
            preco: typeof p.preco === 'number' ? p.preco : parseFloat(String(p.preco || '0')) || 0,
            maxDescontoPercent:
              typeof p.maxDescontoPercent === 'number' ? p.maxDescontoPercent : parseFloat(String(p.maxDescontoPercent || '0')) || 0,
            ativo: typeof p.ativo === 'boolean' ? p.ativo : true,
            criadoEm: String(p.criadoEm || ''),
          };
        });
        if (!isCancelled) setAllProducts(mapped);
      } catch {
        if (!isCancelled) setAllProducts([]);
      }
    };
    load();
    return () => {
      isCancelled = true;
    };
  }, [backend, isBackendEnabled, token]);

  const products = useMemo(() => {
    const active = allProducts.filter((p) => p.ativo !== false);
    const q = query.trim().toLowerCase();
    if (!q) return active.sort((a, b) => a.nome.localeCompare(b.nome));
    return active
      .filter((p) => p.nome.toLowerCase().includes(q) || String(p.descricao || '').toLowerCase().includes(q))
      .sort((a, b) => a.nome.localeCompare(b.nome));
  }, [allProducts, query]);

  const selected = useMemo(() => {
    if (!selectedId && products.length > 0) return products[0];
    return products.find((p) => p.id === selectedId) || null;
  }, [products, selectedId]);

  const [draft, setDraft] = useState<{ nome: string; descricao: string; preco: string; maxDescontoPercent: string }>({
    nome: '',
    descricao: '',
    preco: '0',
    maxDescontoPercent: '0',
  });

  useEffect(() => {
    setDraft({
      nome: String(selected?.nome || ''),
      descricao: String(selected?.descricao || ''),
      preco: String(typeof selected?.preco === 'number' ? selected.preco : 0),
      maxDescontoPercent: String(typeof selected?.maxDescontoPercent === 'number' ? selected.maxDescontoPercent : 0),
    });
  }, [selected?.id]);

  function normalizeProductName(name: string) {
    return String(name || '').trim().replace(/\s+/g, ' ');
  }

  const handleCreateProduct = async () => {
    if (!canCreateProducts) {
      toast.error('Você não tem permissão para criar produtos');
      return;
    }
    const nome = normalizeProductName(newProductName);
    if (!nome) return;
    setSaving(true);
    try {
      if (isBackendEnabled && backend) {
        const res = await fetch(`${backend}/api/products`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ nome, capaUrl: '', descricao: '', preco: 0, maxDescontoPercent: 0 }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(String(data?.error || 'Falha ao criar produto'));
        const p = data?.product;
        if (p) {
          const created: Product = {
            id: String(p.id),
            nome: String(p.nome || nome),
            capaUrl: String(p.capaUrl || ''),
            descricao: String(p.descricao || ''),
            preco: typeof p.preco === 'number' ? p.preco : parseFloat(String(p.preco || '0')) || 0,
            maxDescontoPercent:
              typeof p.maxDescontoPercent === 'number' ? p.maxDescontoPercent : parseFloat(String(p.maxDescontoPercent || '0')) || 0,
            ativo: typeof p.ativo === 'boolean' ? p.ativo : true,
            criadoEm: String(p.criadoEm || new Date().toISOString()),
          };
          setAllProducts((prev) => [...prev, created]);
          setSelectedId(created.id);
        }
      } else {
        const created: Product = {
          id: crypto.randomUUID(),
          nome,
          capaUrl: '',
          descricao: '',
          preco: 0,
          maxDescontoPercent: 0,
          ativo: true,
          criadoEm: new Date().toISOString(),
        };
        const next = [...allProducts, created];
        setAllProducts(next);
        saveProducts(next);
        setSelectedId(created.id);
      }
      setNewProductName('');
      toast.success('Produto criado');
    } catch (e: any) {
      toast.error(String(e?.message || 'Falha ao criar produto'));
    } finally {
      setSaving(false);
    }
  };

  const handleSaveProduct = async () => {
    if (!selected) return;
    if (!canUpdateProducts) {
      toast.error('Você não tem permissão para editar produtos');
      return;
    }
    const nome = normalizeProductName(draft.nome);
    if (!nome) {
      toast.error('Informe o nome do produto');
      return;
    }
    const preco = Math.max(0, parseFloat(String(draft.preco || '0').replace(',', '.')) || 0);
    const maxDescontoPercent = Math.max(0, Math.min(100, parseFloat(String(draft.maxDescontoPercent || '0').replace(',', '.')) || 0));
    const descricao = String(draft.descricao || '').trim();

    setSaving(true);
    try {
      if (isBackendEnabled && backend) {
        const res = await fetch(`${backend}/api/products/${encodeURIComponent(selected.id)}`, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ nome, descricao, preco, maxDescontoPercent }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(String(data?.error || 'Falha ao atualizar produto'));
        const p = data?.product;
        setAllProducts((prev) =>
          prev.map((item) =>
            item.id === selected.id
              ? {
                  ...item,
                  nome: String(p?.nome || nome),
                  descricao: String(p?.descricao || descricao),
                  preco: typeof p?.preco === 'number' ? p.preco : preco,
                  maxDescontoPercent: typeof p?.maxDescontoPercent === 'number' ? p.maxDescontoPercent : maxDescontoPercent,
                }
              : item,
          ),
        );
      } else {
        const next = allProducts.map((item) =>
          item.id === selected.id ? { ...item, nome, descricao, preco, maxDescontoPercent } : item,
        );
        setAllProducts(next);
        saveProducts(next);
      }
      toast.success('Produto atualizado');
    } catch (e: any) {
      toast.error(String(e?.message || 'Falha ao atualizar produto'));
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteProduct = async () => {
    if (!selected) return;
    if (!canDeleteProducts) {
      toast.error('Você não tem permissão para apagar produtos');
      return;
    }
    setSaving(true);
    try {
      if (isBackendEnabled && backend) {
        const res = await fetch(`${backend}/api/products/${encodeURIComponent(selected.id)}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(String(data?.error || 'Falha ao apagar produto'));
      }
      const next = allProducts.map((item) => (item.id === selected.id ? { ...item, ativo: false } : item));
      setAllProducts(next);
      if (!isBackendEnabled) saveProducts(next);
      setSelectedId(null);
      toast.success('Produto apagado');
    } catch (e: any) {
      toast.error(String(e?.message || 'Falha ao apagar produto'));
    } finally {
      setSaving(false);
    }
  };

  const selectedImageSrc = useMemo(() => {
    const raw = String(selected?.capaUrl || '').trim();
    if (!raw) return '';
    try {
      const resolved = raw.startsWith('/') && backend ? `${backend}${raw}` : raw;
      const url = new URL(resolved);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
      return url.href;
    } catch {
      return '';
    }
  }, [selected?.capaUrl, backend]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[1.625rem] leading-tight font-semibold tracking-tight">Produtos</h1>
        <p className="text-muted-foreground text-sm mt-1">Lista de produtos ativos</p>
      </div>

      {(canCreateProducts || canUpdateProducts || canDeleteProducts) && (
        <Card>
          <CardHeader><CardTitle className="text-base">Gerenciar produtos</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto] gap-2">
              <div className="space-y-1.5">
                <Label>Novo produto</Label>
                <Input
                  value={newProductName}
                  onChange={(e) => setNewProductName(e.target.value)}
                  placeholder="Ex.: Mentoria Premium"
                  disabled={!canCreateProducts || saving}
                />
              </div>
              <Button className="self-end" onClick={handleCreateProduct} disabled={!canCreateProducts || !normalizeProductName(newProductName) || saving}>
                Criar produto
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-1">
          <CardHeader><CardTitle className="text-base">Catálogo</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Input placeholder="Pesquisar" value={query} onChange={(e) => setQuery(e.target.value)} />
            <div className="max-h-[60vh] overflow-auto space-y-2">
              {products.length === 0 ? (
                <div className="text-sm text-muted-foreground">Nenhum produto ativo.</div>
              ) : (
                products.map((p) => (
                  <Button
                    key={p.id}
                    variant={selected?.id === p.id ? 'default' : 'outline'}
                    className="w-full justify-start"
                    onClick={() => setSelectedId(p.id)}
                  >
                    <span className="truncate">{p.nome}</span>
                  </Button>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Detalhes</CardTitle></CardHeader>
          <CardContent>
            {!selected ? (
              <div className="text-sm text-muted-foreground">Selecione um produto à esquerda.</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="md:col-span-1 flex items-start">
                  {selectedImageSrc ? (
                    <div
                      role="img"
                      aria-label={selected.nome}
                      className="rounded-md w-40 h-40 bg-cover bg-center border border-border"
                      style={{ backgroundImage: `url(${JSON.stringify(selectedImageSrc)})` }}
                    />
                  ) : (
                    <Avatar className="w-40 h-40 border border-border rounded-md">
                      <AvatarImage src="" alt={selected.nome} />
                      <AvatarFallback>{(selected.nome || '—').charAt(0).toUpperCase()}</AvatarFallback>
                    </Avatar>
                  )}
                </div>
                <div className="md:col-span-2 space-y-3">
                  <div>
                    <p className="text-xs text-muted-foreground">Nome</p>
                    {canUpdateProducts ? (
                      <Input value={draft.nome} onChange={(e) => setDraft((prev) => ({ ...prev, nome: e.target.value }))} disabled={saving} />
                    ) : (
                      <p className="text-lg font-semibold">{selected.nome}</p>
                    )}
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Preço</p>
                    {canUpdateProducts ? (
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={draft.preco}
                        onChange={(e) => setDraft((prev) => ({ ...prev, preco: e.target.value }))}
                        disabled={saving}
                      />
                    ) : (
                      <p className="text-xl font-bold tabular-nums">{formatBRL(selected.preco || 0)}</p>
                    )}
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Descrição</p>
                    <div className="space-y-2">
                      {canUpdateProducts ? (
                        <Textarea
                          value={draft.descricao}
                          onChange={(e) => setDraft((prev) => ({ ...prev, descricao: e.target.value }))}
                          disabled={saving}
                          className="min-h-[160px] max-h-[240px] overflow-y-auto resize-y"
                          placeholder="Descreva o produto..."
                        />
                      ) : (
                        <div className="text-sm whitespace-pre-wrap border border-border rounded-md px-3 py-2 min-h-[160px] max-h-[240px] overflow-y-auto">
                          {selected.descricao || '—'}
                        </div>
                      )}
                      <div className="flex justify-end">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setDescriptionFullscreenOpen(true)}
                        >
                          Exibir em tela cheia
                        </Button>
                      </div>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Máx desconto (%)</p>
                    {canUpdateProducts ? (
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        max="100"
                        value={draft.maxDescontoPercent}
                        onChange={(e) => setDraft((prev) => ({ ...prev, maxDescontoPercent: e.target.value }))}
                        disabled={saving}
                      />
                    ) : (
                      <p className="text-sm">{Number(selected.maxDescontoPercent || 0).toFixed(2)}%</p>
                    )}
                  </div>
                  {(canUpdateProducts || canDeleteProducts) && (
                    <div className="flex gap-2 pt-2">
                      {canUpdateProducts && (
                        <Button onClick={handleSaveProduct} disabled={saving}>Salvar alterações</Button>
                      )}
                      {canDeleteProducts && (
                        <Button variant="destructive" onClick={() => setDeleteConfirmOpen(true)} disabled={saving}>Apagar produto</Button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar desativação do produto</AlertDialogTitle>
            <AlertDialogDescription>
              {selected
                ? `Tem certeza que deseja desativar o produto \"${selected.nome}\"? Ele não será apagado definitivamente, apenas ficará inativo no banco.`
                : 'Tem certeza que deseja desativar este produto? Ele não será apagado definitivamente, apenas ficará inativo no banco.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={async (event) => {
                event.preventDefault();
                await handleDeleteProduct();
                setDeleteConfirmOpen(false);
              }}
            >
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={descriptionFullscreenOpen} onOpenChange={setDescriptionFullscreenOpen}>
        <DialogContent className="max-w-5xl w-[95vw]">
          <DialogHeader>
            <DialogTitle>Descrição do produto</DialogTitle>
          </DialogHeader>
          {canUpdateProducts ? (
            <Textarea
              value={draft.descricao}
              onChange={(e) => setDraft((prev) => ({ ...prev, descricao: e.target.value }))}
              disabled={saving}
              className="h-[70vh] overflow-y-auto resize-none"
              placeholder="Descreva o produto..."
            />
          ) : (
            <div className="h-[70vh] overflow-y-auto whitespace-pre-wrap border border-border rounded-md p-3 text-sm">
              {selected?.descricao || '—'}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

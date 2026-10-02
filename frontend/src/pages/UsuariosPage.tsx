import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { getUsers, saveUsers, getBackendBaseUrl, getAuthToken } from '@/lib/storage';
import { User, UserRole } from '@/types/dashboard';
import { KeyRound, Pencil, Plus, Trash2, UserX } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import {
  PermissionClass,
  createEmptyPermissionClass,
  getPermissionClasses,
  hasPermission,
  savePermissionClasses,
  summarizePermissionClass,
} from '@/lib/permissions';

const PRODUCT_PERMISSION_TOKENS = {
  create: 'products:create',
  update: 'products:update',
  delete: 'products:delete',
} as const;

function normalizePermissionToken(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

const roleLabels: Record<string, string> = {
  admin: 'Admin',
  gestor: 'Gestor de Tráfego',
  vendedor: 'Vendedor',
  closer: 'Closer de Resgate',
};

const roleColors: Record<string, string> = {
  admin: 'bg-primary/10 text-primary',
  gestor: 'bg-info/10 text-info',
  vendedor: 'bg-success/10 text-success',
  closer: 'bg-warning/10 text-warning',
};

function normalizeRoleValue(value: unknown) {
  return String(value || '').trim().toLowerCase();
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

function getRoleLabel(role: string) {
  return roleLabels[normalizeRoleValue(role)] || role || 'Sem função';
}

function getRoleColor(role: string) {
  return roleColors[normalizeRoleValue(role)] || 'bg-muted text-muted-foreground';
}

function isSellerRole(role: string | null | undefined) {
  return normalizeRoleValue(role) === 'vendedor';
}

function isCommissionRole(role: string | null | undefined) {
  const roleValue = normalizeRoleValue(role);
  return roleValue === 'vendedor' || roleValue === 'gestor';
}

function canManageAccessStatus(role: string | null | undefined) {
  const roleValue = normalizeRoleValue(role);
  return roleValue === 'vendedor' || roleValue === 'gestor';
}

function inferRoleFromToken(token: string): UserRole | '' {
  const normalized = normalizeRoleToken(token);
  if (!normalized) return '';
  if (normalized === 'admin' || normalized.includes(' admin')) return 'admin';
  if (normalized === 'gestor' || normalized.includes('gestor')) return 'gestor';
  if (normalized === 'vendedor' || normalized.includes('vendedor')) return 'vendedor';
  if (normalized === 'closer' || normalized.includes('closer') || normalized.includes('resgate')) return 'closer';
  return '';
}

function resolveRoleFromPermissionClass(
  value: string | null | undefined,
  permissionClasses: PermissionClass[],
): UserRole | '' {
  const target = String(value || '').trim();
  if (!target) return '';

  const directMatch = inferRoleFromToken(target);
  if (directMatch) return directMatch;

  const permissionClass = permissionClasses.find((item) => String(item.id) === target) || null;
  if (!permissionClass) return '';

  return inferRoleFromToken(permissionClass.nome) || inferRoleFromToken(permissionClass.id);
}

function resolvePermissionClassIdForSubmission(
  value: string | null | undefined,
  permissionClasses: PermissionClass[],
): string | null {
  const target = String(value || '').trim();
  if (!target) return null;

  const exactMatch = permissionClasses.find((item) => String(item.id) === target) || null;
  if (exactMatch) return exactMatch.id;

  const targetToken = normalizeRoleToken(target);
  const matched =
    permissionClasses.find(
      (item) => normalizeRoleToken(item.id) === targetToken || normalizeRoleToken(item.nome) === targetToken,
    ) || null;
  return matched?.id || null;
}

type PermissionDraft = {
  id: string;
  nome: string;
  trafficRead: boolean;
  trafficWrite: boolean;
  commercialRead: boolean;
  commercialWrite: boolean;
  adminMetricsRead: boolean;
  usersRead: boolean;
  usersCreate: boolean;
  usersDeactivate: boolean;
  productsCreate: boolean;
  productsUpdate: boolean;
  productsDelete: boolean;
  otherPermissionsText: string;
};

function permissionClassToDraft(permissionClass: PermissionClass | null): PermissionDraft {
  const otherPermissions = Array.isArray(permissionClass?.otherPermissions)
    ? permissionClass!.otherPermissions.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  const normalizedPermissions = new Set(otherPermissions.map(normalizePermissionToken));
  const customPermissions = otherPermissions.filter((item) => {
    const token = normalizePermissionToken(item);
    return token !== PRODUCT_PERMISSION_TOKENS.create && token !== PRODUCT_PERMISSION_TOKENS.update && token !== PRODUCT_PERMISSION_TOKENS.delete;
  });
  return {
    id: permissionClass?.id || createEmptyPermissionClass('').id,
    nome: permissionClass?.nome || '',
    trafficRead: Boolean(permissionClass?.trafficRead),
    trafficWrite: Boolean(permissionClass?.trafficWrite),
    commercialRead: Boolean(permissionClass?.commercialRead),
    commercialWrite: Boolean(permissionClass?.commercialWrite),
    adminMetricsRead: Boolean((permissionClass as any)?.adminMetricsRead),
    usersRead: Boolean(permissionClass?.usersRead),
    usersCreate: Boolean(permissionClass?.usersCreate),
    usersDeactivate: Boolean(permissionClass?.usersDeactivate),
    productsCreate: normalizedPermissions.has(PRODUCT_PERMISSION_TOKENS.create),
    productsUpdate: normalizedPermissions.has(PRODUCT_PERMISSION_TOKENS.update),
    productsDelete: normalizedPermissions.has(PRODUCT_PERMISSION_TOKENS.delete),
    otherPermissionsText: customPermissions.join('\n'),
  };
}

function draftToPermissionClass(draft: PermissionDraft, criadoEm?: string): PermissionClass {
  const parsedOtherPermissions = String(draft.otherPermissionsText || '')
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => {
      const token = normalizePermissionToken(item);
      return token !== PRODUCT_PERMISSION_TOKENS.create && token !== PRODUCT_PERMISSION_TOKENS.update && token !== PRODUCT_PERMISSION_TOKENS.delete;
    });
  if (draft.productsCreate) parsedOtherPermissions.push(PRODUCT_PERMISSION_TOKENS.create);
  if (draft.productsUpdate) parsedOtherPermissions.push(PRODUCT_PERMISSION_TOKENS.update);
  if (draft.productsDelete) parsedOtherPermissions.push(PRODUCT_PERMISSION_TOKENS.delete);

  return {
    id: String(draft.id || createEmptyPermissionClass('').id),
    nome: String(draft.nome || '').trim(),
    trafficRead: Boolean(draft.trafficRead),
    trafficWrite: Boolean(draft.trafficWrite),
    commercialRead: Boolean(draft.commercialRead),
    commercialWrite: Boolean(draft.commercialWrite),
    adminMetricsRead: Boolean(draft.adminMetricsRead),
    usersRead: Boolean(draft.usersRead),
    usersCreate: Boolean(draft.usersCreate),
    usersDeactivate: Boolean(draft.usersDeactivate),
    otherPermissions: Array.from(new Set(parsedOtherPermissions.map(normalizePermissionToken))),
    criadoEm: criadoEm || new Date().toISOString(),
  };
}

function mergeRoleProfiles(base: PermissionClass[], loaded: PermissionClass[]) {
  const merged = new Map<string, PermissionClass>();
  base.forEach((item) => merged.set(String(item.id), item));
  loaded.forEach((item) => merged.set(String(item.id), item));
  return Array.from(merged.values()).sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));
}

export default function UsuariosPage() {
  const [users, setUsersState] = useState<User[]>(getUsers());
  const [activeTab, setActiveTab] = useState<'usuarios' | 'permissoes'>('usuarios');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    nome: '',
    email: '',
    senha: '',
    role: '' as UserRole | '',
    comissaoPercent: '',
    emTreinamento: false,
    treinamentoAte: '',
    ativo: true,
  });
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const [permissionClasses, setPermissionClasses] = useState<PermissionClass[]>(getPermissionClasses());
  const [backendPermissionClasses, setBackendPermissionClasses] = useState<PermissionClass[] | null>(null);
  const [permissionDraft, setPermissionDraft] = useState<PermissionDraft>(() => permissionClassToDraft(getPermissionClasses()[0] || null));
  const [selectedPermissionClassId, setSelectedPermissionClassId] = useState<string>(getPermissionClasses()[0]?.id || '');
  const [savingPermissionClass, setSavingPermissionClass] = useState(false);
  const [teams, setTeams] = useState<Array<{ id: string; nome: string; members?: any[] }>>([]);
  const [teamName, setTeamName] = useState('');
  const [savingTeam, setSavingTeam] = useState(false);
  const [bonusDraft, setBonusDraft] = useState<{
    minInternalRescuePercent: number;
    leaderBonusEnabled: boolean;
    leaderBonusPercent: number;
    rules: Array<{ minVendas: number; pixValor: number }>;
  }>({ minInternalRescuePercent: 0, leaderBonusEnabled: false, leaderBonusPercent: 0, rules: [] });
  const [savingBonus, setSavingBonus] = useState(false);
  const [teamRanking, setTeamRanking] = useState<
    Array<{
      teamId: string;
      nome: string;
      membros: number;
      vendas: number;
      internalRescuePercent: number;
      bonusPixValor: number;
    }>
  >([]);
  const [editOpen, setEditOpen] = useState(false);
  const [editUserId, setEditUserId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({
    nome: '',
    email: '',
    role: '' as UserRole | '',
    comissaoPercent: '',
    emTreinamento: false,
    treinamentoAte: '',
    ativo: true,
  });
  const [savingEdit, setSavingEdit] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [passwordUserId, setPasswordUserId] = useState<string | null>(null);
  const [passwordValue, setPasswordValue] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  const backend = getBackendBaseUrl();
  const token = getAuthToken();
  const selectedEditUser = useMemo(() => users.find((u) => u.id === editUserId) || null, [editUserId, users]);
  const selectedUser = useMemo(() => users.find((u) => u.id === passwordUserId) || null, [passwordUserId, users]);
  const selectedPermissionClass = useMemo(
    () => permissionClasses.find((item) => item.id === selectedPermissionClassId) || null,
    [permissionClasses, selectedPermissionClassId],
  );
  const availablePermissionClasses = useMemo(
    () => (backendPermissionClasses && backendPermissionClasses.length > 0 ? backendPermissionClasses : permissionClasses),
    [backendPermissionClasses, permissionClasses],
  );
  const selectedFormRole = useMemo(() => resolveRoleFromPermissionClass(form.role, availablePermissionClasses), [form.role, availablePermissionClasses]);
  const selectedEditRole = useMemo(() => resolveRoleFromPermissionClass(editDraft.role, availablePermissionClasses), [editDraft.role, availablePermissionClasses]);
  const countUsersForPermissionClass = (permissionClassId: string) => {
    const targetId = String(permissionClassId || '').trim();
    if (!targetId) return 0;
    return users.filter((user) => {
      const assignedId = String((user as any).permissionClassId || '').trim();
      if (assignedId) return assignedId === targetId;
      return normalizeRoleValue(user.role) === normalizeRoleValue(targetId);
    }).length;
  };
  const getEffectiveUserRole = (user: Pick<User, 'role' | 'permissionClassId'>): UserRole => {
    const permissionClassId = String(user.permissionClassId || '').trim();
    if (permissionClassId) {
      const resolved = resolveRoleFromPermissionClass(permissionClassId, availablePermissionClasses);
      if (resolved) return resolved;
    }
    return resolveRoleFromPermissionClass(user.role, availablePermissionClasses) || mapBackendRoleToUi(String(user.role || 'vendedor'));
  };
  const getRoleDisplayName = (role: string) => {
    const roleProfile = availablePermissionClasses.find(
      (item) => normalizeRoleValue(item.id) === normalizeRoleValue(role) || normalizeRoleValue(item.nome) === normalizeRoleValue(role),
    );
    return roleProfile?.nome || getRoleLabel(role);
  };
  const activeUsers = useMemo(() => users.filter((u) => u.ativo !== false), [users]);
  const disabledUsers = useMemo(() => users.filter((u) => u.ativo === false), [users]);
  const teamsApiBase = backend ? `${backend}/api/teams` : null;

  const mapUiRoleToBackend = (selectedPermissionClassId: string) => {
    const resolved = String(resolveRoleFromPermissionClass(selectedPermissionClassId, availablePermissionClasses) || '').trim();
    if (resolved) return resolved;
    return String(selectedPermissionClassId || '').trim();
  };

  const mapBackendRoleToUi = (role: string): UserRole => String(role || '').trim() || 'vendedor';

  useEffect(() => {
    if (!backend || !token) return;
    setRemoteError(null);
    fetch(`${backend}/api/users`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error || 'Falha ao carregar usuários');
        return data?.users ?? data;
      })
      .then((list) => {
        const mapped: User[] = (list || []).map((u: any) => ({
          id: String(u.id),
          nome: String(u.nome || u.name || ''),
          email: String(u.email || ''),
          senha: '',
          role: mapBackendRoleToUi(String(u.role || 'vendedor')),
          permissionClassId:
            u.permissionClassId !== undefined && u.permissionClassId !== null
              ? String(u.permissionClassId)
              : null,
          comissaoPercent:
            typeof u.comissaoPercent === 'number'
              ? u.comissaoPercent
              : parseFloat(String(u.comissaoPercent || '0')) || 0,
          emTreinamento: Boolean(u.emTreinamento),
          treinamentoAte: u.treinamentoAte ? String(u.treinamentoAte).slice(0, 10) : null,
          ativo: typeof u.ativo === 'boolean' ? u.ativo : true,
          teamId: u.teamId !== undefined && u.teamId !== null ? String(u.teamId) : null,
        }));
        setUsersState(mapped);
        saveUsers(mapped);
      })
      .catch((e) => setRemoteError(String(e?.message || 'Falha ao carregar usuários')));
  }, [backend, token]);

  useEffect(() => {
    const loadPermissionClasses = async () => {
      if (backend && token) {
        try {
          const res = await fetch(`${backend}/api/permission-classes`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          const data = await res.json().catch(() => null);
          if (!res.ok) throw new Error(data?.error || 'Falha ao carregar permissões');
          const list = Array.isArray(data?.classes) ? data.classes : [];
          const mapped = list.map((item: any) => ({
            id: String(item.id),
            nome: String(item.nome || ''),
            trafficRead: Boolean(item.trafficRead),
            trafficWrite: Boolean(item.trafficWrite),
            commercialRead: Boolean(item.commercialRead),
            commercialWrite: Boolean(item.commercialWrite),
            adminMetricsRead: Boolean((item as any).adminMetricsRead),
            usersRead: Boolean(item.usersRead),
            usersCreate: Boolean(item.usersCreate),
            usersDeactivate: Boolean(item.usersDeactivate),
            otherPermissions: Array.isArray(item.otherPermissions) ? item.otherPermissions.map((v: any) => String(v)) : [],
            criadoEm: String(item.createdAt || new Date().toISOString()),
          })) as PermissionClass[];
          setBackendPermissionClasses(mapped);
          setPermissionClasses(mapped);
          savePermissionClasses(mapped);
          if (mapped.length === 0) {
            setSelectedPermissionClassId('');
            setPermissionDraft(permissionClassToDraft(null));
            return;
          }
          const currentId = selectedPermissionClassId && mapped.some((item) => item.id === selectedPermissionClassId)
            ? selectedPermissionClassId
            : mapped[0].id;
          setSelectedPermissionClassId(currentId);
          setPermissionDraft(permissionClassToDraft(mapped.find((item) => item.id === currentId) || null));
          return;
        } catch {
          // fallback to local cache below
        }
      }

      setBackendPermissionClasses(null);
      const classes = mergeRoleProfiles(getPermissionClasses(), []);
      setPermissionClasses(classes);
      if (classes.length === 0) {
        setSelectedPermissionClassId('');
        setPermissionDraft(permissionClassToDraft(null));
        return;
      }
      const currentId = selectedPermissionClassId && classes.some((item) => item.id === selectedPermissionClassId)
        ? selectedPermissionClassId
        : classes[0].id;
      setSelectedPermissionClassId(currentId);
      setPermissionDraft(permissionClassToDraft(classes.find((item) => item.id === currentId) || null));
    };

    loadPermissionClasses();
  }, [backend, token]);

  useEffect(() => {
    const current = permissionClasses.find((item) => item.id === selectedPermissionClassId) || null;
    if (current) {
      setPermissionDraft(permissionClassToDraft(current));
    }
  }, [permissionClasses, selectedPermissionClassId]);

  useEffect(() => {
    if (!teamsApiBase || !token) return;
    fetch(teamsApiBase, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error || 'Falha ao carregar times');
        return data?.teams ?? data;
      })
      .then((list) => {
        setTeams(
          Array.isArray(list)
            ? list.map((t: any) => ({
                id: String(t.id),
                nome: String(t.nome || ''),
                members: t.members,
                leader: t.leader || null,
              }))
            : [],
        );
      })
      .catch((e: any) => toast.error(String(e?.message || 'Falha ao carregar times')));
  }, [teamsApiBase, token]);

  useEffect(() => {
    if (!teamsApiBase || !token) return;
    fetch(`${teamsApiBase}/bonus-config`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error || 'Falha ao carregar bonificação');
        return data?.config ?? data;
      })
      .then((cfg) => {
        const rules = Array.isArray(cfg?.rules) ? cfg.rules : [];
        setBonusDraft({
          minInternalRescuePercent: Math.max(0, Math.min(100, Number(cfg?.minInternalRescuePercent ?? 0) || 0)),
          leaderBonusEnabled: Boolean(cfg?.leaderBonusEnabled),
          leaderBonusPercent: Math.max(0, Math.min(100, Number(cfg?.leaderBonusPercent ?? 0) || 0)),
          rules: rules
            .map((r: any) => ({
              minVendas: Math.max(0, parseInt(String(r?.minVendas || '0')) || 0),
              pixValor: Math.max(0, Number(r?.pixValor || 0) || 0),
            }))
            .sort((a: any, b: any) => a.minVendas - b.minVendas),
        });
      })
      .catch((e: any) => toast.error(String(e?.message || 'Falha ao carregar bonificação')));
  }, [teamsApiBase, token]);

  useEffect(() => {
    if (!teamsApiBase || !token) return;
    fetch(`${teamsApiBase}/ranking`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error || 'Falha ao carregar ranking');
        return data?.ranking ?? data;
      })
      .then((list) => {
        const mapped = Array.isArray(list)
          ? list.map((r: any) => ({
              teamId: String(r.teamId),
              nome: String(r.nome || ''),
              membros: Math.max(0, parseInt(String(r.membros || '0')) || 0),
              vendas: Math.max(0, parseInt(String(r.vendas || '0')) || 0),
              internalRescuePercent: Math.max(0, Math.min(100, Number(r.internalRescuePercent || 0) || 0)),
              bonusPixValor: Math.max(0, Number(r.bonusPixValor || 0) || 0),
            }))
          : [];
        setTeamRanking(mapped);
      })
      .catch((e: any) => toast.error(String(e?.message || 'Falha ao carregar ranking')));
  }, [teamsApiBase, token, bonusDraft.minInternalRescuePercent, bonusDraft.rules.length]);

  const handleCreateTeam = async () => {
    if (!teamsApiBase || !token) return;
    const nome = String(teamName || '').trim();
    if (!nome) return;
    setSavingTeam(true);
    try {
      const res = await fetch(teamsApiBase, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Falha ao criar time');
      const created = data?.team ?? data;
      setTeams((prev) => [...prev, { id: String(created.id), nome: String(created.nome || nome), members: [] }].sort((a, b) => a.nome.localeCompare(b.nome)));
      setTeamName('');
      toast.success('Time criado');
    } catch (e: any) {
      toast.error(String(e?.message || 'Falha ao criar time'));
    } finally {
      setSavingTeam(false);
    }
  };

  const handleDeleteTeam = async (id: string) => {
    if (!teamsApiBase || !token) return;
    try {
      const res = await fetch(`${teamsApiBase}/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Falha ao excluir time');
      setTeams((prev) => prev.filter((t) => t.id !== id));
      setUsersState((prev) => prev.map((u) => (u.teamId === id ? { ...u, teamId: null } : u)));
      toast.success('Time excluído');
    } catch (e: any) {
      toast.error(String(e?.message || 'Falha ao excluir time'));
    }
  };

  const handleAssignTeam = async (userId: string, teamId: string | null) => {
    if (!teamsApiBase || !token) return;
    try {
      const res = await fetch(`${teamsApiBase}/assign`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, teamId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Falha ao salvar time do usuário');
      setUsersState((prev) => prev.map((u) => (u.id === userId ? { ...u, teamId } : u)));
    } catch (e: any) {
      toast.error(String(e?.message || 'Falha ao salvar time do usuário'));
    }
  };

  const handleSaveBonus = async () => {
    if (!teamsApiBase || !token) return;
    setSavingBonus(true);
    try {
      const payload = {
        minInternalRescuePercent: Math.max(0, Math.min(100, Number(bonusDraft.minInternalRescuePercent) || 0)),
        leaderBonusEnabled: Boolean(bonusDraft.leaderBonusEnabled),
        leaderBonusPercent: Math.max(0, Math.min(100, Number(bonusDraft.leaderBonusPercent) || 0)),
        rules: (bonusDraft.rules || [])
          .map((r) => ({ minVendas: Math.max(0, parseInt(String(r.minVendas || 0)) || 0), pixValor: Math.max(0, Number(r.pixValor || 0) || 0) }))
          .sort((a, b) => a.minVendas - b.minVendas),
      };
      const res = await fetch(`${teamsApiBase}/bonus-config`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Falha ao salvar bonificação');
      const cfg = data?.config ?? data;
      setBonusDraft({
        minInternalRescuePercent: Math.max(0, Math.min(100, Number(cfg?.minInternalRescuePercent ?? payload.minInternalRescuePercent) || 0)),
        leaderBonusEnabled: Boolean(cfg?.leaderBonusEnabled ?? payload.leaderBonusEnabled),
        leaderBonusPercent: Math.max(0, Math.min(100, Number(cfg?.leaderBonusPercent ?? payload.leaderBonusPercent) || 0)),
        rules: Array.isArray(cfg?.rules) ? cfg.rules : payload.rules,
      });
      toast.success('Bonificação salva');
    } catch (e: any) {
      toast.error(String(e?.message || 'Falha ao salvar bonificação'));
    } finally {
      setSavingBonus(false);
    }
  };

  const handleUpdateUser = async (id: string, patch: Partial<User>) => {
    setRemoteError(null);
    if (backend && token) {
      try {
        const res = await fetch(`${backend}/api/users/${encodeURIComponent(id)}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ ...patch }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error || 'Falha ao atualizar usuário');
        const updated = data?.user ?? data;
        setUsersState((prev) =>
          prev.map((u) =>
            u.id === id
              ? {
                  ...u,
                  nome: String(updated?.nome || u.nome),
                  email: String(updated?.email || u.email),
                  role: mapBackendRoleToUi(String(updated?.role || u.role)),
                  permissionClassId:
                    updated?.permissionClassId !== undefined
                      ? (updated.permissionClassId ? String(updated.permissionClassId) : null)
                      : patch.permissionClassId !== undefined
                        ? (patch.permissionClassId ? String(patch.permissionClassId) : null)
                        : (u as any).permissionClassId ?? null,
                  comissaoPercent:
                    typeof updated?.comissaoPercent === 'number'
                      ? updated.comissaoPercent
                      : patch.comissaoPercent ?? u.comissaoPercent,
                  emTreinamento:
                    typeof updated?.emTreinamento === 'boolean'
                      ? updated.emTreinamento
                      : patch.emTreinamento ?? u.emTreinamento ?? false,
                  treinamentoAte:
                    updated?.treinamentoAte !== undefined
                      ? (updated?.treinamentoAte ? String(updated.treinamentoAte).slice(0, 10) : null)
                      : patch.treinamentoAte ?? u.treinamentoAte ?? null,
                  ativo:
                    typeof updated?.ativo === 'boolean'
                      ? updated.ativo
                      : patch.ativo ?? (typeof u.ativo === 'boolean' ? u.ativo : true),
                }
              : u,
          ),
        );
        return true;
      } catch (e: any) {
        setRemoteError(String(e?.message || 'Falha ao atualizar usuário'));
        return false;
      }
    }

    const updated = users.map((u) =>
      u.id === id
        ? {
            ...u,
            ...patch,
          }
        : u,
    );
    setUsersState(updated);
    saveUsers(updated);
    return true;
  };

  const handleSave = async () => {
    const selectedPermissionClassId = String(form.role || '').trim();
    const resolvedPermissionClassId = resolvePermissionClassIdForSubmission(selectedPermissionClassId, availablePermissionClasses);
    const resolvedRole = resolveRoleFromPermissionClass(selectedPermissionClassId, availablePermissionClasses);
    if (!form.nome || !form.email || !form.senha || !selectedPermissionClassId) return;
    if (isSellerRole(resolvedRole) && form.emTreinamento && !String(form.treinamentoAte || '').trim()) {
      toast.error('Informe a data limite do treinamento');
      return;
    }
    setRemoteError(null);

    if (backend && token) {
      try {
        const comissaoPercent = isCommissionRole(resolvedRole)
          ? Math.min(100, Math.max(0, parseFloat(String(form.comissaoPercent || '').replace(',', '.')) || 0))
          : 0;
        const res = await fetch(`${backend}/api/users`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            nome: form.nome,
            email: form.email,
            senha: form.senha,
            role: mapUiRoleToBackend(selectedPermissionClassId),
            permissionClassId: resolvedPermissionClassId,
            comissaoPercent,
            emTreinamento: isSellerRole(resolvedRole) ? Boolean(form.emTreinamento) : false,
            treinamentoAte: isSellerRole(resolvedRole) && form.emTreinamento ? form.treinamentoAte || null : null,
            ativo: canManageAccessStatus(resolvedRole) ? Boolean(form.ativo) : true,
          }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error || 'Falha ao criar usuário');

        const created = data?.user ?? data;
        const newUser: User = {
          id: String(created?.id),
          nome: String(created?.nome || created?.name || form.nome),
          email: String(created?.email || form.email),
          senha: '',
          role: mapBackendRoleToUi(String(created?.role || mapUiRoleToBackend(selectedPermissionClassId))),
          permissionClassId:
            created?.permissionClassId !== undefined && created?.permissionClassId !== null
              ? String(created.permissionClassId)
              : resolvedPermissionClassId,
          comissaoPercent:
            typeof created?.comissaoPercent === 'number'
              ? created.comissaoPercent
              : isCommissionRole(resolvedRole)
                ? comissaoPercent
                : 0,
          emTreinamento: Boolean(created?.emTreinamento ?? (isSellerRole(resolvedRole) ? form.emTreinamento : false)),
          treinamentoAte: created?.treinamentoAte ? String(created.treinamentoAte).slice(0, 10) : null,
          ativo: typeof created?.ativo === 'boolean' ? created.ativo : canManageAccessStatus(resolvedRole) ? form.ativo : true,
        };
        setUsersState((prev) => [newUser, ...prev]);
        setShowForm(false);
        setForm({
          nome: '',
          email: '',
          senha: '',
          role: '',
          comissaoPercent: '',
          emTreinamento: false,
          treinamentoAte: '',
          ativo: true,
        });
        return;
      } catch (e: any) {
        setRemoteError(String(e?.message || 'Falha ao criar usuário'));
        return;
      }
    }

    const newUser: User = {
      id: crypto.randomUUID(),
      nome: form.nome,
      email: form.email,
      senha: form.senha,
      role: mapUiRoleToBackend(selectedPermissionClassId),
      permissionClassId: resolvedPermissionClassId,
      comissaoPercent: isCommissionRole(resolvedRole)
        ? Math.min(100, Math.max(0, parseFloat(String(form.comissaoPercent || '').replace(',', '.')) || 0))
        : 0,
      emTreinamento: isSellerRole(resolvedRole) ? form.emTreinamento : false,
      treinamentoAte: isSellerRole(resolvedRole) && form.emTreinamento ? form.treinamentoAte || null : null,
      ativo: canManageAccessStatus(resolvedRole) ? form.ativo : true,
    };
    const updated = [...users, newUser];
    setUsersState(updated);
    saveUsers(updated);
    setShowForm(false);
    setForm({
      nome: '',
      email: '',
      senha: '',
      role: '',
      comissaoPercent: '',
      emTreinamento: false,
      treinamentoAte: '',
      ativo: true,
    });
  };

  const handleDelete = async (id: string) => {
    setRemoteError(null);
    if (backend && token) {
      try {
        const res = await fetch(`${backend}/api/users/${encodeURIComponent(id)}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error || 'Falha ao desativar usuário');
        const updatedUser = data?.user;
        setUsersState((prev) =>
          prev.map((u) =>
            u.id === id
              ? {
                  ...u,
                  ativo: updatedUser?.ativo === false ? false : false,
                  emTreinamento: typeof updatedUser?.emTreinamento === 'boolean' ? updatedUser.emTreinamento : u.emTreinamento,
                  treinamentoAte: updatedUser?.treinamentoAte ? String(updatedUser.treinamentoAte).slice(0, 10) : u.treinamentoAte,
                }
              : u,
          ),
        );
        toast.success('Usuário desativado');
      } catch (e: any) {
        setRemoteError(String(e?.message || 'Falha ao desativar usuário'));
      }
      return;
    }

    if (id === 'admin-1') return;
    const updated = users.map((u) => (u.id === id ? { ...u, ativo: false } : u));
    setUsersState(updated);
    saveUsers(updated);
  };

  const handleReactivate = async (id: string) => {
    const ok = await handleUpdateUser(id, { ativo: true });
    if (ok) toast.success('Usuário reativado');
  };

  const openPasswordDialog = (id: string) => {
    setPasswordUserId(id);
    setPasswordValue('');
    setPasswordConfirm('');
    setPasswordOpen(true);
  };

  const openEditDialog = (id: string) => {
    const u = users.find((x) => x.id === id) || null;
    setEditUserId(id);
    setEditDraft({
      nome: String(u?.nome || ''),
      email: String(u?.email || ''),
      role: (((u as any)?.permissionClassId || u?.role || '') as UserRole | ''),
      comissaoPercent: typeof u?.comissaoPercent === 'number' ? String(u.comissaoPercent) : '',
      emTreinamento: Boolean(u?.emTreinamento),
      treinamentoAte: u?.treinamentoAte ? String(u.treinamentoAte).slice(0, 10) : '',
      ativo: typeof u?.ativo === 'boolean' ? u.ativo : true,
    });
    setEditOpen(true);
  };

  const handleEditSave = async () => {
    const id = String(editUserId || '').trim();
    if (!id) return;
    const current = selectedEditUser;
    if (!current) return;

    const nome = String(editDraft.nome || '').trim();
    const email = String(editDraft.email || '').trim();
    if (!nome || !email) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error('Email inválido');
      return;
    }
    const selectedPermissionClassId = String(editDraft.role || '').trim();
    const resolvedPermissionClassId = resolvePermissionClassIdForSubmission(selectedPermissionClassId, availablePermissionClasses);
    const resolvedRole = resolveRoleFromPermissionClass(selectedPermissionClassId, availablePermissionClasses);
    if (!selectedPermissionClassId) {
      toast.error('Selecione o perfil do usuário');
      return;
    }

    const comissaoPercent = isCommissionRole(resolvedRole)
      ? Math.min(100, Math.max(0, parseFloat(String(editDraft.comissaoPercent || '').replace(',', '.')) || 0))
      : 0;

    if (isSellerRole(resolvedRole) && editDraft.emTreinamento && !String(editDraft.treinamentoAte || '').trim()) {
      toast.error('Informe a data limite do treinamento');
      return;
    }

    setSavingEdit(true);
    try {
      const ok = await handleUpdateUser(id, {
        nome,
        email,
        role: mapUiRoleToBackend(selectedPermissionClassId),
        permissionClassId: resolvedPermissionClassId,
        comissaoPercent: isCommissionRole(resolvedRole) ? comissaoPercent : 0,
        emTreinamento: isSellerRole(resolvedRole) ? Boolean(editDraft.emTreinamento) : false,
        treinamentoAte:
          isSellerRole(resolvedRole)
            ? editDraft.emTreinamento
              ? String(editDraft.treinamentoAte || '').trim() || null
              : null
            : null,
        ativo: canManageAccessStatus(resolvedRole) ? Boolean(editDraft.ativo) : true,
      });
      if (!ok) return;
      setEditOpen(false);
      toast.success('Usuário atualizado');
    } finally {
      setSavingEdit(false);
    }
  };

  const openNewPermissionClass = () => {
    const draft = permissionClassToDraft(createEmptyPermissionClass(''));
    setSelectedPermissionClassId(draft.id);
    setPermissionDraft(draft);
  };

  const savePermissionClass = async () => {
    const nome = String(permissionDraft.nome || '').trim();
    if (!nome) {
      toast.error('Informe o nome da função');
      return;
    }
    setSavingPermissionClass(true);
    try {
      const nextClass = draftToPermissionClass(permissionDraft, selectedPermissionClass?.criadoEm);
      if (backend && token) {
        const exists = permissionClasses.some((item) => item.id === nextClass.id);
        const endpoint = exists
          ? `${backend}/api/permission-classes/${encodeURIComponent(nextClass.id)}`
          : `${backend}/api/permission-classes`;
        const res = await fetch(endpoint, {
          method: exists ? 'PUT' : 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(nextClass),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error || 'Falha ao salvar  função');
        const saved = data?.class ?? data;
        const normalized: PermissionClass = {
          id: String(saved.id),
          nome: String(saved.nome || nextClass.nome),
          trafficRead: Boolean(saved.trafficRead),
          trafficWrite: Boolean(saved.trafficWrite),
          commercialRead: Boolean(saved.commercialRead),
          commercialWrite: Boolean(saved.commercialWrite),
          adminMetricsRead: Boolean((saved as any).adminMetricsRead),
          usersRead: Boolean(saved.usersRead),
          usersCreate: Boolean(saved.usersCreate),
          usersDeactivate: Boolean(saved.usersDeactivate),
          otherPermissions: Array.isArray(saved.otherPermissions) ? saved.otherPermissions.map((v: any) => String(v)) : nextClass.otherPermissions,
          criadoEm: String(saved.createdAt || nextClass.criadoEm),
        };
        const nextList = exists
          ? permissionClasses.map((item) => (item.id === nextClass.id ? normalized : item))
          : [...permissionClasses, normalized];
        savePermissionClasses(nextList);
        setPermissionClasses(nextList);
        setBackendPermissionClasses(nextList);
        setSelectedPermissionClassId(normalized.id);
        setPermissionDraft(permissionClassToDraft(normalized));
        toast.success(exists ? 'Função atualizada' : 'Função criada');
        return;
      }

      const exists = permissionClasses.some((item) => item.id === nextClass.id);
      const nextList = exists
        ? permissionClasses.map((item) => (item.id === nextClass.id ? nextClass : item))
        : [...permissionClasses, nextClass];
      savePermissionClasses(nextList);
      setPermissionClasses(nextList);
      setSelectedPermissionClassId(nextClass.id);
      setPermissionDraft(permissionClassToDraft(nextClass));
      toast.success(exists ? 'Função atualizada' : 'Função criada');
    } finally {
      setSavingPermissionClass(false);
    }
  };

  const deletePermissionClass = async () => {
    const targetId = String(selectedPermissionClassId || '').trim();
    if (!targetId) return;
    const usersUsingRole = countUsersForPermissionClass(targetId);
    if (usersUsingRole > 0) {
      toast.error('Não é possível excluir uma função que possui usuários vinculados.');
      return;
    }
    if (backend && token) {
      const res = await fetch(`${backend}/api/permission-classes/${encodeURIComponent(targetId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        if (res.status !== 404) {
          toast.error(String(data?.error || 'Falha ao Excluir função'));
          return;
        }
      }
    }
    const nextList = permissionClasses.filter((item) => item.id !== targetId);
    savePermissionClasses(nextList);
    setPermissionClasses(nextList);
    if (backend && token) setBackendPermissionClasses(nextList);
    const fallback = nextList[0] || null;
    setSelectedPermissionClassId(fallback?.id || '');
    setPermissionDraft(permissionClassToDraft(fallback));
    toast.success('Função removida');
  };

  const handleChangePassword = async () => {
    const id = String(passwordUserId || '').trim();
    if (!id) return;
    const novaSenha = String(passwordValue || '');
    const confirm = String(passwordConfirm || '');
    if (!novaSenha) return;
    if (novaSenha !== confirm) {
      toast.error('A confirmação não confere');
      return;
    }

    setRemoteError(null);
    setSavingPassword(true);
    try {
      if (backend && token) {
        const res = await fetch(`${backend}/api/users/${encodeURIComponent(id)}/password`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ novaSenha }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error || 'Falha ao alterar senha');
        setPasswordOpen(false);
        toast.success('Senha alterada');
        return;
      }

      const all = getUsers();
      const nextUsers = all.map((u) => (u.id === id ? { ...u, senha: novaSenha } : u));
      saveUsers(nextUsers);
      setUsersState(nextUsers.map((u) => ({ ...u, senha: '' })));
      setPasswordOpen(false);
      toast.success('Senha alterada');
    } catch (e: any) {
      const msg = String(e?.message || 'Falha ao alterar senha');
      setRemoteError(msg);
      toast.error(msg);
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'usuarios' | 'permissoes')} className="space-y-6">
      <TabsList>
        <TabsTrigger value="usuarios">Usuários</TabsTrigger>
        <TabsTrigger value="permissoes">Funções</TabsTrigger>
      </TabsList>

      <TabsContent value="usuarios" className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[1.625rem] leading-tight font-semibold tracking-tight">Gerenciar Usuários</h1>
            <p className="text-muted-foreground text-sm mt-1">Cadastre e gerencie os perfis de acesso</p>
          </div>
          <Button onClick={() => setShowForm(!showForm)} className="active:scale-[0.97]">
            <Plus className="mr-2 h-4 w-4" /> Novo Usuário
          </Button>
        </div>

        {showForm && (
        <Card>
          <CardContent className="p-5 grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="space-y-1.5">
              <Label>Nome</Label>
              <Input value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} placeholder="Nome completo" />
            </div>
            <div className="space-y-1.5">
              <Label>Usuário (login)</Label>
              <Input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="usuario.login" />
            </div>
            <div className="space-y-1.5">
              <Label>Senha</Label>
              <Input type="password" value={form.senha} onChange={e => setForm({ ...form, senha: e.target.value })} placeholder="••••••" />
            </div>
            <div className="space-y-1.5">
              <Label>Perfil</Label>
              <Select value={form.role} onValueChange={v => setForm({ ...form, role: v as UserRole })}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {availablePermissionClasses.map((permissionClass) => (
                    <SelectItem key={permissionClass.id} value={permissionClass.id}>{permissionClass.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {isCommissionRole(selectedFormRole) && (
              <div className="space-y-1.5">
                <Label>Comissão (%)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  value={form.comissaoPercent}
                  onChange={e => setForm({ ...form, comissaoPercent: e.target.value })}
                  placeholder="0"
                />
              </div>
            )}
            {canManageAccessStatus(selectedFormRole) && (
              <div className="col-span-full grid grid-cols-1 md:grid-cols-3 gap-4">
                {isSellerRole(selectedFormRole) ? (
                  <>
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2 pt-6">
                        <Checkbox
                          checked={form.emTreinamento}
                          onCheckedChange={(v) =>
                            setForm((prev) => ({
                              ...prev,
                              emTreinamento: Boolean(v),
                              treinamentoAte: Boolean(v) ? prev.treinamentoAte : '',
                            }))
                          }
                          id="form-em-treinamento"
                        />
                        <Label htmlFor="form-em-treinamento">Vendedor em treinamento</Label>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Data limite do treinamento</Label>
                      <Input
                        type="date"
                        value={form.treinamentoAte}
                        disabled={!form.emTreinamento}
                        onChange={(e) => setForm((prev) => ({ ...prev, treinamentoAte: e.target.value }))}
                      />
                    </div>
                  </>
                ) : (
                  <div className="md:col-span-2" />
                )}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 pt-6">
                    <Checkbox
                      checked={form.ativo}
                      onCheckedChange={(v) => setForm((prev) => ({ ...prev, ativo: Boolean(v) }))}
                      id="form-acesso-ativo"
                    />
                    <Label htmlFor="form-acesso-ativo">Acesso ativo</Label>
                  </div>
                </div>
              </div>
            )}
            <div className="col-span-full flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
              <Button onClick={handleSave} disabled={!form.nome || !form.email || !form.senha || !form.role}>Salvar</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {remoteError && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {remoteError}
        </div>
      )}

      <Card>
        <CardContent className="p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            <div className="space-y-1.5 md:col-span-2">
              <Label>Novo time</Label>
              <Input value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="Nome do time" />
            </div>
            <div className="flex justify-end">
              <Button onClick={handleCreateTeam} disabled={!teamName.trim() || savingTeam}>
                Criar time
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {teams.map((t: any) => (
              <div key={t.id} className="flex items-center justify-between rounded-lg border px-3 py-2">
                <div className="min-w-0">
                  <div className="font-medium truncate">{t.nome}</div>
                  <div className="text-xs text-muted-foreground">{Array.isArray(t.members) ? t.members.length : 0} membros</div>
                </div>
                <div className="flex items-center gap-2">
                  <Select
                    value={t.leader?.id ? String(t.leader.id) : 'none'}
                    onValueChange={async (v) => {
                      const leaderId = v === 'none' ? null : String(v);
                      try {
                        const res = await fetch(`${teamsApiBase}/${encodeURIComponent(t.id)}/leader`, {
                          method: 'PUT',
                          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                          body: JSON.stringify({ leaderId }),
                        });
                        const data = await res.json().catch(() => null);
                        if (!res.ok) throw new Error(data?.error || 'Falha ao salvar líder');
                        setTeams((prev) =>
                          prev.map((x: any) =>
                            x.id === t.id
                              ? {
                                  ...x,
                                  leader: leaderId ? (t.members || []).find((m: any) => m.id === leaderId) || { id: leaderId, nome: '—', email: '' } : null,
                                }
                              : x,
                          ),
                        );
                        toast.success('Líder atualizado');
                      } catch (e: any) {
                        toast.error(String(e?.message || 'Falha ao salvar líder'));
                      }
                    }}
                  >
                    <SelectTrigger className="h-8 w-48">
                      <SelectValue placeholder="Líder" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sem líder</SelectItem>
                      {(t.members || []).map((m: any) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive" onClick={() => handleDeleteTeam(t.id)} title="Excluir time">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            <div className="space-y-1.5">
              <Label>Mínimo de resgates internos (%)</Label>
              <Input
                type="number"
                min="0"
                max="100"
                step="1"
                value={bonusDraft.minInternalRescuePercent}
                onChange={(e) => setBonusDraft((prev) => ({ ...prev, minInternalRescuePercent: Math.max(0, Math.min(100, parseInt(e.target.value || '0') || 0)) }))}
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={bonusDraft.leaderBonusEnabled}
                  onCheckedChange={(v) => setBonusDraft((prev) => ({ ...prev, leaderBonusEnabled: Boolean(v) }))}
                  id="leader-bonus-enabled"
                />
                <Label htmlFor="leader-bonus-enabled">Bonificar líder</Label>
              </div>
              <Label>Bonificação do líder (%)</Label>
              <Input
                type="number"
                min="0"
                max="100"
                step="1"
                value={bonusDraft.leaderBonusPercent}
                disabled={!bonusDraft.leaderBonusEnabled}
                onChange={(e) => setBonusDraft((prev) => ({ ...prev, leaderBonusPercent: Math.max(0, Math.min(100, parseInt(e.target.value || '0') || 0)) }))}
              />
            </div>
            <div className="md:col-span-1 md:col-start-3 flex justify-end">
              <Button onClick={handleSaveBonus} disabled={savingBonus}>
                Salvar bonificação
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-sm font-medium">Regras (vendas da equipe → PIX)</div>
            {(bonusDraft.rules || []).map((r, idx) => (
              <div key={idx} className="grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
                <div className="space-y-1.5 md:col-span-2">
                  <Label>Min. vendas</Label>
                  <Input
                    type="number"
                    min="0"
                    step="1"
                    value={r.minVendas}
                    onChange={(e) => {
                      const v = Math.max(0, parseInt(e.target.value || '0') || 0);
                      setBonusDraft((prev) => ({
                        ...prev,
                        rules: (prev.rules || []).map((x, i) => (i === idx ? { ...x, minVendas: v } : x)),
                      }));
                    }}
                  />
                </div>
                <div className="space-y-1.5 md:col-span-3">
                  <Label>PIX (R$)</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={r.pixValor}
                    onChange={(e) => {
                      const v = Math.max(0, parseFloat(e.target.value || '0') || 0);
                      setBonusDraft((prev) => ({
                        ...prev,
                        rules: (prev.rules || []).map((x, i) => (i === idx ? { ...x, pixValor: v } : x)),
                      }));
                    }}
                  />
                </div>
                <div className="md:col-span-1 flex justify-end">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => setBonusDraft((prev) => ({ ...prev, rules: (prev.rules || []).filter((_, i) => i !== idx) }))}
                    title="Remover regra"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
            <div className="flex justify-end">
              <Button
                variant="outline"
                onClick={() => setBonusDraft((prev) => ({ ...prev, rules: [...(prev.rules || []), { minVendas: 0, pixValor: 0 }] }))}
              >
                Adicionar regra
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Login</TableHead>
                <TableHead>Time</TableHead>
                <TableHead>Perfil</TableHead>
                <TableHead className="text-right">Comissão (%)</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-24"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activeUsers.map((u) => {
                const effectiveRole = getEffectiveUserRole(u);
                return (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.nome}</TableCell>
                  <TableCell className="font-mono text-sm">{u.email}</TableCell>
                  <TableCell>
                    <Select
                      value={u.teamId ? String(u.teamId) : 'none'}
                      onValueChange={(v) => handleAssignTeam(u.id, v === 'none' ? null : String(v))}
                    >
                      <SelectTrigger className="h-8">
                        <SelectValue placeholder="Sem time" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Sem time</SelectItem>
                        {teams.map((t) => (
                          <SelectItem key={t.id} value={t.id}>
                            {t.nome}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <span className={`text-xs font-medium px-2 py-1 rounded-full ${getRoleColor(effectiveRole)}`}>
                      {getRoleDisplayName(String((u as any).permissionClassId || effectiveRole))}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    {isCommissionRole(effectiveRole)
                      ? `${Math.min(100, Math.max(0, Number(u.comissaoPercent ?? 0))).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`
                      : '—'}
                  </TableCell>
                  <TableCell>
                    {canManageAccessStatus(effectiveRole) ? (
                      <div className="flex flex-col gap-1">
                        <span className={`text-xs font-medium px-2 py-1 rounded-full w-fit ${u.ativo === false ? 'bg-destructive/10 text-destructive' : 'bg-success/10 text-success'}`}>
                          {u.ativo === false ? 'Acesso desativado' : 'Acesso ativo'}
                        </span>
                        {isSellerRole(effectiveRole) && u.emTreinamento ? (
                          <span className="text-xs text-warning">
                            Treinamento até {u.treinamentoAte ? String(u.treinamentoAte).slice(0, 10) : 'não informado'}
                          </span>
                        ) : null}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-foreground"
                        onClick={() => openEditDialog(u.id)}
                        title="Editar usuário"
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-foreground"
                        onClick={() => openPasswordDialog(u.id)}
                        title="Alterar senha"
                      >
                        <KeyRound className="w-4 h-4" />
                      </Button>
                      {u.id !== 'admin-1' && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-muted-foreground hover:text-destructive"
                          onClick={() => handleDelete(u.id)}
                          title="Desativar usuário"
                        >
                          <UserX className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );})}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Usuários desativados</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {disabledUsers.length === 0 ? (
            <div className="p-5 text-sm text-muted-foreground">Nenhum usuário desativado.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Login</TableHead>
                  <TableHead>Perfil</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-24"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {disabledUsers.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">{u.nome}</TableCell>
                    <TableCell className="font-mono text-sm">{u.email}</TableCell>
                    <TableCell>
                      <span className={`text-xs font-medium px-2 py-1 rounded-full ${getRoleColor(u.role)}`}>
                        {getRoleDisplayName(u.role)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs font-medium px-2 py-1 rounded-full w-fit bg-destructive/10 text-destructive">
                        Acesso desativado
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleReactivate(u.id)}
                        >
                          Reativar
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ranking de Equipes</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Equipe</TableHead>
                <TableHead className="text-right">Membros</TableHead>
                <TableHead className="text-right">Vendas</TableHead>
                <TableHead className="text-right">Resgate Interno (%)</TableHead>
                <TableHead className="text-right">PIX (R$)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {teamRanking.map((r) => (
                <TableRow key={r.teamId}>
                  <TableCell>{r.nome}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.membros}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.vendas}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.internalRescuePercent.toFixed(1)}%</TableCell>
                  <TableCell className="text-right tabular-nums">R$ {r.bonusPixValor.toLocaleString('pt-BR')}</TableCell>
                </TableRow>
              ))}
              {teamRanking.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                    Sem dados
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={passwordOpen} onOpenChange={setPasswordOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Alterar senha</DialogTitle>
            <DialogDescription>{selectedUser ? `${selectedUser.nome} (${selectedUser.email})` : ''}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Nova senha</Label>
              <Input type="password" value={passwordValue} onChange={(e) => setPasswordValue(e.target.value)} placeholder="••••••" />
            </div>
            <div className="space-y-1.5">
              <Label>Confirmar nova senha</Label>
              <Input
                type="password"
                value={passwordConfirm}
                onChange={(e) => setPasswordConfirm(e.target.value)}
                placeholder="••••••"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPasswordOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleChangePassword} disabled={!passwordValue || savingPassword}>
              {savingPassword ? 'Salvando...' : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={editOpen}
        onOpenChange={(open) => {
          setEditOpen(open);
          if (!open) {
            setEditUserId(null);
            setEditDraft({ nome: '', email: '', role: '', comissaoPercent: '', emTreinamento: false, treinamentoAte: '', ativo: true });
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar usuário</DialogTitle>
            <DialogDescription>{selectedEditUser ? `${selectedEditUser.nome} (${selectedEditUser.email})` : ''}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Nome</Label>
              <Input value={editDraft.nome} onChange={(e) => setEditDraft((prev) => ({ ...prev, nome: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input value={editDraft.email} onChange={(e) => setEditDraft((prev) => ({ ...prev, email: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Perfil</Label>
              <Select
                value={editDraft.role}
                onValueChange={(value) => {
                  const resolvedRole = resolveRoleFromPermissionClass(value, availablePermissionClasses);
                  setEditDraft((prev) => ({
                    ...prev,
                    role: value as UserRole,
                    emTreinamento: isSellerRole(resolvedRole) ? prev.emTreinamento : false,
                    treinamentoAte: isSellerRole(resolvedRole) ? prev.treinamentoAte : '',
                    ativo: canManageAccessStatus(resolvedRole) ? prev.ativo : true,
                    comissaoPercent: isCommissionRole(resolvedRole) ? prev.comissaoPercent : '0',
                  }));
                }}
              >
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {availablePermissionClasses.map((permissionClass) => (
                    <SelectItem key={permissionClass.id} value={permissionClass.id}>{permissionClass.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {isCommissionRole(selectedEditRole) && (
              <div className="space-y-1.5">
                <Label>Comissão (%)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  value={editDraft.comissaoPercent}
                  onChange={(e) => setEditDraft((prev) => ({ ...prev, comissaoPercent: e.target.value }))}
                />
              </div>
            )}
            {canManageAccessStatus(selectedEditRole) && (
              <>
                {isSellerRole(selectedEditRole) ? (
                  <>
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <Checkbox
                          checked={editDraft.emTreinamento}
                          onCheckedChange={(v) =>
                            setEditDraft((prev) => ({
                              ...prev,
                              emTreinamento: Boolean(v),
                              treinamentoAte: Boolean(v) ? prev.treinamentoAte : '',
                            }))
                          }
                          id="edit-em-treinamento"
                        />
                        <Label htmlFor="edit-em-treinamento">Vendedor em treinamento</Label>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Data limite do treinamento</Label>
                      <Input
                        type="date"
                        value={editDraft.treinamentoAte}
                        disabled={!editDraft.emTreinamento}
                        onChange={(e) => setEditDraft((prev) => ({ ...prev, treinamentoAte: e.target.value }))}
                      />
                    </div>
                  </>
                ) : null}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={editDraft.ativo}
                      onCheckedChange={(v) => setEditDraft((prev) => ({ ...prev, ativo: Boolean(v) }))}
                      id="edit-acesso-ativo"
                    />
                    <Label htmlFor="edit-acesso-ativo">Acesso ativo</Label>
                  </div>
                </div>
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleEditSave}
              disabled={!editDraft.nome.trim() || !editDraft.email.trim() || savingEdit}
            >
              {savingEdit ? 'Salvando...' : 'Salvar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </TabsContent>

      <TabsContent value="permissoes" className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[1.625rem] leading-tight font-semibold tracking-tight">Permissões</h1>
            <p className="text-muted-foreground text-sm mt-1">Crie funções e distribua leitura, escrita e ações administrativas.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={openNewPermissionClass}>Nova função</Button>
            <Button onClick={savePermissionClass} disabled={savingPermissionClass || !permissionDraft.nome.trim()}>
              {savingPermissionClass ? 'Salvando...' : 'Salvar Função'}
            </Button>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Funções existentes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {availablePermissionClasses.map((permissionClass) => {
                const assigned = countUsersForPermissionClass(permissionClass.id);
                return (
                  <button
                    key={permissionClass.id}
                    type="button"
                    onClick={() => {
                      setSelectedPermissionClassId(permissionClass.id);
                      setPermissionDraft(permissionClassToDraft(permissionClass));
                    }}
                    className={`w-full rounded-lg border px-3 py-3 text-left transition ${selectedPermissionClassId === permissionClass.id ? 'border-primary bg-primary/5' : 'hover:bg-muted/40'}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-medium">{permissionClass.nome}</div>
                      <div className="text-xs text-muted-foreground">{assigned} usuário(s)</div>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">{summarizePermissionClass(permissionClass)}</div>
                  </button>
                );
              })}
              {permissionClasses.length === 0 && <div className="text-sm text-muted-foreground">Nenhum role cadastrado.</div>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Editar role</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label>Nome da função</Label>
                <Input value={permissionDraft.nome} onChange={(e) => setPermissionDraft((prev) => ({ ...prev, nome: e.target.value }))} placeholder="Ex.: Comercial Premium" />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-3 rounded-lg border p-4">
                  <div className="font-medium">Tráfego</div>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={permissionDraft.trafficRead} onCheckedChange={(v) => setPermissionDraft((prev) => ({ ...prev, trafficRead: Boolean(v) }))} />
                    Leitura
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={permissionDraft.trafficWrite} onCheckedChange={(v) => setPermissionDraft((prev) => ({ ...prev, trafficWrite: Boolean(v) }))} />
                    Escrita
                  </label>
                </div>
                <div className="space-y-3 rounded-lg border p-4">
                  <div className="font-medium">Comercial</div>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={permissionDraft.commercialRead} onCheckedChange={(v) => setPermissionDraft((prev) => ({ ...prev, commercialRead: Boolean(v) }))} />
                    Leitura
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={permissionDraft.commercialWrite} onCheckedChange={(v) => setPermissionDraft((prev) => ({ ...prev, commercialWrite: Boolean(v) }))} />
                    Escrita
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox checked={permissionDraft.adminMetricsRead} onCheckedChange={(v) => setPermissionDraft((prev) => ({ ...prev, adminMetricsRead: Boolean(v) }))} />
                    Métricas do admin
                  </label>
                </div>
                <div className="space-y-3 rounded-lg border p-4 md:col-span-2">
                  <div className="font-medium">Usuários</div>
                  <div className="grid gap-3 md:grid-cols-3">
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox checked={permissionDraft.usersRead} onCheckedChange={(v) => setPermissionDraft((prev) => ({ ...prev, usersRead: Boolean(v) }))} />
                      Leitura
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox checked={permissionDraft.usersCreate} onCheckedChange={(v) => setPermissionDraft((prev) => ({ ...prev, usersCreate: Boolean(v) }))} />
                      Criação
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox checked={permissionDraft.usersDeactivate} onCheckedChange={(v) => setPermissionDraft((prev) => ({ ...prev, usersDeactivate: Boolean(v) }))} />
                      Desativar usuários
                    </label>
                  </div>
                </div>
                <div className="space-y-3 rounded-lg border p-4 md:col-span-2">
                  <div className="font-medium">Produtos</div>
                  <div className="grid gap-3 md:grid-cols-3">
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox checked={permissionDraft.productsCreate} onCheckedChange={(v) => setPermissionDraft((prev) => ({ ...prev, productsCreate: Boolean(v) }))} />
                      Criar
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox checked={permissionDraft.productsUpdate} onCheckedChange={(v) => setPermissionDraft((prev) => ({ ...prev, productsUpdate: Boolean(v) }))} />
                      Editar
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox checked={permissionDraft.productsDelete} onCheckedChange={(v) => setPermissionDraft((prev) => ({ ...prev, productsDelete: Boolean(v) }))} />
                      Apagar
                    </label>
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Demais permissões</Label>
                <Textarea
                  value={permissionDraft.otherPermissionsText}
                  onChange={(e) => setPermissionDraft((prev) => ({ ...prev, otherPermissionsText: e.target.value }))}
                  placeholder="Uma função por linha ou separada por vírgula"
                  rows={4}
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs text-muted-foreground">
                  {selectedPermissionClass ? `Editando: ${selectedPermissionClass.nome}` : 'Criando nova função'}
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={deletePermissionClass} disabled={!selectedPermissionClassId || countUsersForPermissionClass(selectedPermissionClassId) > 0}>Excluir função</Button>
                  <Button onClick={savePermissionClass} disabled={savingPermissionClass || !permissionDraft.nome.trim()}>
                    {savingPermissionClass ? 'Salvando...' : 'Salvar  Função'}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Permissões disponíveis por usuário</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Usuário</TableHead>
                  <TableHead>Função</TableHead>
                  <TableHead>Tráfego</TableHead>
                  <TableHead>Comercial</TableHead>
                  <TableHead>Usuários</TableHead>
                  <TableHead>Produtos</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeUsers.map((userItem) => {
                  const permissionClass =
                    permissionClasses.find((item) => normalizeRoleValue(item.id) === normalizeRoleValue(userItem.role)) ||
                    permissionClasses.find((item) => normalizeRoleValue(item.nome) === normalizeRoleValue(userItem.role)) ||
                    null;
                  return (
                    <TableRow key={userItem.id}>
                      <TableCell className="font-medium">{userItem.nome}</TableCell>
                      <TableCell>
                        <Select
                          value={String(userItem.role || '')}
                          onValueChange={async (value) => {
                            const ok = await handleUpdateUser(userItem.id, { role: value, permissionClassId: value });
                            if (ok) toast.success('Role atualizado');
                            if (ok) toast.success('Função atualizada');
                          }}
                        >
                          <SelectTrigger className="h-8 w-56">
                            <SelectValue placeholder="Selecione" />
                          </SelectTrigger>
                          <SelectContent>
                            {availablePermissionClasses.map((permissionClassItem) => (
                              <SelectItem key={permissionClassItem.id} value={permissionClassItem.id}>
                                {permissionClassItem.nome}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {userItem.role === 'admin'
                          ? 'Leitura / Escrita'
                          : [hasPermission(userItem, 'traffic', 'read') ? 'Leitura' : '', permissionClass?.trafficWrite ? 'Escrita' : '']
                              .filter(Boolean)
                              .join(' / ') || '—'}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {userItem.role === 'admin'
                          ? 'Leitura / Escrita'
                          : [hasPermission(userItem, 'commercial', 'read') ? 'Leitura' : '', permissionClass?.commercialWrite ? 'Escrita' : '']
                              .filter(Boolean)
                              .join(' / ') || '—'}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {userItem.role === 'admin'
                          ? 'Leitura / Criação / Desativar'
                          : [
                              hasPermission(userItem, 'users', 'read') ? 'Leitura' : '',
                              permissionClass?.usersCreate ? 'Criação' : '',
                              permissionClass?.usersDeactivate ? 'Desativar' : '',
                            ]
                              .filter(Boolean)
                              .join(' / ') || '—'}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {userItem.role === 'admin'
                          ? 'Criar / Editar / Apagar'
                          : [
                              hasPermission(userItem, 'products', 'create') ? 'Criar' : '',
                              hasPermission(userItem, 'products', 'update') ? 'Editar' : '',
                              hasPermission(userItem, 'products', 'delete') ? 'Apagar' : '',
                            ]
                              .filter(Boolean)
                              .join(' / ') || '—'}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {activeUsers.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                      Nenhum usuário ativo encontrado.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}

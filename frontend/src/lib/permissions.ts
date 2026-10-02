import { User } from '@/types/dashboard';

export type PermissionArea = 'traffic' | 'commercial' | 'users' | 'adminMetrics' | 'products';
export type PermissionAction = 'read' | 'write' | 'create' | 'deactivate' | 'update' | 'delete';

export interface PermissionClass {
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
  otherPermissions: string[];
  criadoEm: string;
}

const PERMISSION_CLASSES_KEY = 'im_permission_classes';
const USER_PERMISSION_CLASS_MAP_KEY = 'im_user_permission_class_map';
const PRODUCT_PERMISSION_TOKENS = {
  create: 'products:create',
  update: 'products:update',
  delete: 'products:delete',
} as const;

function normalizePermissionToken(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function withProductPermissionDefaults(permissionClass: PermissionClass): PermissionClass {
  const current = normalizePermissionList(permissionClass.otherPermissions).map(normalizePermissionToken);
  const next = new Set(current);
  if (normalizeRoleToken(permissionClass.id) === 'admin' || normalizeRoleToken(permissionClass.nome) === 'admin') {
    next.add(PRODUCT_PERMISSION_TOKENS.create);
    next.add(PRODUCT_PERMISSION_TOKENS.update);
    next.add(PRODUCT_PERMISSION_TOKENS.delete);
  }
  return {
    ...permissionClass,
    otherPermissions: Array.from(next),
  };
}

function hasOtherPermissionToken(permissionClass: PermissionClass, token: string) {
  const normalizedTarget = normalizePermissionToken(token);
  if (!normalizedTarget) return false;
  return normalizePermissionList(permissionClass.otherPermissions)
    .map(normalizePermissionToken)
    .includes(normalizedTarget);
}

function hasProductPermission(permissionClass: PermissionClass, action: PermissionAction) {
  if (action === 'create') return hasOtherPermissionToken(permissionClass, PRODUCT_PERMISSION_TOKENS.create);
  if (action === 'update' || action === 'write') return hasOtherPermissionToken(permissionClass, PRODUCT_PERMISSION_TOKENS.update);
  if (action === 'delete' || action === 'deactivate') return hasOtherPermissionToken(permissionClass, PRODUCT_PERMISSION_TOKENS.delete);
  return (
    hasOtherPermissionToken(permissionClass, PRODUCT_PERMISSION_TOKENS.create) ||
    hasOtherPermissionToken(permissionClass, PRODUCT_PERMISSION_TOKENS.update) ||
    hasOtherPermissionToken(permissionClass, PRODUCT_PERMISSION_TOKENS.delete)
  );
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

function hasStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function readJson<T>(key: string, fallback: T): T {
  if (!hasStorage()) return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T) {
  if (!hasStorage()) return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

function makeId(prefix: string) {
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${random}`;
}

function normalizePermissionList(value: unknown) {
  if (!Array.isArray(value)) return [] as string[];
  return Array.from(new Set(value.map((item) => String(item || '').trim()).filter(Boolean)));
}

export function createEmptyPermissionClass(nome = ''): PermissionClass {
  return {
    id: makeId('role'),
    nome,
    trafficRead: false,
    trafficWrite: false,
    commercialRead: false,
    commercialWrite: false,
    adminMetricsRead: false,
    usersRead: false,
    usersCreate: false,
    usersDeactivate: false,
    otherPermissions: [],
    criadoEm: new Date().toISOString(),
  };
}

function normalizePermissionClass(raw: any): PermissionClass {
  const base = createEmptyPermissionClass(String(raw?.nome || '').trim());
  return withProductPermissionDefaults({
    ...base,
    id: String(raw?.id || base.id),
    nome: String(raw?.nome || base.nome || '').trim(),
    trafficRead: Boolean(raw?.trafficRead),
    trafficWrite: Boolean(raw?.trafficWrite),
    commercialRead: Boolean(raw?.commercialRead),
    commercialWrite: Boolean(raw?.commercialWrite),
    adminMetricsRead: Boolean(raw?.adminMetricsRead),
    usersRead: Boolean(raw?.usersRead),
    usersCreate: Boolean(raw?.usersCreate),
    usersDeactivate: Boolean(raw?.usersDeactivate),
    otherPermissions: normalizePermissionList(raw?.otherPermissions),
    criadoEm: String(raw?.criadoEm || base.criadoEm),
  });
}

const DEFAULT_PERMISSION_CLASSES: PermissionClass[] = [
  {
    id: 'admin',
    nome: 'Admin',
    trafficRead: true,
    trafficWrite: true,
    commercialRead: true,
    commercialWrite: true,
    adminMetricsRead: true,
    usersRead: true,
    usersCreate: true,
    usersDeactivate: true,
    otherPermissions: [
      PRODUCT_PERMISSION_TOKENS.create,
      PRODUCT_PERMISSION_TOKENS.update,
      PRODUCT_PERMISSION_TOKENS.delete,
    ],
    criadoEm: new Date().toISOString(),
  },
  {
    id: 'gestor',
    nome: 'Gestor de Tráfego',
    trafficRead: true,
    trafficWrite: true,
    commercialRead: true,
    commercialWrite: false,
    adminMetricsRead: true,
    usersRead: false,
    usersCreate: false,
    usersDeactivate: false,
    otherPermissions: [],
    criadoEm: new Date().toISOString(),
  },
  {
    id: 'vendedor',
    nome: 'Vendedor',
    trafficRead: false,
    trafficWrite: false,
    commercialRead: true,
    commercialWrite: true,
    adminMetricsRead: false,
    usersRead: false,
    usersCreate: false,
    usersDeactivate: false,
    otherPermissions: [],
    criadoEm: new Date().toISOString(),
  },
  {
    id: 'closer',
    nome: 'Closer de Resgate',
    trafficRead: false,
    trafficWrite: false,
    commercialRead: true,
    commercialWrite: false,
    adminMetricsRead: false,
    usersRead: false,
    usersCreate: false,
    usersDeactivate: false,
    otherPermissions: [],
    criadoEm: new Date().toISOString(),
  },
];

export function ensureDefaultPermissionClasses() {
  if (!hasStorage()) return;
  const existing = readJson<PermissionClass[]>(PERMISSION_CLASSES_KEY, []);
  if (!Array.isArray(existing) || existing.length === 0) {
    writeJson(PERMISSION_CLASSES_KEY, DEFAULT_PERMISSION_CLASSES.map(normalizePermissionClass));
  } else {
    writeJson(PERMISSION_CLASSES_KEY, existing.map(normalizePermissionClass));
  }
  if (window.localStorage.getItem(USER_PERMISSION_CLASS_MAP_KEY) === null) {
    writeJson(USER_PERMISSION_CLASS_MAP_KEY, {});
  }
}

export function getPermissionClasses(): PermissionClass[] {
  const raw = readJson<any[]>(PERMISSION_CLASSES_KEY, []);
  const list = Array.isArray(raw) ? raw.map(normalizePermissionClass).filter((item) => item.nome) : [];
  const merged = new Map<string, PermissionClass>();
  DEFAULT_PERMISSION_CLASSES.map(normalizePermissionClass).forEach((item) => merged.set(item.id, item));
  list.forEach((item) => merged.set(item.id, item));
  return Array.from(merged.values()).sort((a, b) => a.nome.localeCompare(b.nome));
}

export function savePermissionClasses(classes: PermissionClass[]) {
  writeJson(PERMISSION_CLASSES_KEY, classes.map(normalizePermissionClass));
}

export function getPermissionClassById(id: string | null | undefined) {
  const target = String(id || '').trim();
  if (!target) return null;
  return getPermissionClasses().find((item) => item.id === target) || null;
}

export function getPermissionClassByRole(role: string | null | undefined) {
  const target = normalizeRoleToken(role);
  if (!target) return null;
  return (
    getPermissionClasses().find(
      (item) => normalizeRoleToken(item.id) === target || normalizeRoleToken(item.nome) === target,
    ) || null
  );
}

function getPermissionClassMap() {
  const raw = readJson<Record<string, string>>(USER_PERMISSION_CLASS_MAP_KEY, {});
  return raw && typeof raw === 'object' ? raw : {};
}

function savePermissionClassMap(map: Record<string, string>) {
  writeJson(USER_PERMISSION_CLASS_MAP_KEY, map);
}

export function getUserPermissionClassId(userId: string) {
  const map = getPermissionClassMap();
  const value = String(map[String(userId) || ''] || '').trim();
  return value || null;
}

export function setUserPermissionClassId(userId: string, permissionClassId: string | null) {
  const id = String(userId || '').trim();
  if (!id) return;
  const map = getPermissionClassMap();
  if (!permissionClassId) {
    delete map[id];
  } else {
    map[id] = String(permissionClassId).trim();
  }
  savePermissionClassMap(map);
}

export function hydrateUsersWithPermissionClassId<T extends { id: string; permissionClassId?: string | null }>(users: T[]) {
  return users.map((user) => ({
    ...user,
    permissionClassId: user.permissionClassId ?? getUserPermissionClassId(user.id),
  }));
}

export function hasPermission(
  user: Pick<User, 'id' | 'role' | 'permissionClassId' | 'permissionFlags'> | null | undefined,
  area: PermissionArea,
  action: PermissionAction = 'read',
) {
  if (!user) return false;
  if (normalizeRoleToken(user.role) === 'admin') return true;
  if (user.permissionFlags) {
    if (area === 'traffic') {
      return action === 'write' ? user.permissionFlags.trafficWrite : user.permissionFlags.trafficRead;
    }
    if (area === 'commercial') {
      return action === 'write' ? user.permissionFlags.commercialWrite : user.permissionFlags.commercialRead;
    }
    if (area === 'adminMetrics') {
      return user.permissionFlags.adminMetricsRead;
    }
    if (area === 'users') {
      if (action === 'create') return user.permissionFlags.usersCreate;
      if (action === 'deactivate') return user.permissionFlags.usersDeactivate;
      return user.permissionFlags.usersRead;
    }
    if (area === 'products') {
      if (action === 'create') return Boolean((user.permissionFlags as any).productsCreate);
      if (action === 'update' || action === 'write') return Boolean((user.permissionFlags as any).productsUpdate);
      if (action === 'delete' || action === 'deactivate') return Boolean((user.permissionFlags as any).productsDelete);
      return Boolean((user.permissionFlags as any).productsCreate || (user.permissionFlags as any).productsUpdate || (user.permissionFlags as any).productsDelete);
    }
  }
  const permissionClass = getPermissionClassByRole(user.role);
  if (!permissionClass) return false;
  if (area === 'traffic') {
    return action === 'write' ? permissionClass.trafficWrite : permissionClass.trafficRead;
  }
  if (area === 'commercial') {
    return action === 'write' ? permissionClass.commercialWrite : permissionClass.commercialRead;
  }
  if (area === 'adminMetrics') {
    return permissionClass.adminMetricsRead;
  }
  if (area === 'users') {
    if (action === 'create') return permissionClass.usersCreate;
    if (action === 'deactivate') return permissionClass.usersDeactivate;
    return permissionClass.usersRead;
  }
  if (area === 'products') {
    return hasProductPermission(permissionClass, action);
  }
  return false;
}

export function summarizePermissionClass(permissionClass: PermissionClass) {
  const parts: string[] = [];
  if (permissionClass.trafficRead) parts.push('Tráfego leitura');
  if (permissionClass.trafficWrite) parts.push('Tráfego escrita');
  if (permissionClass.commercialRead) parts.push('Comercial leitura');
  if (permissionClass.commercialWrite) parts.push('Comercial escrita');
  if (permissionClass.adminMetricsRead) parts.push('Métricas admin');
  if (permissionClass.usersRead) parts.push('Usuários leitura');
  if (permissionClass.usersCreate) parts.push('Usuários criação');
  if (permissionClass.usersDeactivate) parts.push('Usuários desativar');
  if (hasOtherPermissionToken(permissionClass, PRODUCT_PERMISSION_TOKENS.create)) parts.push('Produtos criar');
  if (hasOtherPermissionToken(permissionClass, PRODUCT_PERMISSION_TOKENS.update)) parts.push('Produtos editar');
  if (hasOtherPermissionToken(permissionClass, PRODUCT_PERMISSION_TOKENS.delete)) parts.push('Produtos apagar');
  const customPermissions = permissionClass.otherPermissions.filter((item) => {
    const token = normalizePermissionToken(item);
    return token !== PRODUCT_PERMISSION_TOKENS.create && token !== PRODUCT_PERMISSION_TOKENS.update && token !== PRODUCT_PERMISSION_TOKENS.delete;
  });
  if (customPermissions.length > 0) parts.push(...customPermissions);
  return parts.length > 0 ? parts.join(' • ') : 'Sem permissões configuradas';
}
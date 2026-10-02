import { User, TrafficEntry, CommercialEntry, RescueEntry, AbandonmentThresholds, Product, TrafficAlertThresholds } from '@/types/dashboard';
import { ensureDefaultPermissionClasses } from '@/lib/permissions';

const KEYS = {
  users: 'im_users',
  currentUser: 'im_current_user',
  token: 'im_token',
  traffic: 'im_traffic',
  commercial: 'im_commercial',
  rescue: 'im_rescue',
  thresholds: 'im_thresholds',
  trafficThresholds: 'im_traffic_thresholds',
  products: 'im_products',
  commercialAwards: 'im_commercial_awards',
  rescuePenalty: 'im_rescue_penalty',
  rescueCommission: 'im_rescue_commission',
  bonusLimitPercent: 'im_bonus_limit_percent',
};

function get<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function set<T>(key: string, value: T) {
  localStorage.setItem(key, JSON.stringify(value));
}

const DEFAULT_THRESHOLDS: AbandonmentThresholds = { amarelo: 5, vermelho: 10 };
const DEFAULT_TRAFFIC_THRESHOLDS: TrafficAlertThresholds = {
  highLeadMin: 100,
  lowConversionMaxPercent: 1,
  lowCplMax: 10,
  lowSalesMax: 1,
  highRoasMin: 3,
};

export function initializeStorage() {
  localStorage.removeItem(KEYS.users);
  localStorage.removeItem(KEYS.currentUser);
  ensureDefaultPermissionClasses();
  if (!localStorage.getItem(KEYS.thresholds)) {
    set(KEYS.thresholds, DEFAULT_THRESHOLDS);
  }
  if (!localStorage.getItem(KEYS.trafficThresholds)) {
    set(KEYS.trafficThresholds, DEFAULT_TRAFFIC_THRESHOLDS);
  }
  if (!localStorage.getItem(KEYS.products)) {
    set(KEYS.products, []);
  }
}

// Users
export function getUsers(): User[] {
  return get<User[]>(KEYS.users, []);
}
export function saveUsers(users: User[]) {
  set(KEYS.users, users.map(user => ({ ...user, senha: '' })));
}
export function getCurrentUser(): User | null {
  return get<User | null>(KEYS.currentUser, null);
}
export function setCurrentUser(user: User | null) {
  set(KEYS.currentUser, user ? { ...user, senha: '' } : null);
}

export function getAuthToken(): string | null {
  const raw = localStorage.getItem(KEYS.token);
  const token = raw ? String(raw).trim() : '';
  return token.length > 0 ? token : null;
}

export function setAuthToken(token: string | null) {
  if (!token) {
    localStorage.removeItem(KEYS.token);
    return;
  }
  localStorage.setItem(KEYS.token, token);
}

export function clearDashboardDataCache() {
  localStorage.removeItem(KEYS.traffic);
  localStorage.removeItem(KEYS.commercial);
  localStorage.removeItem(KEYS.products);
  localStorage.removeItem(KEYS.rescue);
}

export function getBackendBaseUrl(): string | null {
  const raw =
    String((import.meta as any).env?.VITE_BACKEND || (import.meta as any).env?.BACKEND || '').trim();
  if (typeof window !== 'undefined') {
    const origin = String(window.location.origin || '').replace(/\/$/, '');
    if (raw) {
      try {
        const configured = new URL(raw);
        const current = new URL(origin);
        const isLocalConfigured = ['localhost', '127.0.0.1', '::1'].includes(configured.hostname);
        const isLocalCurrent = ['localhost', '127.0.0.1', '::1'].includes(current.hostname);

        if ((import.meta as any).env?.DEV && isLocalConfigured && isLocalCurrent) {
          return origin;
        }
      } catch {
        return raw.replace(/\/$/, '');
      }

      return raw.replace(/\/$/, '');
    }

    return origin;
  }
  if (raw) return raw.replace(/\/$/, '');
  return null;
}

// Traffic
export function getTrafficEntries(): TrafficEntry[] {
  return get<TrafficEntry[]>(KEYS.traffic, []);
}
export function saveTrafficEntries(entries: TrafficEntry[]) {
  set(KEYS.traffic, entries);
}

// Commercial
export function getCommercialEntries(): CommercialEntry[] {
  return get<CommercialEntry[]>(KEYS.commercial, []);
}
export function saveCommercialEntries(entries: CommercialEntry[]) {
  set(KEYS.commercial, entries);
}

// Products
export function getProducts(): Product[] {
  return get<Product[]>(KEYS.products, []);
}
export function saveProducts(products: Product[]) {
  set(KEYS.products, products);
}

export type CommercialAwardsPeriod = 'weekly' | 'monthly' | 'quarterly';

export type CommercialAwardRule = {
  id: string;
  vendedorId?: string | null;
  minVendas: number;
  pixValor: number;
};

export type CommercialAwardsConfig = {
  period: CommercialAwardsPeriod;
  rules: CommercialAwardRule[];
};

export function getCommercialAwards(): CommercialAwardsConfig {
  return get<CommercialAwardsConfig>(KEYS.commercialAwards, { period: 'weekly', rules: [] });
}

export function saveCommercialAwards(config: CommercialAwardsConfig) {
  set(KEYS.commercialAwards, config);
}

// Rescue
export function getRescueEntries(): RescueEntry[] {
  return get<RescueEntry[]>(KEYS.rescue, []);
}
export function saveRescueEntries(entries: RescueEntry[]) {
  set(KEYS.rescue, entries);
}

// Thresholds
export function getThresholds(): AbandonmentThresholds {
  return get<AbandonmentThresholds>(KEYS.thresholds, DEFAULT_THRESHOLDS);
}
export function saveThresholds(t: AbandonmentThresholds) {
  set(KEYS.thresholds, t);
}

export function getTrafficThresholds(): TrafficAlertThresholds {
  const raw = get<any>(KEYS.trafficThresholds, DEFAULT_TRAFFIC_THRESHOLDS as any);
  if (raw && typeof raw === 'object') {
    const highLeadMin = Number.isFinite(raw.highLeadMin) ? raw.highLeadMin : DEFAULT_TRAFFIC_THRESHOLDS.highLeadMin;
    const lowConversionMaxPercent = Number.isFinite(raw.lowConversionMaxPercent)
      ? raw.lowConversionMaxPercent
      : DEFAULT_TRAFFIC_THRESHOLDS.lowConversionMaxPercent;
    const lowCplMax = Number.isFinite(raw.lowCplMax) ? raw.lowCplMax : DEFAULT_TRAFFIC_THRESHOLDS.lowCplMax;
    const lowSalesMax = Number.isFinite(raw.lowSalesMax) ? raw.lowSalesMax : DEFAULT_TRAFFIC_THRESHOLDS.lowSalesMax;
    const highRoasMin =
      Number.isFinite(raw.highRoasMin)
        ? raw.highRoasMin
        : Number.isFinite(raw.highRoiMinPercent)
          ? raw.highRoiMinPercent / 100 + 1
          : DEFAULT_TRAFFIC_THRESHOLDS.highRoasMin;
    return { highLeadMin, lowConversionMaxPercent, lowCplMax, lowSalesMax, highRoasMin };
  }
  return DEFAULT_TRAFFIC_THRESHOLDS;
}
export function saveTrafficThresholds(t: TrafficAlertThresholds) {
  set(KEYS.trafficThresholds, t);
}

export function getRescuePenaltyPercentPerSale(): number {
  const value = get<number>(KEYS.rescuePenalty, 0);
  const n = Number.isFinite(value) ? value : 0;
  return Math.max(0, Math.min(100, n));
}

export function saveRescuePenaltyPercentPerSale(value: number) {
  const n = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  set(KEYS.rescuePenalty, n);
}

export const getRescuePenaltyPerSale = getRescuePenaltyPercentPerSale;
export const saveRescuePenaltyPerSale = saveRescuePenaltyPercentPerSale;

export type RescueCommissionSplit = { originPercent: number; closerPercent: number };
export type RescueCommissionRule = { id: string; userIds: string[]; originPercent: number; closerPercent: number };
export type RescueCommissionConfig = { default: RescueCommissionSplit; rules: RescueCommissionRule[] };

function normalizeRescueCommissionSplit(split: RescueCommissionSplit): RescueCommissionSplit {
  const origin = Math.max(0, Math.min(100, Number((split as any)?.originPercent ?? 100)));
  const closer = Math.max(0, Math.min(100, Number((split as any)?.closerPercent ?? 0)));
  const sum = origin + closer;
  if (!Number.isFinite(sum) || sum <= 0) return { originPercent: 100, closerPercent: 0 };
  if (sum === 100) return { originPercent: origin, closerPercent: closer };
  const originPercent = Math.max(0, Math.min(100, (origin / sum) * 100));
  const closerPercent = 100 - originPercent;
  return { originPercent, closerPercent };
}

function normalizeRescueCommissionConfig(raw: any): RescueCommissionConfig {
  if (raw && typeof raw === 'object' && raw.default) {
    const rules = Array.isArray(raw.rules) ? raw.rules : [];
    const normalizedRules: RescueCommissionRule[] = rules
      .map((r: any) => ({
        id: String(r?.id ?? ''),
        userIds: Array.from(new Set((Array.isArray(r?.userIds) ? r.userIds : []).map((x: any) => String(x)).filter(Boolean))),
        ...normalizeRescueCommissionSplit({ originPercent: r?.originPercent ?? 100, closerPercent: r?.closerPercent ?? 0 }),
      }))
      .filter((r) => r.id && r.userIds.length > 0);
    return { default: normalizeRescueCommissionSplit(raw.default), rules: normalizedRules };
  }

  const legacy = normalizeRescueCommissionSplit({
    originPercent: raw?.originPercent ?? 100,
    closerPercent: raw?.closerPercent ?? 0,
  });
  return { default: legacy, rules: [] };
}

export function getRescueCommissionConfig(): RescueCommissionConfig {
  const cfg = get<any>(KEYS.rescueCommission, { default: { originPercent: 100, closerPercent: 0 }, rules: [] });
  return normalizeRescueCommissionConfig(cfg);
}

export function saveRescueCommissionConfig(cfg: RescueCommissionConfig) {
  set(KEYS.rescueCommission, normalizeRescueCommissionConfig(cfg));
}

export function getBonusLimitPercent(): number {
  const value = get<number>(KEYS.bonusLimitPercent, 100);
  const n = Number.isFinite(value) ? value : 100;
  return Math.max(0, Math.min(100, n));
}

export function saveBonusLimitPercent(value: number) {
  const n = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 100));
  set(KEYS.bonusLimitPercent, n);
}

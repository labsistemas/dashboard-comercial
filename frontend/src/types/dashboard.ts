export type UserRole = string;

export interface UserPermissionFlags {
  trafficRead: boolean;
  trafficWrite: boolean;
  commercialRead: boolean;
  commercialWrite: boolean;
  adminMetricsRead: boolean;
  usersRead: boolean;
  usersCreate: boolean;
  usersDeactivate: boolean;
  productsCreate?: boolean;
  productsUpdate?: boolean;
  productsDelete?: boolean;
}

export interface User {
  id: string;
  nome: string;
  email: string;
  senha: string;
  role: UserRole;
  avatar?: string;
  comissaoPercent?: number;
  emTreinamento?: boolean;
  treinamentoAte?: string | null;
  ativo?: boolean;
  teamId?: string | null;
  permissionClassId?: string | null;
  permissionFlags?: UserPermissionFlags | null;
}

export interface Product {
  id: string;
  nome: string;
  capaUrl?: string;
  descricao?: string;
  preco?: number;
  comissaoPercent?: number;
  maxDescontoPercent?: number;
  ativo?: boolean;
  criadoEm: string;
}

export interface CommercialSaleLine {
  produtoId: string;
  quantidade: number;
  precoUnitario?: number;
}

export interface RescueSaleLine {
  produtoId: string;
  quantidade: number;
  precoUnitario?: number;
}

export interface TrafficEntry {
  id: string;
  produto: string;
  semana: string; // ISO date string of period reference (semana ou mês)
  fim?: string; // ISO date string of period end (quando aplicável)
  periodoTipo?: 'weekly' | 'monthly';
  investimento: number;
  leads: number;
  cpl: number;
  vendas: number;
  receita: number;
  roas: number;
  alcance?: number;
  impressoes?: number;
  cliques?: number;
  ctrPercent?: number;
  cpc?: number;
  cpm?: number;
  vendedorId?: string;
  vendedorNome?: string;
  criadoPor: string; // user id
  criadoPorNome?: string;
  criadoEm: string;
}

export interface CommercialEntry {
  criadoPor: string;
  criadoPorNome: string;
  id: string;
  data: string; // ISO date
  vendedorId: string;
  vendedorNome?: string;
  campaignScope?: 'geral' | 'campanha';
  campaignName?: string;
  leadsAtendidos: number;
  agendamentos: number;
  vendas: number;
  followUps: number;
  vendasPorProduto?: CommercialSaleLine[];
  alunoNome?: string;
  descontoPercent?: number;
  descontoValor?: number;
  valorBruto?: number;
  valorLiquido?: number;
  comissao?: number;
  criadoEm: string;
}

export interface RescueEntry {
  id: string;
  data: string;
  closerId: string;
  closerNome?: string;
  leadsResgatados: number;
  leadsConvertidos: number;
  vendedorOrigem: string; // vendedor id
  vendedorOrigemNome?: string;
  produtosVendidos?: RescueSaleLine[];
  valorVendas?: number;
  comissaoTotal?: number;
  comissaoOrigem?: number;
  comissaoCloser?: number;
  criadoEm: string;
}

export interface RescueCommissionConfig {
  default: { originPercent: number; closerPercent: number };
  rules: Array<{
    id: string;
    userIds: string[];
    originPercent: number;
    closerPercent: number;
  }>;
}

export interface AbandonmentLevel {
  vendedorId: string;
  vendedorNome: string;
  avatar?: string;
  totalResgatados: number;
  classificacao: 'verde' | 'amarelo' | 'vermelho';
}

export interface AbandonmentThresholds {
  amarelo: number; // leads resgatados >= this = amarelo
  vermelho: number; // leads resgatados >= this = vermelho
}

export interface TrafficAlertThresholds {
  highLeadMin: number; // mínimo de leads para considerar alto lead
  lowConversionMaxPercent: number; // conversão máxima para considerar baixa conversão
  lowCplMax: number; // CPL máximo para alertar baixa qualidade
  lowSalesMax: number; // vendas máximas para baixa venda
  highRoasMin: number; // ROAS mínimo para considerar alto ROAS
}

export interface AgentConfig {
  faqWebhookUrl: string | null;
  chatWebhookUrl: string | null;
  inboundWebhookToken: string | null;
}

export interface AgentFaqItem {
  id?: string;
  question: string;
  answer: string;
  order?: number;
}

export type AgentChatSender = 'user' | 'agent' | 'system';

export interface AgentChatConversation {
  id: string;
  number: number;
  createdAt: string;
  updatedAt?: string;
  lastMessage?: {
    id: string;
    createdAt: string;
    content: string;
    sender: AgentChatSender;
  } | null;
}

export interface AgentChatMessage {
  id: string;
  sender: AgentChatSender;
  content: string;
  createdAt: string;
}

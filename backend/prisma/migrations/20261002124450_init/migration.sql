-- CreateEnum
CREATE TYPE "AgentMessageSender" AS ENUM ('user', 'agent', 'system');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "senha" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "emTreinamento" BOOLEAN NOT NULL DEFAULT false,
    "treinamentoAte" TIMESTAMP(3),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "avatar" TEXT,
    "comissaoPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "teamId" TEXT,
    "permissionClassId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PermissionClass" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "trafficRead" BOOLEAN NOT NULL DEFAULT false,
    "trafficWrite" BOOLEAN NOT NULL DEFAULT false,
    "commercialRead" BOOLEAN NOT NULL DEFAULT false,
    "commercialWrite" BOOLEAN NOT NULL DEFAULT false,
    "adminMetricsRead" BOOLEAN NOT NULL DEFAULT false,
    "usersRead" BOOLEAN NOT NULL DEFAULT false,
    "usersCreate" BOOLEAN NOT NULL DEFAULT false,
    "usersDeactivate" BOOLEAN NOT NULL DEFAULT false,
    "otherPermissions" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PermissionClass_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "leaderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamBonusConfig" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "minInternalRescuePercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "leaderBonusEnabled" BOOLEAN NOT NULL DEFAULT false,
    "leaderBonusPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rules" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamBonusConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentConfig" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "faqWebhookUrl" TEXT,
    "chatWebhookUrl" TEXT,
    "inboundWebhookToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentFaqItem" (
    "id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentFaqItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentChatConversation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentChatConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentChatMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "sender" "AgentMessageSender" NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "capaUrl" TEXT,
    "descricao" TEXT,
    "preco" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "comissaoPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "maxDescontoPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommercialEntry" (
    "id" TEXT NOT NULL,
    "data" TIMESTAMP(3) NOT NULL,
    "vendedorId" TEXT NOT NULL,
    "campaignScope" TEXT NOT NULL DEFAULT 'geral',
    "campaignName" TEXT,
    "leadsAtendidos" INTEGER NOT NULL,
    "agendamentos" INTEGER NOT NULL,
    "vendas" INTEGER NOT NULL,
    "followUps" INTEGER NOT NULL,
    "descontoPercent" DOUBLE PRECISION,
    "descontoValor" DOUBLE PRECISION,
    "valorBruto" DOUBLE PRECISION,
    "valorLiquido" DOUBLE PRECISION,
    "comissao" DOUBLE PRECISION,
    "alunoNome" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommercialEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommercialSaleLine" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "precoUnitario" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "CommercialSaleLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrafficEntry" (
    "id" TEXT NOT NULL,
    "produto" TEXT NOT NULL,
    "semana" TIMESTAMP(3) NOT NULL,
    "periodoTipo" TEXT NOT NULL DEFAULT 'weekly',
    "investimento" DOUBLE PRECISION NOT NULL,
    "leads" INTEGER NOT NULL,
    "cpl" DOUBLE PRECISION NOT NULL,
    "vendas" INTEGER NOT NULL,
    "receita" DOUBLE PRECISION NOT NULL,
    "roi" DOUBLE PRECISION NOT NULL,
    "alcance" INTEGER,
    "impressoes" INTEGER,
    "cliques" INTEGER,
    "ctrPercent" DOUBLE PRECISION,
    "cpc" DOUBLE PRECISION,
    "cpm" DOUBLE PRECISION,
    "vendedorId" TEXT,
    "criadoPorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrafficEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RescueEntry" (
    "id" TEXT NOT NULL,
    "data" TIMESTAMP(3) NOT NULL,
    "closerId" TEXT NOT NULL,
    "leadsResgatados" INTEGER NOT NULL,
    "leadsConvertidos" INTEGER NOT NULL,
    "vendedorOrigemId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RescueEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RescueSaleLine" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "precoUnitario" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "RescueSaleLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AbandonmentThresholds" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "amarelo" INTEGER NOT NULL,
    "vermelho" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AbandonmentThresholds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommercialAwardsConfig" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "period" TEXT NOT NULL DEFAULT 'weekly',
    "rules" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommercialAwardsConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "PermissionClass_nome_key" ON "PermissionClass"("nome");

-- CreateIndex
CREATE UNIQUE INDEX "Team_nome_key" ON "Team"("nome");

-- CreateIndex
CREATE UNIQUE INDEX "AgentChatConversation_userId_number_key" ON "AgentChatConversation"("userId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Product_nome_key" ON "Product"("nome");

-- CreateIndex
CREATE UNIQUE INDEX "CommercialSaleLine_entryId_produtoId_key" ON "CommercialSaleLine"("entryId", "produtoId");

-- CreateIndex
CREATE UNIQUE INDEX "RescueSaleLine_entryId_produtoId_key" ON "RescueSaleLine"("entryId", "produtoId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_permissionClassId_fkey" FOREIGN KEY ("permissionClassId") REFERENCES "PermissionClass"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_leaderId_fkey" FOREIGN KEY ("leaderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentChatConversation" ADD CONSTRAINT "AgentChatConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentChatMessage" ADD CONSTRAINT "AgentChatMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AgentChatConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialEntry" ADD CONSTRAINT "CommercialEntry_vendedorId_fkey" FOREIGN KEY ("vendedorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialSaleLine" ADD CONSTRAINT "CommercialSaleLine_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "CommercialEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialSaleLine" ADD CONSTRAINT "CommercialSaleLine_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrafficEntry" ADD CONSTRAINT "TrafficEntry_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrafficEntry" ADD CONSTRAINT "TrafficEntry_vendedorId_fkey" FOREIGN KEY ("vendedorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RescueEntry" ADD CONSTRAINT "RescueEntry_closerId_fkey" FOREIGN KEY ("closerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RescueEntry" ADD CONSTRAINT "RescueEntry_vendedorOrigemId_fkey" FOREIGN KEY ("vendedorOrigemId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RescueSaleLine" ADD CONSTRAINT "RescueSaleLine_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "RescueEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RescueSaleLine" ADD CONSTRAINT "RescueSaleLine_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

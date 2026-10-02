# Dockerfile unificado para Backend e Frontend (Vite)

# Estágio 1: Build do Frontend (Vite)
FROM node:22-alpine AS frontend-build

WORKDIR /app/frontend

# Copiar arquivos de dependências do frontend
COPY frontend/package*.json ./

# Instalar dependências do frontend
RUN npm install --no-audit --no-fund

# Copiar código do frontend
COPY frontend/ ./

# Build do frontend (gera /dist)
RUN npm run build

# Estágio 2: Build do Backend
FROM node:22-alpine AS backend-build

WORKDIR /app/backend

# Instalar OpenSSL e outras dependências necessárias
RUN apk add --no-cache openssl libc6-compat

# Copiar arquivos de dependências do backend
COPY backend/package*.json ./
COPY backend/prisma ./prisma/
COPY backend/prisma.config.js ./
# Instalar dependências do backend
RUN npm install --no-audit --no-fund

# Definir variável de ambiente dummy para o build (necessário para o prisma generate)
ENV DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"

# Gerar cliente Prisma
RUN npx prisma generate

# Copiar código do backend
COPY backend/ ./

# Build do TypeScript
RUN npm run build

# Estágio 3: Imagem final com Nginx
FROM nginx:alpine

# Instalar Node.js 22 e OpenSSL
RUN apk add --no-cache nodejs npm openssl libc6-compat

# Criar diretório da aplicação
WORKDIR /app

# Copiar backend buildado do estágio anterior
COPY --from=backend-build /app/backend ./backend

# Copiar frontend buildado (Vite)
COPY --from=frontend-build /app/frontend/dist /usr/share/nginx/html

# Copiar configuração do nginx
COPY nginx.conf /etc/nginx/nginx.conf

# Criar diretórios necessários
RUN mkdir -p /app/backend/uploads /app/backend/logs

# Expor porta
EXPOSE 80

# Script de inicialização
COPY start.sh /start.sh
RUN chmod +x /start.sh

# Comando para iniciar
CMD ["/start.sh"]

#!/bin/sh

# Script de inicialização para rodar backend e frontend (Vite build) no mesmo container

echo "🚀 =========================================="
echo "🚀 INICIANDO LAB SISTEMAS DASHBOARD"
echo "🚀 =========================================="
echo ""

# Função para mostrar status de conexão
show_connection_status() {
    local service=$1
    local status=$2
    local message=$3
    
    if [ "$status" = "success" ]; then
        echo "✅ $service: $message"
    elif [ "$status" = "warning" ]; then
        echo "⚠️  $service: $message"
    else
        echo "❌ $service: $message"
    fi
}

# 1. Verificar variáveis de ambiente essenciais
echo "🔧 Verificando configurações..."
echo ""

# Verificar DATABASE_URL
if [ -n "$DATABASE_URL" ]; then
    show_connection_status "DATABASE_URL" "success" "Configurado"
else
    show_connection_status "DATABASE_URL" "error" "Não configurado"
fi

# Verificar JWT_SECRET
if [ -n "$JWT_SECRET" ]; then
    show_connection_status "JWT_SECRET" "success" "Configurado"
else
    show_connection_status "JWT_SECRET" "warning" "Não configurado"
fi

echo ""
echo "🔍 Testando conexões..."
echo ""

# 2. Testar conexão com banco de dados
echo "📊 Testando conexão com banco de dados..."
cd /app/backend

# Criar script temporário para testar conexão
cat > test-db-connection.js << 'EOF'
async function testConnection() {
  try {
    const prisma = require('./dist/lib/prisma').default || require('./dist/lib/prisma').prisma;
    await prisma.$connect();
    console.log('✅ Banco de dados: Conectado com sucesso');
    await prisma.$disconnect();
    process.exit(0);
  } catch (error) {
    console.log('❌ Banco de dados: Falha na conexão -', error && error.message ? error.message : String(error));
    process.exit(1);
  }
}

testConnection();
EOF

if node test-db-connection.js; then
    show_connection_status "DATABASE" "success" "Conexão estabelecida"
else
    show_connection_status "DATABASE" "error" "Falha na conexão"
    echo "⚠️  Continuando com inicialização..."
fi

# Limpar script temporário
rm -f test-db-connection.js

echo ""

# 3. Verificar configurações de email
if [ -n "$SMTP_HOST" ] || [ -n "$AWS_REGION" ]; then
    show_connection_status "EMAIL" "success" "Configurado"
else
    show_connection_status "EMAIL" "warning" "Não configurado"
fi

# 4. Verificar configurações de S3/Storage
if [ -n "$STORAGE_BUCKET_NAME" ] || [ -n "$S3_BUCKET" ]; then
    show_connection_status "STORAGE" "success" "Configurado"
else
    show_connection_status "STORAGE" "warning" "Não configurado"
fi

echo ""
echo "🚀 =========================================="
echo "🚀 INICIANDO APLICAÇÃO"
echo "🚀 =========================================="
echo ""

# Configurar variáveis do banco
echo "🔧 Configurando variáveis do banco:"
echo "   DATABASE_URL: ${DATABASE_URL:+[CONFIGURADO]}"

# Configurar outras variáveis
echo "🔧 Configurando variáveis:"
echo "   FRONTEND_URL: ${FRONTEND_URL:-http://localhost:80}"
echo "   BACKEND_URL: ${BACKEND_URL:-http://localhost:80}"
echo "   CORS_ORIGIN: ${CORS_ORIGIN:-http://localhost:80}"

# Definir variáveis de ambiente para os processos
export PORT=3000
export NODE_ENV=production

# Garantir schema do banco (cria tabelas se não existir)
echo "🧩 Aplicando migrações com Prisma..."
cd /app/backend
node ./node_modules/prisma/build/index.js migrate deploy || exit 1

# Generate a private internal TLS key per container instead of copying a shared key.
umask 077
mkdir -p /app/backend/certs
openssl req -x509 -newkey rsa:2048 -nodes -days 365 \
  -keyout /app/backend/certs/internal.key \
  -out /app/backend/certs/internal.crt \
  -subj '/CN=localhost' -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1' || exit 1

# Iniciar o backend em background
echo "📦 Iniciando backend na porta 3000..."
cd /app/backend
(
  while true; do
    node dist/server.js
    echo "❌ Backend encerrou (exit code: $?). Reiniciando..."
    sleep 2
  done
) &
BACKEND_WATCH_PID=$!

# Aguardar um pouco para o backend inicializar
sleep 3

# Verificar se o backend está rodando
if pgrep -f "node dist/server.js" > /dev/null; then
    echo "✅ Backend iniciado com sucesso (watch PID: $BACKEND_WATCH_PID)"
else
    echo "❌ Falha ao iniciar o backend"
    exit 1
fi

# Verificar build do frontend
echo "📄 Verificando arquivos do frontend (nginx)..."
if [ -f /usr/share/nginx/html/index.html ]; then
    echo "✅ Frontend: index.html encontrado"
else
    echo "❌ Frontend: index.html não encontrado em /usr/share/nginx/html"
    ls -la /usr/share/nginx/html || true
fi

# Validar configuração do nginx antes de subir
echo "🧪 Testando configuração do nginx..."
if nginx -t; then
    echo "✅ nginx.conf OK"
else
    echo "❌ nginx.conf com erro. Dump de configuração:"
    nginx -T || true
    exit 1
fi

# Iniciar nginx em foreground
echo "🌐 Iniciando nginx..."
echo "✅ nginx em execução (foreground). Container pronto para receber requisições na porta 80."
nginx -g "daemon off;" &
NGINX_PID=$!

shutdown() {
  echo "🛑 Encerrando..."
  if [ -n "$NGINX_PID" ]; then kill "$NGINX_PID" 2>/dev/null || true; fi
  if [ -n "$BACKEND_WATCH_PID" ]; then kill "$BACKEND_WATCH_PID" 2>/dev/null || true; fi
  pkill -f "node dist/server.js" 2>/dev/null || true
  wait "$NGINX_PID" 2>/dev/null || true
  exit 0
}

trap shutdown INT TERM
wait "$NGINX_PID"

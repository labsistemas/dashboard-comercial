# Dashboard Comercial

Aplicação web para acompanhar a operação comercial, os investimentos em tráfego pago e a recuperação de oportunidades de venda. O sistema reúne indicadores, registros de atividades, produtos, comissões e desempenho das equipes em um único painel.

Seu objetivo é ajudar administradores, gestores de tráfego, vendedores e closers de resgate a entender os resultados da operação e identificar onde melhorar o atendimento, a conversão e o retorno das campanhas.

## Funcionalidades

| Módulo | Finalidade |
| --- | --- |
| Visão Geral | Consolidar indicadores, gráficos, rankings e projeções da operação. |
| Tráfego | Registrar investimento, leads, vendas e receita; acompanhar CPL, ROAS, alcance, impressões, cliques e outros indicadores de campanhas. |
| Comercial | Registrar leads atendidos, agendamentos, follow-ups e vendas por produto; acompanhar descontos, valores, comissões, rankings e premiações. |
| Produtos | Manter o catálogo com nome, descrição, capa, preço, comissão, limite de desconto e situação de cada produto. |
| Resgate | Registrar leads recuperados e convertidos, identificar o vendedor de origem e calcular a divisão de comissão com o closer. |
| Abandono | Acompanhar indicadores por vendedor a partir dos registros de resgate, com classificações verde, amarela e vermelha e limites configuráveis. |
| Usuários e equipes | Gerenciar contas, classes de permissão, equipes, lideranças, treinamento e regras de bônus. |
| Agente Comercial | Gerenciar perguntas e respostas, importar FAQ e integrar conversas com serviços externos por webhooks e atualizações em tempo real. |

O projeto também inclui exportação de relatórios comerciais em PDF, upload de imagens e arquivos, atualização de avatar e alteração de senha.

O módulo de Agente Comercial possui página e API próprias. Seu item de navegação está comentado no menu lateral atual. A integração com um agente externo depende da configuração dos webhooks.

## Perfis de acesso

- **Administrador:** configura e gerencia a operação, as contas e as permissões.
- **Gestor de tráfego:** acompanha investimentos e resultados das campanhas.
- **Vendedor:** registra e acompanha sua atividade comercial.
- **Closer de resgate:** acompanha a recuperação e a conversão de oportunidades.

O acesso depende do perfil e da classe de permissão atribuída ao usuário. O backend também verifica permissões e restrições de acesso aos registros.

## Tecnologias

**Frontend:** React, TypeScript, Vite, Tailwind CSS, componentes shadcn/ui e Radix UI, React Router, TanStack Query, Recharts e jsPDF.

**Backend:** Node.js, TypeScript, Express, Prisma e PostgreSQL. A autenticação utiliza JWT e bcrypt; a validação dos dados utiliza Zod.

**Integrações e infraestrutura:** Socket.IO para comunicação em tempo real, armazenamento S3 ou compatível com S3, processamento de imagens com Sharp e implantação com Docker e Nginx.

## Como o projeto está organizado

```text
projeto_dashboard_comercial/
├── frontend/
│   ├── src/
│   │   ├── pages/          # Telas dos módulos
│   │   ├── components/     # Layout e componentes da interface
│   │   ├── contexts/       # Contexto de autenticação
│   │   ├── lib/            # Utilitários, permissões e relatórios
│   │   └── types/          # Tipos dos dados do dashboard
│   └── public/             # Imagens e recursos estáticos
├── backend/
│   ├── src/
│   │   ├── routes/         # Rotas da API
│   │   ├── middleware/     # Autenticação e autorização
│   │   ├── lib/            # Banco, storage e serviços auxiliares
│   │   └── server.ts       # Inicialização da API e do Socket.IO
│   ├── prisma/             # Modelo do banco e migrações
│   └── tests/              # Testes de segurança
├── Dockerfile             # Build e imagem da aplicação
├── nginx.conf             # Frontend e proxy para o backend
├── start.sh               # Inicialização no container
└── SEGURANCA.md            # Revisão de segurança e efeitos na implantação
```

O frontend acessa a API para consultar e registrar dados. O backend aplica as regras de acesso e negócio, persiste os registros no PostgreSQL e utiliza o storage para arquivos. As conversas do agente usam webhooks e Socket.IO.

## Execução e configuração

O ambiente precisa de Node.js compatível com as dependências — o Dockerfile usa Node.js 22 —, npm e PostgreSQL. Uploads dependem de um serviço S3 compatível configurado; o agente comercial depende dos serviços externos conectados por webhook.

Os comandos devem ser executados dentro do diretório de cada aplicação:

| Comando | Frontend | Backend |
| --- | --- | --- |
| `npm install` | Instala as dependências | Instala as dependências |
| `npm run dev` | Inicia o Vite na porta 8080 | Inicia a API em desenvolvimento, por padrão na porta 3000 |
| `npm run build` | Gera o frontend em `dist/` | Gera o cliente Prisma e compila o backend em `dist/` |
| `npm run test:security` | — | Compila e executa os testes de segurança |

A API utiliza HTTPS e precisa dos arquivos `backend/certs/internal.crt` e `backend/certs/internal.key` na execução local. O proxy de desenvolvimento do Vite encaminha `/api` e `/socket.io` para o backend local. No container, o script `start.sh` gera o certificado interno, e o Nginx serve o frontend compilado e encaminha as requisições para a API.

As configurações do backend incluem conexão com o banco (`DATABASE_URL`), segredo de autenticação (`JWT_SECRET`, com pelo menos 32 bytes), origens permitidas (`FRONTEND` e `FRONTEND_URL`) e credenciais do storage (`STORAGE_*`). O frontend resolve a API pela configuração de URL ou pela origem da própria página.

Na inicialização, o backend aplica as migrações Prisma existentes antes de disponibilizar a aplicação.

## Primeiro acesso

Quando não há usuários no banco, a página de login abre o modal de criação do administrador:

1. Inicie o backend e copie o código de instalação exibido no terminal.
2. Abra a página de login.
3. Informe o código, o nome, o e-mail e a senha do administrador.
4. Conclua o cadastro para entrar no sistema.

O código é invalidado após o cadastro. Reiniciar o backend enquanto o banco está vazio gera um novo código. Também existe provisionamento do administrador pelas configurações `ADMIN_EMAIL` e `ADMIN_PASSWORD` do servidor.

Para detalhes sobre as proteções implementadas e as limitações da validação, consulte [SEGURANCA.md](./SEGURANCA.md).

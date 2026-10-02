# Design system — Painel Comercial Lab Sistemas

**Direção:** "Limpo & moderno". Ferramenta de trabalho diária de vendedores/gestores: densa, calma, legível.
Neutros frios (hue 220–224), tinta escura, um único acento índigo (243°) para ação/foco/item ativo.
Cor comunica: status (success/warning/info/destructive), ação, foco. Estrutura é neutra.

## Tokens (src/index.css, HSL)
- Neutros frios (hue ~220). Sidebar = mesmo fundo do canvas, separada por borda.
- `--accent` é superfície neutra (NÃO amarelo). Aviso é âmbar-escuro (33°), distinto do índigo da marca.
- Profundidade: bordas + sombras leves (`shadow-lift`, `shadow-raised`); no escuro, só anel.
- Raio base 10px (`--radius`); cartões `rounded-xl`, controles `rounded-md`.
- Movimento: `--ease-out` cubic-bezier(0.23,1,0.32,1), <300ms, press `scale(0.97)`.

## Hierarquia
- Rótulo: `.eyebrow` (11px/500/caixa-alta/tracking 0.08em/muted).
- Valor herói: 28px/600/tabular-nums. Dica: 12px muted.
- Título de Card: `text-lg font-semibold`. Um foco por tela (`featured` no MetricCard).

## Padrões
- `MetricCard` (src/components/MetricCard.tsx): `featured` = superfície índigo (um por grupo); `tone` colore só o chip do ícone.
- Item de navegação ativo: fundo `sidebar-accent` + barra índigo 3px à esquerda.
- Primários: botão índigo com texto branco. Tabelas: cabeçalho eyebrow (xs/caixa-alta).
- Nunca usar zinc/hex fixos; usar tokens semânticos.

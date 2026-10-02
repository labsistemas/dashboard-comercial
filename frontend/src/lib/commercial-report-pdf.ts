import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { CommercialEntry, Product, TrafficEntry } from '@/types/dashboard';

export type CommercialReportMetrics = {
  clientes: number;
  agendamentos: number;
  vendas: number;
  followUps: number;
  bruto: number;
  desconto: number;
  liquido: number;
  comissao: number;
  conversaoPercent: number;
  cpl: number;
  cac: number;
};

export type GenerateCommercialReportArgs = {
  sellerName: string;
  periodLabel: string;
  entries: CommercialEntry[];
  products: Product[];
  trafficEntries?: TrafficEntry[];
  metrics: CommercialReportMetrics;
  bonus?: {
    vendasPeriodo: number;
    valorBase: number;
    penalidadePercent: number;
    valorFinal: number;
    valorReferenciaMeta?: number;
    progressoPercent?: number;
    metaAtingida?: number | null;
    proximaMeta?: number | null;
    faltam?: number;
  } | null;
  fileName?: string;
  trainingLabel?: string | null;
};

export type GenerateUnifiedCommercialReportArgs = {
  periodLabel: string;
  products: Product[];
  reports: GenerateCommercialReportArgs[];
  cpl: number;
  trafficEntries?: TrafficEntry[];
  fileName?: string;
};

type UnifiedOverviewMetrics = {
  vendedoresAtivos: number;
  vendedoresTreinamento: number;
  clientes: number;
  agendamentos: number;
  vendas: number;
  vendasAtivos: number;
  vendasTreinamento: number;
  followUps: number;
  bruto: number;
  desconto: number;
  liquido: number;
  comissao: number;
};

function formatCurrency(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatMetricNumber(value: number) {
  if (!Number.isFinite(value)) return '0';
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function formatDateBR(dateISO: string) {
  const raw = String(dateISO || '').trim();
  if (!raw) return '-';
  const d = new Date(`${raw}T00:00:00`);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleDateString('pt-BR');
}

function parseEntryClientTokens(value: string) {
  const baseTokens = String(value || '')
    .split(/\s*\|\s*|\s*;\s*|\r?\n/)
    .map((token) => String(token || '').trim())
    .filter(Boolean)
    .flatMap((token) => token.split(/,\s*(?=[^\d])/u));

  return baseTokens
    .map((token) => String(token || '').trim())
    .filter(Boolean)
    .map((token) => {
      const match = token.match(/^(.*)\((\d+(?:[.,]\d+)?)%\)\s*$/u);
      if (!match) return { name: token, discountPercent: null as number | null };
      const name = String(match[1] || '').trim();
      const parsed = Number.parseFloat(String(match[2] || '').replace(',', '.'));
      return {
        name,
        discountPercent: Number.isFinite(parsed) ? parsed : null,
      };
    })
    .map((item) => ({ ...item, name: item.name.trim() }))
    .filter((item) => Boolean(item.name));
}

async function loadLogoDataUrl() {
  try {
    const res = await fetch('/logo.png', { cache: 'force-cache' });
    if (!res.ok) return null;
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const img = await new Promise<HTMLImageElement | null>((resolve) => {
      const node = new Image();
      node.onload = () => resolve(node);
      node.onerror = () => resolve(null);
      node.src = objectUrl;
    });
    URL.revokeObjectURL(objectUrl);
    if (!img) return null;

    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) continue;
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
    }
    ctx.putImageData(imageData, 0, 0);

    return await new Promise<string | null>((resolve) => {
      try {
        resolve(canvas.toDataURL('image/png'));
      } catch {
        resolve(null);
      }
    });
  } catch {
    return null;
  }
}

function buildCommercialReportRows(entries: CommercialEntry[], products: Product[]) {
  const productsById = new Map(products.map((p) => [String(p.id), String(p.nome || '').trim()]));
  const rows: Array<Array<string>> = [];

  for (const entry of entries.slice().sort((a, b) => a.data.localeCompare(b.data))) {
    const lines = Array.isArray(entry.vendasPorProduto) ? entry.vendasPorProduto : [];
    const computedBrutoFromLines = lines.reduce((sum, line) => {
      const qty = Number(line.quantidade) || 0;
      const unit = Number(line.precoUnitario) || 0;
      if (qty <= 0 || unit <= 0) return sum;
      return sum + qty * unit;
    }, 0);

    const brutoEntry = Number.isFinite(entry.valorBruto as number)
      ? Number(entry.valorBruto)
      : computedBrutoFromLines;
    const descontoEntry = Number.isFinite(entry.descontoValor as number)
      ? Number(entry.descontoValor)
      : Number.isFinite(entry.descontoPercent as number)
        ? brutoEntry * (Number(entry.descontoPercent) / 100)
        : 0;
    const descontoPercent = Number.isFinite(entry.descontoPercent as number)
      ? Number(entry.descontoPercent)
      : brutoEntry > 0
        ? (descontoEntry / brutoEntry) * 100
        : 0;
    const liquidoEntry = Number.isFinite(entry.valorLiquido as number)
      ? Number(entry.valorLiquido)
      : Math.max(brutoEntry - descontoEntry, 0);

    const validLines = lines.filter((line) => (Number(line.quantidade) || 0) > 0);
    const clientTokens = parseEntryClientTokens(String(entry.alunoNome || ''));
    let clientCursor = 0;

    if (lines.length === 0) {
      const fallbackQty = Number(entry.vendas) || 0;
      if (fallbackQty <= 0) continue;
      rows.push([
        formatDateBR(entry.data),
        clientTokens[0]?.name || '-',
        String(entry.campaignScope === 'campanha' ? entry.campaignName || 'Campanha' : 'Geral'),
        '-',
        String(fallbackQty),
        '-',
        formatCurrency(brutoEntry),
        `${(clientTokens[0]?.discountPercent ?? descontoPercent).toFixed(2)}%`,
        formatCurrency(descontoEntry),
        formatCurrency(liquidoEntry),
      ]);
      continue;
    }
    if (validLines.length === 0) continue;

    for (const line of validLines) {
      const qty = Number(line.quantidade) || 0;
      const unit = Number(line.precoUnitario) || 0;
      const lineBruto = qty * unit;
      const slice = qty > 0
        ? clientTokens.slice(clientCursor, clientCursor + qty)
        : clientTokens.slice(clientCursor, clientCursor + 1);
      const tokenDiscounts = slice
        .map((item) => item.discountPercent)
        .filter((value): value is number => Number.isFinite(value as number));
      const effectiveLineDiscountPercent = tokenDiscounts.length > 0
        ? tokenDiscounts.reduce((sum, value) => sum + value, 0) / tokenDiscounts.length
        : descontoPercent;
      const lineDesconto = lineBruto * (effectiveLineDiscountPercent / 100);
      const lineLiquido = Math.max(lineBruto - lineDesconto, 0);
      const productName = productsById.get(String(line.produtoId)) || 'Produto';
      const clientName = clientTokens[clientCursor]?.name || clientTokens[clientTokens.length - 1]?.name || '-';
      clientCursor += Math.max(qty, 1);
      rows.push([
        formatDateBR(entry.data),
        clientName,
        String(entry.campaignScope === 'campanha' ? entry.campaignName || 'Campanha' : 'Geral'),
        productName,
        String(qty),
        formatCurrency(unit),
        formatCurrency(lineBruto),
        `${effectiveLineDiscountPercent.toFixed(2)}%`,
        formatCurrency(lineDesconto),
        formatCurrency(lineLiquido),
      ]);
    }
  }

  return rows;
}

type ProductSummaryRow = {
  produto: string;
  vendas: number;
  receita: number;
  ticketMedio: number;
};

type SellerProductSummaryRow = {
  vendedor: string;
  produto: string;
  vendas: number;
  receita: number;
  ticketMedio: number;
  share: number;
};

type TrafficProductMetrics = {
  leads: number;
  investimento: number;
  receita: number;
  cpl: number;
  roas: number;
};

function normalizeProductKey(value: string) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function buildProductSummaryRows(entries: CommercialEntry[], products: Product[]) {
  const productsById = new Map(products.map((p) => [String(p.id), String(p.nome || '').trim() || 'Produto']));
  const grouped = new Map<string, { produto: string; vendas: number; receita: number }>();

  for (const entry of entries) {
    const lines = Array.isArray(entry.vendasPorProduto) ? entry.vendasPorProduto : [];
    const computedBrutoFromLines = lines.reduce((sum, line) => {
      const qty = Number(line.quantidade) || 0;
      const unit = Number(line.precoUnitario) || 0;
      if (qty <= 0 || unit <= 0) return sum;
      return sum + qty * unit;
    }, 0);

    const brutoEntry = Number.isFinite(entry.valorBruto as number)
      ? Number(entry.valorBruto)
      : computedBrutoFromLines;
    const descontoEntry = Number.isFinite(entry.descontoValor as number)
      ? Number(entry.descontoValor)
      : Number.isFinite(entry.descontoPercent as number)
        ? brutoEntry * (Number(entry.descontoPercent) / 100)
        : 0;
    const liquidoEntry = Number.isFinite(entry.valorLiquido as number)
      ? Number(entry.valorLiquido)
      : Math.max(brutoEntry - descontoEntry, 0);

    if (lines.length === 0) {
      const fallbackQty = Number(entry.vendas) || 0;
      if (fallbackQty <= 0) continue;
      const current = grouped.get('sem-produto') || { produto: 'Sem produto definido', vendas: 0, receita: 0 };
      current.vendas += fallbackQty;
      current.receita += liquidoEntry;
      grouped.set('sem-produto', current);
      continue;
    }

    for (const line of lines) {
      const qty = Number(line.quantidade) || 0;
      const unit = Number(line.precoUnitario) || 0;
      if (qty <= 0 || unit <= 0) continue;

      const produto = productsById.get(String(line.produtoId || '')) || 'Produto';
      const grossLine = qty * unit;
      const receitaLiquidaLinha = brutoEntry > 0 ? liquidoEntry * (grossLine / brutoEntry) : 0;
      const key = String(line.produtoId || produto);
      const current = grouped.get(key) || { produto, vendas: 0, receita: 0 };
      current.vendas += qty;
      current.receita += receitaLiquidaLinha;
      grouped.set(key, current);
    }
  }

  return Array.from(grouped.values())
    .map((row) => ({
      produto: row.produto,
      vendas: row.vendas,
      receita: row.receita,
      ticketMedio: row.vendas > 0 ? row.receita / row.vendas : 0,
    }))
    .sort((a, b) => b.receita - a.receita || b.vendas - a.vendas || a.produto.localeCompare(b.produto, 'pt-BR'));
}

function buildSellerProductSummaryRows(reports: GenerateCommercialReportArgs[]) {
  const grouped = new Map<string, { vendedor: string; produto: string; vendas: number; receita: number }>();

  for (const report of reports) {
    const productRows = buildProductSummaryRows(report.entries, report.products);
    for (const row of productRows) {
      const key = `${report.sellerName}::${row.produto}`;
      const current = grouped.get(key) || {
        vendedor: report.sellerName,
        produto: row.produto,
        vendas: 0,
        receita: 0,
      };
      current.vendas += row.vendas;
      current.receita += row.receita;
      grouped.set(key, current);
    }
  }

  const totalsByProduct = new Map<string, { vendas: number; receita: number }>();
  for (const row of grouped.values()) {
    const key = normalizeProductKey(row.produto);
    const current = totalsByProduct.get(key) || { vendas: 0, receita: 0 };
    current.vendas += row.vendas;
    current.receita += row.receita;
    totalsByProduct.set(key, current);
  }

  return Array.from(grouped.values())
    .map((row) => {
      const totals = totalsByProduct.get(normalizeProductKey(row.produto)) || { vendas: 0, receita: 0 };
      const shareByRevenue = totals.receita > 0 ? row.receita / totals.receita : 0;
      const shareBySales = totals.vendas > 0 ? row.vendas / totals.vendas : 0;
      const share = shareByRevenue > 0 ? shareByRevenue : shareBySales;
      return {
        vendedor: row.vendedor,
        produto: row.produto,
        vendas: row.vendas,
        receita: row.receita,
        ticketMedio: row.vendas > 0 ? row.receita / row.vendas : 0,
        share,
      };
    })
    .sort(
      (a, b) =>
        a.vendedor.localeCompare(b.vendedor, 'pt-BR') ||
        b.receita - a.receita ||
        b.vendas - a.vendas ||
        a.produto.localeCompare(b.produto, 'pt-BR'),
    );
}

const TRAFFIC_CAMPAIGN_PREFIX = '__campanha__:';

function isCampaignStoredProduto(value: string) {
  return String(value || '').startsWith(TRAFFIC_CAMPAIGN_PREFIX);
}

function getCampaignNameFromStoredProduto(value: string) {
  const raw = String(value || '').trim();
  if (!isCampaignStoredProduto(raw)) return raw;
  return raw.slice(TRAFFIC_CAMPAIGN_PREFIX.length).trim();
}

function buildTrafficMetricsByProduct(entries: TrafficEntry[]) {
  const grouped = new Map<string, { produto: string; leads: number; investimento: number; receita: number }>();

  for (const entry of entries) {
    const produto = String(entry.produto || '').trim();
    if (!produto) continue;
    const cleanProdutoName = getCampaignNameFromStoredProduto(produto);
    const key = normalizeProductKey(cleanProdutoName);
    const current = grouped.get(key) || { produto: cleanProdutoName, leads: 0, investimento: 0, receita: 0 };
    current.leads += Number(entry.leads) || 0;
    current.investimento += Number(entry.investimento) || 0;
    current.receita += Number(entry.receita) || 0;
    grouped.set(key, current);
  }

  return new Map<string, TrafficProductMetrics>(
    Array.from(grouped.entries()).map(([key, value]) => [
      key,
      {
        leads: value.leads,
        investimento: value.investimento,
        receita: value.receita,
        cpl: value.leads > 0 ? value.investimento / value.leads : 0,
        roas: value.investimento > 0 ? value.receita / value.investimento : 0,
      },
    ]),
  );
}

function drawCommercialReportSection(
  doc: jsPDF,
  args: GenerateCommercialReportArgs,
  logo: string | null,
) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 12;
  let y = 14;

  if (logo) {
    doc.addImage(logo, 'PNG', margin, y - 4, 28, 12);
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text('Relatório Comercial', logo ? margin + 34 : margin, y + 2);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`Vendedor: ${args.sellerName || '-'}`, logo ? margin + 34 : margin, y + 8);
  doc.text(`Período: ${args.periodLabel}`, logo ? margin + 34 : margin, y + 13);
  if (args.trainingLabel) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(180, 30, 30);
    doc.text(String(args.trainingLabel).toUpperCase(), pageWidth - margin, y + 8, { align: 'right' });
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'normal');
  }

  y += 20;

  const cardWidth = (pageWidth - margin * 2 - 6) / 2;
  const lineHeight = 5;
  const cardHeight = 58;
  const ticketMedioBruto = args.metrics.vendas > 0 ? args.metrics.bruto / args.metrics.vendas : 0;
  const ticketMedioLiquido = args.metrics.vendas > 0 ? args.metrics.liquido / args.metrics.vendas : 0;

  doc.setDrawColor(220, 220, 220);
  doc.roundedRect(margin, y, cardWidth, cardHeight, 2, 2);
  doc.roundedRect(margin + cardWidth + 6, y, cardWidth, cardHeight, 2, 2);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('Resumo do periodo', margin + 3, y + 6);
  doc.text('Financeiro', margin + cardWidth + 9, y + 6);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);

  const leftLines = [
    `Clientes: ${args.metrics.clientes}`,
    `Agendamentos: ${args.metrics.agendamentos}`,
    `Vendas: ${args.metrics.vendas}`,
    `Follow-ups: ${args.metrics.followUps}`,
    `Conversao (v/c): ${args.metrics.conversaoPercent.toFixed(1)}%`,
  ];

  leftLines.forEach((line, idx) => {
    doc.text(line, margin + 3, y + 12 + idx * lineHeight);
  });

  const rightLines = [
    `Bruto: ${formatCurrency(args.metrics.bruto)}`,
    `Desconto: ${formatCurrency(args.metrics.desconto)}`,
    `Liquido: ${formatCurrency(args.metrics.liquido)}`,
    `Comissao: ${formatCurrency(args.metrics.comissao)}`,
    `CAC: ${args.metrics.vendas > 0 ? formatCurrency(args.metrics.cac) : '-'}`,
    `Ticket medio bruto: ${formatCurrency(ticketMedioBruto)}`,
    `Ticket medio liquido: ${formatCurrency(ticketMedioLiquido)}`,
  ];

  rightLines.forEach((line, idx) => {
    doc.text(line, margin + cardWidth + 9, y + 12 + idx * lineHeight);
  });

  y += cardHeight + 6;

  if (args.bonus) {
    const bonusHeight = 24;
    doc.roundedRect(margin, y, pageWidth - margin * 2, bonusHeight, 2, 2);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('Bonificação do vendedor (mensal)', margin + 3, y + 6);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);

    const metaTxt = typeof args.bonus.metaAtingida === 'number'
      ? `Meta atingida: ${args.bonus.metaAtingida}`
      : typeof args.bonus.proximaMeta === 'number'
        ? `Próxima meta: ${args.bonus.proximaMeta} (faltam ${args.bonus.faltam || 0})`
        : 'Sem regra aplicável';

    const referenciaValor = formatCurrency(args.bonus.valorReferenciaMeta ?? 0);
    const progressoTxt = `${Number(args.bonus.progressoPercent || 0).toFixed(1)}%`;

    const bonusLine =
      `Vendas: ${args.bonus.vendasPeriodo}  |  Bônus base: ${formatCurrency(args.bonus.valorBase)}  |  ` +
      `Penalidade: ${args.bonus.penalidadePercent.toFixed(2)}%  |  Bônus final: ${formatCurrency(args.bonus.valorFinal)}`;

    doc.text(bonusLine, margin + 3, y + 12);
    doc.text(`${metaTxt}  |  Valor financeiro da meta: ${referenciaValor}  |  Progresso: ${progressoTxt}`, margin + 3, y + 17);

    y += bonusHeight + 6;
  }

  const productSummaryRows = buildProductSummaryRows(args.entries, args.products);
  const trafficMetricsByProduct = buildTrafficMetricsByProduct(args.trafficEntries || []);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(`Resumo por produto (${args.periodLabel})`, margin, y);
  y += 3;

  autoTable(doc, {
    startY: y,
    head: [['Produto', 'Leads', 'Qtd. vendas', 'Ticket médio', 'Receita total', 'CPL', 'ROAS']],
    body:
      productSummaryRows.length > 0
        ? productSummaryRows.map((row) => {
          const traffic = trafficMetricsByProduct.get(normalizeProductKey(row.produto));
          return [
            row.produto,
            formatMetricNumber(traffic?.leads || 0),
            String(row.vendas),
            formatCurrency(row.ticketMedio),
            formatCurrency(row.receita),
            traffic && traffic.leads > 0 ? formatCurrency(traffic.cpl) : '-',
            traffic && traffic.investimento > 0 ? traffic.roas.toFixed(2) : '-',
          ];
        })
        : [['-', '-', '-', '-', '-', '-', '-']],
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: [17, 24, 39], textColor: 255, fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 46 },
      1: { cellWidth: 16, halign: 'right' },
      2: { cellWidth: 16, halign: 'right' },
      3: { cellWidth: 24, halign: 'right' },
      4: { cellWidth: 28, halign: 'right' },
      5: { cellWidth: 22, halign: 'right' },
      6: { cellWidth: 18, halign: 'right' },
    },
    margin: { left: margin, right: margin },
  });

  y = (doc as any).lastAutoTable?.finalY ? (doc as any).lastAutoTable.finalY + 8 : y + 40;

  const rows = buildCommercialReportRows(args.entries, args.products);

  autoTable(doc, {
    startY: y,
    head: [[
      'Data',
      'Cliente',
      'Campanha',
      'Produto',
      'Qtd',
      'Vlr unit.',
      'Bruto',
      'Desc. %',
      'Desconto',
      'Liquido',
    ]],
    body: rows.length > 0 ? rows : [['-', '-', '-', '-', '-', '-', '-', '-', '-', '-']],
    styles: { fontSize: 8, cellPadding: 1.8, overflow: 'linebreak' },
    headStyles: { fillColor: [17, 24, 39], textColor: 255, fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 16 },
      1: { cellWidth: 28 },
      2: { cellWidth: 24 },
      3: { cellWidth: 28 },
      4: { cellWidth: 10, halign: 'right' },
      5: { cellWidth: 18, halign: 'right' },
      6: { cellWidth: 18, halign: 'right' },
      7: { cellWidth: 14, halign: 'right' },
      8: { cellWidth: 18, halign: 'right' },
      9: { cellWidth: 18, halign: 'right' },
    },
    margin: { left: margin, right: margin },
    didDrawPage: () => {
      const footer = `Emitido em ${new Date().toLocaleString('pt-BR')}`;
      doc.setFontSize(8);
      doc.setTextColor(120);
      doc.text(footer, margin, doc.internal.pageSize.getHeight() - 6);
      doc.setTextColor(0, 0, 0);
    },
  });
}

function drawUnifiedOverviewPage(
  doc: jsPDF,
  logo: string | null,
  periodLabel: string,
  cpl: number,
  reports: GenerateCommercialReportArgs[],
  trafficEntries: TrafficEntry[],
) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 12;
  let y = 14;
  const trafficMetricsByProduct = buildTrafficMetricsByProduct(trafficEntries);
  const trafficOverview = Array.from(trafficMetricsByProduct.values()).reduce(
    (acc, item) => {
      acc.leads += item.leads;
      acc.investimento += item.investimento;
      acc.receita += item.receita;
      return acc;
    },
    { leads: 0, investimento: 0, receita: 0 },
  );

  const overview = reports.reduce<UnifiedOverviewMetrics>(
    (acc, report) => {
      if (report.trainingLabel) acc.vendedoresTreinamento += 1;
      else acc.vendedoresAtivos += 1;
      acc.clientes += report.metrics.clientes;
      acc.agendamentos += report.metrics.agendamentos;
      acc.vendas += report.metrics.vendas;
      if (report.trainingLabel) acc.vendasTreinamento += report.metrics.vendas;
      else acc.vendasAtivos += report.metrics.vendas;
      acc.followUps += report.metrics.followUps;
      acc.bruto += report.metrics.bruto;
      acc.desconto += report.metrics.desconto;
      acc.liquido += report.metrics.liquido;
      acc.comissao += report.metrics.comissao;
      return acc;
    },
    {
      vendedoresAtivos: 0,
      vendedoresTreinamento: 0,
      clientes: 0,
      agendamentos: 0,
      vendas: 0,
      vendasAtivos: 0,
      vendasTreinamento: 0,
      followUps: 0,
      bruto: 0,
      desconto: 0,
      liquido: 0,
      comissao: 0,
    },
  );

  if (logo) {
    doc.addImage(logo, 'PNG', margin, y - 4, 28, 12);
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('Relatório Comercial Unificado', logo ? margin + 34 : margin, y + 2);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`Período: ${periodLabel}`, logo ? margin + 34 : margin, y + 8);
  doc.text(`Emitido em: ${new Date().toLocaleString('pt-BR')}`, logo ? margin + 34 : margin, y + 13);

  y += 22;

  doc.setDrawColor(220, 220, 220);
  doc.roundedRect(margin, y, pageWidth - margin * 2, 34, 2, 2);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('Resumo geral do período', margin + 3, y + 6);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const summaryCol1 = margin + 3;
  const summaryCol2 = margin + 56;
  const summaryCol3 = margin + 110;
  doc.text(`Vendedores ativos: ${overview.vendedoresAtivos}`, summaryCol1, y + 12);
  doc.text(`Vendas ativos: ${overview.vendasAtivos}`, summaryCol2, y + 12);
  doc.text(`Vendedores em treinamento: ${overview.vendedoresTreinamento}`, summaryCol3, y + 12);
  doc.text(`Leads do tráfego: ${formatMetricNumber(trafficOverview.leads)}`, summaryCol1, y + 19);
  doc.text(`Agendamentos: ${overview.agendamentos}`, summaryCol2, y + 19);
  doc.text(`Vendas treinamento: ${overview.vendasTreinamento}`, summaryCol3, y + 19);
  doc.text(`Follow-ups: ${overview.followUps}`, summaryCol1, y + 26);
  doc.text(`Vendas total: ${overview.vendas}`, summaryCol2, y + 26);

  y += 40;

  doc.roundedRect(margin, y, pageWidth - margin * 2, 32, 2, 2);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('Financeiro consolidado', margin + 3, y + 6);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Bruto: ${formatCurrency(overview.bruto)}`, margin + 3, y + 12);
  doc.text(`Desconto: ${formatCurrency(overview.desconto)}`, margin + 58, y + 12);
  doc.text(`Liquido: ${formatCurrency(overview.liquido)}`, margin + 118, y + 12);
  doc.text(`Comissao: ${formatCurrency(overview.comissao)}`, margin + 3, y + 18);
  doc.text(`CPL do trafego: ${cpl > 0 ? formatCurrency(cpl) : '-'}`, margin + 58, y + 18);
  doc.text(
    `Conversão geral: ${trafficOverview.leads > 0 ? ((overview.vendas / trafficOverview.leads) * 100).toFixed(1) : '0.0'}%`,
    margin + 118,
    y + 18,
  );
  doc.text(`Relatórios individuais: ${reports.length}`, margin + 3, y + 24);
  doc.text('Ordem das próximas páginas: vendedores ativos e depois vendedores em treinamento.', margin + 58, y + 24);

  y += 38;
  const consolidatedProductRows = buildProductSummaryRows(
    reports.flatMap((report) => report.entries),
    reports[0]?.products || [],
  );

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(`Quantidade de vendas por produto (ativos + treinamento) - ${periodLabel}`, margin, y);
  y += 3;

  autoTable(doc, {
    startY: y,
    head: [['Produto', 'Investimento', 'Leads', 'CPL', 'Vendas', 'Faturamento', "Conversão\n de Vendas", 'ROAS']],
    body:
      consolidatedProductRows.length > 0
        ? consolidatedProductRows.map((row) => {
          const traffic = trafficMetricsByProduct.get(normalizeProductKey(row.produto));
          return [
            row.produto,
            traffic ? formatCurrency(traffic.investimento) : formatCurrency(0),
            traffic ? formatMetricNumber(traffic.leads) : '0',
            traffic && traffic.leads > 0 ? formatCurrency(traffic.cpl) : '-',
            String(row.vendas),
            formatCurrency(row.receita),
            traffic && traffic.leads > 0 ? `${((row.vendas / traffic.leads) * 100).toFixed(1)}%` : '0.0%',
            traffic && traffic.investimento > 0 ? traffic.roas.toFixed(2) : '-',
          ];
        })
        : [['-', '-', '-', '-', '-', '-', '-', '-']],
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: [17, 24, 39], textColor: 255, fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 46 },
      1: { cellWidth: 22, halign: 'right' },
      2: { cellWidth: 12, halign: 'right' },
      3: { cellWidth: 18, halign: 'right' },
      4: { cellWidth: 14, halign: 'right' },
      5: { cellWidth: 32, halign: 'right' },
      6: { cellWidth: 22, halign: 'right' },
      7: { cellWidth: 18, halign: 'right' },
    },
    margin: { left: margin, right: margin },
  });
}

function drawUnifiedSectionDividerPage(
  doc: jsPDF,
  logo: string | null,
  title: string,
  subtitle: string,
) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 12;
  const centerY = pageHeight / 2;

  if (logo) {
    doc.addImage(logo, 'PNG', margin, 10, 28, 12);
  }

  doc.setDrawColor(220, 220, 220);
  doc.roundedRect(margin, centerY - 24, pageWidth - margin * 2, 48, 3, 3);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.text(title, pageWidth / 2, centerY - 2, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.text(subtitle, pageWidth / 2, centerY + 8, { align: 'center' });

  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(`Emitido em ${new Date().toLocaleString('pt-BR')}`, margin, pageHeight - 8);
  doc.setTextColor(0, 0, 0);
}

function drawUnifiedProductGroupPage(
  doc: jsPDF,
  logo: string | null,
  title: string,
  periodLabel: string,
  reports: GenerateCommercialReportArgs[],
  trafficEntries: TrafficEntry[],
) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 12;
  let y = 14;

  if (logo) {
    doc.addImage(logo, 'PNG', margin, y - 4, 28, 12);
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text(title, logo ? margin + 34 : margin, y + 2);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`Período: ${periodLabel}`, logo ? margin + 34 : margin, y + 8);
  doc.text(`Vendedores no grupo: ${reports.length}`, logo ? margin + 34 : margin, y + 13);

  y += 24;

  const productRows = buildProductSummaryRows(
    reports.flatMap((report) => report.entries),
    reports[0]?.products || [],
  );

  const trafficMetricsByProduct = buildTrafficMetricsByProduct(trafficEntries);

  autoTable(doc, {
    startY: y,
    head: [['Produto', 'Investimento', 'Leads', 'CPL', 'Vendas', 'Faturamento', "Conversão de\nVendas", 'ROAS']],
    body:
      productRows.length > 0
        ? productRows.map((row) => {
          const traffic = trafficMetricsByProduct.get(normalizeProductKey(row.produto));
          return [
            row.produto,
            traffic ? formatCurrency(traffic.investimento) : formatCurrency(0),
            traffic ? formatMetricNumber(traffic.leads) : '0',
            traffic && traffic.leads > 0 ? formatCurrency(traffic.cpl) : '-',
            String(row.vendas),
            formatCurrency(row.receita),
            traffic && traffic.leads > 0 ? `${((row.vendas / traffic.leads) * 100).toFixed(1)}%` : '0.0%',
            traffic && traffic.investimento > 0 ? traffic.roas.toFixed(2) : '-',
          ];
        })
        : [['-', '-', '-', '-', '-', '-', '-', '-']],
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: [17, 24, 39], textColor: 255, fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 46 },
      1: { cellWidth: 22, halign: 'right' },
      2: { cellWidth: 12, halign: 'right' },
      3: { cellWidth: 16, halign: 'right' },
      4: { cellWidth: 12, halign: 'right' },
      5: { cellWidth: 22, halign: 'right' },
      6: { cellWidth: 38, halign: 'right' },
      7: { cellWidth: 18, halign: 'right' },
    },
    margin: { left: margin, right: margin },
  });

  doc.setFontSize(8);
  doc.setTextColor(120);
  doc.text(`Emitido em ${new Date().toLocaleString('pt-BR')}`, margin, doc.internal.pageSize.getHeight() - 6);
  doc.setTextColor(0, 0, 0);
}

export async function generateCommercialReportPdf(args: GenerateCommercialReportArgs) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const logo = await loadLogoDataUrl();
  drawCommercialReportSection(doc, args, logo);

  const safeSellerName = String(args.sellerName || 'vendedor')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9-_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();

  const fileName =
    args.fileName || `relatório_comercial_${safeSellerName || 'vendedor'}_${new Date().toISOString().slice(0, 10)}.pdf`;

  doc.save(fileName);
}

export async function generateUnifiedCommercialReportPdf(args: GenerateUnifiedCommercialReportArgs) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const logo = await loadLogoDataUrl();
  const reports = args.reports
    .slice()
    .sort((a, b) => {
      const aTraining = Boolean(a.trainingLabel);
      const bTraining = Boolean(b.trainingLabel);
      if (aTraining !== bTraining) return aTraining ? 1 : -1;
      return String(a.sellerName || '').localeCompare(String(b.sellerName || ''), 'pt-BR');
    });

  drawUnifiedOverviewPage(doc, logo, args.periodLabel, args.cpl, reports, args.trafficEntries || []);

  const activeReports = reports.filter((report) => !report.trainingLabel);
  const trainingReports = reports.filter((report) => Boolean(report.trainingLabel));

  doc.addPage();
  drawUnifiedProductGroupPage(
    doc,
    logo,
    'Produtos vendidos - Vendedores Ativos',
    args.periodLabel,
    activeReports,
    args.trafficEntries || [],
  );

  doc.addPage();
  drawUnifiedProductGroupPage(
    doc,
    logo,
    'Produtos vendidos - Vendedores em Treinamento',
    args.periodLabel,
    trainingReports,
    args.trafficEntries || [],
  );

  if (activeReports.length > 0) {
    doc.addPage();
    drawUnifiedSectionDividerPage(
      doc,
      logo,
      'Vendedores Ativos',
      `${activeReports.length} relatório(s) no período ${args.periodLabel}`,
    );
  }

  activeReports.forEach((report) => {
    doc.addPage();
    drawCommercialReportSection(doc, { ...report, periodLabel: args.periodLabel }, logo);
  });

  if (trainingReports.length > 0) {
    doc.addPage();
    drawUnifiedSectionDividerPage(
      doc,
      logo,
      'Vendedores em Treinamento',
      `${trainingReports.length} relatório(s) no período ${args.periodLabel}`,
    );
  }

  trainingReports.forEach((report) => {
    doc.addPage();
    drawCommercialReportSection(doc, { ...report, periodLabel: args.periodLabel }, logo);
  });

  const fileName =
    args.fileName || `relatório_comercial_unificado_${new Date().toISOString().slice(0, 10)}.pdf`;

  doc.save(fileName);
}

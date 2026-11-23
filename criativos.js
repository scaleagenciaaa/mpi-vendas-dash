/* =====================================================================
   MPI · aba "Criativos" (hook rate) — módulo independente
   - Lê só window.MPI (data.js). Não usa funções internas do app.js.
   - Hook rate = reproduções de vídeo de 3 s ÷ impressões × 100, a partir dos campos
     vv (reproduções de 3 s) e imv (impressões das linhas que têm esse dado) do grão Meta.
     Linhas com vv = 0 (anúncio sem vídeo) ficam fora das médias.
   - Período: lê as datas #dtDe / #dtAte do topo (o app.js as mantém iguais ao período ativo)
     e se redesenha quando o período ou o funil mudam.
   - Usa as classes do styles.css do dashboard (card, tbl, roas-pill, cac-pill, heatcell,
     v2btn, micro-tile...) e acrescenta poucas regras próprias com o prefixo do id da aba.
   - Depende destes elementos da página: #tab-criativos e seus ids (criTiles, criVol, criHook,
     criCh, criAds, criAdsMore) e o botão .tab[data-tab="criativos"], que vêm com a aba; #periods
     e #funnelBar, do index.html; #dtDe, #dtAte e os botões .fnl-btn (o ativo tem a classe "on" e
     data-fn="mpi" ou "mpd"), que o app.js cria dentro deles.
===================================================================== */
(function () {
  'use strict';

  /* ---------- formatação (mesmas regras do dashboard) ---------- */
  var NF0 = new Intl.NumberFormat('pt-BR');
  var NF1 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  var NF2 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function money(v) { return 'R$ ' + NF2.format(v || 0); }
  function money0(v) { return 'R$ ' + NF0.format(Math.round(v || 0)); }
  function moneyExato(v) { v = +v || 0; return (v > 0 && v < 10) ? money(v) : money0(v); }
  function intf(v) { return NF0.format(Math.round(v || 0)); }
  function pct(v) { return NF1.format(v || 0) + '%'; }
  function roasf(v) { return NF2.format(v || 0); }
  function dv(a, b) { return b > 0 ? a / b : 0; }
  function clamp(x) { return Math.max(0, Math.min(1, x)); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function isISO(x) { return /^\d{4}-\d{2}-\d{2}$/.test(x); }
  function fmtBR(iso) { return isISO(iso) ? iso.slice(8, 10) + '/' + iso.slice(5, 7) : iso; }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function todayISO() { var d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function addDays(iso, n) { var p = iso.split('-'); var dt = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); dt.setUTCDate(dt.getUTCDate() + n); return dt.toISOString().slice(0, 10); }
  function median(xs) { var a = xs.filter(function (x) { return x != null && isFinite(x); }).sort(function (x, y) { return x - y; }); if (!a.length) return 0; var m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; }
  function roasClass(v) { if (v == null || !isFinite(v) || v <= 0) return 'roas-n'; if (v >= 1) return 'roas-g'; if (v >= 0.8) return 'roas-a'; return 'roas-r'; }
  function cacClass(v, med) { if (v == null || !isFinite(v) || v <= 0 || med <= 0) return 'cac-n'; var r = v / med; if (r <= 0.85) return 'cac-g'; if (r <= 1.3) return 'cac-a'; return 'cac-r'; }
  function el(id) { return document.getElementById(id); }
  var SEM = 'SEM_RASTREIO';
  function prettyName(x) { return x === SEM ? '— sem rastreio —' : x; }

  /* ---------- dados (window.MPI) ---------- */
  var DATA = null;
  function prep() {
    var M = window.MPI || {};
    if (DATA && DATA.stamp === M.generatedAt && DATA.src === M) return DATA;
    function source(S, ch) {
      S = S || {}; var names = S.names || [];
      return {
        daily: S.daily || [],
        // hook rate: imv só conta nas linhas com reprodução de 3 s; anúncio sem vídeo (K = 0) não puxa a média para baixo
        grain: (S.grain || []).map(function (g) {
          return { date: g.d, campaign: names[g.c] || '', adset: names[g.s] || '', ad: names[g.a] || '',
            spend: +g.sp || 0, impr: +g.im || 0, clicks: +g.ck || 0, lpv: +g.lp || 0, checkout: +g.chk || 0,
            sales: +g.vn || 0, rev: +g.rv || 0, vv: +g.vv || 0, imv: +g.vv > 0 ? +g.imv || 0 : 0, channel: ch };
        })
      };
    }
    var meta = source(M.meta, 'meta'), google = source(M.google, 'google'), ds = [];
    [meta, google].forEach(function (S) { S.daily.forEach(function (d) { if (isISO(d.date)) ds.push(d.date); }); });
    ds.sort();
    DATA = { src: M, stamp: M.generatedAt, meta: meta, google: google, ob: (M.ob && M.ob.daily) || [], minDate: ds[0] || '', maxDate: ds[ds.length - 1] || '' };
    return DATA;
  }
  function inR(d, r) { return d >= r[0] && d <= r[1]; }
  // período ativo do topo (o app.js mantém #dtDe/#dtAte iguais ao período escolhido, inclusive nos botões rápidos).
  // Se uma das datas for apagada, o app.js mantém o período anterior; aqui também.
  var lastRange = null;
  function currentRange() {
    var de = el('dtDe'), at = el('dtAte');
    var a = de && isISO(de.value) ? de.value : '', b = at && isISO(at.value) ? at.value : '';
    if (a && b) { if (a > b) { var t = a; a = b; b = t; } lastRange = [a, b]; return lastRange; }
    return lastRange || [a || DATA.minDate, b || DATA.maxDate];
  }
  // fim da janela "últimos 7 dias" = hoje (como os períodos rápidos do dashboard)
  function recentEnd() { var t = todayISO(); return (DATA.maxDate && DATA.maxDate > t) ? DATA.maxDate : t; }

  /* ---------- order bump / upsell por venda (igual ao "ROAS c/OB" da Otimização V2) ---------- */
  var UPSELL = { lastro: 1, lastro_ds: 1 };
  function salesIn(S, r) { var s = 0; S.daily.forEach(function (d) { if (isISO(d.date) && inR(d.date, r)) s += d.sales || 0; }); return s; }
  function obPerSale(r, src, cat) {
    var rev = 0;
    DATA.ob.forEach(function (o) {
      if (!isISO(o.d) || !inR(o.d, r) || (src && o.src !== src)) return;
      var up = !!UPSELL[o.k];
      if ((cat === 'ob' && up) || (cat === 'up' && !up)) return;
      rev += o.r || 0;
    });
    var sales = src === 'm' ? salesIn(DATA.meta, r) : src === 'g' ? salesIn(DATA.google, r) : salesIn(DATA.meta, r) + salesIn(DATA.google, r);
    return sales > 0 ? rev / sales : 0;
  }

  /* ---------- hook rate ---------- */
  function hookOf(vv, imv) { return (imv > 0 && vv > 0) ? vv / imv * 100 : null; }   // sem reprodução = anúncio sem vídeo → "—"
  function hookClass(h, avg) { if (h == null || !(avg > 0)) return 'roas-n'; var q = h / avg; return q >= 1.1 ? 'roas-g' : (q >= 0.9 ? 'roas-a' : 'roas-r'); }
  function hookHeat(h, avg) {
    if (h == null || !(avg > 0)) return '';
    var q = h / avg - 1, a = (0.10 + 0.42 * clamp(Math.abs(q) / 0.4)).toFixed(3);
    return 'background:' + (q >= 0 ? 'rgba(35,194,134,' : 'rgba(242,99,126,') + a + ')';
  }
  function pp(v) { return (v > 0 ? '+' : (v < 0 ? '−' : '')) + NF1.format(Math.abs(v)) + ' p.p.'; }
  function trendPP(v) {
    if (v == null) return '<span class="mt-na">—</span>';
    if (Math.abs(v) < 0.3) return '<span class="mt-eq">➡ ' + pp(v) + '</span>';
    return '<span class="' + (v > 0 ? 'mt-up' : 'mt-down') + '">' + (v > 0 ? '▲ ' : '▼ ') + pp(v) + '</span>';
  }
  // o mesmo criativo com nomes um pouco diferentes conta como um só (".mp4", "— Cópia", sobras como " =")
  function cleanCreative(name) {
    return String(name || '').replace(/[\s=_.,;:—–-]+$/, '').replace(/\s*[—–-]+\s*c[oó]pia(\s*\d+)?\s*$/i, '')
      .replace(/\.(mp4|mov|m4v|webm|jpe?g|png|gif)\s*$/i, '').replace(/[\s=_.,;:—–-]+$/, '').replace(/\s+/g, ' ').trim();
  }

  /* ---------- estado da aba ---------- */
  var ST = { ch: 'geral', sort: { k: 'spend', rev: false }, hsort: { k: 'hook', rev: false }, minImp: 1000 };
  var MIN_IMP = [[0, 'Todos'], [1000, '1 mil+'], [5000, '5 mil+'], [20000, '20 mil+']];

  /* ---------- tabela 1: hook rate por criativo, últimos 7 dias (inclui hoje) ---------- */
  function hookWeek() {
    var end = recentEnd(), days = []; for (var i = 6; i >= 0; i--) days.push(addDays(end, -i));
    var w = [days[0], days[6]], map = {}, dayAcc = {}, acc = { vv: 0, imv: 0, impr: 0, spend: 0, sales: 0, rev: 0 };
    days.forEach(function (d) { dayAcc[d] = { vv: 0, imv: 0 }; });
    DATA.meta.grain.forEach(function (x) {
      if (!inR(x.date, w)) return;
      // conta inteira = tudo da Meta na janela, inclusive vendas sem rastreio (que não entram em nenhum criativo)
      acc.vv += x.vv; acc.imv += x.imv; acc.impr += x.impr; acc.spend += x.spend; acc.sales += x.sales; acc.rev += x.rev;
      dayAcc[x.date].vv += x.vv; dayAcc[x.date].imv += x.imv;
      if (!x.ad || x.ad === SEM) return;
      var name = cleanCreative(x.ad), k = name.toLowerCase(); if (!k) return;
      var o = map[k] || (map[k] = { names: {}, camps: {}, impr: 0, vv: 0, imv: 0, spend: 0, sales: 0, rev: 0, d: {} });
      o.names[x.ad] = (o.names[x.ad] || 0) + x.impr + 1; o.camps[x.campaign] = 1;
      o.impr += x.impr; o.vv += x.vv; o.imv += x.imv; o.spend += x.spend; o.sales += x.sales; o.rev += x.rev;
      var q = o.d[x.date] || (o.d[x.date] = { vv: 0, imv: 0 }); q.vv += x.vv; q.imv += x.imv;
    });
    function part(dmap, ds) { var v = 0, n = 0; ds.forEach(function (d) { var q = dmap[d]; if (q) { v += q.vv; n += q.imv; } }); return hookOf(v, n); }
    function trendOf(dmap) { var a = part(dmap, days.slice(0, 4)), b = part(dmap, days.slice(4)); return (a != null && b != null) ? b - a : null; }
    var list = Object.keys(map).map(function (k) {
      var o = map[k];
      o.variants = Object.keys(o.names).sort(function (a, b) { return o.names[b] - o.names[a]; });
      o.name = cleanCreative(o.variants[0]);
      o.hook = hookOf(o.vv, o.imv); o.trend = trendOf(o.d); o.roas = o.spend > 0 ? o.rev / o.spend : null;
      o.daily = days.map(function (d) { return o.d[d] ? hookOf(o.d[d].vv, o.d[d].imv) : null; });
      return o;
    });
    var A = { name: 'Conta inteira (média)', hook: hookOf(acc.vv, acc.imv), trend: trendOf(dayAcc),
      daily: days.map(function (d) { return hookOf(dayAcc[d].vv, dayAcc[d].imv); }),
      impr: acc.impr, spend: acc.spend, sales: acc.sales, rev: acc.rev, roas: acc.spend > 0 ? acc.rev / acc.spend : null, imv: acc.imv };
    return { days: days, list: list, acc: A };
  }
  function hookSortVal(o, k) {
    if (k === 'name') return String(o.name || '').toLowerCase();
    if (/^d[0-6]$/.test(k)) return o.daily[+k[1]];
    return o[k];
  }
  function sortableHead(cols, ss, numFrom) {
    return '<thead><tr>' + cols.map(function (c, i) {
      var on = ss.k === c[0];
      return '<th class="sortable' + (i >= numFrom ? ' num' : '') + (on ? ' sorton' : '') + '" data-col="' + c[0] + '" title="clique p/ ordenar (melhor→pior) · de novo p/ inverter">' + c[1] +
        (on ? ' <span class="sarr">' + (ss.rev ? '▲' : '▼') + '</span>' : '') + '</th>';
    }).join('') + '</tr></thead>';
  }
  function renderHook() {
    var H = hookWeek(), A = H.acc, today = todayISO(), host = el('criHook'), tiles = el('criTiles'), vol = el('criVol');
    vol.innerHTML = '<span class="pf-h">Volume mínimo <small style="opacity:.65;font-weight:500">(impressões em 7 dias)</small>:</span>' +
      MIN_IMP.map(function (x) { return '<button class="v2btn' + (ST.minImp === x[0] ? ' on' : '') + '" data-min="' + x[0] + '">' + x[1] + '</button>'; }).join('');
    Array.prototype.forEach.call(vol.querySelectorAll('[data-min]'), function (b) { b.addEventListener('click', function () { ST.minImp = +b.getAttribute('data-min'); renderHook(); }); });
    if (!(A.imv > 0)) {
      tiles.style.display = 'none';
      host.innerHTML = '<div class="empty">Ainda não há reproduções de vídeo de 3 segundos nos últimos 7 dias. Elas vêm dos campos <b>vv</b> e <b>imv</b> do grão Meta no data.js (coluna K "Action Video View (3s)" da aba MPI | META).</div>';
      return;
    }
    var volList = H.list.filter(function (o) { return o.impr >= ST.minImp && o.hook != null; });
    var best = volList.slice().sort(function (a, b) { return b.hook - a.hook; })[0];
    var moves = volList.filter(function (o) { return o.trend != null; });
    var rise = moves.slice().sort(function (a, b) { return b.trend - a.trend; })[0], fall = moves.slice().sort(function (a, b) { return a.trend - b.trend; })[0];
    function tile(l, v, sub) { return '<div class="micro-tile"><div class="mtl-l">' + l + '</div><div class="mtl-v">' + v + '</div><div class="mtl-t">' + sub + '</div></div>'; }
    tiles.style.display = '';
    tiles.innerHTML =
      tile('Hook rate da conta · 7 dias', A.hook != null ? pct(A.hook) : '—', fmtBR(H.days[0]) + ' a ' + fmtBR(H.days[6]) + ' · ' + trendPP(A.trend)) +
      tile('Melhor hook da semana', best ? pct(best.hook) : '—', best ? esc(best.name) : 'nenhum criativo com esse volume') +
      tile('Maior alta na semana', (rise && rise.trend > 0) ? '<span class="mt-up">' + pp(rise.trend) + '</span>' : '—', (rise && rise.trend > 0) ? esc(rise.name) : 'nenhum subindo') +
      tile('Maior queda na semana', (fall && fall.trend < 0) ? '<span class="mt-down">' + pp(fall.trend) + '</span>' : '—', (fall && fall.trend < 0) ? esc(fall.name) : 'nenhum caindo');
    var ss = ST.hsort, rows = H.list.filter(function (o) { return o.impr >= ST.minImp; });
    rows.sort(function (a, b) {
      var va = hookSortVal(a, ss.k), vb = hookSortVal(b, ss.k);
      if (va == null && vb == null) return b.impr - a.impr;
      if (va == null) return 1; if (vb == null) return -1;
      var q = ss.k === 'name' ? (va < vb ? -1 : (va > vb ? 1 : 0)) : vb - va;
      if (ss.rev) q = -q;
      return q !== 0 ? q : b.impr - a.impr;
    });
    var cols = [['name', 'Criativo'], ['hook', 'Hook 7 dias']]
      .concat(H.days.map(function (d, i) { return ['d' + i, d === today ? 'Hoje' : fmtBR(d)]; }))
      .concat([['trend', 'Tendência'], ['impr', 'Impressões'], ['spend', 'Gasto'], ['sales', 'Vendas'], ['roas', 'ROAS']]);
    function line(o, isAcc) {
      return '<td>' + (isAcc ? '<b>' + esc(o.name) + '</b>' : '<span title="' + esc(o.variants.join(' / ') + ' · campanhas: ' + Object.keys(o.camps).join(' | ')) + '">' + esc(o.name) + '</span>') + '</td>' +
        '<td class="num">' + (o.hook != null ? '<span class="roas-pill ' + (isAcc ? 'roas-n' : hookClass(o.hook, A.hook)) + '">' + pct(o.hook) + '</span>' : '—') + '</td>' +
        o.daily.map(function (h, i) { return '<td class="num"><span class="heatcell" style="' + (isAcc ? '' : hookHeat(h, A.daily[i])) + '">' + (h != null ? pct(h) : '—') + '</span></td>'; }).join('') +
        '<td class="num">' + trendPP(o.trend) + '</td><td class="num">' + intf(o.impr) + '</td><td class="num">' + moneyExato(o.spend) + '</td><td class="num">' + intf(o.sales) + '</td>' +
        '<td class="num">' + (o.roas != null ? '<span class="roas-pill ' + roasClass(o.roas) + '">' + roasf(o.roas) + '</span>' : '—') + '</td>';
    }
    var body = rows.length ? rows.map(function (o) { return '<tr>' + line(o, false) + '</tr>'; }).join('')
      : '<tr><td colspan="' + cols.length + '" class="empty">Nenhum criativo com esse volume de impressões nos últimos 7 dias.</td></tr>';
    host.innerHTML = '<div class="cri-note">' + intf(rows.length) + ' criativo' + (rows.length === 1 ? '' : 's') + (ST.minImp ? ' com ' + intf(ST.minImp) + '+ impressões' : '') +
      ' · ' + intf(H.list.filter(function (o) { return o.hook != null; }).length) + ' com vídeo na semana</div>' +
      '<div class="table-scroll"><table class="tbl cri-hook">' + sortableHead(cols, ss, 1) + '<tbody>' + body + '</tbody><tfoot><tr>' + line(A, true) + '</tr></tfoot></table></div>';
    Array.prototype.forEach.call(host.querySelectorAll('th.sortable'), function (th) {
      th.addEventListener('click', function () { var k = th.getAttribute('data-col'); if (ss.k === k) ss.rev = !ss.rev; else { ss.k = k; ss.rev = false; } renderHook(); });
    });
  }

  /* ---------- tabela 2: "Anúncios" da Otimização V2 + hook rate entre CTR e Connect ---------- */
  function metricsOf(n, ops, ups) {
    return { roas: n.spend > 0 ? n.rev / n.spend : null, roasob: n.spend > 0 ? (n.rev + n.sales * ops) / n.spend : null, roasobup: n.spend > 0 ? (n.rev + n.sales * (ops + ups)) / n.spend : null,
      cac: (n.sales > 0 && n.spend > 0) ? n.spend / n.sales : null, cpm: n.impr > 0 ? n.spend / n.impr * 1000 : null, ctr: n.impr > 0 ? n.clicks / n.impr * 100 : null,
      hook: hookOf(n.vv, n.imv), connect: (n.lpv > 0 && n.clicks > 0) ? n.lpv / n.clicks * 100 : null, convPag: n.clicks > 0 ? n.sales / n.clicks * 100 : null,
      txchk: n.lpv > 0 ? n.checkout / n.lpv * 100 : null, txcpr: n.checkout > 0 ? n.sales / n.checkout * 100 : null };
  }
  var ADCOLS = [
    ['name', 'Anúncio', 'az'], ['spend', 'Gasto', 'hi', function (o) { return o.spend; }], ['rev', 'Faturamento', 'hi', function (o) { return o.rev; }],
    ['roas', 'ROAS', 'hi', function (o, m) { return m.roas; }], ['roasob', 'ROAS c/OB', 'hi', function (o, m) { return m.roasob; }], ['roasobup', 'ROAS c/OB+Up', 'hi', function (o, m) { return m.roasobup; }],
    ['sales', 'Vendas', 'hi', function (o) { return o.sales; }], ['cac', 'CAC', 'lo', function (o, m) { return m.cac; }], ['cpm', 'CPM', 'lo', function (o, m) { return m.cpm; }],
    ['ctr', 'CTR', 'hi', function (o, m) { return m.ctr; }], ['hook', 'Hook rate', 'hi', function (o, m) { return m.hook; }], ['connect', 'Connect', 'hi', function (o, m) { return m.connect; }],
    ['convPag', 'Conv. pág.', 'hi', function (o, m) { return m.convPag; }], ['txchk', 'Tx Chk', 'hi', function (o, m) { return m.txchk; }], ['txcpr', 'Tx Compra', 'hi', function (o, m) { return m.txcpr; }],
    ['lucro', 'Lucro c/ OB+Up', 'hi', function (o, m, ops, ups) { return o.rev + (o.sales || 0) * (ops + ups) - o.spend; }]
  ];
  function renderAds() {
    var r = currentRange(), host = el('criAds'), chEl = el('criCh');
    var CH = [['geral', 'Geral'], ['meta', 'Meta'], ['google', 'Google']];
    chEl.innerHTML = '<span class="pf-h">Canal:</span>' + CH.map(function (c) { return '<button class="v2btn' + (ST.ch === c[0] ? ' on' : '') + '" data-ch="' + c[0] + '">' + c[1] + '</button>'; }).join('');
    Array.prototype.forEach.call(chEl.querySelectorAll('[data-ch]'), function (b) { b.addEventListener('click', function () { ST.ch = b.getAttribute('data-ch'); renderAds(); }); });
    var base = DATA.meta.grain.concat(DATA.google.grain).filter(function (x) { return isISO(x.date) && inR(x.date, r) && (ST.ch === 'geral' || x.channel === ST.ch); });
    var src = ST.ch === 'meta' ? 'm' : (ST.ch === 'google' ? 'g' : null), ops = obPerSale(r, src, 'ob'), ups = obPerSale(r, src, 'up');
    var accV = 0, accI = 0; base.forEach(function (x) { accV += x.vv; accI += x.imv; });
    var accHook = hookOf(accV, accI), g = {};
    base.forEach(function (x) {   // um item por campanha › conjunto › anúncio (como a tabela "Anúncios" da Otimização V2)
      var key = x.campaign + '\u0001' + x.adset + '\u0001' + x.ad, o = g[key];
      if (!o) o = g[key] = { name: prettyName(x.ad), camp: x.campaign, adset: x.adset, spend: 0, impr: 0, clicks: 0, lpv: 0, checkout: 0, sales: 0, rev: 0, vv: 0, imv: 0 };
      o.spend += x.spend; o.impr += x.impr; o.clicks += x.clicks; o.lpv += x.lpv; o.checkout += x.checkout; o.sales += x.sales; o.rev += x.rev; o.vv += x.vv; o.imv += x.imv;
    });
    var list = Object.keys(g).map(function (k) { return g[k]; }).sort(function (a, b) { return b.spend - a.spend; });
    if (!list.length) { host.innerHTML = '<div class="empty">Sem dados no período.</div>'; el('criAdsMore').textContent = ''; return; }
    var ss = ST.sort, col = ADCOLS.filter(function (c) { return c[0] === ss.k; })[0] || ADCOLS[1];
    var rows = list.map(function (o) {
      var m = metricsOf(o, ops, ups), v = col[2] === 'az' ? String(o.name || '').toLowerCase() : col[3](o, m, ops, ups);
      if (typeof v === 'number' && !isFinite(v)) v = null;
      return { o: o, m: m, v: v };
    });
    rows.sort(function (a, b) {
      if (a.v == null && b.v == null) return (b.o.spend || 0) - (a.o.spend || 0);
      if (a.v == null) return 1; if (b.v == null) return -1;
      var q = col[2] === 'az' ? (a.v < b.v ? -1 : (a.v > b.v ? 1 : 0)) : (col[2] === 'hi' ? b.v - a.v : a.v - b.v);
      if (ss.rev) q = -q;
      return q !== 0 ? q : (b.o.spend || 0) - (a.o.spend || 0);
    });
    var shown = rows.slice(0, 80);
    var medC = median(shown.map(function (x) { return x.o.sales > 0 ? x.o.spend / x.o.sales : null; }).filter(function (x) { return x != null; }));
    function pill(v, cls) { return v != null ? '<span class="roas-pill ' + cls + '">' + roasf(v) + '</span>' : '—'; }
    var body = shown.map(function (x) {
      var o = x.o, m = x.m, lucro = o.rev + (o.sales || 0) * (ops + ups) - o.spend;
      return '<tr><td><span class="v2name" title="' + esc(o.name + ' · ' + prettyName(o.camp) + ' › ' + prettyName(o.adset)) + '">' + esc(o.name) + '</span></td>' +
        '<td class="num">' + moneyExato(o.spend) + '</td><td class="num">' + money0(o.rev) + '</td>' +
        '<td class="num">' + pill(m.roas, roasClass(m.roas)) + '</td><td class="num">' + pill(m.roasob, roasClass(m.roasob)) + '</td><td class="num">' + pill(m.roasobup, roasClass(m.roasobup)) + '</td>' +
        '<td class="num">' + intf(o.sales) + '</td><td class="num">' + (m.cac != null ? '<span class="cac-pill ' + cacClass(m.cac, medC) + '">' + money0(m.cac) + '</span>' : '—') + '</td>' +
        '<td class="num">' + (m.cpm != null ? money0(m.cpm) : '—') + '</td><td class="num">' + (m.ctr != null ? pct(m.ctr) : '—') + '</td>' +
        '<td class="num">' + (m.hook != null ? '<span class="roas-pill ' + hookClass(m.hook, accHook) + '">' + pct(m.hook) + '</span>' : '—') + '</td>' +
        '<td class="num">' + (m.connect != null ? pct(m.connect) : '—') + '</td><td class="num">' + (m.convPag != null ? pct(m.convPag) : '—') + '</td>' +
        '<td class="num">' + (m.txchk != null ? pct(m.txchk) : '—') + '</td><td class="num">' + (m.txcpr != null ? pct(m.txcpr) : '—') + '</td>' +
        '<td class="num ' + (lucro >= 0 ? 'pos' : 'neg') + '">' + money0(lucro) + '</td></tr>';
    }).join('');
    var sortLab = ss.k === 'name' ? 'nome' : col[1];
    el('criAdsMore').textContent = list.length > shown.length ? '· top ' + shown.length + ' de ' + list.length + ' por ' + sortLab : '· ' + list.length + ' anúncios';
    host.innerHTML = '<div class="table-scroll"><table class="tbl cri-ads">' + sortableHead(ADCOLS.map(function (c) { return [c[0], c[1]]; }), ss, 1) + '<tbody>' + body + '</tbody></table></div>';
    Array.prototype.forEach.call(host.querySelectorAll('th.sortable'), function (th) {
      th.addEventListener('click', function () { var k = th.getAttribute('data-col'); if (ss.k === k) ss.rev = !ss.rev; else { ss.k = k; ss.rev = false; } renderAds(); });
    });
  }

  /* ---------- montagem e ligação com o dashboard ---------- */
  function mpdActive() { var b = document.querySelector('#funnelBar .fnl-btn.on'); return !!(b && b.getAttribute('data-fn') && b.getAttribute('data-fn') !== 'mpi'); }
  function render() {
    try {
      if (!el('tab-criativos') || !window.MPI || mpdActive()) return;
      prep();
    } catch (e) { if (window.console) console.error('[Criativos] dados', e); return; }
    try { renderHook(); } catch (e) { if (window.console) console.error('[Criativos] hook rate', e); }
    try { renderAds(); } catch (e) { if (window.console) console.error('[Criativos] anúncios', e); }
  }
  var timer = null;
  function later() { clearTimeout(timer); timer = setTimeout(render, 0); }   // roda depois do app.js atualizar o período
  function init() {
    if (!el('tab-criativos')) return;
    var per = el('periods'); if (per) { per.addEventListener('click', later); per.addEventListener('change', later); }
    var fb = el('funnelBar'); if (fb) fb.addEventListener('click', later);
    var tb = document.querySelector('.tab[data-tab="criativos"]'); if (tb) tb.addEventListener('click', later);
    render();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.MPICriativos = { render: render };
})();

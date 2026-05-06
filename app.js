'use strict';

const DEFAULT_SWIM_RECORDS = {
  Damas: {
    '400 LC Metros Libre': { RM: '3:54.18', RN: '4:17.21' },
    '200 LC Metros Comb. Ind.': { RM: '2:05.70', RN: '2:14.70' },
    '200 LC Metros Espalda': { RM: '2:03.14', RN: '2:13.80' },
    '50 LC Metros Libre': { RM: '23.61', RN: '25.80' },
    '100 LC Metros Espalda': { RM: '57.13', RN: '1:01.99' },
    '50 LC Metros Pecho': { RM: '29.16', RN: '32.53' },
    '100 LC Metros Mariposa': { RM: '54.60', RN: '1:00.16' }
  },
  Varones: {
    '400 LC Metros Libre': { RM: '3:39.96', RN: '3:52.18' },
    '200 LC Metros Comb. Ind.': { RM: '1:52.69', RN: '2:04.03' },
    '200 LC Metros Espalda': { RM: '1:51.92', RN: '2:03.10' },
    '50 LC Metros Libre': { RM: '20.91', RN: '23.08' },
    '100 LC Metros Espalda': { RM: '51.60', RN: '56.96' },
    '50 LC Metros Pecho': { RM: '25.95', RN: '28.96' },
    '100 LC Metros Mariposa': { RM: '49.45', RN: '52.91' }
  }
};

let allData = [];
let filtered = [];
let currentPage = 1;
const PAGE_SIZE = 25;

let activeSesion = '';
let activeGenero = '';
let activePrueba = '';
let activeCategoria = '';
let activeEquipo = '';
let activeBuscar = '';
let activePodioSesion = 'all';
let activePodioGenero = 'all';
let activeMedalBuscar = '';
let activeMedalleroType = 'all';
let activeRankingType = 'team';
let activeStyleDominanceType = 'team';
let activeStyleDominanceFilter = '';
let activeCategoryDominanceScope = 'combined';
let activeCategoryDominanceFilter = '';
let activeCategoryDominanceType = 'team';
let expandedRelayResults = new Set();
let promoPopupTimer = null;
let rankingViews = null;
let styleDominanceData = null;
let categoryDominanceData = null;

const PROMO_POPUP_DELAY_MS = 30 * 1000;
const PROMO_POPUP_COOLDOWN_MS = 2 * 60 * 60 * 1000;
const PROMO_POPUP_STORAGE_KEY = 'deporclubPromoPopupLastShownAt';
const INDIVIDUAL_POINTS_SCALE = [9, 7, 6, 5, 4, 3, 2, 1];
const RELAY_POINTS_SCALE = [18, 14, 12, 10, 8, 6, 4, 2];
const MINOR_SIMULATION_SESSIONS = new Set([4, 6]);
const SESSION_PILL_LABELS = {
  'Primera Sesion': '25 marzo',
  'Segunda Sesion': '26 marzo',
  'Tercera Fecha': '27 marzo',
  'Tercera Sesion': '27 marzo',
  'Cuarta Sesion': '28 marzo',
  'Quinta Sesion': '28 marzo',
  'Sexta Sesion': '29 marzo'
};

function getSessionPillLabel(sessionName) {
  return SESSION_PILL_LABELS[sessionName] || sessionName;
}

const isDesktop = () => window.innerWidth >= 768;

function syncBodyScrollLock() {
  const hasOpenOverlay = document.getElementById('filterSheet')?.classList.contains('open')
    || document.getElementById('promoPopup')?.classList.contains('open');
  document.body.style.overflow = hasOpenOverlay ? 'hidden' : '';
}

function timeToSec(str) {
  if (!str || str === 'DQ' || str === 'NS' || str === 'NT' || str === '—') return Infinity;
  const parts = str.split(':');
  return parts.length === 2 ? Number(parts[0]) * 60 + Number(parts[1]) : Number(parts[0]);
}

function cleanPoints(value) {
  const rounded = Math.round(Number(value || 0) * 10) / 10;
  return Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1);
}

function getRecordBadge(row) {
  if (row.dq || row.ns) return null;
  const refs = getRecordRefs(row);
  if (!refs) return null;
  const time = timeToSec(row.tiempo);
  if (time <= timeToSec(refs.RM.time)) return 'RM';
  if (time <= timeToSec(refs.RN.time)) return 'RN';
  return null;
}

function getRecordRefs(row) {
  return RECORDS.meta?.swimRecords?.[row.genero]?.[row.prueba]
    || DEFAULT_SWIM_RECORDS[row.genero]?.[row.prueba]
    || null;
}

function getPodioMeta(row) {
  if (row.relay) return `Relevo ${row.relayLabel} · ${row.puntos} pts`;
  if (row.edad === null || row.edad === undefined || row.edad === '') return `${row.categoria} · ${row.puntos} pts`;
  return `${row.edad} años · ${row.puntos} pts`;
}

function getResultSecondaryMeta(row) {
  if (!row.relay || !Array.isArray(row.integrantes) || !row.integrantes.length) return `${row.genero} Â· ${row.sesionNombre}`;
  return `Relevo ${row.relayLabel} Â· ${row.integrantes.map((item) => item.nombre).join(' / ')}`;
}

function getRelayResultKey(row) {
  return `${row.id}|${row.evento}|${row.equipo}|${row.relayLabel || ''}`;
}

function populateSelect(id, values, allLabel) {
  const el = document.getElementById(id);
  const current = el.value;
  el.innerHTML = `<option value="">${allLabel}</option>`;
  [...values].sort((a, b) => String(a).localeCompare(String(b), 'es')).forEach((value) => {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = value;
    el.appendChild(opt);
  });
  el.value = current;
}

function normalizeAthleteName(name) {
  return String(name || '')
    .replace(/ϐ|β/g, 'f')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildFilterOptions(data) {
  populateSelect('filterSesion', new Set(data.map((r) => r.sesionNombre)), 'Todas');
  populateSelect('filterGenero', new Set(data.map((r) => r.genero)), 'Todos');
  populateSelect('filterPrueba', new Set(data.map((r) => r.prueba)), 'Todas');
  populateSelect('filterCategoria', new Set(data.map((r) => r.categoria)), 'Todas');
  populateSelect('filterEquipo', new Set(data.map((r) => r.equipo)), 'Todos');
}

function renderStats(data) {
  const visibles = data.filter((r) => !r.ns);
  const atletasUnicos = new Set(
    visibles.flatMap((row) => {
      if (row.relay && Array.isArray(row.integrantes)) {
        return row.integrantes.map((item) => item.nombre);
      }
      return row.relay ? [] : [row.nombre];
    })
      .map((name) => normalizeAthleteName(name))
      .filter(Boolean)
  ).size;
  document.getElementById('statAtletas').textContent = atletasUnicos;
  document.getElementById('statEquipos').textContent = new Set(data.map((r) => r.equipo)).size;
  document.getElementById('statCategorias').textContent = RECORDS.meta.categorias;
  document.getElementById('statPruebas').textContent = RECORDS.meta.eventos;
  document.getElementById('headerSub').textContent = `${RECORDS.meta.fechas} · ${RECORDS.meta.sesion}`;
}

function renderDatasetCopy(data) {
  const rankingSubtitle = document.getElementById('rankingSubtitle');
  const medalleroSubtitle = document.getElementById('medalleroSubtitle');
  updateRankingCopy(data.length);

  if (medalleroSubtitle) {
    medalleroSubtitle.textContent = `Medallas acumuladas por persona y equipo hasta el Evento ${RECORDS.meta.eventos}`;
  }
}

function updateRankingCopy(processedRows = allData.length) {
  const rankingSubtitle = document.getElementById('rankingSubtitle');
  const officialUntilEvent = RECORDS.validacion?.officialUntilEvent || RECORDS.meta.eventos;
  const corte = RECORDS.validacion?.provisional ? 'Corte preliminar' : 'Acumulado oficial';

  if (!rankingSubtitle) return;

  rankingSubtitle.textContent = activeRankingType === 'team'
    ? `${corte} por equipos hasta el Evento ${officialUntilEvent} · ${processedRows} resultados procesados`
    : `${corte} por personas hasta el Evento ${officialUntilEvent} · las postas no suman puntos individuales`;
}

function updateRankingHeadings() {
  const labels = activeRankingType === 'team'
    ? {
        combined: 'Acumulado general por equipos',
        women: 'Acumulado mujeres por equipos',
        men: 'Acumulado hombres por equipos'
      }
    : {
        combined: 'Acumulado general por personas',
        women: 'Acumulado mujeres por personas',
        men: 'Acumulado hombres por personas'
      };

  document.getElementById('rankingHeadingCombined').textContent = labels.combined;
  document.getElementById('rankingHeadingWomen').textContent = labels.women;
  document.getElementById('rankingHeadingMen').textContent = labels.men;
}

function initTabs() {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((node) => node.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach((node) => node.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.tab).classList.add('active');
    });
  });
}

function openSheet() {
  document.getElementById('filterSheet').classList.add('open');
  document.getElementById('sheetBackdrop').classList.add('open');
  syncBodyScrollLock();
}

function closeSheet() {
  document.getElementById('filterSheet').classList.remove('open');
  document.getElementById('sheetBackdrop').classList.remove('open');
  syncBodyScrollLock();
}

function getPromoPopupLastShownAt() {
  try {
    return Number(window.localStorage.getItem(PROMO_POPUP_STORAGE_KEY) || 0);
  } catch {
    return 0;
  }
}

function setPromoPopupLastShownAt(timestamp) {
  try {
    window.localStorage.setItem(PROMO_POPUP_STORAGE_KEY, String(timestamp));
  } catch {
    // Si el navegador bloquea storage, el popup simplemente se comporta como temporal.
  }
}

function shouldShowPromoPopup() {
  return Date.now() - getPromoPopupLastShownAt() >= PROMO_POPUP_COOLDOWN_MS;
}

function openPromoPopup() {
  const popup = document.getElementById('promoPopup');
  const backdrop = document.getElementById('promoPopupBackdrop');

  if (!popup || !backdrop || popup.classList.contains('open')) return;

  popup.classList.add('open');
  backdrop.classList.add('open');
  setPromoPopupLastShownAt(Date.now());
  syncBodyScrollLock();
}

function closePromoPopup() {
  const popup = document.getElementById('promoPopup');
  const backdrop = document.getElementById('promoPopupBackdrop');

  if (!popup || !backdrop) return;

  popup.classList.remove('open');
  backdrop.classList.remove('open');
  syncBodyScrollLock();
}

function schedulePromoPopup() {
  if (!shouldShowPromoPopup()) return;

  window.clearTimeout(promoPopupTimer);
  promoPopupTimer = window.setTimeout(() => {
    if (document.hidden) {
      promoPopupTimer = null;
      return;
    }
    openPromoPopup();
    promoPopupTimer = null;
  }, PROMO_POPUP_DELAY_MS);
}

function syncActiveFiltersFromUI() {
  activeSesion = document.getElementById('filterSesion').value;
  activeGenero = document.getElementById('filterGenero').value;
  activePrueba = document.getElementById('filterPrueba').value;
  activeCategoria = document.getElementById('filterCategoria').value;
  activeEquipo = document.getElementById('filterEquipo').value;
}

function applySheetFilters() {
  syncActiveFiltersFromUI();
  if (!isDesktop()) closeSheet();
  applyFilters();
  updateFilterBtn();
}

function clearSheetFilters() {
  ['filterSesion', 'filterGenero', 'filterPrueba', 'filterCategoria', 'filterEquipo'].forEach((id) => {
    document.getElementById(id).value = '';
  });
  activeSesion = '';
  activeGenero = '';
  activePrueba = '';
  activeCategoria = '';
  activeEquipo = '';
  if (!isDesktop()) closeSheet();
  applyFilters();
  updateFilterBtn();
}

function updateFilterBtn() {
  const count = [activeSesion, activeGenero, activePrueba, activeCategoria, activeEquipo].filter(Boolean).length;
  const btn = document.getElementById('filterToggleBtn');
  btn.innerHTML = count > 0 ? `⚙️ Filtrar <span class="filter-badge">${count}</span>` : '⚙️ Filtrar';
  btn.classList.toggle('has-filters', count > 0);
}

function applyFilters() {
  filtered = allData.filter((r) => {
    if (activeSesion && r.sesionNombre !== activeSesion) return false;
    if (activeGenero && r.genero !== activeGenero) return false;
    if (activePrueba && r.prueba !== activePrueba) return false;
    if (activeCategoria && r.categoria !== activeCategoria) return false;
    if (activeEquipo && r.equipo !== activeEquipo) return false;
    if (activeBuscar) {
      const text = `${r.nombre} ${r.equipo} ${r.prueba}`.toLowerCase();
      if (!text.includes(activeBuscar)) return false;
    }
    return true;
  });
  currentPage = 1;
  renderResults();
  updateResultsInfo();
}

function initCategoryPills(data) {
  const dateContainer = document.getElementById('datePills');
  const genderContainer = document.getElementById('genderPills');
  const sessionPills = [...new Map(
    [...data]
      .sort((a, b) => a.sesion - b.sesion || a.evento - b.evento)
      .map((row) => [getSessionPillLabel(row.sesionNombre), row.sesion])
  ).entries()];

  const datePills = [
    { label: 'Todas', value: 'all' },
    ...sessionPills.map(([sessionLabel]) => ({
      label: sessionLabel,
      value: sessionLabel
    }))
  ];

  const genderPills = [
    { label: 'Todas', value: 'all' },
    ...[...new Set(data.map((row) => row.genero))]
      .sort((a, b) => a.localeCompare(b, 'es'))
      .map((gender) => ({ label: gender, value: gender }))
  ];

  datePills.forEach((pill, index) => {
    const btn = document.createElement('button');
    btn.className = `pill-btn podio-date-btn${index === 0 ? ' active' : ''}`;
    btn.textContent = pill.label;
    btn.addEventListener('click', () => {
      document.querySelectorAll('.podio-date-btn').forEach((node) => node.classList.remove('active'));
      btn.classList.add('active');
      activePodioSesion = pill.value;
      renderPodios(data, activePodioSesion, activePodioGenero);
    });
    dateContainer.appendChild(btn);
  });

  genderPills.forEach((pill, index) => {
    const btn = document.createElement('button');
    btn.className = `pill-btn podio-gender-btn${index === 0 ? ' active' : ''}`;
    btn.textContent = pill.label;
    btn.addEventListener('click', () => {
      document.querySelectorAll('.podio-gender-btn').forEach((node) => node.classList.remove('active'));
      btn.classList.add('active');
      activePodioGenero = pill.value;
      renderPodios(data, activePodioSesion, activePodioGenero);
    });
    genderContainer.appendChild(btn);
  });
}

function renderPodios(data, sessionFilter = 'all', genderFilter = 'all') {
  const grid = document.getElementById('podiosGrid');
  grid.innerHTML = '';

  const grouped = new Map();
  data.forEach((row) => {
    if (sessionFilter !== 'all' && getSessionPillLabel(row.sesionNombre) !== sessionFilter) return;
    if (genderFilter !== 'all' && row.genero !== genderFilter) return;
    const key = `${row.evento}|${row.genero}|${row.prueba}|${row.categoria}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  });

  [...grouped.values()]
    .sort((a, b) => a[0].evento - b[0].evento || a[0].categoria.localeCompare(b[0].categoria, 'es'))
    .forEach((rows) => {
      const first = rows[0];
      const recordRefs = getRecordRefs(first);
      const top3 = rows
        .filter((row) => !row.dq && !row.ns && !row.nt && !row.exhibition)
        .sort((a, b) => (a.pos || 999) - (b.pos || 999))
        .slice(0, 3);

      if (!top3.length) return;

      const card = document.createElement('div');
      card.className = 'podio-card';
      card.innerHTML = `
        <div class="podio-header">
          <div class="podio-header-title">Evento ${first.evento} · ${first.genero} · ${first.categoria}</div>
          <div class="podio-header-sub">${first.prueba} · ${first.sesionNombre}</div>
          ${recordRefs ? `
            <div class="podio-records">
              <span class="rec-badge rm">RM</span>
              <span>${recordRefs.RM.time}</span>
              <span class="rec-name">${recordRefs.RM.name}</span>
              <span class="rec-badge rn">RN</span>
              <span>${recordRefs.RN.time}</span>
              <span class="rec-name">${recordRefs.RN.name}</span>
            </div>
          ` : ''}
        </div>
        <div class="podio-places">
          ${top3.map((row, index) => {
            const badge = getRecordBadge(row);
            const breakerClass = badge ? ` record-breaker ${badge.toLowerCase()}-breaker` : '';
            const badgeLabel = badge === 'RM' ? '&#128293; RM' : '&#128293; RN';
            return `
              <div class="podio-place p${index + 1}${breakerClass}">
                <span class="medal-icon">${['🥇', '🥈', '🥉'][index]}</span>
                <div class="place-body">
                  <div class="place-name">${row.nombre}${badge ? ` <span class="record-pill ${badge.toLowerCase()}">${badgeLabel}</span>` : ''}</div>
                  <div class="place-meta"><span class="equipo-tag">${row.equipo}</span> · ${getPodioMeta(row)}</div>
                </div>
                <span class="place-time${badge ? ' record-time' : ''}">${row.displayTime}</span>
              </div>
            `;
          }).join('')}
        </div>
      `;
      card.addEventListener('click', () => goToResultados(first));
      grid.appendChild(card);
    });
}

function goToResultados(row) {
  document.querySelectorAll('.tab-btn').forEach((node) => node.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach((node) => node.classList.remove('active'));
  document.querySelector('[data-tab="resultados"]').classList.add('active');
  document.getElementById('resultados').classList.add('active');

  document.getElementById('filterSesion').value = row.sesionNombre;
  document.getElementById('filterGenero').value = row.genero;
  document.getElementById('filterPrueba').value = row.prueba;
  document.getElementById('filterCategoria').value = row.categoria;
  document.getElementById('filterEquipo').value = '';
  document.getElementById('filterBuscar').value = '';

  activeBuscar = '';
  syncActiveFiltersFromUI();
  applyFilters();
  updateFilterBtn();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function statusTag(row) {
  if (row.ns) return '<span class="badge-ns">NS</span>';
  if (row.dq) return '<span class="badge-dq">DQ</span>';
  if (row.nt) return '<span class="badge-ns">NT</span>';
  if (row.exhibition) return '<span class="badge-exh">EXH</span>';
  return '';
}

function renderResults() {
  const list = document.getElementById('resultsList');
  list.innerHTML = '';

  const start = (currentPage - 1) * PAGE_SIZE;
  const page = filtered.slice(start, start + PAGE_SIZE);

  if (!page.length) {
    list.innerHTML = `
      <div class="no-results">
        <div class="no-results-icon">🔍</div>
        <p>Sin resultados para los filtros aplicados</p>
      </div>`;
    renderPagination(0);
    return;
  }

  page.forEach((row) => {
    const card = document.createElement('div');
    let posClass = 'other';
    let posLabel = row.pos ?? '—';

    if (row.ns) {
      posClass = 'dq-pos';
      posLabel = 'NS';
    } else if (row.nt) {
      posClass = 'dq-pos';
      posLabel = 'NT';
    } else if (row.dq) {
      posClass = 'dq-pos';
      posLabel = 'DQ';
    } else if (row.pos === 1) posClass = 'gold';
    else if (row.pos === 2) posClass = 'silver';
    else if (row.pos === 3) posClass = 'bronze';

    const recordBadge = getRecordBadge(row);
    const isRelayExpanded = row.relay && expandedRelayResults.has(getRelayResultKey(row));
    const relayToggle = row.relay
      ? `<button class="equipo-tag equipo-tag-btn" type="button" data-relay-toggle="${getRelayResultKey(row)}">${row.equipo}</button>`
      : `<span class="equipo-tag">${row.equipo}</span>`;
    const relayMembers = row.relay && Array.isArray(row.integrantes) && row.integrantes.length
      ? `
        <div class="rc-relay-members${isRelayExpanded ? ' open' : ''}">
          <div class="rc-relay-title">Integrantes del equipo</div>
          <div class="rc-relay-list">
            ${row.integrantes.map((item) => `
              <div class="rc-relay-member">
                <span class="rc-relay-member-name">${item.nombre}</span>
                <span class="rc-relay-member-meta">${item.genero || row.genero} · ${item.edad} años</span>
              </div>
            `).join('')}
          </div>
        </div>
      `
      : '';
    card.className = `result-card ${row.dq ? 'is-dq' : row.ns ? 'is-ns' : ''}`;
    card.innerHTML = `
      <div class="rc-pos ${posClass}">${posLabel}</div>
      <div class="rc-body">
        <div class="rc-name">${row.nombre}${statusTag(row)}</div>
        <div class="rc-meta">
          ${relayToggle} · Evento ${row.evento} · ${row.prueba} · ${row.categoria}
        </div>
        <div class="rc-submeta">${getResultSecondaryMeta(row)}</div>
        ${relayMembers}
      </div>
      <div class="rc-right">
        <span class="rc-time">${row.displayTime}</span>
        ${recordBadge ? `<span class="rc-record-pill ${recordBadge.toLowerCase()}">${recordBadge}</span>` : ''}
        <span class="rc-points">${row.puntos} pts</span>
      </div>
    `;
    const relayToggleBtn = card.querySelector('[data-relay-toggle]');
    if (relayToggleBtn) {
      relayToggleBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        const key = relayToggleBtn.dataset.relayToggle;
        if (expandedRelayResults.has(key)) expandedRelayResults.delete(key);
        else expandedRelayResults.add(key);
        renderResults();
      });
    }
    list.appendChild(card);
  });

  renderPagination(filtered.length);
}

function updateResultsInfo() {
  const hasFilters = [activeSesion, activeGenero, activePrueba, activeCategoria, activeEquipo, activeBuscar].filter(Boolean).length > 0;
  document.getElementById('tableInfo').textContent = `${filtered.length} resultado${filtered.length !== 1 ? 's' : ''}`;
  document.getElementById('clearAllLink').style.display = hasFilters ? 'inline' : 'none';
}

function renderPagination(total) {
  const el = document.getElementById('pagination');
  el.innerHTML = '';
  const pages = Math.ceil(total / PAGE_SIZE);
  if (pages <= 1) return;

  el.appendChild(makePageBtn('←', currentPage === 1, () => {
    currentPage -= 1;
    renderResults();
    scrollToTop();
  }));

  let start = Math.max(1, currentPage - 2);
  let end = Math.min(pages, start + 4);
  if (end - start < 4) start = Math.max(1, end - 4);

  for (let page = start; page <= end; page += 1) {
    const btn = makePageBtn(page, false, () => {
      currentPage = page;
      renderResults();
      scrollToTop();
    });
    if (page === currentPage) btn.classList.add('active');
    el.appendChild(btn);
  }

  el.appendChild(makePageBtn('→', currentPage === pages, () => {
    currentPage += 1;
    renderResults();
    scrollToTop();
  }));
}

function makePageBtn(label, disabled, onClick) {
  const btn = document.createElement('button');
  btn.className = 'page-btn';
  btn.textContent = label;
  btn.disabled = disabled;
  if (!disabled) btn.addEventListener('click', onClick);
  return btn;
}

function scrollToTop() {
  document.getElementById('resultados').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderRankingList(targetId, rows, mode = 'team') {
  const list = document.getElementById(targetId);
  list.innerHTML = '';
  rows.forEach((entry, index) => {
    const wrapper = document.createElement('div');
    wrapper.className = `ranking-row ${index === 0 ? 'rk-gold' : index === 1 ? 'rk-silver' : index === 2 ? 'rk-bronze' : ''}`;
    const title = mode === 'team' ? entry.teamName : entry.nombre;
    const meta = mode === 'athlete' && entry.teamName
      ? `<div class="rk-events">${entry.teamName}</div>`
      : '';
    wrapper.innerHTML = `
      <div class="rk-pos">${index < 3 ? ['&#129351;', '&#129352;', '&#129353;'][index] : entry.rank}</div>
      <div class="rk-body">
        <div class="rk-name">${title}</div>
        ${meta}
      </div>
      <div class="rk-points">
        <span class="rk-pts">${entry.points}</span>
        <span class="rk-pts-label">pts</span>
      </div>
    `;
    list.appendChild(wrapper);
  });
}

function buildRankedTable(pointsMap) {
  const sorted = [...pointsMap.entries()]
    .map(([teamName, points]) => ({ teamName, points: Number(cleanPoints(points)) }))
    .sort((a, b) => b.points - a.points || a.teamName.localeCompare(b.teamName, 'es'));

  let lastPoints = null;
  let lastRank = 0;
  return sorted.map((team, index) => {
    const rank = team.points === lastPoints ? lastRank : index + 1;
    lastPoints = team.points;
    lastRank = rank;
    return { rank, ...team };
  });
}

function buildAthleteRankingData(rows) {
  const officialUntilEvent = RECORDS.validacion?.officialUntilEvent || RECORDS.meta.eventos;
  const buckets = {
    combined: new Map(),
    women: new Map(),
    men: new Map()
  };

  const ensureAthlete = (scope, nombre, teamName) => {
    if (!buckets[scope].has(nombre)) {
      buckets[scope].set(nombre, { nombre, teamName, points: 0 });
    }
    return buckets[scope].get(nombre);
  };

  rows
    .filter((row) => (
      row.evento <= officialUntilEvent
      && !row.relay
      && Number(row.puntosOficiales || row.puntos || 0) > 0
      && !row.exhibition
      && !row.dq
      && !row.ns
      && !row.nt
    ))
    .forEach((row) => {
      const points = Number(row.puntosOficiales || row.puntos || 0);
      ensureAthlete('combined', row.nombre, row.teamName).points += points;
      if (row.genero === 'Damas') ensureAthlete('women', row.nombre, row.teamName).points += points;
      if (row.genero === 'Varones') ensureAthlete('men', row.nombre, row.teamName).points += points;
    });

  const rankEntries = (items) => {
    const sorted = [...items.values()]
      .map((item) => ({ ...item, points: Number(cleanPoints(item.points)) }))
      .sort((a, b) => b.points - a.points || a.nombre.localeCompare(b.nombre, 'es'));

    let lastPoints = null;
    let lastRank = 0;
    return sorted.map((item, index) => {
      const rank = item.points === lastPoints ? lastRank : index + 1;
      lastPoints = item.points;
      lastRank = rank;
      return { rank, ...item };
    });
  };

  return {
    combined: rankEntries(buckets.combined),
    women: rankEntries(buckets.women),
    men: rankEntries(buckets.men)
  };
}

function syncRankingView(processedRows = allData.length) {
  if (!rankingViews) return;

  const current = rankingViews[activeRankingType];
  renderRankingList('rankingListCombined', current.combined, activeRankingType);
  renderRankingList('rankingListWomen', current.women, activeRankingType);
  renderRankingList('rankingListMen', current.men, activeRankingType);
  updateRankingHeadings();
  updateRankingCopy(processedRows);
}

function buildMinorPointsSimulation(rows) {
  const simulationRows = rows.filter((row) => MINOR_SIMULATION_SESSIONS.has(row.sesion));
  const added = {
    combined: new Map(),
    women: new Map(),
    men: new Map()
  };
  const grouped = new Map();

  simulationRows.forEach((row) => {
    const key = `${row.evento}|${row.genero}|${row.prueba}|${row.categoria}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  });

  grouped.forEach((eventRows) => {
    const eligible = eventRows
      .filter((row) => !row.dq && !row.ns && !row.nt && !row.exhibition && row.pos)
      .sort((a, b) => (a.pos || 999) - (b.pos || 999) || timeToSec(a.tiempo) - timeToSec(b.tiempo) || a.nombre.localeCompare(b.nombre, 'es'));

    if (!eligible.length) return;

    const scale = eligible[0].relay ? RELAY_POINTS_SCALE : INDIVIDUAL_POINTS_SCALE;
    const tiesByPos = new Map();
    eligible.forEach((row) => {
      if (!tiesByPos.has(row.pos)) tiesByPos.set(row.pos, []);
      tiesByPos.get(row.pos).push(row);
    });

    let scoreIndex = 1;
    [...tiesByPos.entries()]
      .sort((a, b) => a[0] - b[0])
      .forEach(([, tiedRows]) => {
        const covered = scale.slice(scoreIndex - 1, scoreIndex - 1 + tiedRows.length);
        const points = covered.length
          ? covered.reduce((sum, value) => sum + value, 0) / tiedRows.length
          : 0;

        tiedRows.forEach((row) => {
          added.combined.set(row.teamName, (added.combined.get(row.teamName) || 0) + points);

          if (row.genero === 'Damas') {
            added.women.set(row.teamName, (added.women.get(row.teamName) || 0) + points);
          }

          if (row.genero === 'Varones') {
            added.men.set(row.teamName, (added.men.get(row.teamName) || 0) + points);
          }
        });

        scoreIndex += tiedRows.length;
      });
  });

  const rankings = {};
  ['combined', 'women', 'men'].forEach((scope) => {
    rankings[scope] = buildRankedTable(added[scope]).map((team) => ({
      ...team,
      addedPoints: Number(cleanPoints(team.points))
    }));
  });

  const combinedImpact = rankings.combined.filter((team) => team.addedPoints > 0);
  const leader = rankings.combined[0] || null;

  return {
    rankings,
    summary: {
      totalAddedPoints: Number(cleanPoints([...added.combined.values()].reduce((sum, value) => sum + value, 0))),
      impactedTeams: combinedImpact.length,
      eventsSimulated: new Set(simulationRows.map((row) => row.evento)).size,
      leader,
      womenLeader: rankings.women[0] || null,
      menLeader: rankings.men[0] || null
    }
  };
}

function renderSimulationRanking(targetId, rows) {
  const list = document.getElementById(targetId);
  list.innerHTML = '';

  rows.forEach((team, index) => {
    const wrapper = document.createElement('div');
    wrapper.className = `ranking-row metrics-row ${index === 0 ? 'rk-gold' : index === 1 ? 'rk-silver' : index === 2 ? 'rk-bronze' : ''}`;
    wrapper.innerHTML = `
      <div class="rk-pos">${index < 3 ? ['&#129351;', '&#129352;', '&#129353;'][index] : team.rank}</div>
      <div class="rk-body">
        <div class="rk-name">${team.teamName}</div>
        <div class="rk-events">
          <span class="metrics-delta is-up">Menores</span>
          | ${cleanPoints(team.addedPoints)} pts en este campeonato
        </div>
      </div>
      <div class="rk-points">
        <span class="rk-pts">${cleanPoints(team.points)}</span>
        <span class="rk-pts-label">pts</span>
      </div>
    `;
    list.appendChild(wrapper);
  });
}

function renderMetrics(rows) {
  const simulation = buildMinorPointsSimulation(rows);
  const summary = simulation.summary;
  const summaryContainer = document.getElementById('metricsSummary');
  const note = document.getElementById('metricsNote');

  summaryContainer.innerHTML = `
    <article class="metric-card">
      <span class="metric-label">Puntos del campeonato</span>
      <strong class="metric-value">${cleanPoints(summary.totalAddedPoints)}</strong>
      <span class="metric-copy">Puntaje total repartido dentro de este campeonato simulado de menores.</span>
    </article>
    <article class="metric-card">
      <span class="metric-label">Equipos clasificados</span>
      <strong class="metric-value">${summary.impactedTeams}</strong>
      <span class="metric-copy">Clubes que sumarian puntos si los menores tuvieran su propio campeonato.</span>
    </article>
    <article class="metric-card">
      <span class="metric-label">Lider general</span>
      <strong class="metric-value metric-team">${summary.leader?.teamName || '-'}</strong>
      <span class="metric-copy">${summary.leader ? `${cleanPoints(summary.leader.points)} pts en el campeonato de menores.` : 'Sin datos disponibles.'}</span>
    </article>
    <article class="metric-card">
      <span class="metric-label">Lideres por rama</span>
      <strong class="metric-value metric-team">${summary.womenLeader?.teamName || '-'}</strong>
      <span class="metric-copy">${summary.womenLeader ? `Damas: ${cleanPoints(summary.womenLeader.points)} pts` : 'Sin lider en damas.'}${summary.menLeader ? ` | Varones: ${summary.menLeader.teamName} ${cleanPoints(summary.menLeader.points)} pts` : ''}</span>
    </article>
  `;

  note.innerHTML = `
    <strong>Supuesto de la simulacion:</strong> esta vista trata a la cuarta y sexta sesion como si fueran un campeonato separado de menores.
    No se mezcla con el ranking oficial del meet. Individuales: 9-7-6-5-4-3-2-1. Postas: 18-14-12-10-8-6-4-2 por equipo.
    Los empates reparten promedio y las postas siguen sumando solo al club.
  `;

  renderSimulationRanking('metricsListCombined', simulation.rankings.combined);
  renderSimulationRanking('metricsListWomen', simulation.rankings.women);
  renderSimulationRanking('metricsListMen', simulation.rankings.men);
  styleDominanceData = buildStyleDominanceData(rows);
  renderStyleMetrics();
  categoryDominanceData = buildCategoryDominanceData(rows);
  renderCategoryDominance();
  renderHeatmaps(rows);
}

function getMetricStyle(row) {
  if (row.relay) return 'Relevos';
  if (row.prueba.includes('Libre')) return 'Libre';
  if (row.prueba.includes('Espalda')) return 'Espalda';
  if (row.prueba.includes('Pecho')) return 'Pecho';
  if (row.prueba.includes('Mariposa')) return 'Mariposa';
  if (row.prueba.includes('Comb')) return 'Combinado';
  return 'Otros';
}

function getCategoryOrderLabel(category) {
  const order = ['8 Años de Edad', '9 Años de Edad', '10 Años de Edad', '9-10', '11 Años de Edad', '12 Años de Edad', '11-12', '13-14', '15-17', '18 & Over'];
  const index = order.indexOf(category);
  return index === -1 ? 999 : index;
}

function buildOfficialTeamMetricData(rows) {
  const scoringRows = rows.filter((row) => (
    Number(row.puntosOficiales || row.puntos || 0) > 0
    && !row.exhibition
    && !row.dq
    && !row.ns
    && !row.nt
    && row.teamName !== 'Unattached'
  ));
  const rankedTeams = RECORDS.rankingsOficiales.combined.map((item) => item.teamName);
  const extraTeams = [...new Set(scoringRows.map((row) => row.teamName))]
    .filter((teamName) => !rankedTeams.includes(teamName));
  const topTeams = [...rankedTeams, ...extraTeams];
  const styleOrder = ['Libre', 'Espalda', 'Pecho', 'Mariposa', 'Combinado', 'Relevos', 'Otros'];
  const styleMatrix = new Map();
  const categoryMatrix = new Map();
  const categories = [...new Set(scoringRows.map((row) => row.categoria))]
    .sort((a, b) => getCategoryOrderLabel(a) - getCategoryOrderLabel(b) || a.localeCompare(b, 'es'));

  topTeams.forEach((teamName) => {
    styleMatrix.set(teamName, new Map());
    categoryMatrix.set(teamName, new Map());
  });

  scoringRows.forEach((row) => {
    if (!styleMatrix.has(row.teamName)) return;
    const style = getMetricStyle(row);
    const points = Number(row.puntosOficiales || row.puntos || 0);
    styleMatrix.get(row.teamName).set(style, (styleMatrix.get(row.teamName).get(style) || 0) + points);
    categoryMatrix.get(row.teamName).set(row.categoria, (categoryMatrix.get(row.teamName).get(row.categoria) || 0) + points);
  });

  const activeStyles = styleOrder.filter((style) => topTeams.some((team) => (styleMatrix.get(team).get(style) || 0) > 0));
  const styleLeaders = activeStyles.map((style) => {
    const ranking = topTeams
      .map((teamName) => ({ teamName, points: Number(cleanPoints(styleMatrix.get(teamName).get(style) || 0)) }))
      .filter((team) => team.points > 0)
      .sort((a, b) => b.points - a.points || a.teamName.localeCompare(b.teamName, 'es'));
    return {
      style,
      ranking,
      leader: ranking[0] || null,
      runnerUp: ranking[1] || null
    };
  }).filter((entry) => entry.leader);

  const teamProfiles = topTeams.map((teamName) => {
    const total = activeStyles.reduce((sum, style) => sum + (styleMatrix.get(teamName).get(style) || 0), 0);
    const dominant = activeStyles
      .map((style) => ({ style, points: styleMatrix.get(teamName).get(style) || 0 }))
      .sort((a, b) => b.points - a.points || a.style.localeCompare(b.style, 'es'))[0];
    return {
      teamName,
      total: Number(cleanPoints(total)),
      dominantStyle: dominant?.style || 'Sin puntos',
      dominantPoints: Number(cleanPoints(dominant?.points || 0)),
      share: total ? Number(cleanPoints(((dominant?.points || 0) / total) * 100)) : 0
    };
  }).sort((a, b) => b.share - a.share || b.dominantPoints - a.dominantPoints || a.teamName.localeCompare(b.teamName, 'es'));

  return {
    topTeams,
    activeStyles,
    categories,
    styleMatrix,
    categoryMatrix,
    styleLeaders,
    teamProfiles
  };
}

function buildStyleDominanceData(rows) {
  const teamRows = rows.filter((row) => (
    Number(row.puntosOficiales || row.puntos || 0) > 0
    && !row.exhibition
    && !row.dq
    && !row.ns
    && !row.nt
    && row.teamName !== 'Unattached'
  ));
  const athleteRows = teamRows.filter((row) => !row.relay);
  const styleOrder = ['Libre', 'Espalda', 'Pecho', 'Mariposa', 'Combinado', 'Relevos', 'Otros'];

  const buildTypeData = (mode, sourceRows) => {
    const totalsMap = new Map();
    const breakdownMap = new Map();

    sourceRows.forEach((row) => {
      const style = getMetricStyle(row);
      const points = Number(row.puntosOficiales || row.puntos || 0);
      const entityKey = mode === 'team' ? row.teamName : row.nombre;
      const breakdownKey = mode === 'team' ? row.categoria : row.prueba;

      if (!totalsMap.has(entityKey)) {
        totalsMap.set(entityKey, mode === 'team'
          ? { teamName: row.teamName, totals: new Map() }
          : { nombre: row.nombre, teamName: row.teamName, totals: new Map() });
      }
      totalsMap.get(entityKey).totals.set(style, (totalsMap.get(entityKey).totals.get(style) || 0) + points);

      const detailMapKey = `${entityKey}|${style}`;
      if (!breakdownMap.has(detailMapKey)) breakdownMap.set(detailMapKey, new Map());
      breakdownMap.get(detailMapKey).set(breakdownKey, (breakdownMap.get(detailMapKey).get(breakdownKey) || 0) + points);
    });

    const activeStyles = styleOrder.filter((style) => [...totalsMap.values()].some((entry) => (entry.totals.get(style) || 0) > 0));
    const styleLeaders = activeStyles.map((style) => {
      const ranking = [...totalsMap.values()]
        .map((entry) => ({
          ...(mode === 'team' ? { teamName: entry.teamName } : { nombre: entry.nombre, teamName: entry.teamName }),
          points: Number(cleanPoints(entry.totals.get(style) || 0))
        }))
        .filter((entry) => entry.points > 0)
        .sort((a, b) => {
          const labelA = mode === 'team' ? a.teamName : a.nombre;
          const labelB = mode === 'team' ? b.teamName : b.nombre;
          return b.points - a.points || labelA.localeCompare(labelB, 'es');
        });
      return {
        style,
        ranking,
        leader: ranking[0] || null,
        runnerUp: ranking[1] || null
      };
    }).filter((entry) => entry.leader);

    const profiles = [...totalsMap.values()].map((entry) => {
      const total = activeStyles.reduce((sum, style) => sum + (entry.totals.get(style) || 0), 0);
      const dominant = activeStyles
        .map((style) => ({ style, points: entry.totals.get(style) || 0 }))
        .sort((a, b) => b.points - a.points || a.style.localeCompare(b.style, 'es'))[0];
      return {
        ...(mode === 'team' ? { teamName: entry.teamName } : { nombre: entry.nombre, teamName: entry.teamName }),
        total: Number(cleanPoints(total)),
        dominantStyle: dominant?.style || 'Sin puntos',
        dominantPoints: Number(cleanPoints(dominant?.points || 0)),
        share: total ? Number(cleanPoints(((dominant?.points || 0) / total) * 100)) : 0
      };
    }).sort((a, b) => {
      const labelA = mode === 'team' ? a.teamName : a.nombre;
      const labelB = mode === 'team' ? b.teamName : b.nombre;
      return b.share - a.share || b.dominantPoints - a.dominantPoints || labelA.localeCompare(labelB, 'es');
    });

    return {
      activeStyles,
      styleLeaders,
      profiles,
      breakdownMap
    };
  };

  return {
    team: buildTypeData('team', teamRows),
    athlete: buildTypeData('athlete', athleteRows)
  };
}

function renderStyleMetrics() {
  if (!styleDominanceData) return;

  const metricData = styleDominanceData[activeStyleDominanceType];
  const summary = document.getElementById('styleLeadersSummary');
  const note = document.getElementById('styleDominanceNote');
  const leadersList = document.getElementById('styleDominanceList');
  const profilesList = document.getElementById('teamStyleProfileList');
  const leadersTitle = document.getElementById('styleDominanceListTitle');
  const profileTitle = document.getElementById('styleProfileListTitle');
  const modeCopy = activeStyleDominanceType === 'team'
    ? {
        subject: 'equipo',
        plural: 'equipos',
        note: `puntaje oficial acumulado por equipo hasta el Evento ${RECORDS.validacion.officialUntilEvent}.`,
        profile: 'Detalle del lider'
      }
    : {
        subject: 'persona',
        plural: 'personas',
        note: `puntaje oficial individual acumulado por participante hasta el Evento ${RECORDS.validacion.officialUntilEvent}. Las postas no suman puntos individuales.`,
        profile: 'Detalle del lider por estilo'
      };
  const selected = metricData.styleLeaders.find((entry) => entry.style === activeStyleDominanceFilter) || metricData.styleLeaders[0];

  if (selected) {
    activeStyleDominanceFilter = selected.style;
  }

  summary.innerHTML = metricData.styleLeaders.map((entry) => `
    <article class="metric-card metric-card-style ${entry.style === activeStyleDominanceFilter ? 'metric-card-active' : ''}" data-style-card="${entry.style}">
      <span class="metric-label">${entry.style}</span>
      <strong class="metric-value metric-team">${activeStyleDominanceType === 'team' ? entry.leader.teamName : entry.leader.nombre}</strong>
      <span class="metric-copy">${cleanPoints(entry.leader.points)} pts${entry.runnerUp ? ` · margen ${cleanPoints(entry.leader.points - entry.runnerUp.points)}` : ''}</span>
    </article>
  `).join('');

  summary.querySelectorAll('[data-style-card]').forEach((card) => {
    card.addEventListener('click', () => {
      activeStyleDominanceFilter = card.dataset.styleCard;
      renderStyleMetrics();
    });
  });

  note.innerHTML = `
    <strong>Base del análisis:</strong> ${modeCopy.note}
    La dominancia se calcula por puntos en cada estilo. Selecciona una cartilla para ver abajo el ranking y el detalle de ese estilo.
  `;

  if (!selected) {
    leadersList.innerHTML = `<div class="metrics-note">No hay datos disponibles para este tipo de análisis.</div>`;
    profilesList.innerHTML = '';
    return;
  }

  leadersTitle.textContent = `Ranking en ${selected.style}`;
  profileTitle.textContent = `${modeCopy.profile} en ${selected.style}`;

  leadersList.innerHTML = selected.ranking.map((item, index) => `
    <div class="ranking-row metrics-row ${index === 0 ? 'rk-gold' : index === 1 ? 'rk-silver' : index === 2 ? 'rk-bronze' : ''}">
      <div class="rk-pos">${item.rank || index + 1}</div>
      <div class="rk-body">
        <div class="rk-name">${activeStyleDominanceType === 'team' ? item.teamName : item.nombre}</div>
        <div class="rk-events">${activeStyleDominanceType === 'athlete' ? `${item.teamName} · ` : ''}${cleanPoints(item.points)} pts en ${selected.style}</div>
      </div>
      <div class="rk-points">
        <span class="rk-pts">${cleanPoints(item.points)}</span>
        <span class="rk-pts-label">pts</span>
      </div>
    </div>
  `).join('');

  const leader = selected.leader;
  const leaderKey = activeStyleDominanceType === 'team' ? leader.teamName : leader.nombre;
  const detailBreakdown = [...(metricData.breakdownMap.get(`${leaderKey}|${selected.style}`) || new Map()).entries()]
    .map(([label, points]) => ({ label, points: Number(cleanPoints(points)) }))
    .sort((a, b) => b.points - a.points || a.label.localeCompare(b.label, 'es'));

  profilesList.innerHTML = `
    <div class="metric-style-card">
      <div class="metric-style-head">
        <span class="metric-style-name">${activeStyleDominanceType === 'team' ? leader.teamName : leader.nombre}</span>
        <span class="metric-style-badge">${selected.ranking.length} ${modeCopy.plural} con puntos</span>
      </div>
      ${activeStyleDominanceType === 'athlete' ? `<div class="metrics-note metrics-note-inline">${leader.teamName}</div>` : ''}
      <div class="metrics-grid metrics-grid-compact">
        <article class="metric-card">
          <span class="metric-label">Puntos del lider</span>
          <strong class="metric-value">${cleanPoints(leader.points)}</strong>
          <span class="metric-copy">${selected.runnerUp ? `Margen ${cleanPoints(leader.points - selected.runnerUp.points)} pts sobre el segundo.` : 'Sin perseguidor directo en este estilo.'}</span>
        </article>
        <article class="metric-card">
          <span class="metric-label">Detalle del estilo</span>
          <strong class="metric-value">${selected.style}</strong>
          <span class="metric-copy">${activeStyleDominanceType === 'team' ? 'Desglose por categorías' : 'Desglose por pruebas'} del líder.</span>
        </article>
      </div>
      <div class="metric-style-list">
        ${detailBreakdown.length ? detailBreakdown.map((item, index) => `
          <div class="ranking-row metrics-row">
            <div class="rk-pos">${index + 1}</div>
            <div class="rk-body">
              <div class="rk-name">${item.label}</div>
              <div class="rk-events">${cleanPoints(item.points)} pts dentro de ${selected.style}</div>
            </div>
          </div>
        `).join('') : '<div class="metrics-note">No hay desglose adicional disponible para este líder.</div>'}
      </div>
    </div>
  `;
}

function buildCategoryDominanceData(rows) {
  const teamRows = rows.filter((row) => (
    Number(row.puntosOficiales || row.puntos || 0) > 0
    && !row.exhibition
    && !row.dq
    && !row.ns
    && !row.nt
    && row.teamName !== 'Unattached'
  ));
  const athleteRows = teamRows.filter((row) => !row.relay);
  const categories = [...new Set(teamRows.map((row) => row.categoria))]
    .sort((a, b) => getCategoryOrderLabel(a) - getCategoryOrderLabel(b) || a.localeCompare(b, 'es'));
  const scopes = {
    combined: () => true,
    women: (row) => row.genero === 'Damas',
    men: (row) => row.genero === 'Varones'
  };
  const buildRankedEntities = (entityMap, mode) => {
    const sorted = [...entityMap.values()]
      .map((item) => ({ ...item, points: Number(cleanPoints(item.points)) }))
      .sort((a, b) => {
        const labelA = mode === 'team' ? a.teamName : a.nombre;
        const labelB = mode === 'team' ? b.teamName : b.nombre;
        return b.points - a.points || labelA.localeCompare(labelB, 'es');
      });

    let lastPoints = null;
    let lastRank = 0;
    return sorted.map((item, index) => {
      const rank = item.points === lastPoints ? lastRank : index + 1;
      lastPoints = item.points;
      lastRank = rank;
      return { rank, ...item };
    });
  };

  const buildTypeData = (mode, sourceRows) => {
    const typeData = { scopes: {} };

    Object.entries(scopes).forEach(([scope, predicate]) => {
      const categoryPoints = new Map();
      const categoryBreakdown = new Map();

      sourceRows.filter(predicate).forEach((row) => {
        const category = row.categoria;
        const points = Number(row.puntosOficiales || row.puntos || 0);
        const entityKey = mode === 'team' ? row.teamName : row.nombre;
        const detailKey = mode === 'team' ? getMetricStyle(row) : row.prueba;

        if (!categoryPoints.has(category)) categoryPoints.set(category, new Map());
        if (!categoryPoints.get(category).has(entityKey)) {
          categoryPoints.get(category).set(entityKey, mode === 'team'
            ? { teamName: row.teamName, points: 0 }
            : { nombre: row.nombre, teamName: row.teamName, points: 0 });
        }
        categoryPoints.get(category).get(entityKey).points += points;

        const breakdownKey = `${category}|${entityKey}`;
        if (!categoryBreakdown.has(breakdownKey)) categoryBreakdown.set(breakdownKey, new Map());
        categoryBreakdown.get(breakdownKey).set(detailKey, (categoryBreakdown.get(breakdownKey).get(detailKey) || 0) + points);
      });

      const leaders = categories.map((category) => {
        const ranking = buildRankedEntities(categoryPoints.get(category) || new Map(), mode);
        return {
          category,
          ranking,
          leader: ranking[0] || null,
          runnerUp: ranking[1] || null,
          totalPoints: Number(cleanPoints(ranking.reduce((sum, item) => sum + item.points, 0))),
          entitiesWithPoints: ranking.length
        };
      }).filter((entry) => entry.leader);

      typeData.scopes[scope] = {
        leaders,
        categoryPoints,
        categoryBreakdown
      };
    });

    return typeData;
  };

  return {
    categories,
    types: {
      team: buildTypeData('team', teamRows),
      athlete: buildTypeData('athlete', athleteRows)
    }
  };
}

function renderCategoryDominance() {
  if (!categoryDominanceData) return;

  const scopeLabels = {
    combined: 'general',
    women: 'mujeres',
    men: 'hombres'
  };
  const entityLabels = {
    team: {
      plural: 'equipos',
      singular: 'lider',
      metricLabel: 'Equipos con puntos',
      detailLabel: 'estilos',
      baseCopy: `puntaje oficial acumulado por equipo hasta el Evento ${RECORDS.validacion.officialUntilEvent}.`,
      empty: 'No hay datos oficiales disponibles para esta combinación.',
      detailEmpty: 'No hay desglose adicional disponible para este líder.'
    },
    athlete: {
      plural: 'personas',
      singular: 'lider',
      metricLabel: 'Personas con puntos',
      detailLabel: 'pruebas',
      baseCopy: `puntaje oficial individual acumulado por participante hasta el Evento ${RECORDS.validacion.officialUntilEvent}. Las postas no suman puntos individuales.`,
      empty: 'No hay participantes con puntos en esta combinación.',
      detailEmpty: 'No hay pruebas con puntaje para este participante en esta categoría.'
    }
  };
  const typeConfig = entityLabels[activeCategoryDominanceType];
  const currentScope = categoryDominanceData.types[activeCategoryDominanceType].scopes[activeCategoryDominanceScope];
  const categories = categoryDominanceData.categories;

  if (!activeCategoryDominanceFilter || !categories.includes(activeCategoryDominanceFilter)) {
    activeCategoryDominanceFilter = categories[0] || '';
  }

  const selected = currentScope.leaders.find((entry) => entry.category === activeCategoryDominanceFilter) || currentScope.leaders[0];
  const summary = document.getElementById('categoryDominanceSummary');
  const note = document.getElementById('categoryDominanceNote');
  const list = document.getElementById('categoryDominanceList');
  const detail = document.getElementById('categoryDominanceDetail');
  const listTitle = document.getElementById('categoryDominanceListTitle');
  const detailTitle = document.getElementById('categoryDominanceDetailTitle');

  summary.innerHTML = currentScope.leaders.map((entry) => `
    <article class="metric-card metric-card-style ${entry.category === activeCategoryDominanceFilter ? 'metric-card-active' : ''}" data-category-card="${entry.category}">
      <span class="metric-label">${entry.category}</span>
      <strong class="metric-value metric-team">${activeCategoryDominanceType === 'team' ? entry.leader.teamName : entry.leader.nombre}</strong>
      <span class="metric-copy">${cleanPoints(entry.leader.points)} pts${entry.runnerUp ? ` · margen ${cleanPoints(entry.leader.points - entry.runnerUp.points)}` : ''}</span>
    </article>
  `).join('');

  summary.querySelectorAll('[data-category-card]').forEach((card) => {
    card.addEventListener('click', () => {
      activeCategoryDominanceFilter = card.dataset.categoryCard;
      const select = document.getElementById('categoryDominanceFilter');
      if (select) select.value = activeCategoryDominanceFilter;
      renderCategoryDominance();
    });
  });

  note.innerHTML = `
    <strong>Base del análisis:</strong> ${typeConfig.baseCopy}
    Usa los filtros para cambiar entre equipos o personas, elegir la categoría y la rama, y ver quién dominó mejor ese tramo de edades.
  `;

  if (!selected) {
    list.innerHTML = `<div class="metrics-note">${typeConfig.empty}</div>`;
    detail.innerHTML = '';
    return;
  }

  listTitle.textContent = `Ranking de ${typeConfig.plural} en ${selected.category}`;
  detailTitle.textContent = `Detalle del ${typeConfig.singular} en ${selected.category}`;

  list.innerHTML = selected.ranking.map((entry, index) => `
    <div class="ranking-row metrics-row ${index === 0 ? 'rk-gold' : index === 1 ? 'rk-silver' : index === 2 ? 'rk-bronze' : ''}">
      <div class="rk-pos">${entry.rank}</div>
      <div class="rk-body">
        <div class="rk-name">${activeCategoryDominanceType === 'team' ? entry.teamName : entry.nombre}</div>
        <div class="rk-events">
          ${activeCategoryDominanceType === 'athlete' ? `${entry.teamName} · ` : ''}${cleanPoints(entry.points)} pts · ${selected.totalPoints ? cleanPoints((entry.points / selected.totalPoints) * 100) : 0}% del total de la categoría
        </div>
      </div>
      <div class="rk-points">
        <span class="rk-pts">${cleanPoints(entry.points)}</span>
        <span class="rk-pts-label">pts</span>
      </div>
    </div>
  `).join('');

  const leaderKey = activeCategoryDominanceType === 'team' ? selected.leader.teamName : selected.leader.nombre;
  const leaderBreakdownMap = currentScope.categoryBreakdown.get(`${selected.category}|${leaderKey}`) || new Map();
  const leaderBreakdown = [...leaderBreakdownMap.entries()]
    .map(([label, points]) => ({ label, points: Number(cleanPoints(points)) }))
    .sort((a, b) => b.points - a.points || a.label.localeCompare(b.label, 'es'));

  detail.innerHTML = `
    <div class="metric-style-card">
      <div class="metric-style-head">
        <span class="metric-style-name">${activeCategoryDominanceType === 'team' ? selected.leader.teamName : selected.leader.nombre}</span>
        <span class="metric-style-badge">${scopeLabels[activeCategoryDominanceScope]}</span>
      </div>
      ${activeCategoryDominanceType === 'athlete' ? `<div class="metrics-note metrics-note-inline">${selected.leader.teamName}</div>` : ''}
      <div class="metrics-grid metrics-grid-compact">
        <article class="metric-card">
          <span class="metric-label">Puntos del lider</span>
          <strong class="metric-value">${cleanPoints(selected.leader.points)}</strong>
          <span class="metric-copy">Sobre ${cleanPoints(selected.totalPoints)} pts repartidos en ${selected.category}.</span>
        </article>
        <article class="metric-card">
          <span class="metric-label">${typeConfig.metricLabel}</span>
          <strong class="metric-value">${selected.entitiesWithPoints}</strong>
          <span class="metric-copy">${typeConfig.plural.charAt(0).toUpperCase() + typeConfig.plural.slice(1)} que puntuaron en esta categoría.</span>
        </article>
      </div>
      <div class="metric-style-list">
        ${leaderBreakdown.length ? leaderBreakdown.map((item, index) => `
          <div class="ranking-row metrics-row">
            <div class="rk-pos">${index + 1}</div>
            <div class="rk-body">
              <div class="rk-name">${item.label}</div>
              <div class="rk-events">${cleanPoints(item.points)} pts en ${typeConfig.detailLabel} dentro de ${selected.category}</div>
            </div>
          </div>
        `).join('') : `<div class="metrics-note">${typeConfig.detailEmpty}</div>`}
      </div>
    </div>
  `;
}

function getHeatmapCellStyle(value, maxValue, hue) {
  if (!value || !maxValue) return 'background: rgba(226,232,240,.35); color: #64748b;';
  const alpha = 0.16 + (value / maxValue) * 0.74;
  return `background: hsla(${hue}, 82%, 46%, ${alpha}); color: ${alpha > 0.6 ? '#ffffff' : '#082f49'};`;
}

function renderHeatmap(containerId, teams, columns, matrix, hue) {
  const target = document.getElementById(containerId);
  const values = teams.flatMap((team) => columns.map((column) => matrix.get(team)?.get(column) || 0));
  const maxValue = Math.max(...values, 0);

  target.innerHTML = `
    <div class="heatmap-table-wrap">
      <table class="heatmap-table">
        <thead>
          <tr>
            <th>Equipo</th>
            ${columns.map((column) => `<th>${column}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${teams.map((team) => `
            <tr>
              <th>${team}</th>
              ${columns.map((column) => {
                const value = matrix.get(team)?.get(column) || 0;
                return `<td style="${getHeatmapCellStyle(value, maxValue, hue)}">${value ? cleanPoints(value) : '—'}</td>`;
              }).join('')}
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderHeatmaps(rows) {
  const metricData = buildOfficialTeamMetricData(rows);
  document.getElementById('styleHeatmapNote').innerHTML = `
    <strong>Heatmap equipo × estilo:</strong> muestra dónde se concentra el puntaje oficial de todos los equipos con puntaje.
    Más color significa más dominio relativo en ese estilo.
  `;
  document.getElementById('categoryHeatmapNote').innerHTML = `
    <strong>Heatmap equipo × categoría:</strong> deja ver en qué edades están construyendo más puntaje todos los equipos con puntaje.
    Está basado en el acumulado oficial actual, no en la simulación de menores.
  `;
  renderHeatmap('styleHeatmap', metricData.topTeams, metricData.activeStyles, metricData.styleMatrix, 198);
  renderHeatmap('categoryHeatmap', metricData.topTeams, metricData.categories, metricData.categoryMatrix, 27);
  initHeatmapDragScroll();
}

function initHeatmapDragScroll() {
  document.querySelectorAll('.heatmap-table-wrap').forEach((wrap) => {
    if (wrap.dataset.dragReady === 'true') return;

    let isPointerDown = false;
    let startX = 0;
    let startScrollLeft = 0;

    wrap.dataset.dragReady = 'true';

    wrap.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      isPointerDown = true;
      startX = event.clientX;
      startScrollLeft = wrap.scrollLeft;
      wrap.classList.add('is-dragging');
      wrap.setPointerCapture?.(event.pointerId);
    });

    wrap.addEventListener('pointermove', (event) => {
      if (!isPointerDown) return;
      const deltaX = event.clientX - startX;
      wrap.scrollLeft = startScrollLeft - deltaX;
    });

    const stopDragging = (event) => {
      if (!isPointerDown) return;
      isPointerDown = false;
      wrap.classList.remove('is-dragging');
      if (event?.pointerId !== undefined) {
        try {
          wrap.releasePointerCapture?.(event.pointerId);
        } catch {
          // ignore browsers that already released capture
        }
      }
    };

    wrap.addEventListener('pointerup', stopDragging);
    wrap.addEventListener('pointercancel', stopDragging);
    wrap.addEventListener('pointerleave', (event) => {
      if (event.pointerType === 'mouse') stopDragging(event);
    });
  });
}

function buildMedallero(rows) {
  const medalists = new Map();
  const ensureEntry = (nombre, equipo, teamName, genero, entityType = 'athlete') => {
    const key = `${entityType}|${nombre}|${equipo}`;
    if (!medalists.has(key)) {
      medalists.set(key, {
        nombre,
        equipo,
        teamName: teamName || equipo,
        genero,
        entityType,
        gold: 0,
        silver: 0,
        bronze: 0,
        total: 0
      });
    }
    return medalists.get(key);
  };

  rows.forEach((row) => {
    if (row.dq || row.ns || row.nt || row.exhibition || ![1, 2, 3].includes(row.pos)) return;

    const addMedal = (athlete) => {
      if (row.pos === 1) athlete.gold += 1;
      if (row.pos === 2) athlete.silver += 1;
      if (row.pos === 3) athlete.bronze += 1;
      athlete.total += 1;
    };

    if (row.relay && Array.isArray(row.integrantes) && row.integrantes.length) {
      const teamEntry = ensureEntry(
        row.teamName || row.nombre,
        row.equipo,
        row.teamName || row.equipo,
        row.genero,
        'team'
      );
      addMedal(teamEntry);

      row.integrantes.forEach((item) => {
        const athlete = ensureEntry(
          item.nombre,
          row.equipo,
          row.teamName || row.equipo,
          item.genero || row.genero,
          'athlete'
        );
        addMedal(athlete);
      });
      return;
    }

    const athlete = ensureEntry(row.nombre, row.equipo, row.teamName || row.equipo, row.genero, 'athlete');
    addMedal(athlete);
  });

  return [...medalists.values()].sort((a, b) => (
    b.gold - a.gold
    || b.silver - a.silver
    || b.bronze - a.bronze
    || b.total - a.total
    || a.nombre.localeCompare(b.nombre, 'es')
  ));
}

function renderMedallero(rows) {
  const list = document.getElementById('medalleroList');
  const info = document.getElementById('medalleroInfo');
  const medallero = buildMedallero(rows).filter((athlete) => (
    (activeMedalleroType === 'all' || athlete.entityType === activeMedalleroType)
    && (
    !activeMedalBuscar
    || athlete.nombre.toLowerCase().includes(activeMedalBuscar)
    || athlete.teamName.toLowerCase().includes(activeMedalBuscar)
    || athlete.equipo.toLowerCase().includes(activeMedalBuscar)
    )
  ));

  info.textContent = `${medallero.length} registro${medallero.length !== 1 ? 's' : ''} con medallas`;
  list.innerHTML = '';

  if (!medallero.length) {
    list.innerHTML = `
      <div class="no-results">
        <div class="no-results-icon">🔍</div>
        <p>No hay concursantes que coincidan con la búsqueda</p>
      </div>`;
    return;
  }

  medallero.forEach((athlete) => {
    const card = document.createElement('div');
    card.className = 'ranking-row medallero-row';
    card.innerHTML = `
      <div class="rk-body">
        <div class="rk-name">${athlete.nombre}</div>
        <div class="rk-events"><span class="equipo-tag">${athlete.equipo}</span> · ${athlete.entityType === 'team' ? 'Equipo' : athlete.genero}</div>
      </div>
      <div class="medal-summary">
        <span class="medal-pill gold">🥇 ${athlete.gold}</span>
        <span class="medal-pill silver">🥈 ${athlete.silver}</span>
        <span class="medal-pill bronze">🥉 ${athlete.bronze}</span>
      </div>
    `;
    list.appendChild(card);
  });
}

function initMedalleroSwitch() {
  const buttons = document.querySelectorAll('[data-medallero-target]');
  buttons.forEach((button) => {
    button.addEventListener('click', () => {
      activeMedalleroType = button.dataset.medalleroTarget;
      buttons.forEach((node) => node.classList.remove('active'));
      button.classList.add('active');
      renderMedallero(allData);
    });
  });
}

function initRankingSwitch() {
  const buttons = document.querySelectorAll('[data-ranking-target]');
  const panels = document.querySelectorAll('[data-ranking-panel]');

  buttons.forEach((button) => {
    button.addEventListener('click', () => {
      const target = button.dataset.rankingTarget;
      buttons.forEach((node) => node.classList.remove('active'));
      panels.forEach((panel) => panel.classList.toggle('active', panel.dataset.rankingPanel === target));
      button.classList.add('active');
    });
  });
}

function initRankingTypeSwitch() {
  const buttons = document.querySelectorAll('[data-ranking-type]');
  buttons.forEach((button) => {
    button.addEventListener('click', () => {
      activeRankingType = button.dataset.rankingType;
      buttons.forEach((node) => node.classList.remove('active'));
      button.classList.add('active');
      syncRankingView();
    });
  });
}

function initMetricsSwitch() {
  const buttons = document.querySelectorAll('.metrics-switch-btn');
  const panels = document.querySelectorAll('.metrics-block');

  buttons.forEach((button) => {
    button.addEventListener('click', () => {
      const target = button.dataset.metricsTarget;
      buttons.forEach((node) => node.classList.remove('active'));
      panels.forEach((panel) => panel.classList.toggle('active', panel.dataset.metricsPanel === target));
      button.classList.add('active');
    });
  });
}

function initMetricViewSwitch() {
  const buttons = document.querySelectorAll('.metrics-view-btn');
  const panels = document.querySelectorAll('[data-metric-panel]');

  buttons.forEach((button) => {
    button.addEventListener('click', () => {
      const target = button.dataset.metricView;
      buttons.forEach((node) => node.classList.remove('active'));
      panels.forEach((panel) => panel.classList.toggle('active', panel.dataset.metricPanel === target));
      button.classList.add('active');
    });
  });
}

function initCategoryDominanceControls() {
  const select = document.getElementById('categoryDominanceFilter');
  const typeButtons = document.querySelectorAll('.category-type-btn');
  const buttons = document.querySelectorAll('.category-scope-btn');

  if (select) {
    const categories = categoryDominanceData?.categories || [];
    select.innerHTML = categories.map((category) => `<option value="${category}">${category}</option>`).join('');
    if (activeCategoryDominanceFilter && categories.includes(activeCategoryDominanceFilter)) {
      select.value = activeCategoryDominanceFilter;
    } else if (categories.length) {
      activeCategoryDominanceFilter = categories[0];
      select.value = activeCategoryDominanceFilter;
    }

    select.addEventListener('change', (event) => {
      activeCategoryDominanceFilter = event.target.value;
      renderCategoryDominance();
    });
  }

  buttons.forEach((button) => {
    button.addEventListener('click', () => {
      activeCategoryDominanceScope = button.dataset.categoryScope;
      buttons.forEach((node) => node.classList.remove('active'));
      button.classList.add('active');
      renderCategoryDominance();
    });
  });

  typeButtons.forEach((button) => {
    button.addEventListener('click', () => {
      activeCategoryDominanceType = button.dataset.categoryType;
      typeButtons.forEach((node) => node.classList.remove('active'));
      button.classList.add('active');
      renderCategoryDominance();
    });
  });
}

function initStyleDominanceControls() {
  const buttons = document.querySelectorAll('.style-type-btn');
  buttons.forEach((button) => {
    button.addEventListener('click', () => {
      activeStyleDominanceType = button.dataset.styleType;
      buttons.forEach((node) => node.classList.remove('active'));
      button.classList.add('active');
      renderStyleMetrics();
    });
  });
}

function init() {
  allData = RECORDS.resultados;
  filtered = [...allData];
  rankingViews = {
    team: {
      combined: RECORDS.rankingsOficiales.combined,
      women: RECORDS.rankingsOficiales.women,
      men: RECORDS.rankingsOficiales.men
    },
    athlete: buildAthleteRankingData(allData)
  };

  renderStats(allData);
  renderDatasetCopy(allData);
  buildFilterOptions(allData);
  initTabs();
  initCategoryPills(allData);
  renderPodios(allData);
  renderResults();
  updateResultsInfo();
  syncRankingView(allData.length);
  renderMedallero(allData);
  renderMetrics(allData);
  initRankingSwitch();
  initRankingTypeSwitch();
  initMetricsSwitch();
  initMetricViewSwitch();
  initStyleDominanceControls();
  initCategoryDominanceControls();
  initMedalleroSwitch();
  schedulePromoPopup();

  document.getElementById('filterBuscar').addEventListener('input', (event) => {
    activeBuscar = event.target.value.trim().toLowerCase();
    applyFilters();
  });

  document.getElementById('filterToggleBtn').addEventListener('click', () => {
    if (!isDesktop()) openSheet();
  });

  document.getElementById('medalBuscar').addEventListener('input', (event) => {
    activeMedalBuscar = event.target.value.trim().toLowerCase();
    renderMedallero(allData);
  });

  document.getElementById('sheetClose').addEventListener('click', closeSheet);
  document.getElementById('sheetBackdrop').addEventListener('click', closeSheet);
  document.getElementById('btnApply').addEventListener('click', applySheetFilters);
  document.getElementById('btnClear').addEventListener('click', clearSheetFilters);
  document.getElementById('promoPopupClose').addEventListener('click', closePromoPopup);
  document.getElementById('promoPopupDismiss').addEventListener('click', closePromoPopup);
  document.getElementById('promoPopupBackdrop').addEventListener('click', closePromoPopup);
  document.getElementById('promoPopupLink').addEventListener('click', () => {
    closePromoPopup();
  });

  ['filterSesion', 'filterGenero', 'filterPrueba', 'filterCategoria', 'filterEquipo'].forEach((id) => {
    document.getElementById(id).addEventListener('change', () => {
      if (isDesktop()) applySheetFilters();
    });
  });

  document.getElementById('clearAllLink').addEventListener('click', () => {
    document.getElementById('filterBuscar').value = '';
    activeBuscar = '';
    clearSheetFilters();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closePromoPopup();
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && shouldShowPromoPopup() && promoPopupTimer === null) {
      schedulePromoPopup();
    }
  });
}

document.addEventListener('DOMContentLoaded', init);

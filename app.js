'use strict';

const RECORDS = window.DEPORCLUB_RECORDS || window.RECORDS || {
  meta: {},
  validacion: {},
  resultados: []
};

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
let activePodioCategoria = 'all';
let activeMedalBuscar = '';
let activeMedalleroType = 'all';
let activeRankingType = 'athlete';
let activeRankingScope = 'categories';
let activeRankingSession = 'all';
let activeRankingCategory = 'all';
let activeIndividualScope = 'categories';
let activeStyleDominanceType = 'athlete';
let activeStyleDominanceFilter = '';
let activeCategoryDominanceScope = 'combined';
let activeCategoryDominanceFilter = '';
let activeCategoryDominanceType = 'athlete';
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
function getSessionPillLabel(sessionName) {
  return sessionName;
}

function getDisplayGroup(value) {
  return value === 'Absoluto' ? 'Todos' : value;
}

function getCategorySortRank(category) {
  return category === 'Absoluto' ? 999 : 0;
}

function isRealCategory(value) {
  return value && value !== 'Absoluto';
}

function getPrimaryCategory(rows) {
  const counts = new Map();
  rows
    .filter((row) => !row.relay && isRealCategory(row.categoria))
    .forEach((row) => counts.set(row.categoria, (counts.get(row.categoria) || 0) + 1));

  const preferred = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'es'))[0]?.[0];

  return preferred || rows.find((row) => row.categoria)?.categoria || '';
}

function getDisplayCategoryForRow(row) {
  if (!row || row.relay || isRealCategory(row.categoria)) return row?.categoria || '';
  const athleteKey = normalizeAthleteName(row.nombre);
  const matchingRows = allData.filter((item) => (
    !item.relay
    && normalizeAthleteName(item.nombre) === athleteKey
    && isRealCategory(item.categoria)
  ));
  const matchingSameRace = matchingRows.find((item) => (
    item.prueba === row.prueba
    && item.tiempo === row.tiempo
    && item.sesionNombre === row.sesionNombre
  ));
  return matchingSameRace?.categoria || getPrimaryCategory(matchingRows) || row.categoria;
}

function getSwimKey(row) {
  return [
    normalizeAthleteName(row.nombre),
    row.sesionNombre,
    row.genero,
    row.prueba,
    row.tiempo
  ].join('|');
}

function findLinkedScoreRow(row, category) {
  const key = getSwimKey(row);
  return allData.find((item) => (
    !item.relay
    && item.categoria === category
    && getSwimKey(item) === key
  ));
}

function getCategoryScoreRow(row) {
  return isRealCategory(row.categoria) ? row : findLinkedScoreRow(row, getDisplayCategoryForRow(row));
}

function getAbsoluteScoreRow(row) {
  return row.categoria === 'Absoluto' ? row : findLinkedScoreRow(row, 'Absoluto');
}

function getPhysicalResultRows(rows) {
  const bySwim = new Map();
  rows
    .filter((row) => !row.relay)
    .forEach((row) => {
      const key = getSwimKey(row);
      const current = bySwim.get(key);
      if (!current || (current.categoria === 'Absoluto' && isRealCategory(row.categoria))) {
        bySwim.set(key, row);
      }
    });

  return [...bySwim.values()];
}

const isDesktop = () => window.innerWidth >= 768;

function syncBodyScrollLock() {
  const hasOpenOverlay = document.getElementById('filterSheet')?.classList.contains('open')
    || document.getElementById('promoPopup')?.classList.contains('open')
    || document.getElementById('athleteDetailModal')?.classList.contains('open');
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
  const turno = row.turno ? `${row.turno} · ` : '';
  if (row.edad === null || row.edad === undefined || row.edad === '') return `${turno}${row.puntos} pts`;
  return `${turno}${row.edad} años · ${row.puntos} pts`;
}

function getResultSecondaryMeta(row) {
  const turno = row.turno ? ` · ${row.turno}` : '';
  if (!row.relay || !Array.isArray(row.integrantes) || !row.integrantes.length) return `${row.genero} · ${row.sesionNombre}${turno}`;
  return `Relevo ${row.relayLabel} · ${row.integrantes.map((item) => item.nombre).join(' / ')}`;
}
function getAthleteAction(name, label = name) {
  return `<button class="athlete-link" type="button" data-athlete-name="${name}">${label}</button>`;
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
    opt.textContent = id === 'filterEquipo' ? getDisplayGroup(value) : value;
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
  document.getElementById('statCategorias').textContent = RECORDS.meta.categorias;
  document.getElementById('statPruebas').textContent = RECORDS.meta.eventos;
  document.getElementById('headerSub').textContent = `${RECORDS.meta.fechas} · ${RECORDS.meta.sesion}`;
}

function getScoringRows(data) {
  return data.filter((row) => (
    !row.relay
    && !row.dq
    && !row.ns
    && !row.nt
    && !row.exhibition
    && Number(row.puntosOficiales || row.puntos || 0) > 0
  ));
}

function getLatestSessionName(data) {
  const latest = [...data]
    .filter((row) => row.sesionNombre)
    .sort((a, b) => Number(b.sesion || 0) - Number(a.sesion || 0))[0];
  return latest?.sesionNombre || 'all';
}

function getTournamentScope(row) {
  return row?.categoria === 'Absoluto' ? 'absolute' : 'categories';
}

function getTournamentScopeLabel(scope) {
  return scope === 'absolute' ? 'Absoluto' : 'Categorías';
}

function getStyleSummaryFromMap(styles, limit = 3) {
  return [...styles.entries()]
    .map(([style, points]) => ({ style, points: Number(cleanPoints(points)) }))
    .filter((entry) => entry.points > 0)
    .sort((a, b) => b.points - a.points || a.style.localeCompare(b.style, 'es'))
    .slice(0, limit);
}

function renderStyleChips(styles, extraClass = '') {
  const summary = Array.isArray(styles) ? styles : getStyleSummaryFromMap(styles || new Map());
  if (!summary.length) return '';
  return `
    <div class="event-meta-chips ${extraClass}">
      ${summary.map((entry) => `
        <span class="event-chip event-chip-style ${getStyleClass(entry.style)}-chip">${getStyleIcon(entry.style)} ${entry.style}</span>
      `).join('')}
    </div>
  `;
}

function buildSessionAthleteTotals(rows, options = {}) {
  const scope = options.scope || 'all';
  const athletes = new Map();
  rows
    .filter((row) => scope === 'all' || getTournamentScope(row) === scope)
    .forEach((row) => {
    const key = normalizeAthleteName(row.nombre);
    if (!key) return;
    if (!athletes.has(key)) {
      athletes.set(key, {
        nombre: row.nombre,
        categoria: getDisplayCategoryForRow(row),
        scope: getTournamentScope(row),
        points: 0,
        styles: new Map(),
        swims: new Set(),
        tests: new Set(),
        sessionName: row.sesionNombre
      });
    }
    const athlete = athletes.get(key);
    const points = Number(row.puntosOficiales || row.puntos || 0);
    const style = getMetricStyle(row);
    athlete.points += points;
    athlete.styles.set(style, (athlete.styles.get(style) || 0) + points);
    athlete.swims.add(getSwimKey(row));
    athlete.tests.add(row.prueba);
    if (!isRealCategory(athlete.categoria) && isRealCategory(row.categoria)) athlete.categoria = row.categoria;
  });

  return [...athletes.values()].map((entry) => ({
    ...entry,
    styleSummary: getStyleSummaryFromMap(entry.styles),
    swimCount: entry.swims.size,
    testCount: entry.tests.size
  }));
}

function getSessionLeader(rows, scope = 'categories') {
  return buildSessionAthleteTotals(rows, { scope })
    .sort((a, b) => (
      b.points - a.points
      || b.swimCount - a.swimCount
      || a.nombre.localeCompare(b.nombre, 'es')
    ))[0] || null;
}

function buildSecretCards(data) {
  const scoringRows = data.filter((row) => (
    !row.relay
    && !row.dq
    && !row.ns
    && !row.nt
    && !row.exhibition
    && Number(row.puntosOficiales || row.puntos || 0) > 0
  ));
  const latestSession = Math.max(...scoringRows.map((row) => Number(row.sesion || 0)));
  const latestRows = scoringRows.filter((row) => Number(row.sesion) === latestSession);
  const previousRows = scoringRows.filter((row) => Number(row.sesion) < latestSession);
  const scopes = ['categories', 'absolute'];
  const latestLeader = scopes
    .map((scope) => getSessionLeader(latestRows, scope))
    .filter(Boolean)
    .sort((a, b) => (
      b.points - a.points
      || b.swimCount - a.swimCount
      || a.scope.localeCompare(b.scope, 'es')
      || a.nombre.localeCompare(b.nombre, 'es')
    ))[0] || null;
  const revelation = scopes
    .flatMap((scope) => {
      const previousTotals = buildSessionAthleteTotals(previousRows, { scope }).reduce((map, athlete) => {
        map.set(normalizeAthleteName(athlete.nombre), athlete.points);
        return map;
      }, new Map());
      return buildSessionAthleteTotals(latestRows, { scope }).map((athlete) => ({
        ...athlete,
        previousPoints: previousTotals.get(normalizeAthleteName(athlete.nombre)) || 0
      }));
    })
    .sort((a, b) => (
      (b.points - b.previousPoints * .15) - (a.points - a.previousPoints * .15)
      || a.previousPoints - b.previousPoints
      || a.scope.localeCompare(b.scope, 'es')
      || a.nombre.localeCompare(b.nombre, 'es')
    ))[0] || null;

  return [
    {
      icon: '🎯',
      label: 'Última fecha',
      title: latestLeader ? `${latestLeader.sessionName}: ${latestLeader.nombre}` : 'Sin líder disponible',
      copy: latestLeader
        ? `${latestLeader.nombre} fue quien más sumó en ${getTournamentScopeLabel(latestLeader.scope)} durante la última fecha: ${cleanPoints(latestLeader.points)} puntos.`
        : 'Aún no hay suficientes puntos oficiales para revelar esta carta.',
      styles: latestLeader?.styleSummary || []
    },
    {
      icon: '⚡',
      label: 'Top revelación',
      title: revelation ? revelation.nombre : 'Sin revelación disponible',
      copy: revelation
        ? `${revelation.nombre} explotó en ${getTournamentScopeLabel(revelation.scope)} con ${cleanPoints(revelation.points)} puntos. Antes traía ${cleanPoints(revelation.previousPoints)} puntos en ese mismo torneo.`
        : 'Aún no hay suficiente historial para calcular la revelación.',
      styles: revelation?.styleSummary || []
    }
  ];
}

function renderLaneSecret(data) {
  const grid = document.getElementById('secretCardGrid');
  if (!grid) return;

  grid.innerHTML = buildSecretCards(data).map((card, index) => `
    <button class="secret-card" type="button" data-secret-card="${index}" aria-expanded="false">
      <span class="secret-card-top">
        <span>
          <span class="secret-card-label">${card.label}</span>
        </span>
        <span class="secret-card-icon">${card.icon}</span>
      </span>
      <strong class="secret-card-title">${card.title}</strong>
      <span class="secret-card-copy">${card.copy}</span>
      ${renderStyleChips(card.styles, 'secret-card-chips')}
      <span class="secret-card-cta">Revelar</span>
    </button>
  `).join('');

  grid.addEventListener('click', (event) => {
    const card = event.target.closest('[data-secret-card]');
    if (!card || !grid.contains(card)) return;
    const revealed = card.classList.toggle('is-revealed');
    card.setAttribute('aria-expanded', String(revealed));
    card.querySelector('.secret-card-cta').textContent = revealed ? 'Revelado' : 'Revelar';
  });
}

function renderDatasetCopy(data) {
  const rankingSubtitle = document.getElementById('rankingSubtitle');
  const medalleroSubtitle = document.getElementById('medalleroSubtitle');
  updateRankingCopy(data.length);

  if (medalleroSubtitle) {
    medalleroSubtitle.textContent = `Medallas acumuladas por persona hasta el Evento ${RECORDS.meta.eventos}`;
  }
}

function updateRankingCopy(processedRows = allData.length) {
  const rankingSubtitle = document.getElementById('rankingSubtitle');
  const officialUntilEvent = RECORDS.validacion?.officialUntilEvent || RECORDS.meta.eventos;
  const corte = RECORDS.validacion?.provisional ? 'Corte preliminar' : 'Acumulado oficial';
  const tournamentLabel = activeRankingScope === 'absolute' ? 'torneo Absoluto' : 'torneo por Categorias';
  const sessionLabel = activeRankingSession === 'all' ? 'todas las fechas' : activeRankingSession;
  const categoryLabel = activeRankingScope === 'absolute'
    ? ''
    : activeRankingCategory === 'all'
      ? ' · todas las categorias'
      : ` · ${activeRankingCategory}`;

  if (!rankingSubtitle) return;

  rankingSubtitle.textContent = `${corte} del ${tournamentLabel} · ${sessionLabel}${categoryLabel} · hasta el Evento ${officialUntilEvent} · las postas no suman puntos individuales`;
}

function updateRankingHeadings() {
  const tournamentLabel = activeRankingScope === 'absolute' ? 'Absoluto' : 'Categorias';
  const sessionLabel = activeRankingSession === 'all' ? 'todas las fechas' : activeRankingSession;
  const categoryLabel = activeRankingScope === 'absolute'
    ? ''
    : activeRankingCategory === 'all'
      ? ''
      : ` · ${activeRankingCategory}`;
  const labels = {
    combined: `${tournamentLabel}${categoryLabel} · general · ${sessionLabel}`,
    women: `${tournamentLabel}${categoryLabel} · mujeres · ${sessionLabel}`,
    men: `${tournamentLabel}${categoryLabel} · hombres · ${sessionLabel}`
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
  document.getElementById('filterToggleBtn')?.classList.add('is-open');
  if (!isDesktop()) document.getElementById('sheetBackdrop').classList.add('open');
  syncBodyScrollLock();
}

function closeSheet() {
  document.getElementById('filterSheet').classList.remove('open');
  document.getElementById('filterToggleBtn')?.classList.remove('is-open');
  document.getElementById('sheetBackdrop').classList.remove('open');
  syncBodyScrollLock();
}

function toggleSheet() {
  if (document.getElementById('filterSheet').classList.contains('open')) closeSheet();
  else openSheet();
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
  closeSheet();
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
  closeSheet();
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
  const categoryContainer = document.getElementById('categoryPills');
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
  const latestSessionLabel = sessionPills[sessionPills.length - 1]?.[0] || 'all';
  activePodioSesion = latestSessionLabel;

  const genderPills = [
    { label: 'Todas', value: 'all' },
    ...[...new Set(data.map((row) => row.genero))]
      .sort((a, b) => a.localeCompare(b, 'es'))
      .map((gender) => ({ label: gender, value: gender }))
  ];

  const categoryPills = [
    { label: 'Todas', value: 'all' },
    ...[...new Set(data.map((row) => row.categoria))]
      .sort((a, b) => (
        getCategorySortRank(a) - getCategorySortRank(b)
        || a.localeCompare(b, 'es')
      ))
      .map((category) => ({ label: category, value: category }))
  ];

  datePills.forEach((pill) => {
    const btn = document.createElement('button');
    btn.className = `pill-btn podio-date-btn${pill.value === activePodioSesion ? ' active' : ''}`;
    btn.textContent = pill.label;
    btn.addEventListener('click', () => {
      document.querySelectorAll('.podio-date-btn').forEach((node) => node.classList.remove('active'));
      btn.classList.add('active');
      activePodioSesion = pill.value;
      renderPodios(data, activePodioSesion, activePodioGenero, activePodioCategoria);
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
      renderPodios(data, activePodioSesion, activePodioGenero, activePodioCategoria);
    });
    genderContainer.appendChild(btn);
  });

  categoryPills.forEach((pill, index) => {
    const btn = document.createElement('button');
    btn.className = `pill-btn podio-category-btn${index === 0 ? ' active' : ''}`;
    btn.textContent = pill.label;
    btn.addEventListener('click', () => {
      document.querySelectorAll('.podio-category-btn').forEach((node) => node.classList.remove('active'));
      btn.classList.add('active');
      activePodioCategoria = pill.value;
      renderPodios(data, activePodioSesion, activePodioGenero, activePodioCategoria);
    });
    categoryContainer.appendChild(btn);
  });
}

function renderPodios(data, sessionFilter = 'all', genderFilter = 'all', categoryFilter = 'all') {
  const grid = document.getElementById('podiosGrid');
  grid.innerHTML = '';

  const grouped = new Map();
  data.forEach((row) => {
    if (sessionFilter !== 'all' && getSessionPillLabel(row.sesionNombre) !== sessionFilter) return;
    if (genderFilter !== 'all' && row.genero !== genderFilter) return;
    if (categoryFilter !== 'all' && row.categoria !== categoryFilter) return;
    const key = `${row.evento}|${row.genero}|${row.prueba}|${row.categoria}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  });

  [...grouped.values()]
    .sort((a, b) => (
      a[0].evento - b[0].evento
      || getCategorySortRank(a[0].categoria) - getCategorySortRank(b[0].categoria)
      || a[0].categoria.localeCompare(b[0].categoria, 'es')
    ))
    .forEach((rows) => {
      const first = rows[0];
      const recordRefs = getRecordRefs(first);
      const top3 = rows
        .filter((row) => !row.dq && !row.ns && !row.nt && !row.exhibition)
        .sort((a, b) => (a.pos || 999) - (b.pos || 999))
        .slice(0, 3);

      if (!top3.length) return;

      const card = document.createElement('div');
      card.className = `podio-card ${getStyleClass(getMetricStyle(first))}`;
      card.innerHTML = `
        <div class="podio-header">
          <div class="podio-header-title">Evento ${first.evento} · ${first.genero} · ${first.categoria}</div>
          <div class="podio-header-sub">${first.prueba} · ${first.sesionNombre}</div>
          ${getEventMetaChips(first)}
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
                  <div class="place-name">${row.relay ? row.nombre : getAthleteAction(row.nombre)}${badge ? ` <span class="record-pill ${badge.toLowerCase()}">${badgeLabel}</span>` : ''}</div>
                  <div class="place-meta"><span class="equipo-tag">${getDisplayCategoryForRow(row)}</span> · ${getPodioMeta(row)}</div>
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
  document.getElementById('pagination').innerHTML = '';

  if (!filtered.length) {
    list.innerHTML = `
      <div class="no-results">
        <div class="no-results-icon">🔍</div>
        <p>Sin resultados para los filtros aplicados</p>
      </div>`;
    return;
  }

  const grouped = new Map();
  const displayRows = getPhysicalResultRows(filtered);
  displayRows.forEach((row) => {
    const key = `${row.evento}|${row.prueba}|${row.categoria}|${row.genero}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  });

  [...grouped.values()]
    .sort((a, b) => (
      a[0].evento - b[0].evento
      || getCategorySortRank(a[0].categoria) - getCategorySortRank(b[0].categoria)
      || a[0].categoria.localeCompare(b[0].categoria, 'es')
      || a[0].genero.localeCompare(b[0].genero, 'es')
    ))
    .forEach((rows) => {
      const first = rows[0];
      const orderedRows = [...rows].sort((a, b) => (
        (a.pos || 999) - (b.pos || 999)
        || timeToSec(a.tiempo) - timeToSec(b.tiempo)
        || a.nombre.localeCompare(b.nombre, 'es')
      ));
      const card = document.createElement('section');
      card.className = 'result-event-card';

      const rowItems = orderedRows.map((row) => {
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
        const categoryScore = getCategoryScoreRow(row);
        const absoluteScore = getAbsoluteScoreRow(row);
        const scoreLabels = [
          categoryScore ? `<span class="rc-points">Cat ${cleanPoints(categoryScore.puntos)} pts</span>` : '',
          absoluteScore ? `<span class="rc-points rc-points-absolute">Abs ${cleanPoints(absoluteScore.puntos)} pts</span>` : ''
        ].filter(Boolean).join('');
        return `
          <div class="result-event-row ${row.dq ? 'is-dq' : row.ns ? 'is-ns' : ''}">
            <div class="rc-pos ${posClass}">${posLabel}</div>
            <div class="result-event-athlete">
              <div class="rc-name">${row.relay ? row.nombre : getAthleteAction(row.nombre)}${statusTag(row)}</div>
              <div class="rc-submeta">${row.turno || row.sesionNombre}</div>
            </div>
            <div class="result-event-marks">
              <span class="rc-time${recordBadge ? ' record-time' : ''}">${row.displayTime}</span>
              ${recordBadge ? `<span class="rc-record-pill ${recordBadge.toLowerCase()}">${recordBadge}</span>` : ''}
              ${scoreLabels}
            </div>
          </div>
        `;
      }).join('');

      card.innerHTML = `
        <div class="result-event-head">
          <div>
            <div class="podio-header-title">Evento ${first.evento} · ${first.prueba}</div>
            <div class="podio-header-sub">${first.categoria} · ${first.genero}</div>
          </div>
          <span class="result-event-count">${orderedRows.length} nadador${orderedRows.length !== 1 ? 'es' : ''}</span>
        </div>
        <div class="result-event-rows">${rowItems}</div>
      `;
      list.appendChild(card);
    });
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

function getStyleClass(style) {
  return `style-${normalizeAthleteName(style).replace(/\s+/g, '-') || 'otros'}`;
}

function getStyleIcon(style) {
  const icons = {
    Libre: '🌊',
    Espalda: '↩',
    Pecho: '💪',
    Mariposa: '🦋',
    Combinado: '🎲',
    Relevos: '🤝',
    Otros: '🏊'
  };
  return icons[style] || icons.Otros;
}

function renderRankingEntry(entry, index, mode = 'team', isPodium = false) {
  const title = mode === 'team' ? getDisplayGroup(entry.teamName) : getAthleteAction(entry.nombre);
  const style = entry.dominantStyle || 'Otros';
  const meta = mode === 'athlete'
    ? `<span class="equipo-tag">${getDisplayGroup(entry.teamName)}</span> · ${entry.swimCount || 0} prueba${entry.swimCount !== 1 ? 's' : ''}`
    : '';
  return `
    <div class="${isPodium ? 'ranking-podium-card' : 'ranking-row'} ${getStyleClass(style)} ${index === 0 ? 'rk-gold' : index === 1 ? 'rk-silver' : index === 2 ? 'rk-bronze' : ''}">
      <div class="rk-pos">${index < 3 ? ['🥇', '🥈', '🥉'][index] : entry.rank}</div>
      <div class="rk-body">
        <div class="rk-name">${title}</div>
        <div class="rk-events">${meta}</div>
        ${renderStyleChips(entry.styleSummary?.length ? entry.styleSummary : [{ style, points: entry.points }], 'ranking-style-chips')}
      </div>
      <div class="rk-points">
        <span class="rk-pts">${cleanPoints(entry.points)}</span>
        <span class="rk-pts-label">pts</span>
      </div>
    </div>
  `;
}

function renderRankingPodiumGroup(group, index, mode = 'team') {
  const main = group[0];
  const styleTotals = new Map();
  group.forEach((entry) => {
    (entry.styleSummary?.length ? entry.styleSummary : [{ style: entry.dominantStyle || 'Otros', points: entry.points }])
      .forEach((item) => styleTotals.set(item.style, (styleTotals.get(item.style) || 0) + Number(item.points || 0)));
  });
  const styleSummary = getStyleSummaryFromMap(styleTotals);
  const style = styleSummary[0]?.style || main?.dominantStyle || 'Otros';
  const medal = ['🥇', '🥈', '🥉'][index];
  const names = group.map((entry) => (mode === 'team' ? getDisplayGroup(entry.teamName) : entry.nombre)).join(' / ');
  const categories = [...new Set(group.map((entry) => getDisplayGroup(entry.teamName)).filter(Boolean))].join(' · ');
  const swimCount = group.reduce((sum, entry) => sum + Number(entry.swimCount || 0), 0);
  return `
    <article class="ranking-podium-card ranking-podium-group ${getStyleClass(style)} ${index === 0 ? 'rk-gold' : index === 1 ? 'rk-silver' : 'rk-bronze'}">
      <div class="rk-pos">${medal}</div>
      <div class="rk-body">
        <div class="rk-name">${names}</div>
        <div class="rk-events">${group.length > 1 ? `${group.length} empatados` : categories}${group.length === 1 && mode === 'athlete' ? ` · ${swimCount} prueba${swimCount !== 1 ? 's' : ''}` : ''}</div>
        ${renderStyleChips(styleSummary, 'ranking-style-chips')}
      </div>
      <div class="rk-points">
        <span class="rk-pts">${cleanPoints(main.points)}</span>
        <span class="rk-pts-label">pts</span>
      </div>
    </article>
  `;
}

function getRankingPodiumGroups(rows) {
  const groups = new Map();
  rows.forEach((entry) => {
    const key = cleanPoints(entry.points);
    if (!groups.has(key)) groups.set(key, { points: Number(entry.points), items: [] });
    groups.get(key).items.push(entry);
  });
  return [...groups.values()].sort((a, b) => b.points - a.points).slice(0, 3);
}

function renderRankingList(targetId, rows, mode = 'team') {
  const list = document.getElementById(targetId);
  list.innerHTML = '';
  if (!rows.length) {
    list.innerHTML = '<div class="metrics-note">No hay puntos individuales para estos filtros.</div>';
    return;
  }

  const podiumGroups = getRankingPodiumGroups(rows);
  const medalOrder = [1, 0, 2];
  const podiumOrder = medalOrder
    .map((index) => podiumGroups[index])
    .filter(Boolean);
  const podiumNames = new Set(podiumGroups.flatMap((group) => group.items.map((entry) => normalizeAthleteName(entry.nombre || entry.teamName))));
  const rest = rows.filter((entry) => !podiumNames.has(normalizeAthleteName(entry.nombre || entry.teamName)));

  const podium = document.createElement('div');
  podium.className = 'ranking-podium';
  podium.innerHTML = podiumOrder.map((group) => renderRankingPodiumGroup(group.items, podiumGroups.indexOf(group), mode)).join('');
  list.appendChild(podium);

  if (rest.length) {
    const restTitle = document.createElement('div');
    restTitle.className = 'ranking-rest-title';
    restTitle.textContent = 'Ranking completo';
    list.appendChild(restTitle);
  }

  rest.forEach((entry) => {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = renderRankingEntry(entry, Math.min(entry.rank - 1, 99), mode, false).trim();
    list.appendChild(wrapper.firstElementChild);
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

function buildAthleteRankingData(rows, options = {}) {
  const officialUntilEvent = RECORDS.validacion?.officialUntilEvent || RECORDS.meta.eventos;
  const scope = options.scope || 'categories';
  const session = options.session || 'all';
  const category = options.category || 'all';
  const buckets = {
    combined: new Map(),
    women: new Map(),
    men: new Map()
  };

  const ensureAthlete = (scope, nombre, teamName) => {
    const key = normalizeAthleteName(nombre);
    if (!buckets[scope].has(key)) {
      buckets[scope].set(key, { nombre, teamName, points: 0, styles: new Map(), swims: new Set() });
    }
    if (!isRealCategory(buckets[scope].get(key).teamName) && isRealCategory(teamName)) {
      buckets[scope].get(key).teamName = teamName;
    }
    return buckets[scope].get(key);
  };

  rows
    .filter((row) => (
      row.evento <= officialUntilEvent
      && (scope === 'absolute' ? row.categoria === 'Absoluto' : row.categoria !== 'Absoluto')
      && (session === 'all' || row.sesionNombre === session)
      && (scope === 'absolute' || category === 'all' || row.categoria === category)
      && !row.relay
      && Number(row.puntosOficiales || row.puntos || 0) > 0
      && !row.exhibition
      && !row.dq
      && !row.ns
      && !row.nt
    ))
    .forEach((row) => {
      const points = Number(row.puntosOficiales || row.puntos || 0);
      const displayCategory = getDisplayCategoryForRow(row);
      const addRow = (bucketName) => {
        const athlete = ensureAthlete(bucketName, row.nombre, displayCategory);
        const style = getMetricStyle(row);
        athlete.points += points;
        athlete.styles.set(style, (athlete.styles.get(style) || 0) + points);
        athlete.swims.add(getSwimKey(row));
      };
      addRow('combined');
      if (row.genero === 'Damas') addRow('women');
      if (row.genero === 'Varones') addRow('men');
    });

  const rankEntries = (items) => {
    const sorted = [...items.values()]
      .map((item) => {
        const dominantStyle = [...item.styles.entries()]
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'es'))[0]?.[0] || 'Otros';
        return {
          ...item,
          points: Number(cleanPoints(item.points)),
          dominantStyle,
          styleSummary: getStyleSummaryFromMap(item.styles),
          swimCount: item.swims.size
        };
      })
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
  rankingViews = {
    athlete: buildAthleteRankingData(allData, {
      scope: activeRankingScope,
      session: activeRankingSession,
      category: activeRankingCategory
    })
  };

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

function getScoringIndividualRows(rows) {
  return rows.filter((row) => (
    !row.relay
    && (activeIndividualScope === 'absolute' ? row.categoria === 'Absoluto' : row.categoria !== 'Absoluto')
    && Number(row.puntosOficiales || row.puntos || 0) > 0
    && !row.exhibition
    && !row.dq
    && !row.ns
    && !row.nt
  ));
}

function rankByValue(items, valueKey, labelKey = 'nombre') {
  const sorted = [...items].sort((a, b) => (
    b[valueKey] - a[valueKey]
    || String(a[labelKey]).localeCompare(String(b[labelKey]), 'es')
  ));

  let lastValue = null;
  let lastRank = 0;
  return sorted.map((item, index) => {
    const rank = item[valueKey] === lastValue ? lastRank : index + 1;
    lastValue = item[valueKey];
    lastRank = rank;
    return { rank, ...item };
  });
}

function buildIndividualAnalysisData(rows) {
  const athletes = new Map();
  const improvementCandidates = new Map();

  getScoringIndividualRows(rows).forEach((row) => {
    const key = normalizeAthleteName(row.nombre);
    if (!key) return;

    if (!athletes.has(key)) {
      athletes.set(key, {
        nombre: row.nombre,
        teamName: row.categoria,
        genero: row.genero,
        points: 0,
        swims: new Set(),
        tests: new Set(),
        firstPoints: 0,
        fifthPoints: 0,
        sessions: new Map()
      });
    }

    const athlete = athletes.get(key);
    if (!isRealCategory(athlete.teamName) && isRealCategory(row.categoria)) {
      athlete.teamName = row.categoria;
    }
    const points = Number(row.puntosOficiales || row.puntos || 0);
    athlete.points += points;
    athlete.swims.add(getSwimKey(row));
    athlete.tests.add(row.prueba);
    athlete.sessions.set(row.sesionNombre, (athlete.sessions.get(row.sesionNombre) || 0) + points);

    if (row.sesionNombre === 'Primera Fecha') athlete.firstPoints += points;
    if (row.sesionNombre === 'Quinta Fecha') athlete.fifthPoints += points;

    const time = timeToSec(row.tiempo);
    if (Number.isFinite(time) && ['Primera Fecha', 'Quinta Fecha'].includes(row.sesionNombre)) {
      const comparisonKey = `${key}|${row.prueba}`;
      if (!improvementCandidates.has(comparisonKey)) {
        improvementCandidates.set(comparisonKey, {
          athleteKey: key,
          nombre: row.nombre,
          teamName: row.categoria,
          prueba: row.prueba,
          firstTime: Infinity,
          fifthTime: Infinity,
          firstDisplay: '',
          fifthDisplay: ''
        });
      }
      const comparison = improvementCandidates.get(comparisonKey);
      if (row.sesionNombre === 'Primera Fecha' && time < comparison.firstTime) {
        comparison.firstTime = time;
        comparison.firstDisplay = row.displayTime;
      }
      if (row.sesionNombre === 'Quinta Fecha' && time < comparison.fifthTime) {
        comparison.fifthTime = time;
        comparison.fifthDisplay = row.displayTime;
      }
    }
  });

  const bestImprovementByAthlete = new Map();
  [...improvementCandidates.values()]
    .filter((item) => Number.isFinite(item.firstTime) && Number.isFinite(item.fifthTime) && item.fifthTime < item.firstTime)
    .forEach((item) => {
      const improvementPct = Number(cleanPoints(((item.firstTime - item.fifthTime) / item.firstTime) * 100));
      const enriched = {
        ...item,
        improvementPct,
        secondsImproved: Number(cleanPoints(item.firstTime - item.fifthTime))
      };
      const current = bestImprovementByAthlete.get(item.athleteKey);
      if (!current || enriched.improvementPct > current.improvementPct) {
        bestImprovementByAthlete.set(item.athleteKey, enriched);
      }
    });

  const entries = [...athletes.values()].map((athlete) => ({
    ...athlete,
    events: athlete.swims.size,
    points: Number(cleanPoints(athlete.points)),
    pointsPerEvent: Number(cleanPoints(athlete.swims.size ? athlete.points / athlete.swims.size : 0)),
    testsCount: athlete.tests.size,
    firstPoints: Number(cleanPoints(athlete.firstPoints)),
    fifthPoints: Number(cleanPoints(athlete.fifthPoints)),
    improvement: bestImprovementByAthlete.get(normalizeAthleteName(athlete.nombre)) || null
  }));

  const totalRanking = rankByValue(entries, 'points');
  const efficiencyRanking = rankByValue(entries.filter((entry) => entry.events > 0), 'pointsPerEvent');
  const improvementRanking = rankByValue(
    entries
      .filter((entry) => entry.improvement)
      .map((entry) => ({ ...entry, improvementPct: entry.improvement.improvementPct })),
    'improvementPct'
  );
  const topTotal = totalRanking[0] || null;
  const topEfficiency = efficiencyRanking[0] || null;
  const topImprovement = improvementRanking[0] || null;

  return {
    entries,
    totalRanking,
    efficiencyRanking,
    improvementRanking,
    summary: {
      athletes: entries.length,
      totalEvents: entries.reduce((sum, entry) => sum + entry.events, 0),
      topTotal,
      topEfficiency,
      topImprovement
    }
  };
}

function renderIndividualRankingList(targetId, rows, metric) {
  const list = document.getElementById(targetId);
  if (!list) return;

  const topRows = rows.slice(0, 15);
  list.innerHTML = topRows.length ? topRows.map((entry, index) => {
    const value = metric === 'efficiency'
      ? cleanPoints(entry.pointsPerEvent)
      : metric === 'improvement'
        ? `+${cleanPoints(entry.improvementPct)}%`
        : cleanPoints(entry.points);
    const label = metric === 'efficiency'
      ? 'pts/prueba'
      : metric === 'improvement'
        ? 'mejora'
        : 'pts';
    const detail = metric === 'improvement'
      ? `${entry.improvement.prueba} · ${entry.improvement.firstDisplay} a ${entry.improvement.fifthDisplay}`
      : `${entry.events} prueba${entry.events !== 1 ? 's' : ''} tomada${entry.events !== 1 ? 's' : ''} · ${entry.testsCount} tipo${entry.testsCount !== 1 ? 's' : ''} de prueba`;

    return `
      <div class="ranking-row metrics-row ${index === 0 ? 'rk-gold' : index === 1 ? 'rk-silver' : index === 2 ? 'rk-bronze' : ''}" data-athlete-card="${entry.nombre}">
        <div class="rk-pos">${entry.rank}</div>
        <div class="rk-body">
          <div class="rk-name">${entry.nombre}</div>
          <div class="rk-events">${getDisplayGroup(entry.teamName)} · ${detail}</div>
        </div>
        <div class="rk-points">
          <span class="rk-pts">${value}</span>
          <span class="rk-pts-label">${label}</span>
        </div>
      </div>
    `;
  }).join('') : '<div class="metrics-note">No hay datos suficientes para este analisis.</div>';

  list.querySelectorAll('[data-athlete-card]').forEach((card) => {
    card.addEventListener('click', () => openAthleteDetail(card.dataset.athleteCard));
  });
}

function renderIndividualAnalysis(rows) {
  const analysis = buildIndividualAnalysisData(rows);
  const summary = document.getElementById('individualSummary');
  const note = document.getElementById('individualNote');
  if (!summary || !note) return;

  summary.innerHTML = `
    <article class="metric-card">
      <span class="metric-label">Atletas unicos</span>
      <strong class="metric-value">${analysis.summary.athletes}</strong>
      <span class="metric-copy">Participantes individuales con resultados validos y puntaje.</span>
    </article>
    <article class="metric-card">
      <span class="metric-label">Pruebas tomadas</span>
      <strong class="metric-value">${analysis.summary.totalEvents}</strong>
      <span class="metric-copy">Salidas individuales puntuables acumuladas en las 5 fechas.</span>
    </article>
    <article class="metric-card">
      <span class="metric-label">Mayor puntaje</span>
      <strong class="metric-value metric-team">${analysis.summary.topTotal?.nombre || '-'}</strong>
      <span class="metric-copy">${analysis.summary.topTotal ? `${cleanPoints(analysis.summary.topTotal.points)} pts totales.` : 'Sin datos disponibles.'}</span>
    </article>
    <article class="metric-card">
      <span class="metric-label">Mejor pts/prueba</span>
      <strong class="metric-value metric-team">${analysis.summary.topEfficiency?.nombre || '-'}</strong>
      <span class="metric-copy">${analysis.summary.topEfficiency ? `${cleanPoints(analysis.summary.topEfficiency.pointsPerEvent)} pts por prueba.` : 'Sin datos disponibles.'}</span>
    </article>
  `;

  note.innerHTML = `
    <strong>Base del analisis:</strong> se cuentan solo pruebas individuales con puntos oficiales.
    Vista actual: ${activeIndividualScope === 'absolute' ? 'torneo absoluto' : 'torneo por categorias'}.
    Puntos/prueba = suma de puntos dividida entre pruebas tomadas.
  `;

  renderIndividualRankingList('individualTotalList', analysis.totalRanking, 'total');
  renderIndividualRankingList('individualEfficiencyList', analysis.efficiencyRanking, 'efficiency');
  renderIndividualRankingList('individualImprovementList', analysis.improvementRanking, 'improvement');
}

function getAthleteRows(name) {
  const key = normalizeAthleteName(name);
  return allData.filter((row) => {
    if (!row.relay) return normalizeAthleteName(row.nombre) === key;
    return Array.isArray(row.integrantes) && row.integrantes.some((item) => normalizeAthleteName(item.nombre) === key);
  });
}

function openAthleteDetail(name) {
  const rows = getAthleteRows(name);
  const individualRows = rows.filter((row) => !row.relay);
  const physicalIndividualRows = getPhysicalResultRows(individualRows);
  if (!rows.length) return;

  const validIndividualRows = individualRows.filter((row) => !row.dq && !row.ns && !row.nt && !row.exhibition);
  const points = validIndividualRows.reduce((sum, row) => sum + Number(row.puntosOficiales || row.puntos || 0), 0);
  const medals = validIndividualRows.reduce((acc, row) => {
    if (row.pos === 1) acc.gold += 1;
    if (row.pos === 2) acc.silver += 1;
    if (row.pos === 3) acc.bronze += 1;
    return acc;
  }, { gold: 0, silver: 0, bronze: 0 });
  const bestTimeRow = validIndividualRows
    .filter((row) => Number.isFinite(timeToSec(row.tiempo)))
    .sort((a, b) => timeToSec(a.tiempo) - timeToSec(b.tiempo))[0];
  const firstRow = rows.find((row) => normalizeAthleteName(row.nombre) === normalizeAthleteName(name))
    || rows.find((row) => row.integrantes?.some((item) => normalizeAthleteName(item.nombre) === normalizeAthleteName(name)));
  const primaryCategory = getPrimaryCategory(rows);

  document.getElementById('athleteDetailTitle').textContent = name;
  document.getElementById('athleteDetailMeta').textContent = `${primaryCategory} · ${firstRow?.genero || ''}`;
  document.getElementById('athleteDetailSummary').innerHTML = `
    <article class="metric-card">
      <span class="metric-label">Puntos</span>
      <strong class="metric-value">${cleanPoints(points)}</strong>
      <span class="metric-copy">Puntos individuales acumulados.</span>
    </article>
    <article class="metric-card">
      <span class="metric-label">Pruebas</span>
      <strong class="metric-value">${physicalIndividualRows.length}</strong>
      <span class="metric-copy">${new Set(physicalIndividualRows.map((row) => row.prueba)).size} pruebas distintas nadadas.</span>
    </article>
    <article class="metric-card">
      <span class="metric-label">Medallas</span>
      <strong class="metric-value metric-team">🥇 ${medals.gold} · 🥈 ${medals.silver} · 🥉 ${medals.bronze}</strong>
      <span class="metric-copy">Podios individuales registrados.</span>
    </article>
    <article class="metric-card">
      <span class="metric-label">Mejor marca</span>
      <strong class="metric-value metric-team">${bestTimeRow?.displayTime || '-'}</strong>
      <span class="metric-copy">${bestTimeRow ? `${bestTimeRow.prueba} · ${bestTimeRow.sesionNombre}` : 'Sin tiempos validos.'}</span>
    </article>
  `;
  document.getElementById('athleteDetailResults').innerHTML = physicalIndividualRows
    .sort((a, b) => a.sesion - b.sesion || a.evento - b.evento)
    .map((row) => {
      const categoryScore = getCategoryScoreRow(row);
      const absoluteScore = getAbsoluteScoreRow(row);
      const scoreLabel = [
        categoryScore ? `Cat ${cleanPoints(categoryScore.puntos)} pts` : '',
        absoluteScore ? `Abs ${cleanPoints(absoluteScore.puntos)} pts` : ''
      ].filter(Boolean).join(' · ');
      return `
      <div class="ranking-row metrics-row">
        <div class="rk-pos">${row.pos || (row.dq ? 'DQ' : row.ns ? 'NS' : row.nt ? 'NT' : '-')}</div>
        <div class="rk-body">
          <div class="rk-name">${row.prueba}</div>
          <div class="rk-events">${row.sesionNombre} · Evento ${row.evento} · ${getDisplayCategoryForRow(row)}${row.turno ? ` · ${row.turno}` : ''}</div>
        </div>
        <div class="rk-points">
          <span class="rk-pts">${row.displayTime}</span>
          <span class="rk-pts-label">${scoreLabel}</span>
        </div>
      </div>
    `;
    }).join('');

  document.getElementById('athleteDetailBackdrop').classList.add('open');
  document.getElementById('athleteDetailModal').classList.add('open');
  syncBodyScrollLock();
}

function closeAthleteDetail() {
  document.getElementById('athleteDetailBackdrop')?.classList.remove('open');
  document.getElementById('athleteDetailModal')?.classList.remove('open');
  syncBodyScrollLock();
}

function renderMetrics(rows) {
  renderIndividualAnalysis(rows);
  styleDominanceData = buildStyleDominanceData(rows);
  renderStyleMetrics();
  categoryDominanceData = buildCategoryDominanceData(rows);
  renderCategoryDominance();
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

function getEventDistance(row) {
  const match = String(row.prueba || '').match(/(\d+)\s*Metros/i);
  return match ? `${match[1]}m` : 'Distancia';
}

function getEventTypeLabel(row) {
  return row.relay ? 'Posta' : 'Individual';
}

function getEventMetaChips(row) {
  const style = getMetricStyle(row);
  return `
    <div class="event-meta-chips">
      <span class="event-chip event-chip-distance">${getEventDistance(row)}</span>
      <span class="event-chip event-chip-style">${getStyleIcon(style)} ${style}</span>
      <span class="event-chip event-chip-type">${getEventTypeLabel(row)}</span>
    </div>
  `;
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
  const rankedTeams = RECORDS.rankingsOficiales?.combined?.map((item) => item.teamName) || [];
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
          : { nombre: row.nombre, teamName: row.categoria, totals: new Map() });
      }
      if (mode === 'athlete' && !isRealCategory(totalsMap.get(entityKey).teamName) && isRealCategory(row.categoria)) {
        totalsMap.get(entityKey).teamName = row.categoria;
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
        <div class="rk-events">${activeStyleDominanceType === 'athlete' ? `${getDisplayGroup(item.teamName)} · ` : ''}${cleanPoints(item.points)} pts en ${selected.style}</div>
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
      ${activeStyleDominanceType === 'athlete' ? `<div class="metrics-note metrics-note-inline">${getDisplayGroup(leader.teamName)}</div>` : ''}
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
            : { nombre: row.nombre, teamName: row.categoria, points: 0 });
        }
        if (mode === 'athlete' && !isRealCategory(categoryPoints.get(category).get(entityKey).teamName) && isRealCategory(row.categoria)) {
          categoryPoints.get(category).get(entityKey).teamName = row.categoria;
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
    Usa los filtros para elegir la categoria y la rama, y ver quien domino mejor ese tramo de edades.
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
          ${activeCategoryDominanceType === 'athlete' ? `${getDisplayGroup(entry.teamName)} · ` : ''}${cleanPoints(entry.points)} pts · ${selected.totalPoints ? cleanPoints((entry.points / selected.totalPoints) * 100) : 0}% del total de la categoría
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
      ${activeCategoryDominanceType === 'athlete' ? `<div class="metrics-note metrics-note-inline">${getDisplayGroup(selected.leader.teamName)}</div>` : ''}
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
    const key = `${entityType}|${normalizeAthleteName(nombre)}`;
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
    if (!isRealCategory(medalists.get(key).equipo) && isRealCategory(equipo)) {
      medalists.get(key).equipo = equipo;
      medalists.get(key).teamName = teamName || equipo;
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
      row.integrantes.forEach((item) => {
        const athlete = ensureEntry(
          item.nombre,
          row.categoria,
          row.categoria,
          item.genero || row.genero,
          'athlete'
        );
        addMedal(athlete);
      });
      return;
    }

    const athlete = ensureEntry(row.nombre, row.categoria, row.categoria, row.genero, 'athlete');
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

  const topThree = medallero.slice(0, 3);
  const rest = medallero.slice(3);
  const podiumOrder = [topThree[1], topThree[0], topThree[2]].filter(Boolean);

  const podium = document.createElement('div');
  podium.className = 'medallero-podium';
  podium.innerHTML = podiumOrder.map((athlete) => {
    const originalIndex = medallero.indexOf(athlete);
    const place = originalIndex + 1;
    return `
      <article class="medallero-podium-card place-${place}">
        <span class="podium-medal">${['🥇', '🥈', '🥉'][originalIndex]}</span>
        <strong>${getAthleteAction(athlete.nombre)}</strong>
        <span><span class="equipo-tag">${athlete.equipo}</span> · ${athlete.genero}</span>
        <div class="medal-summary">
          <span class="medal-pill gold">🥇 ${athlete.gold}</span>
          <span class="medal-pill silver">🥈 ${athlete.silver}</span>
          <span class="medal-pill bronze">🥉 ${athlete.bronze}</span>
        </div>
      </article>
    `;
  }).join('');
  list.appendChild(podium);

  if (rest.length) {
    const restTitle = document.createElement('div');
    restTitle.className = 'medallero-rest-title';
    restTitle.textContent = 'Los demás competidores con medallas';
    list.appendChild(restTitle);
  }

  rest.forEach((athlete, index) => {
    const card = document.createElement('div');
    card.className = 'ranking-row medallero-row';
    card.innerHTML = `
      <div class="rk-pos">${index + 4}</div>
      <div class="rk-body">
        <div class="rk-name">${getAthleteAction(athlete.nombre)}</div>
        <div class="rk-events"><span class="equipo-tag">${athlete.equipo}</span> · ${athlete.genero}</div>
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

function initRankingFilterControls(data) {
  const tournamentButtons = document.querySelectorAll('[data-ranking-scope]');
  const sessionSwitch = document.getElementById('rankingSessionSwitch');
  const categorySwitch = document.getElementById('rankingCategorySwitch');
  const categoryFilterGroup = document.getElementById('rankingCategoryFilterGroup');
  const sessions = [...new Map(
    [...data]
      .sort((a, b) => a.sesion - b.sesion || a.evento - b.evento)
      .map((row) => [row.sesionNombre, row.sesion])
  ).entries()];
  const categories = [...new Set(data.filter((row) => row.categoria !== 'Absoluto').map((row) => row.categoria))]
    .sort((a, b) => a.localeCompare(b, 'es'));

  if (sessionSwitch) {
    sessionSwitch.innerHTML = [
      { label: 'Todas', value: 'all' },
      ...sessions.map(([label]) => ({ label, value: label }))
    ].map((session, index) => `
      <button
        class="ranking-switch-btn ranking-session-btn${index === 0 ? ' active' : ''}"
        data-ranking-session="${session.value}"
        type="button"
      >
        ${session.label}
      </button>
    `).join('');
  }

  if (categorySwitch) {
    categorySwitch.innerHTML = [
      { label: 'Todas', value: 'all' },
      ...categories.map((category) => ({ label: category, value: category }))
    ].map((category, index) => `
      <button
        class="ranking-switch-btn ranking-category-btn${index === 0 ? ' active' : ''}"
        data-ranking-category="${category.value}"
        type="button"
      >
        ${category.label}
      </button>
    `).join('');
  }

  tournamentButtons.forEach((button) => {
    button.addEventListener('click', () => {
      activeRankingScope = button.dataset.rankingScope;
      if (activeRankingScope === 'absolute') activeRankingCategory = 'all';
      tournamentButtons.forEach((node) => node.classList.toggle('active', node === button));
      categoryFilterGroup?.classList.toggle('is-disabled', activeRankingScope === 'absolute');
      document.querySelectorAll('[data-ranking-category]').forEach((node) => node.classList.toggle('active', node.dataset.rankingCategory === activeRankingCategory));
      syncRankingView();
    });
  });

  document.querySelectorAll('[data-ranking-session]').forEach((button) => {
    button.addEventListener('click', () => {
      activeRankingSession = button.dataset.rankingSession;
      document.querySelectorAll('[data-ranking-session]').forEach((node) => node.classList.toggle('active', node === button));
      syncRankingView();
    });
  });

  document.querySelectorAll('[data-ranking-category]').forEach((button) => {
    button.addEventListener('click', () => {
      activeRankingCategory = button.dataset.rankingCategory;
      document.querySelectorAll('[data-ranking-category]').forEach((node) => node.classList.toggle('active', node === button));
      syncRankingView();
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

function initIndividualScopeSwitch() {
  const buttons = document.querySelectorAll('[data-individual-scope]');
  buttons.forEach((button) => {
    button.addEventListener('click', () => {
      activeIndividualScope = button.dataset.individualScope;
      buttons.forEach((node) => node.classList.toggle('active', node === button));
      renderIndividualAnalysis(allData);
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
  allData = [...RECORDS.resultados].sort((a, b) => (
    a.evento - b.evento
    || getCategorySortRank(a.categoria) - getCategorySortRank(b.categoria)
    || a.categoria.localeCompare(b.categoria, 'es')
    || a.genero.localeCompare(b.genero, 'es')
    || (a.pos || 999) - (b.pos || 999)
  ));
  filtered = [...allData];
  rankingViews = {
    athlete: buildAthleteRankingData(allData)
  };

  renderStats(allData);
  renderLaneSecret(allData);
  renderDatasetCopy(allData);
  buildFilterOptions(allData);
  initTabs();
  initCategoryPills(allData);
  initRankingFilterControls(allData);
  renderPodios(allData, activePodioSesion, activePodioGenero, activePodioCategoria);
  renderResults();
  updateResultsInfo();
  syncRankingView(allData.length);
  renderMedallero(allData);
  renderMetrics(allData);
  initRankingSwitch();
  initRankingTypeSwitch();
  initIndividualScopeSwitch();
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
    toggleSheet();
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
  document.getElementById('athleteDetailClose').addEventListener('click', closeAthleteDetail);
  document.getElementById('athleteDetailBackdrop').addEventListener('click', closeAthleteDetail);
  document.getElementById('promoPopupLink').addEventListener('click', () => {
    closePromoPopup();
  });

  document.addEventListener('click', (event) => {
    const athleteButton = event.target.closest('[data-athlete-name]');
    if (!athleteButton) return;
    event.preventDefault();
    event.stopPropagation();
    openAthleteDetail(athleteButton.dataset.athleteName);
  }, true);

  ['filterSesion', 'filterGenero', 'filterPrueba', 'filterCategoria', 'filterEquipo'].forEach((id) => {
    document.getElementById(id).addEventListener('change', () => {
      if (isDesktop()) {
        syncActiveFiltersFromUI();
        applyFilters();
        updateFilterBtn();
      }
    });
  });

  document.getElementById('clearAllLink').addEventListener('click', () => {
    document.getElementById('filterBuscar').value = '';
    activeBuscar = '';
    clearSheetFilters();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closePromoPopup();
      closeAthleteDetail();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && shouldShowPromoPopup() && promoPopupTimer === null) {
      schedulePromoPopup();
    }
  });
}

document.addEventListener('DOMContentLoaded', init);

(() => {
  'use strict';

  const STORE_KEY = 'siljesreiser.v1';
  const CONTINENT_ORDER = ['Europa', 'Asia', 'Afrika', 'Nord-Amerika', 'Sør-Amerika', 'Oseania', 'Antarktis'];
  const COLORS = {
    land: '#c8eac4',
    want: '#de3163',
    been: '#00626a',
    cityWant: '#8b0000',
    cityBeen: '#0b5d1e',
    border: '#7fa58a',
  };

  // ---------- Lagring ----------
  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(STORE_KEY));
      if (d && d.countries && d.cities) return d;
    } catch (e) { /* tomt */ }
    return { countries: {}, cities: {} };
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* ignorer */ }
  }
  let state = load();

  // ---------- Landdata ----------
  const regionNames = (() => {
    try { return new Intl.DisplayNames(['nb', 'no'], { type: 'region' }); } catch (e) { return null; }
  })();
  const countries = new Map(); // iso -> { iso, name, en, sv, continent, layer }

  function norwegianName(iso, fallback) {
    if (regionNames && /^[A-Z]{2}$/.test(iso)) {
      const n = regionNames.of(iso);
      if (n && n !== iso) return n;
    }
    return fallback;
  }

  const normalize = s => s.toLocaleLowerCase('nb').normalize('NFD').replace(/[̀-ͯ]/g, '');

  // ---------- Kart ----------
  const map = L.map('map', {
    worldCopyJump: false,
    minZoom: 2,
    maxZoom: 10,
    zoomSnap: 0.5,
    maxBounds: [[-75, -200], [85, 200]],
    maxBoundsViscosity: 1,
    attributionControl: true,
  });
  map.attributionControl.setPrefix(false);
  map.attributionControl.addAttribution('Kart: Natural Earth · Søk: © OpenStreetMap');
  map.setView([30, 10], 2);

  const cityLayer = L.layerGroup();
  let countryLayer;

  function countryStyle(iso) {
    const s = state.countries[iso];
    return {
      fillColor: s === 'been' ? COLORS.been : s === 'want' ? COLORS.want : COLORS.land,
      fillOpacity: 1,
      color: s ? '#ffffff' : COLORS.border,
      weight: 0.6,
    };
  }

  fetch('data/countries.json')
    .then(r => r.json())
    .then(geo => {
      countryLayer = L.geoJSON(geo, {
        style: f => countryStyle(f.id),
        onEachFeature: (f, layer) => {
          const iso = f.id;
          const name = norwegianName(iso, f.properties.en);
          countries.set(iso, { iso, name, en: f.properties.en, sv: f.properties.sv, continent: f.properties.c, layer });
          layer.on('click', () => openCountry(iso, false));
        },
      }).addTo(map);
      cityLayer.addTo(map);
      renderCities();
      renderStats();
    });

  function restyleCountry(iso) {
    const c = countries.get(iso);
    if (c) c.layer.setStyle(countryStyle(iso));
  }

  function renderCities() {
    cityLayer.clearLayers();
    for (const [id, city] of Object.entries(state.cities)) {
      const color = city.status === 'been' ? COLORS.cityBeen : COLORS.cityWant;
      L.circleMarker([city.lat, city.lon], {
        radius: 5.5,
        color: '#ffffff',
        weight: 1.5,
        fillColor: color,
        fillOpacity: 1,
        bubblingMouseEvents: false,
      })
        .bindTooltip(city.name, { direction: 'top', offset: [0, -4] })
        .on('click', () => openCity(id, false))
        .addTo(cityLayer);
    }
  }

  // ---------- Panel ----------
  const panel = document.getElementById('panel');
  const panelKind = document.getElementById('panel-kind');
  const panelTitle = document.getElementById('panel-title');
  const panelSub = document.getElementById('panel-sub');
  let current = null; // { type: 'country', iso } | { type: 'city', id, data }

  function showPanel() {
    panel.hidden = false;
    const status = current.type === 'country'
      ? state.countries[current.iso]
      : (state.cities[current.id] || {}).status;
    panel.querySelectorAll('.actions .btn').forEach(b => {
      b.classList.toggle('on', !!b.dataset.status && b.dataset.status === status);
    });
  }

  function openCountry(iso, fly) {
    const c = countries.get(iso);
    if (!c) return;
    current = { type: 'country', iso };
    panelKind.textContent = 'Land';
    panelTitle.textContent = c.name;
    panelSub.textContent = c.continent;
    showPanel();
    if (fly) map.flyToBounds(c.layer.getBounds(), { maxZoom: 5, duration: 0.8 });
  }

  function openCity(id, fly, data) {
    const city = state.cities[id] || data;
    current = { type: 'city', id, data: city };
    panelKind.textContent = 'By / sted';
    panelTitle.textContent = city.name;
    const country = countries.get(city.cc);
    panelSub.textContent = [city.countryName || (country && country.name), country && country.continent]
      .filter(Boolean).join(' · ');
    showPanel();
    if (fly) map.flyTo([city.lat, city.lon], Math.max(map.getZoom(), 5), { duration: 0.8 });
  }

  panel.querySelectorAll('.actions .btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!current) return;
      const status = btn.dataset.status;
      if (current.type === 'country') {
        if (status) state.countries[current.iso] = status;
        else delete state.countries[current.iso];
        restyleCountry(current.iso);
      } else {
        if (status) state.cities[current.id] = { ...current.data, status };
        else delete state.cities[current.id];
        renderCities();
      }
      save();
      renderStats();
      showPanel();
    });
  });
  document.getElementById('panel-close').addEventListener('click', () => {
    panel.hidden = true;
    current = null;
  });

  // ---------- Søk ----------
  const input = document.getElementById('search');
  const results = document.getElementById('results');
  let items = [];
  let selIdx = -1;
  let cityTimer = null;
  let cityAbort = null;

  function searchCountries(q) {
    const n = normalize(q);
    const out = [];
    for (const c of countries.values()) {
      const names = [c.name, c.en, c.sv].filter(Boolean).map(normalize);
      const rank = names.includes(n) ? 0 : names.some(x => x.startsWith(n)) ? 1 : names.some(x => x.includes(n)) ? 2 : -1;
      if (rank >= 0) out.push({ rank, c });
    }
    // Eksakte treff først, så korteste navn ("nor" → Norge før Nord-Korea).
    out.sort((a, b) => a.rank - b.rank || a.c.name.length - b.c.name.length || a.c.name.localeCompare(b.c.name, 'nb'));
    return out.slice(0, 5).map(({ c }) => ({
      kind: 'country',
      label: c.name,
      meta: 'Land',
      go: () => openCountry(c.iso, true),
    }));
  }

  function renderResults(countryItems, cityItems, loading) {
    items = [...countryItems, ...cityItems];
    selIdx = -1;
    results.innerHTML = '';
    for (const [i, it] of items.entries()) {
      const li = document.createElement('li');
      const span = document.createElement('span');
      span.textContent = it.label;
      const small = document.createElement('small');
      small.textContent = it.meta;
      li.append(span, small);
      li.addEventListener('mousedown', e => { e.preventDefault(); choose(i); });
      results.append(li);
    }
    if (loading) {
      const li = document.createElement('li');
      li.className = 'info';
      li.textContent = 'Søker etter byer …';
      results.append(li);
    } else if (!items.length) {
      const li = document.createElement('li');
      li.className = 'info';
      li.textContent = 'Ingen treff';
      results.append(li);
    }
    results.hidden = false;
  }

  function choose(i) {
    const it = items[i];
    if (!it) return;
    it.go();
    input.value = '';
    results.hidden = true;
    input.blur();
  }

  async function searchCities(q, signal) {
    const url = 'https://nominatim.openstreetmap.org/search?' + new URLSearchParams({
      q,
      format: 'jsonv2',
      addressdetails: '1',
      limit: '6',
      'accept-language': 'nb,en',
      featureType: 'settlement',
    });
    const res = await fetch(url, { signal });
    if (!res.ok) return [];
    const data = await res.json();
    return data.map(p => {
      const a = p.address || {};
      const name = p.name || (p.display_name || '').split(',')[0];
      const cc = (a.country_code || '').toUpperCase();
      const region = a.state || a.county || '';
      const city = {
        name,
        lat: +p.lat,
        lon: +p.lon,
        cc,
        countryName: a.country || '',
      };
      const id = 'osm:' + p.osm_type + p.osm_id;
      return {
        kind: 'city',
        label: name,
        meta: [region, a.country].filter(Boolean).join(', '),
        go: () => openCity(id, true, city),
      };
    });
  }

  input.addEventListener('input', () => {
    const q = input.value.trim();
    clearTimeout(cityTimer);
    if (cityAbort) cityAbort.abort();
    if (!q) { results.hidden = true; return; }
    const countryItems = searchCountries(q);
    if (q.length < 2) { renderResults(countryItems, [], false); return; }
    renderResults(countryItems, [], true);
    cityTimer = setTimeout(async () => {
      cityAbort = new AbortController();
      try {
        const cityItems = await searchCities(q, cityAbort.signal);
        if (input.value.trim() === q) renderResults(countryItems, cityItems, false);
      } catch (e) {
        if (e.name !== 'AbortError' && input.value.trim() === q) renderResults(countryItems, [], false);
      }
    }, 400);
  });

  input.addEventListener('keydown', e => {
    const lis = [...results.querySelectorAll('li:not(.info)')];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!lis.length) return;
      selIdx = (selIdx + (e.key === 'ArrowDown' ? 1 : -1) + lis.length) % lis.length;
      lis.forEach((li, i) => li.classList.toggle('sel', i === selIdx));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(selIdx >= 0 ? selIdx : 0);
    } else if (e.key === 'Escape') {
      results.hidden = true;
      input.blur();
    }
  });
  input.addEventListener('blur', () => { results.hidden = true; });
  input.addEventListener('focus', () => { if (input.value.trim()) input.dispatchEvent(new Event('input')); });

  // ---------- Stats ----------
  function summarize(status) {
    const cities = Object.values(state.cities).filter(c => c.status === status);
    const countrySet = new Set(Object.keys(state.countries).filter(iso => state.countries[iso] === status));
    // Et land regnes også med når du har markert en by i det.
    for (const c of cities) if (countries.has(c.cc)) countrySet.add(c.cc);
    const continentSet = new Set();
    for (const iso of countrySet) continentSet.add(countries.get(iso).continent);
    return { cities, countrySet, continentSet };
  }

  function renderList(el, sum) {
    el.innerHTML = '';
    if (!sum.countrySet.size && !sum.cities.length) {
      el.innerHTML = '<p class="empty">Ingenting markert ennå.</p>';
      return;
    }
    const byContinent = new Map();
    for (const iso of sum.countrySet) {
      const c = countries.get(iso);
      if (!byContinent.has(c.continent)) byContinent.set(c.continent, []);
      byContinent.get(c.continent).push(c);
    }
    for (const cont of CONTINENT_ORDER) {
      const list = byContinent.get(cont);
      if (!list) continue;
      const h = document.createElement('h4');
      h.textContent = cont;
      const ul = document.createElement('ul');
      list.sort((a, b) => a.name.localeCompare(b.name, 'nb'));
      for (const c of list) {
        const li = document.createElement('li');
        li.textContent = c.name;
        const cs = sum.cities.filter(x => x.cc === c.iso).map(x => x.name).sort((a, b) => a.localeCompare(b, 'nb'));
        if (cs.length) {
          const small = document.createElement('small');
          small.textContent = ' — ' + cs.join(', ');
          li.append(small);
        }
        ul.append(li);
      }
      el.append(h, ul);
    }
    const orphans = sum.cities.filter(x => !countries.has(x.cc));
    if (orphans.length) {
      const h = document.createElement('h4');
      h.textContent = 'Andre steder';
      const ul = document.createElement('ul');
      for (const x of orphans) {
        const li = document.createElement('li');
        li.textContent = x.name;
        ul.append(li);
      }
      el.append(h, ul);
    }
  }

  function renderStats() {
    if (!countries.size) return;
    for (const status of ['been', 'want']) {
      const sum = summarize(status);
      document.getElementById(status + '-cities').textContent = sum.cities.length;
      document.getElementById(status + '-countries').textContent = sum.countrySet.size;
      document.getElementById(status + '-continents').textContent = sum.continentSet.size;
      renderList(document.getElementById(status + '-list'), sum);
    }
  }

  // ---------- Sikkerhetskopi ----------
  document.getElementById('export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'siljesreiser-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  document.getElementById('import').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const d = JSON.parse(await file.text());
      if (!d.countries || !d.cities) throw new Error('ugyldig');
      if (!confirm('Erstatte alt som er lagret nå med innholdet i filen?')) return;
      state = d;
      save();
      for (const iso of countries.keys()) restyleCountry(iso);
      renderCities();
      renderStats();
    } catch (err) {
      alert('Kunne ikke lese filen.');
    } finally {
      e.target.value = '';
    }
  });

  // ---------- Sider ----------
  function route() {
    const page = location.hash === '#stats' ? 'stats' : 'kart';
    document.getElementById('page-kart').hidden = page !== 'kart';
    document.getElementById('page-stats').hidden = page !== 'stats';
    document.querySelectorAll('.topbar nav a').forEach(a => a.classList.toggle('active', a.dataset.page === page));
    if (page === 'kart') map.invalidateSize();
    else renderStats();
  }
  window.addEventListener('hashchange', route);
  route();
})();

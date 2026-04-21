/**
 * Türkiye Yer Gözlem Uyduları — yatay animasyonlu timeline.
 *
 * Sayfa açıldığında fırlatma tarihine göre soldan sağa yatay bir zaman
 * ekseni çizilir. Her uydunun fırlatma noktası noktayla işaretlenir,
 * aktif kart altta detayla birlikte gösterilir. Auto-play ile 4 saniyede
 * bir sıradaki uyduya geçilir; prev/next butonları ile manuel de gezilir.
 */

import './styles/satellites-tr.css';

const SATS = [
  {
    name: 'BİLSAT-1',
    noradId: 27943,
    cospar: '2003-042E',
    launch: '2003-09-27T06:12:00Z',
    launchStr: '27 Eylül 2003 · 06:12 UTC',
    rocket: 'Kosmos-3M',
    site: 'Plesetsk 132/1, Rusya',
    orbit: 'SSO 686 km · 98.2° · 98.5 dk',
    mass: '130 kg',
    camera: 'ÇOBAN — 12 m PAN, 26 m VNIR',
    resolution: '12 m',
    status: 'inactive',
    statusText: 'Görev Sona Erdi',
    color: '#8b949e',
    highlights: [
      'Türkiye\'nin ilk yer gözlem uydusu',
      'SSTL-100 platformu, DMC takımyıldızı üyesi',
      'Batarya hücresi arızası (Ağustos 2006) ile görev tamamlandı',
    ],
    builder: 'SSTL + TÜBİTAK',
    operator: 'TÜBİTAK UZAY',
    flag: 'TR · UK',
  },
  {
    name: 'RASAT',
    noradId: 37791,
    cospar: '2011-044D',
    launch: '2011-08-17T07:12:00Z',
    launchStr: '17 Ağustos 2011 · 07:12 UTC',
    rocket: 'Dnepr',
    site: 'Yasny, Rusya',
    orbit: 'SSO ~700 km · 98.1° · 98.4 dk',
    mass: '93 kg',
    camera: '7.5 m PAN / 15 m MS',
    resolution: '7.5 m',
    status: 'inactive',
    statusText: 'İrtibat Kesildi (2022)',
    color: '#d29922',
    highlights: [
      'Türkiye\'de tasarlanıp üretilen ilk yerli yer gözlem uydusu',
      '3 yıl tasarım ömrüne rağmen 11 yıl çalıştı',
      'BİLGE uçuş bilgisayarı + GEZGİN görüntü işleme modülü',
    ],
    builder: 'TÜBİTAK UZAY',
    operator: 'TÜBİTAK UZAY',
    flag: 'TR',
  },
  {
    name: 'GÖKTÜRK-2',
    noradId: 39030,
    cospar: '2012-073A',
    launch: '2012-12-18T16:12:52Z',
    launchStr: '18 Aralık 2012 · 16:12 UTC',
    rocket: 'Long March 2D (CZ-2D)',
    site: 'Jiuquan, Çin',
    orbit: 'SSO 686 km · 98.1° · LTAN 10:30',
    mass: '~450 kg',
    camera: '2.5 m PAN / 10 m VNIR / 20 m SWIR',
    resolution: '2.5 m',
    status: 'active',
    statusText: 'Aktif',
    color: '#7ee787',
    highlights: [
      '%80 yerli teknoloji, %100 yerli yazılım',
      'TÜBİTAK UZAY + TUSAŞ ortak geliştirme',
      '12+ yıldır aktif görevde',
    ],
    builder: 'TÜBİTAK UZAY + TUSAŞ',
    operator: 'MSB / Hava Kuvvetleri',
    flag: 'TR',
  },
  {
    name: 'GÖKTÜRK-1',
    noradId: 41875,
    cospar: '2016-073A',
    launch: '2016-12-05T13:51:44Z',
    launchStr: '5 Aralık 2016 · 13:51 UTC',
    rocket: 'Vega (VV08)',
    site: 'Kourou, Fransız Guyanası',
    orbit: 'SSO ~695 km · 98.11°',
    mass: '~1060 kg',
    camera: 'HiRI — 0.8 m PAN / 3.2 m MS',
    resolution: '0.8 m',
    status: 'active',
    statusText: 'Aktif',
    color: '#58a6ff',
    highlights: [
      'Türkiye\'nin en yüksek çözünürlüklü (0.8 m) aktif uydusu',
      'Proteus platformu, Pleiades optik mirası',
      'Telespazio/Thales Alenia — TAI, ASELSAN, TÜBİTAK, ROKETSAN',
    ],
    builder: 'Telespazio / Thales Alenia',
    operator: 'MSB / Hava Kuvvetleri',
    flag: 'TR · FR · IT',
  },
  {
    name: 'İMECE',
    noradId: 56178,
    cospar: '2023-054A',
    launch: '2023-04-15T06:48:00Z',
    launchStr: '15 Nisan 2023 · 06:48 UTC',
    rocket: 'Falcon 9 Block 5',
    site: 'Vandenberg SLC-4E, ABD',
    orbit: 'SSO ~680 km',
    mass: '800 kg',
    camera: '0.99 m PAN / 3.96 m MSI · 13.9×16.2 km',
    resolution: '0.99 m',
    status: 'active',
    statusText: 'Aktif',
    color: '#d2a8ff',
    highlights: [
      'Türkiye\'nin ilk yerli metre-altı gözlem uydusu',
      'TÜBİTAK UZAY tasarım + TUSAŞ Kahramankazan entegrasyon',
      '5 yıl tasarım ömrü',
    ],
    builder: 'TÜBİTAK UZAY',
    operator: 'TÜBİTAK UZAY',
    flag: 'TR',
  },
  {
    name: 'İMECE-2',
    noradId: null,
    cospar: null,
    launch: '2027-06-01T00:00:00Z',
    launchStr: '2027 (planlanıyor)',
    rocket: '—',
    site: '—',
    orbit: 'SSO planlanıyor',
    mass: '—',
    camera: '~50 cm PAN hedefi',
    resolution: '0.50 m',
    status: 'planned',
    statusText: 'Planlanan',
    color: '#f0883e',
    highlights: [
      'Türkiye\'nin 50 cm çözünürlüklü uydusu',
      'İMECE serisinin devamı — yerli tasarım',
    ],
    builder: 'TÜBİTAK UZAY',
    operator: 'TÜBİTAK UZAY',
    flag: 'TR',
  },
  {
    name: 'İMECE-3',
    noradId: null,
    cospar: null,
    launch: '2028-06-01T00:00:00Z',
    launchStr: '2028 (planlanıyor)',
    rocket: '—',
    site: '—',
    orbit: 'SSO planlanıyor',
    mass: '—',
    camera: '~50 cm PAN hedefi',
    resolution: '0.50 m',
    status: 'planned',
    statusText: 'Planlanan',
    color: '#f0883e',
    highlights: [
      'İMECE serisinin 3. üyesi',
      'Yerli üretim + yüksek çözünürlük devamı',
    ],
    builder: 'TÜBİTAK UZAY',
    operator: 'TÜBİTAK UZAY',
    flag: 'TR',
  },
];

const AUTOPLAY_MS = 5000;

let activeIdx = 0;
let autoplayTimer = null;
let autoplayOn = true;

// ───────── Init ─────────
function init() {
  const app = document.getElementById('tr-sat-app');
  if (!app) return;

  const yearRange = computeYearRange();

  app.innerHTML = `
    <header class="trs-header">
      <div class="trs-header-inner">
        <div class="trs-title-row">
          <h1>Türkiye Yer Gözlem Uyduları</h1>
          <nav class="trs-nav">
            <a href="./imaging.html">Görüntüleme</a>
            <a href="./pass-tracker.html">Geçiş Takibi</a>
            <a href="./index.html">Ana</a>
          </nav>
        </div>
        <p class="trs-sub">2003'ten günümüze — kronolojik fırlatma</p>
      </div>
    </header>

    <div class="trs-stats" id="trs-stats"></div>

    <section class="trs-timeline-wrap">
      <div class="trs-years" id="trs-years"></div>
      <div class="trs-track" id="trs-track">
        <div class="trs-line-bg" aria-hidden="true"></div>
        <div class="trs-line-fg" id="trs-line-fg" aria-hidden="true"></div>
        <div class="trs-rocket" id="trs-rocket" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#e6edf3" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/>
            <path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/>
            <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/>
            <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>
          </svg>
        </div>
        <div class="trs-nodes" id="trs-nodes"></div>
      </div>
      <div class="trs-controls">
        <button class="trs-ctrl" id="trs-prev" aria-label="Önceki uydu">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <button class="trs-ctrl trs-play" id="trs-play" aria-label="Oto-oynat">
          <svg id="trs-play-icon" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>
        </button>
        <button class="trs-ctrl" id="trs-next" aria-label="Sonraki uydu">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
        <div class="trs-idx" id="trs-idx">1 / ${SATS.length}</div>
      </div>
    </section>

    <section class="trs-detail" id="trs-detail"></section>

    <footer class="trs-footer">
      Peyker — Uydu Yer İzi Planlayıcı
    </footer>
  `;

  renderStats();
  renderYears(yearRange);
  renderNodes(yearRange);
  attachControls();

  // Kick off entrance animation
  setTimeout(() => {
    document.getElementById('trs-track').classList.add('loaded');
    setTimeout(() => {
      selectSat(0, { animate: true });
      startAutoplay();
    }, 1800);
  }, 200);
}

function computeYearRange() {
  const years = SATS.map(s => new Date(s.launch).getFullYear());
  const min = Math.min(...years) - 1;
  const max = Math.max(...years) + 1;
  return { min, max };
}

function yearFraction(launchIso, range) {
  const y = new Date(launchIso).getFullYear() +
            (new Date(launchIso).getMonth() / 12);
  return (y - range.min) / (range.max - range.min);
}

function renderStats() {
  const el = document.getElementById('trs-stats');
  const launched = SATS.filter(s => s.status !== 'planned');
  const active = SATS.filter(s => s.status === 'active').length;
  const planned = SATS.filter(s => s.status === 'planned').length;
  const firstYear = new Date(launched[0].launch).getFullYear();
  const span = new Date().getFullYear() - firstYear;
  const bestRes = Math.min(...launched
    .filter(s => s.status === 'active')
    .map(s => parseFloat(s.resolution)));

  el.innerHTML = `
    <div class="trs-stat"><div class="trs-stat-val">${launched.length}</div><div class="trs-stat-label">Fırlatılan</div></div>
    <div class="trs-stat"><div class="trs-stat-val trs-green">${active}</div><div class="trs-stat-label">Aktif</div></div>
    <div class="trs-stat"><div class="trs-stat-val trs-orange">${planned}</div><div class="trs-stat-label">Planlanan</div></div>
    <div class="trs-stat"><div class="trs-stat-val">${span} yıl</div><div class="trs-stat-label">${firstYear} — bugün</div></div>
    <div class="trs-stat"><div class="trs-stat-val trs-blue">${bestRes} m</div><div class="trs-stat-label">En iyi çözünürlük</div></div>
  `;
}

function renderYears(range) {
  const el = document.getElementById('trs-years');
  const totalYears = range.max - range.min;
  const stepYears = totalYears > 20 ? 5 : (totalYears > 10 ? 3 : 2);
  for (let y = range.min; y <= range.max; y += stepYears) {
    const frac = (y - range.min) / totalYears;
    const tick = document.createElement('div');
    tick.className = 'trs-year-tick';
    tick.style.left = `${frac * 100}%`;
    tick.textContent = y;
    el.append(tick);
  }
}

function renderNodes(range) {
  const el = document.getElementById('trs-nodes');
  SATS.forEach((sat, i) => {
    const frac = yearFraction(sat.launch, range);
    const node = document.createElement('button');
    node.className = `trs-node trs-node-${sat.status}`;
    node.style.left = `${frac * 100}%`;
    node.style.setProperty('--node-color', sat.color);
    node.style.transitionDelay = `${0.3 + i * 0.18}s`;
    node.setAttribute('aria-label', `${sat.name} — ${sat.launchStr}`);
    node.innerHTML = `
      <span class="trs-node-dot"></span>
      <span class="trs-node-label">
        <span class="trs-node-year">${new Date(sat.launch).getFullYear()}</span>
        <span class="trs-node-name">${sat.name}</span>
      </span>
    `;
    node.addEventListener('click', () => {
      stopAutoplay();
      selectSat(i, { animate: true });
    });
    el.append(node);
  });
}

function selectSat(idx, opts = {}) {
  activeIdx = idx;
  const sat = SATS[idx];
  const range = computeYearRange();
  const frac = yearFraction(sat.launch, range);

  // Active node highlight
  document.querySelectorAll('.trs-node').forEach((n, i) => {
    n.classList.toggle('active', i === idx);
  });

  // Line fill + rocket position
  const lineFg = document.getElementById('trs-line-fg');
  const rocket = document.getElementById('trs-rocket');
  lineFg.style.width = `${frac * 100}%`;
  lineFg.style.background = `linear-gradient(90deg, #58a6ff, ${sat.color})`;
  rocket.style.left = `${frac * 100}%`;
  rocket.classList.add('visible');

  // Index counter
  const idxEl = document.getElementById('trs-idx');
  if (idxEl) idxEl.textContent = `${idx + 1} / ${SATS.length}`;

  renderDetail(sat, opts.animate);
}

function renderDetail(sat, animate) {
  const el = document.getElementById('trs-detail');
  const isActive = sat.status === 'active';
  const isPlanned = sat.status === 'planned';
  const highlights = sat.highlights.map(h => `<li>${h}</li>`).join('');

  el.style.opacity = animate ? '0' : '1';
  el.style.setProperty('--detail-color', sat.color);

  el.innerHTML = `
    <div class="trs-detail-card">
      <div class="trs-detail-accent" aria-hidden="true"></div>
      <div class="trs-detail-head">
        <div class="trs-detail-title">
          <div class="trs-detail-name">${sat.name}</div>
          <div class="trs-detail-launch">${sat.launchStr}</div>
        </div>
        <div class="trs-detail-status trs-status-${sat.status}">${sat.statusText}</div>
      </div>

      <div class="trs-detail-meta">
        <span class="trs-chip">🇹🇷 ${sat.flag}</span>
        <span class="trs-chip">🚀 ${sat.rocket}</span>
        <span class="trs-chip">📍 ${sat.site}</span>
      </div>

      <div class="trs-detail-grid">
        <div class="trs-spec">
          <div class="trs-spec-label">Yörünge</div>
          <div class="trs-spec-val">${sat.orbit}</div>
        </div>
        <div class="trs-spec">
          <div class="trs-spec-label">Kütle</div>
          <div class="trs-spec-val">${sat.mass}</div>
        </div>
        <div class="trs-spec trs-spec-wide">
          <div class="trs-spec-label">Kamera / Sensör</div>
          <div class="trs-spec-val">${sat.camera}</div>
        </div>
        <div class="trs-spec trs-spec-res">
          <div class="trs-spec-label">Çözünürlük</div>
          <div class="trs-spec-val trs-res">${sat.resolution}</div>
        </div>
      </div>

      <ul class="trs-detail-hl">${highlights}</ul>

      <div class="trs-detail-foot">
        ${sat.noradId ? `<span class="trs-mono">NORAD ${sat.noradId}</span>` : ''}
        ${sat.cospar ? `<span class="trs-mono">COSPAR ${sat.cospar}</span>` : ''}
        <span class="trs-builder">${sat.builder}</span>
        ${isActive && sat.noradId
          ? `<a class="trs-track-btn" href="./pass-tracker.html?sat=${sat.noradId}">Geçiş Takibi →</a>`
          : ''}
      </div>
    </div>
  `;

  if (animate) {
    requestAnimationFrame(() => {
      el.style.transition = 'opacity 0.45s ease, transform 0.45s ease';
      el.style.transform = 'translateY(12px)';
      el.style.opacity = '0';
      requestAnimationFrame(() => {
        el.style.transform = 'translateY(0)';
        el.style.opacity = '1';
      });
    });
  }
}

function attachControls() {
  document.getElementById('trs-prev').addEventListener('click', () => {
    stopAutoplay();
    const next = (activeIdx - 1 + SATS.length) % SATS.length;
    selectSat(next, { animate: true });
  });
  document.getElementById('trs-next').addEventListener('click', () => {
    stopAutoplay();
    selectSat((activeIdx + 1) % SATS.length, { animate: true });
  });
  document.getElementById('trs-play').addEventListener('click', () => {
    if (autoplayOn) stopAutoplay();
    else startAutoplay();
  });

  // Keyboard nav
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'ArrowLeft') {
      stopAutoplay();
      selectSat((activeIdx - 1 + SATS.length) % SATS.length, { animate: true });
    } else if (e.key === 'ArrowRight') {
      stopAutoplay();
      selectSat((activeIdx + 1) % SATS.length, { animate: true });
    } else if (e.key === ' ') {
      e.preventDefault();
      if (autoplayOn) stopAutoplay();
      else startAutoplay();
    }
  });
}

function startAutoplay() {
  autoplayOn = true;
  updatePlayIcon();
  if (autoplayTimer) clearInterval(autoplayTimer);
  autoplayTimer = setInterval(() => {
    selectSat((activeIdx + 1) % SATS.length, { animate: true });
  }, AUTOPLAY_MS);
}

function stopAutoplay() {
  autoplayOn = false;
  updatePlayIcon();
  if (autoplayTimer) { clearInterval(autoplayTimer); autoplayTimer = null; }
}

function updatePlayIcon() {
  const btn = document.getElementById('trs-play');
  const icon = document.getElementById('trs-play-icon');
  if (!icon || !btn) return;
  if (autoplayOn) {
    btn.classList.add('playing');
    btn.setAttribute('aria-label', 'Oto-oynat durdur');
    icon.innerHTML = '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>';
  } else {
    btn.classList.remove('playing');
    btn.setAttribute('aria-label', 'Oto-oynat başlat');
    icon.innerHTML = '<polygon points="6 4 20 12 6 20 6 4"/>';
  }
}

// Clean up timer on page unload
window.addEventListener('beforeunload', () => {
  if (autoplayTimer) clearInterval(autoplayTimer);
});

// ───────── Start ─────────
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

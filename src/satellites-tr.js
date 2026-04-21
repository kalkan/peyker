/**
 * Türkiye Yer Gözlem Uyduları — kronolojik timeline sayfası.
 *
 * Sayfa açıldığında kartlar fırlatma sırasına göre teker teker
 * animasyonlu görünür. Her kart: uydu adı, tarih, yörünge, sensör,
 * durum ve öne çıkan notlar içerir.
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
    orbit: 'SSO ~686 km · 98.2° · 98.5 dk',
    mass: '130 kg',
    camera: 'ÇOBAN — 12 m PAN, 26 m VNIR',
    resolution: '12 m',
    status: 'inactive',
    statusText: 'Görev sona erdi (Ağustos 2006)',
    color: '#8b949e',
    highlights: [
      'Türkiye\'nin ilk yer gözlem uydusu',
      'SSTL-100 platformu, DMC takımyıldızı üyesi',
      'Batarya hücresi arızası ile görev sona erdi',
    ],
    builder: 'Surrey Satellite Technology (SSTL) + TÜBİTAK',
    operator: 'TÜBİTAK UZAY',
    flag: '🇹🇷 🇬🇧',
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
    statusText: 'İrtibat kesildi (2022)',
    color: '#d29922',
    highlights: [
      'Türkiye\'de tasarlanıp üretilen ilk yerli yer gözlem uydusu',
      '3 yıl tasarım ömrüne rağmen 11 yıl çalıştı',
      'BİLGE uçuş bilgisayarı + GEZGİN görüntü işleme modülü',
    ],
    builder: 'TÜBİTAK UZAY',
    operator: 'TÜBİTAK UZAY',
    flag: '🇹🇷',
  },
  {
    name: 'GÖKTÜRK-2',
    noradId: 39030,
    cospar: '2012-073A',
    launch: '2012-12-18T16:12:52Z',
    launchStr: '18 Aralık 2012 · 16:12 UTC',
    rocket: 'Long March 2D (CZ-2D)',
    site: 'Jiuquan, Çin',
    orbit: 'SSO ~686 km · 98.1° · 98.3 dk · LTAN 10:30',
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
    builder: 'TÜBİTAK UZAY + TUSAŞ (TAI)',
    operator: 'MSB / Hava Kuvvetleri',
    flag: '🇹🇷',
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
    camera: 'HiRI — 0.8 m PAN / 3.2 m MS (Pleiades mirası)',
    resolution: '0.8 m',
    status: 'active',
    statusText: 'Aktif',
    color: '#58a6ff',
    highlights: [
      'Türkiye\'nin en yüksek çözünürlüklü (0.8 m) aktif uydusu',
      'Proteus platformu, Pleiades optik mirası',
      'Telespazio / Thales Alenia — TAI, ASELSAN, TÜBİTAK, ROKETSAN',
    ],
    builder: 'Telespazio / Thales Alenia Space',
    operator: 'MSB / Hava Kuvvetleri',
    flag: '🇹🇷 🇫🇷 🇮🇹',
  },
  {
    name: 'İMECE',
    noradId: 56178,
    cospar: '2023-054A',
    launch: '2023-04-15T06:48:00Z',
    launchStr: '15 Nisan 2023 · 06:48 UTC',
    rocket: 'Falcon 9 Block 5 (Transporter-7)',
    site: 'Vandenberg SLC-4E, ABD',
    orbit: 'SSO ~680 km',
    mass: '800 kg',
    camera: '0.99 m PAN / 3.96 m MSI · Alan: 13.9 × 16.2 km',
    resolution: '0.99 m',
    status: 'active',
    statusText: 'Aktif',
    color: '#d2a8ff',
    highlights: [
      'Türkiye\'nin ilk yerli metre-altı gözlem uydusu',
      'TÜBİTAK UZAY tasarım + üretim, TUSAŞ Kahramankazan\'da entegrasyon',
      '5 yıl tasarım ömrü',
      'İMECE-2 (2027) ve İMECE-3 (2028): 50 cm çözünürlük hedefi',
    ],
    builder: 'TÜBİTAK UZAY',
    operator: 'TÜBİTAK UZAY',
    flag: '🇹🇷',
  },
];

// ───────── Upcoming ─────────
const UPCOMING = [
  { name: 'İMECE-2', year: 2027, resolution: '~50 cm', note: 'Yerli tasarım, geliştirilmiş optik' },
  { name: 'İMECE-3', year: 2028, resolution: '~50 cm', note: 'İMECE serisinin 3. üyesi' },
];

// ───────── Init ─────────
function init() {
  const app = document.getElementById('tr-sat-app');
  if (!app) return;

  app.innerHTML = `
    <header class="trs-header">
      <div class="trs-header-inner">
        <h1>Türkiye Yer Gözlem Uyduları</h1>
        <p class="trs-sub">2003'ten günümüze — kronolojik fırlatma sırası</p>
        <nav class="trs-nav">
          <a href="./imaging.html">Görüntüleme</a>
          <a href="./index.html">Ana Sayfa</a>
        </nav>
      </div>
    </header>
    <div class="trs-stats" id="trs-stats"></div>
    <div class="trs-timeline" id="trs-timeline">
      <div class="trs-timeline-line" aria-hidden="true"></div>
    </div>
    <section class="trs-upcoming" id="trs-upcoming"></section>
    <footer class="trs-footer">
      Peyker — Uydu Yer İzi Planlayıcı
    </footer>
  `;

  renderStats();
  renderUpcoming();
  animateCards();
}

function renderStats() {
  const el = document.getElementById('trs-stats');
  const active = SATS.filter(s => s.status === 'active').length;
  const total = SATS.length;
  const firstYear = new Date(SATS[0].launch).getFullYear();
  const span = new Date().getFullYear() - firstYear;
  const bestRes = SATS.filter(s => s.status === 'active')
    .reduce((best, s) => Math.min(best, parseFloat(s.resolution)), Infinity);

  el.innerHTML = `
    <div class="trs-stat">
      <div class="trs-stat-val">${total}</div>
      <div class="trs-stat-label">Toplam Uydu</div>
    </div>
    <div class="trs-stat">
      <div class="trs-stat-val trs-green">${active}</div>
      <div class="trs-stat-label">Aktif</div>
    </div>
    <div class="trs-stat">
      <div class="trs-stat-val">${span} yıl</div>
      <div class="trs-stat-label">${firstYear} — bugün</div>
    </div>
    <div class="trs-stat">
      <div class="trs-stat-val trs-blue">${bestRes} m</div>
      <div class="trs-stat-label">En iyi çözünürlük</div>
    </div>
  `;
}

function renderUpcoming() {
  const el = document.getElementById('trs-upcoming');
  const items = UPCOMING.map(u => `
    <div class="trs-up-card">
      <div class="trs-up-name">${u.name}</div>
      <div class="trs-up-year">${u.year}</div>
      <div class="trs-up-res">${u.resolution}</div>
      <div class="trs-up-note">${u.note}</div>
    </div>
  `).join('');

  el.innerHTML = `
    <div class="trs-up-title">Gelecek Görevler</div>
    <div class="trs-up-grid">${items}</div>
  `;
}

function animateCards() {
  const timeline = document.getElementById('trs-timeline');
  SATS.forEach((sat, i) => {
    const card = buildCard(sat, i);
    card.style.opacity = '0';
    card.style.transform = 'translateY(32px)';
    timeline.append(card);

    setTimeout(() => {
      card.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
      card.style.opacity = '1';
      card.style.transform = 'translateY(0)';
    }, 200 + i * 350);
  });
}

function buildCard(sat, idx) {
  const side = idx % 2 === 0 ? 'left' : 'right';
  const year = new Date(sat.launch).getFullYear();
  const isActive = sat.status === 'active';

  const card = document.createElement('div');
  card.className = `trs-card trs-card-${side}`;
  card.style.setProperty('--card-accent', sat.color);

  const highlights = sat.highlights.map(h => `<li>${h}</li>`).join('');

  card.innerHTML = `
    <div class="trs-card-dot" aria-hidden="true">
      <div class="trs-card-dot-inner${isActive ? ' active' : ''}"></div>
    </div>
    <div class="trs-card-year">${year}</div>
    <div class="trs-card-content">
      <div class="trs-card-head">
        <div class="trs-card-name">${sat.name}</div>
        <span class="trs-card-status ${sat.status}">${sat.statusText}</span>
      </div>
      <div class="trs-card-launch">${sat.launchStr}</div>
      <div class="trs-card-meta">
        <span>${sat.flag}</span>
        <span>${sat.rocket}</span>
        <span>${sat.site}</span>
      </div>

      <div class="trs-card-specs">
        <div class="trs-spec">
          <div class="trs-spec-label">Yörünge</div>
          <div class="trs-spec-val">${sat.orbit}</div>
        </div>
        <div class="trs-spec">
          <div class="trs-spec-label">Kütle</div>
          <div class="trs-spec-val">${sat.mass}</div>
        </div>
        <div class="trs-spec">
          <div class="trs-spec-label">Kamera / Sensör</div>
          <div class="trs-spec-val">${sat.camera}</div>
        </div>
        <div class="trs-spec trs-spec-res">
          <div class="trs-spec-label">Çözünürlük</div>
          <div class="trs-spec-val trs-res">${sat.resolution}</div>
        </div>
      </div>

      <ul class="trs-card-highlights">${highlights}</ul>

      <div class="trs-card-ids">
        <span>NORAD ${sat.noradId}</span>
        <span>COSPAR ${sat.cospar}</span>
        <span>${sat.builder}</span>
      </div>

      ${isActive ? `<a class="trs-card-track" href="./pass-tracker.html?sat=${sat.noradId}">Geçiş Takibi</a>` : ''}
    </div>
  `;

  return card;
}

// ───────── Start ─────────
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

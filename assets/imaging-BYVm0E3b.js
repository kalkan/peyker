import"./modulepreload-polyfill-B5Qt9EMX.js";/* empty css            */const l=[{id:"2d",title:"2D Planlayıcı",subtitle:"Tek hedef — harita üzerinde klasik planlama",desc:"Tek bir hedef noktası için geçiş fırsatlarını hesaplar. Leaflet tabanlı düz harita, roll/pitch kontrollü swath gösterimi, takvim dışa aktarımı.",href:"./imaging-planner.html",icon:'<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="12" cy="13" r="4"/><line x1="12" y1="3" x2="12" y2="7"/></svg>',color:"#58a6ff",bullets:["Hedef noktası","Swath · Roll","ICS takvim"]},{id:"3d",title:"3D Planlayıcı",subtitle:"Cesium küre üzerinde gerçek zamanlı 3B",desc:"Dünya küresi üzerinde yörünge izi ve roll konisini gerçek zamanlı görselleştirir. Fırsat zamanları + konum arama (Nominatim).",href:"./imaging-planner-3d.html",icon:'<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',color:"#d2a8ff",badge:"Beta",bullets:["3B küre","Roll konisi","Yer ismi arama"]},{id:"strip",title:"Şerit (Strip)",subtitle:"Push-broom tek geçiş şerit planlaması",desc:"Uzun koridor bölgeler için tek geçişte şerit çekimi. 2D planlayıcı ile aynı altyapı — tek fark hedef koridor seçimi.",href:"./imaging-planner.html#strip",icon:'<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M4 12h16M4 17h16"/><path d="M7 4v16M17 4v16" opacity="0.4"/></svg>',color:"#7ee787",bullets:["Tek pas","Koridor","Yüksek çözünürlük"]},{id:"gag",title:"Geniş Alan (GAG)",subtitle:"Çoklu geçiş ile alan kapsama",desc:"Büyük poligonu frame boyutunda karolara böler, her geçişte en çok yeni karoyu kapsayan şeridi seçerek %100 kapsamayı planlar.",href:"./gag.html",icon:'<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>',color:"#ffa657",badge:"Beta",bullets:["Poligon karolama","Greedy şerit","XML dışa aktar"]},{id:"stereo",title:"Stereo",subtitle:"DEM için çift geçiş planlama",desc:"Aynı hedefin farklı roll açılarıyla iki ayrı geçişte çekimini planlar — Sayısal Yükseklik Modeli (DEM) üretimi için.",href:null,icon:'<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12l10-8 10 8M2 18l10-8 10 8"/></svg>',color:"#ff7b72",badge:"Yakında",disabled:!0,bullets:["Çift pas","Roll farkı","DEM"]}];function t(){const e=document.getElementById("imaging-hub");if(!e)return;e.innerHTML=`
    <div class="hub-tabbar">
      <div class="hub-title">
        <span class="hub-icon" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="12" cy="13" r="4"/><line x1="12" y1="3" x2="12" y2="7"/>
          </svg>
        </span>
        Görüntüleme
      </div>
      <div class="hub-spacer"></div>
      <a href="./pass-tracker.html" class="hub-home" title="Geçiş Takibi">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        Geçiş Takibi
      </a>
      <a href="./stations.html" class="hub-home" title="İstasyonlar">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/><circle cx="12" cy="12" r="2"/><path d="M19.1 4.9C23 8.8 23 15.1 19.1 19"/></svg>
        İstasyonlar
      </a>
      <a href="./index.html" class="hub-home" title="Ana Sayfa">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
        Ana
      </a>
    </div>

    <main class="img-hub">
      <section class="img-hub-hero">
        <h1>Görüntüleme Planlama</h1>
        <p>Hedef alanına ve çekim moduna göre uygun planlama aracını seç.</p>
      </section>

      <section class="img-hub-grid" id="img-hub-grid" role="list"></section>

      <section class="img-hub-foot">
        <div class="img-hub-foot-title">İpucu</div>
        <div class="img-hub-foot-text">
          Uydular ana ekrandan veya geçiş takip ekranından eklenir, diğer planlayıcılar bu listeyi otomatik olarak paylaşır.
        </div>
      </section>
    </main>
  `;const i=document.getElementById("img-hub-grid");for(const a of l)i.append(n(a))}function n(e){const i=document.createElement(e.disabled?"div":"a");i.className="img-card"+(e.disabled?" disabled":""),i.setAttribute("role","listitem"),e.disabled?i.setAttribute("aria-disabled","true"):(i.href=e.href,i.setAttribute("aria-label",`${e.title} — ${e.subtitle}`)),i.style.setProperty("--card-color",e.color);const a=(e.bullets||[]).map(r=>`<li>${r}</li>`).join("");return i.innerHTML=`
    <div class="img-card-head">
      <div class="img-card-icon" aria-hidden="true">${e.icon}</div>
      ${e.badge?`<span class="img-card-badge">${e.badge}</span>`:""}
    </div>
    <div class="img-card-body">
      <h2 class="img-card-title">${e.title}</h2>
      <div class="img-card-sub">${e.subtitle}</div>
      <p class="img-card-desc">${e.desc}</p>
      <ul class="img-card-bullets">${a}</ul>
    </div>
    <div class="img-card-cta">
      ${e.disabled?"Hazırlanıyor":"Aç"}
      ${e.disabled?"":'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 5l7 7-7 7"/></svg>'}
    </div>
  `,i}document.readyState==="loading"?document.addEventListener("DOMContentLoaded",t):t();

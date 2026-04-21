import"./modulepreload-polyfill-B5Qt9EMX.js";const r=[{name:"BİLSAT-1",noradId:27943,cospar:"2003-042E",launch:"2003-09-27T06:12:00Z",launchStr:"27 Eylül 2003 · 06:12 UTC",rocket:"Kosmos-3M",site:"Plesetsk 132/1, Rusya",orbit:"SSO 686 km · 98.2° · 98.5 dk",mass:"130 kg",camera:"ÇOBAN — 12 m PAN, 26 m VNIR",resolution:"12 m",status:"inactive",statusText:"Görev Sona Erdi",color:"#8b949e",highlights:["Türkiye'nin ilk yer gözlem uydusu","SSTL-100 platformu, DMC takımyıldızı üyesi","Batarya hücresi arızası (Ağustos 2006) ile görev tamamlandı"],builder:"SSTL + TÜBİTAK",operator:"TÜBİTAK UZAY",flag:"TR · UK"},{name:"RASAT",noradId:37791,cospar:"2011-044D",launch:"2011-08-17T07:12:00Z",launchStr:"17 Ağustos 2011 · 07:12 UTC",rocket:"Dnepr",site:"Yasny, Rusya",orbit:"SSO ~700 km · 98.1° · 98.4 dk",mass:"93 kg",camera:"7.5 m PAN / 15 m MS",resolution:"7.5 m",status:"inactive",statusText:"İrtibat Kesildi (2022)",color:"#d29922",highlights:["Türkiye'de tasarlanıp üretilen ilk yerli yer gözlem uydusu","3 yıl tasarım ömrüne rağmen 11 yıl çalıştı","BİLGE uçuş bilgisayarı + GEZGİN görüntü işleme modülü"],builder:"TÜBİTAK UZAY",operator:"TÜBİTAK UZAY",flag:"TR"},{name:"GÖKTÜRK-2",noradId:39030,cospar:"2012-073A",launch:"2012-12-18T16:12:52Z",launchStr:"18 Aralık 2012 · 16:12 UTC",rocket:"Long March 2D (CZ-2D)",site:"Jiuquan, Çin",orbit:"SSO 686 km · 98.1° · LTAN 10:30",mass:"~450 kg",camera:"2.5 m PAN / 10 m VNIR / 20 m SWIR",resolution:"2.5 m",status:"active",statusText:"Aktif",color:"#7ee787",highlights:["%80 yerli teknoloji, %100 yerli yazılım","TÜBİTAK UZAY + TUSAŞ ortak geliştirme","12+ yıldır aktif görevde"],builder:"TÜBİTAK UZAY + TUSAŞ",operator:"MSB / Hava Kuvvetleri",flag:"TR"},{name:"GÖKTÜRK-1",noradId:41875,cospar:"2016-073A",launch:"2016-12-05T13:51:44Z",launchStr:"5 Aralık 2016 · 13:51 UTC",rocket:"Vega (VV08)",site:"Kourou, Fransız Guyanası",orbit:"SSO ~695 km · 98.11°",mass:"~1060 kg",camera:"HiRI — 0.50 m PAN / 2.0 m MS",resolution:"0.50 m",status:"active",statusText:"Aktif",color:"#58a6ff",highlights:["Türkiye'nin en yüksek çözünürlüklü (50 cm) aktif uydusu","Proteus platformu, Pleiades optik mirası","Telespazio/Thales Alenia — TAI, ASELSAN, TÜBİTAK, ROKETSAN"],builder:"Telespazio / Thales Alenia",operator:"MSB / Hava Kuvvetleri",flag:"TR · FR · IT"},{name:"GÖKTÜRK-2B",noradId:56178,cospar:"2023-054A",launch:"2023-04-15T06:48:00Z",launchStr:"15 Nisan 2023 · 06:48 UTC",rocket:"Falcon 9 Block 5",site:"Vandenberg SLC-4E, ABD",orbit:"SSO ~680 km",mass:"800 kg",camera:"0.99 m PAN / 3.96 m MSI · 13.9×16.2 km",resolution:"0.99 m",status:"active",statusText:"Aktif",color:"#d2a8ff",highlights:["Türkiye'nin ilk yerli metre-altı gözlem uydusu","TÜBİTAK UZAY tasarım + TUSAŞ Kahramankazan entegrasyon","5 yıl tasarım ömrü"],builder:"TÜBİTAK UZAY",operator:"TÜBİTAK UZAY",flag:"TR"},{name:"İMECE-2",noradId:null,cospar:null,launch:"2027-06-01T00:00:00Z",launchStr:"2027 (planlanıyor)",rocket:"—",site:"—",orbit:"SSO planlanıyor",mass:"—",camera:"~50 cm PAN hedefi",resolution:"0.50 m",status:"planned",statusText:"Planlanan",color:"#f0883e",highlights:["Türkiye'nin 50 cm çözünürlüklü uydusu","İMECE serisinin devamı — yerli tasarım"],builder:"TÜBİTAK UZAY",operator:"TÜBİTAK UZAY",flag:"TR"},{name:"İMECE-3",noradId:null,cospar:null,launch:"2028-06-01T00:00:00Z",launchStr:"2028 (planlanıyor)",rocket:"—",site:"—",orbit:"SSO planlanıyor",mass:"—",camera:"~50 cm PAN hedefi",resolution:"0.50 m",status:"planned",statusText:"Planlanan",color:"#f0883e",highlights:["İMECE serisinin 3. üyesi","Yerli üretim + yüksek çözünürlük devamı"],builder:"TÜBİTAK UZAY",operator:"TÜBİTAK UZAY",flag:"TR"}],A=5e3;let m=0,d=null,v=!0;function p(){const t=document.getElementById("tr-sat-app");if(!t)return;const s=y();t.innerHTML=`
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
        <div class="trs-idx" id="trs-idx">1 / ${r.length}</div>
      </div>
    </section>

    <section class="trs-detail" id="trs-detail"></section>

    <footer class="trs-footer">
      Peyker — Uydu Yer İzi Planlayıcı
    </footer>
  `,b(),S(s),E(s),$(),setTimeout(()=>{document.getElementById("trs-track").classList.add("loaded"),setTimeout(()=>{u(0,{animate:!0}),h()},1800)},200)}function y(){const t=r.map(n=>new Date(n.launch).getFullYear()),s=Math.min(...t)-1,e=Math.max(...t)+1;return{min:s,max:e}}function g(t,s){return(new Date(t).getFullYear()+new Date(t).getMonth()/12-s.min)/(s.max-s.min)}function b(){const t=document.getElementById("trs-stats"),s=r.filter(i=>i.status!=="planned"),e=r.filter(i=>i.status==="active").length,n=r.filter(i=>i.status==="planned").length,l=new Date(s[0].launch).getFullYear(),a=new Date().getFullYear()-l,o=Math.min(...s.filter(i=>i.status==="active").map(i=>parseFloat(i.resolution)));t.innerHTML=`
    <div class="trs-stat"><div class="trs-stat-val">${s.length}</div><div class="trs-stat-label">Fırlatılan</div></div>
    <div class="trs-stat"><div class="trs-stat-val trs-green">${e}</div><div class="trs-stat-label">Aktif</div></div>
    <div class="trs-stat"><div class="trs-stat-val trs-orange">${n}</div><div class="trs-stat-label">Planlanan</div></div>
    <div class="trs-stat"><div class="trs-stat-val">${a} yıl</div><div class="trs-stat-label">${l} — bugün</div></div>
    <div class="trs-stat"><div class="trs-stat-val trs-blue">${o} m</div><div class="trs-stat-label">En iyi çözünürlük</div></div>
  `}function S(t){const s=document.getElementById("trs-years"),e=t.max-t.min,n=e>20?5:e>10?3:2;for(let l=t.min;l<=t.max;l+=n){const a=(l-t.min)/e,o=document.createElement("div");o.className="trs-year-tick",o.style.left=`${a*100}%`,o.textContent=l,s.append(o)}}function E(t){const s=document.getElementById("trs-nodes");r.forEach((e,n)=>{const l=g(e.launch,t),a=document.createElement("button");a.className=`trs-node trs-node-${e.status}`,a.style.left=`${l*100}%`,a.style.setProperty("--node-color",e.color),a.style.transitionDelay=`${.3+n*.18}s`,a.setAttribute("aria-label",`${e.name} — ${e.launchStr}`),a.innerHTML=`
      <span class="trs-node-dot"></span>
      <span class="trs-node-label">
        <span class="trs-node-year">${new Date(e.launch).getFullYear()}</span>
        <span class="trs-node-name">${e.name}</span>
      </span>
    `,a.addEventListener("click",()=>{c(),u(n,{animate:!0})}),s.append(a)})}function u(t,s={}){m=t;const e=r[t],n=y(),l=g(e.launch,n);document.querySelectorAll(".trs-node").forEach((k,f)=>{k.classList.toggle("active",f===t)});const a=document.getElementById("trs-line-fg"),o=document.getElementById("trs-rocket");a.style.width=`${l*100}%`,a.style.background=`linear-gradient(90deg, #58a6ff, ${e.color})`,o.style.left=`${l*100}%`,o.classList.add("visible");const i=document.getElementById("trs-idx");i&&(i.textContent=`${t+1} / ${r.length}`),B(e,s.animate)}function B(t,s){const e=document.getElementById("trs-detail"),n=t.status==="active";t.status;const l=t.highlights.map(a=>`<li>${a}</li>`).join("");e.style.opacity=s?"0":"1",e.style.setProperty("--detail-color",t.color),e.innerHTML=`
    <div class="trs-detail-card">
      <div class="trs-detail-accent" aria-hidden="true"></div>
      <div class="trs-detail-head">
        <div class="trs-detail-title">
          <div class="trs-detail-name">${t.name}</div>
          <div class="trs-detail-launch">${t.launchStr}</div>
        </div>
        <div class="trs-detail-status trs-status-${t.status}">${t.statusText}</div>
      </div>

      <div class="trs-detail-meta">
        <span class="trs-chip">🇹🇷 ${t.flag}</span>
        <span class="trs-chip">🚀 ${t.rocket}</span>
        <span class="trs-chip">📍 ${t.site}</span>
      </div>

      <div class="trs-detail-grid">
        <div class="trs-spec">
          <div class="trs-spec-label">Yörünge</div>
          <div class="trs-spec-val">${t.orbit}</div>
        </div>
        <div class="trs-spec">
          <div class="trs-spec-label">Kütle</div>
          <div class="trs-spec-val">${t.mass}</div>
        </div>
        <div class="trs-spec trs-spec-wide">
          <div class="trs-spec-label">Kamera / Sensör</div>
          <div class="trs-spec-val">${t.camera}</div>
        </div>
        <div class="trs-spec trs-spec-res">
          <div class="trs-spec-label">Çözünürlük</div>
          <div class="trs-spec-val trs-res">${t.resolution}</div>
        </div>
      </div>

      <ul class="trs-detail-hl">${l}</ul>

      <div class="trs-detail-foot">
        ${t.noradId?`<span class="trs-mono">NORAD ${t.noradId}</span>`:""}
        ${t.cospar?`<span class="trs-mono">COSPAR ${t.cospar}</span>`:""}
        <span class="trs-builder">${t.builder}</span>
        ${n&&t.noradId?`<a class="trs-track-btn" href="./pass-tracker.html?sat=${t.noradId}">Geçiş Takibi →</a>`:""}
      </div>
    </div>
  `,s&&requestAnimationFrame(()=>{e.style.transition="opacity 0.45s ease, transform 0.45s ease",e.style.transform="translateY(12px)",e.style.opacity="0",requestAnimationFrame(()=>{e.style.transform="translateY(0)",e.style.opacity="1"})})}function $(){document.getElementById("trs-prev").addEventListener("click",()=>{c();const t=(m-1+r.length)%r.length;u(t,{animate:!0})}),document.getElementById("trs-next").addEventListener("click",()=>{c(),u((m+1)%r.length,{animate:!0})}),document.getElementById("trs-play").addEventListener("click",()=>{v?c():h()}),document.addEventListener("keydown",t=>{t.target.tagName==="INPUT"||t.target.tagName==="TEXTAREA"||(t.key==="ArrowLeft"?(c(),u((m-1+r.length)%r.length,{animate:!0})):t.key==="ArrowRight"?(c(),u((m+1)%r.length,{animate:!0})):t.key===" "&&(t.preventDefault(),v?c():h()))})}function h(){v=!0,T(),d&&clearInterval(d),d=setInterval(()=>{u((m+1)%r.length,{animate:!0})},A)}function c(){v=!1,T(),d&&(clearInterval(d),d=null)}function T(){const t=document.getElementById("trs-play"),s=document.getElementById("trs-play-icon");!s||!t||(v?(t.classList.add("playing"),t.setAttribute("aria-label","Oto-oynat durdur"),s.innerHTML='<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>'):(t.classList.remove("playing"),t.setAttribute("aria-label","Oto-oynat başlat"),s.innerHTML='<polygon points="6 4 20 12 6 20 6 4"/>'))}window.addEventListener("beforeunload",()=>{d&&clearInterval(d)});document.readyState==="loading"?document.addEventListener("DOMContentLoaded",p):p();

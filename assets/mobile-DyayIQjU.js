import"./modulepreload-polyfill-B5Qt9EMX.js";import{G as D,f as F,b as R,p as P}from"./fetch-B8wCyjRJ.js";const U="sat-groundtrack-state",S=D[0];let k=[],x=null,g=-1,T=null;function H(){z(),Y(),K()}function z(){try{const e=localStorage.getItem(U);if(!e)return;const t=JSON.parse(e);Array.isArray(t.satellites)&&(k=t.satellites.map(a=>({noradId:a.noradId,name:a.name,color:a.color,visible:a.visible!==!1,satrec:null,passes:null})),x=t.satellites.length>0?t.satellites[0].noradId:null)}catch{}}async function K(){const e=document.getElementById("m-status");for(const t of k)try{e&&(e.textContent=`${t.name} TLE yükleniyor...`);const a=await F(t.noradId);t.satrec=R(a.line1,a.line2),t.name=a.name,t.passes=P(t.satrec,S,7)}catch{e&&(e.textContent=`${t.name} TLE yüklenemedi`)}e&&(e.textContent=""),$()}function Y(){const e=document.getElementById("mobile-app");e.innerHTML=`
    <header class="m-header">
      <div class="m-header-top">
        <h1>Pass Tracker</h1>
        <a href="./index.html" class="m-back-link">Harita</a>
      </div>
      <div class="m-gs-info">${S.name} (${S.lat.toFixed(2)}°N, ${S.lon.toFixed(2)}°E)</div>
      <div id="m-status" class="m-status"></div>
    </header>
    <nav class="m-sat-tabs" id="m-sat-tabs"></nav>
    <main class="m-main" id="m-main">
      <div class="m-loading">Uydu verileri yükleniyor...</div>
    </main>
  `,I()}function I(){const e=document.getElementById("m-sat-tabs");if(e){if(e.innerHTML="",k.length>=2){const t=document.createElement("button");t.className="m-tab"+(x==="overlaps"?" active":""),t.textContent="Çakışmalar",t.style.borderColor="#f0883e",t.addEventListener("click",()=>{x="overlaps",g=-1,I(),$()}),e.append(t)}for(const t of k){const a=document.createElement("button");a.className="m-tab"+(x===t.noradId?" active":""),a.textContent=t.name,a.style.borderColor=t.color,a.addEventListener("click",()=>{x=t.noradId,g=-1,I(),$()}),e.append(a)}}}function $(){const e=document.getElementById("m-main");if(!e)return;if(e.innerHTML="",x==="overlaps"){Z(e);return}const t=k.find(a=>a.noradId===x);if(!t){e.innerHTML='<div class="m-empty">Uydu seçin</div>';return}if(!t.satrec){e.innerHTML='<div class="m-loading">TLE yükleniyor...</div>';return}j(e,t)}function j(e,t){const a=t.passes;if(!a||a.length===0){e.innerHTML='<div class="m-empty">7 gün içinde geçiş yok</div>';return}const n=Date.now(),s=a.findIndex(l=>l.los.getTime()>n);let o;g===-1?o=s>=0?s:0:o=Math.max(0,Math.min(g,a.length-1));const c=a[o],r=document.createElement("div");W(r,c,a,o,s,n),e.append(r);const i=document.createElement("div");i.className="m-section-title",i.textContent="Tüm Geçişler",e.append(i);const p=G(a);for(const[l,y]of p){const b=document.createElement("div");b.className="m-day-header",b.textContent=l,e.append(b);for(const m of y){const u=a.indexOf(m),f=document.createElement("div"),v=m.los.getTime()<n;f.className="m-pass-row"+(u===o?" active":"")+(v?" past":"");const h=A(m.maxEl);f.innerHTML=`
        <div class="m-pass-row-times">
          <span class="m-pass-row-time">${E(m.aos)}</span>
          <span class="m-pass-row-sep">→</span>
          <span class="m-pass-row-time">${E(m.los)}</span>
        </div>
        <div class="m-pass-row-meta">
          <span class="m-pass-row-dur">${O(m)}</span>
          <span class="m-el-badge ${h}">${m.maxEl.toFixed(1)}°</span>
        </div>
      `,f.addEventListener("click",()=>{g=u,$()}),e.append(f)}}const d=document.createElement("div");d.className="m-note",d.textContent=`${a.length} geçiş — TR saati (UTC+3)`,e.append(d)}function W(e,t,a,n,s,o){e.innerHTML="",T&&(clearInterval(T),T=null);const c=document.createElement("div");c.className="m-card";const r=t.aos.getTime()<=o&&t.los.getTime()>o,i=t.los.getTime()<=o;let p,d;r?(p="AKTİF GEÇİŞ",d="active"):n===s?(p="SONRAKİ GEÇİŞ",d=""):i?(p="GEÇMİŞ",d="past"):(p="GELECEK GEÇİŞ",d="");let l="";if(r){const M=t.los.getTime()-o;l=`
      <div class="m-countdown active">
        <div class="m-countdown-label">Geçiş bitimine kalan</div>
        <div class="m-countdown-value" data-target="${t.los.getTime()}">${C(M)}</div>
      </div>`}else if(!i){const M=t.aos.getTime()-o;l=`
      <div class="m-countdown">
        <div class="m-countdown-label">Geçişe kalan süre</div>
        <div class="m-countdown-value" data-target="${t.aos.getTime()}">${C(M)}</div>
      </div>`}const y=r?"el-high":t.maxEl>=30?"el-mid":t.maxEl>=10?"el-low":"el-vlow",m=q(t,r,r?"#3fb950":"#5daaff");c.innerHTML=`
    ${l}
    <div class="m-card-badge ${d}">${p}</div>
    ${m}
    <div class="m-card-el">
      <span class="m-card-el-val ${y}">${t.maxEl.toFixed(1)}°</span>
      <span class="m-card-el-label">maks. yükseklik</span>
    </div>
    <div class="m-card-times">
      <div class="m-card-time-row"><span class="m-card-time-label">AOS</span><span>${E(t.aos)}</span><span class="m-card-time-date">${N(t.aos)}</span></div>
      <div class="m-card-time-row"><span class="m-card-time-label">TCA</span><span>${E(t.tca)}</span><span class="m-card-time-date">${O(t)}</span></div>
      <div class="m-card-time-row"><span class="m-card-time-label">LOS</span><span>${E(t.los)}</span><span class="m-card-time-date">${N(t.los)}</span></div>
    </div>
  `,e.append(c);const u=c.querySelector(".m-countdown-value[data-target]");if(u){const M=parseInt(u.dataset.target,10);T=setInterval(()=>{const B=M-Date.now();if(B<=0){clearInterval(T),T=null,u.textContent="00:00:00";return}u.textContent=C(B)},1e3)}const f=document.createElement("div");f.className="m-nav";const v=document.createElement("button");v.className="m-nav-btn",v.textContent="◀",v.disabled=n<=0,v.addEventListener("click",()=>{g=n-1,$()});const h=document.createElement("span");h.className="m-nav-counter",h.textContent=`${n+1} / ${a.length}`;const w=document.createElement("button");w.className="m-nav-btn m-nav-home",w.textContent="Sonraki",w.disabled=s<0,w.addEventListener("click",()=>{g=-1,$()});const L=document.createElement("button");L.className="m-nav-btn",L.textContent="▶",L.disabled=n>=a.length-1,L.addEventListener("click",()=>{g=n+1,$()}),f.append(v,h,w,L),e.append(f)}function Z(e){const t=k.filter(i=>i.satrec&&i.passes);if(t.length<2){e.innerHTML='<div class="m-empty">Çakışma analizi için en az 2 uydu gerekli</div>';return}const a=[];for(const i of t)for(const p of i.passes)a.push({...p,sat:i});const n=_(a),s=document.createElement("div");if(s.className="m-section-title",s.textContent=`Çakışma Analizi — ${t.map(i=>i.name).join(", ")}`,e.append(s),n.length===0){e.innerHTML+='<div class="m-empty">7 gün içinde çakışma yok</div>';return}const o=Date.now(),c=G(n);for(const[i,p]of c){const d=document.createElement("div");d.className="m-day-header",d.textContent=i,e.append(d);for(const l of p){const y=document.createElement("div"),b=l.end.getTime()<o;y.className="m-overlap-card"+(b?" past":"");const m=Math.floor(l.durationSec/60),u=Math.floor(l.durationSec%60),f=m>0?`${m}dk ${u}sn`:`${u}sn`,v=A(l.maxElA),h=A(l.maxElB);y.innerHTML=`
        <div class="m-overlap-header">
          <div class="m-overlap-sats">
            <span class="m-overlap-chip" style="background:${l.satA.color}"></span>
            <span>${l.satA.name}</span>
            <span class="m-overlap-x">&times;</span>
            <span class="m-overlap-chip" style="background:${l.satB.color}"></span>
            <span>${l.satB.name}</span>
          </div>
          <span class="m-overlap-dur">${f}</span>
        </div>
        <div class="m-overlap-times">${E(l.start)} — ${E(l.end)}</div>
        <div class="m-overlap-els">
          <span>${l.satA.name}: <span class="m-el-badge ${v}">${l.maxElA.toFixed(1)}°</span></span>
          <span>${l.satB.name}: <span class="m-el-badge ${h}">${l.maxElB.toFixed(1)}°</span></span>
        </div>
      `,e.append(y)}}const r=document.createElement("div");r.className="m-note",r.textContent=`${n.length} çakışma — TR saati (UTC+3)`,e.append(r)}function _(e){const t=[];e.sort((a,n)=>a.aos-n.aos);for(let a=0;a<e.length;a++)for(let n=a+1;n<e.length;n++){const s=e[a],o=e[n];if(s.sat.noradId===o.sat.noradId)continue;if(o.aos>=s.los)break;const c=o.aos,r=new Date(Math.min(s.los.getTime(),o.los.getTime())),i=(r-c)/1e3;i>0&&t.push({satA:s.sat,satB:o.sat,start:c,end:r,durationSec:i,maxElA:s.maxEl,maxElB:o.maxEl})}return t.sort((a,n)=>a.start-n.start),t}function q(e,t,a){const n=Math.max(5,70-e.maxEl),s=Math.max(8,70-e.maxEl),o=Math.max(2,70-e.maxEl-8);return`<svg class="m-arc" viewBox="0 0 200 80" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="m-arc-grad" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="${a}" stop-opacity="0.1"/>
        <stop offset="50%" stop-color="${a}" stop-opacity="0.3"/>
        <stop offset="100%" stop-color="${a}" stop-opacity="0.1"/>
      </linearGradient>
    </defs>
    <path d="M10 70 Q100 ${n} 190 70" fill="none" stroke="url(#m-arc-grad)" stroke-width="2" stroke-dasharray="${t?"none":"4 3"}"/>
    <circle cx="10" cy="70" r="2" fill="#5c6980"/>
    <circle cx="190" cy="70" r="2" fill="#5c6980"/>
    ${t?`<circle cx="100" cy="${s}" r="4" fill="#3fb950" opacity="0.9"><animate attributeName="opacity" values="0.9;0.4;0.9" dur="2s" repeatCount="indefinite"/></circle>`:`<circle cx="100" cy="${s}" r="3" fill="${a}" opacity="0.7"/>`}
    <g transform="translate(95, 70)">
      <line x1="5" y1="0" x2="5" y2="-8" stroke="#98a4b8" stroke-width="1.2"/>
      <circle cx="5" cy="-8" r="3" fill="none" stroke="#98a4b8" stroke-width="1"/>
      <line x1="1" y1="-5" x2="-2" y2="-2" stroke="#98a4b8" stroke-width="0.8"/>
      <line x1="9" y1="-5" x2="12" y2="-2" stroke="#98a4b8" stroke-width="0.8"/>
    </g>
    <g transform="translate(95, ${o})">
      <rect x="0" y="2" width="10" height="6" rx="1" fill="#98a4b8" opacity="0.7"/>
      <rect x="-6" y="3" width="6" height="4" rx="0.5" fill="${a}" opacity="0.5"/>
      <rect x="10" y="3" width="6" height="4" rx="0.5" fill="${a}" opacity="0.5"/>
    </g>
    <text x="10" y="78" font-size="7" fill="#5c6980" font-family="sans-serif">AOS</text>
    <text x="180" y="78" font-size="7" fill="#5c6980" font-family="sans-serif">LOS</text>
  </svg>`}function C(e){if(e<=0)return"00:00:00";const t=Math.floor(e/1e3),a=Math.floor(t/86400),n=Math.floor(t%86400/3600),s=Math.floor(t%3600/60),o=t%60,c=r=>String(r).padStart(2,"0");return a>0?`${a}g ${c(n)}:${c(s)}:${c(o)}`:`${c(n)}:${c(s)}:${c(o)}`}function O(e){const t=(e.los-e.aos)/1e3,a=Math.floor(t/60),n=Math.floor(t%60);return`${a}dk ${n}sn`}function E(e){return e.toLocaleString("tr-TR",{timeZone:"Europe/Istanbul",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:!1})}function N(e){return e.toLocaleString("tr-TR",{timeZone:"Europe/Istanbul",day:"2-digit",month:"2-digit",year:"numeric"})}function G(e){const t=new Map;for(const a of e){const n=a.start||a.aos,s=N(n);t.has(s)||t.set(s,[]),t.get(s).push(a)}return t}function A(e){return e>=60?"el-high":e>=30?"el-mid":e>=10?"el-low":"el-vlow"}document.readyState==="loading"?document.addEventListener("DOMContentLoaded",H):H();

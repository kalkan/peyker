import"./modulepreload-polyfill-B5Qt9EMX.js";/* empty css            */const o=[{id:"gs",label:"GS Planlayıcı",src:"./gs-planner.html",devSrc:"./gs-planner-src.html",icon:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/></svg>'},{id:"antenna",label:"Anten Takip",src:"./antenna.html",devSrc:"./antenna-src.html",icon:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"/><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"/><path d="M19.1 4.9C23 8.8 23 15.1 19.1 19"/></svg>'}],c=new Map;let d=null;function r(){const t=document.getElementById("stations-hub");if(!t)return;t.innerHTML=`
    <div class="hub-tabbar">
      <div class="hub-title">
        <span class="hub-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"/><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"/><path d="M19.1 4.9C23 8.8 23 15.1 19.1 19"/>
          </svg>
        </span>
        İstasyonlar
      </div>
      <div class="hub-tabs" id="hub-tabs"></div>
      <a href="./index.html" class="hub-home" title="Ana Sayfa">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
        Ana
      </a>
    </div>
    <div class="hub-stage" id="hub-stage">
      <div class="hub-loading">Yükleniyor…</div>
    </div>
  `;const a=document.getElementById("hub-tabs");for(const n of o){const e=document.createElement("button");e.className="hub-tab",e.dataset.tabId=n.id,e.innerHTML=`
      ${n.icon}
      <span>${n.label}</span>
    `,e.addEventListener("click",()=>l(n.id)),a.append(e)}const s=(window.location.hash||"").replace("#",""),i=o.find(n=>n.id===s)?s:o[0].id;l(i),window.addEventListener("hashchange",()=>{const n=(window.location.hash||"").replace("#","");o.find(e=>e.id===n)&&n!==d&&l(n)})}function l(t){var n;const a=o.find(e=>e.id===t);if(!a)return;d=t,document.querySelectorAll(".hub-tab").forEach(e=>{e.classList.toggle("active",e.dataset.tabId===t)}),window.location.hash!==`#${t}`&&history.replaceState(null,"",`#${t}`);const s=document.getElementById("hub-stage");(n=s.querySelector(".hub-loading"))==null||n.remove();for(const e of c.values())e.classList.add("hidden");let i=c.get(t);i?i.classList.remove("hidden"):(i=document.createElement("iframe"),i.className="hub-frame",i.src=h(a),i.title=a.label,s.append(i),c.set(t,i))}function h(t){const a=window.location.pathname;return a.endsWith("-src.html")||a.includes("/src/")?t.devSrc:t.src}document.readyState==="loading"?document.addEventListener("DOMContentLoaded",r):r();

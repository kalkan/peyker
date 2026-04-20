import"./modulepreload-polyfill-B5Qt9EMX.js";/* empty css            */const s=[{id:"2d",label:"2D Planlayıcı",src:"./imaging-planner.html",devSrc:"./imaging-planner-src.html",icon:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="12" cy="13" r="4"/><line x1="12" y1="3" x2="12" y2="7"/></svg>'},{id:"3d",label:"3D Planlayıcı",badge:"Beta",src:"./imaging-planner-3d.html",devSrc:"./imaging-planner-3d-src.html",icon:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>'},{id:"gag",label:"Geniş Alan (GAG)",badge:"Beta",src:"./gag.html",devSrc:"./gag-src.html",icon:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>'}],r=new Map;let d=null;function c(){const n=document.getElementById("imaging-hub");if(!n)return;n.innerHTML=`
    <div class="hub-tabbar">
      <div class="hub-title">
        <span class="hub-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="12" cy="13" r="4"/><line x1="12" y1="3" x2="12" y2="7"/>
          </svg>
        </span>
        Görüntüleme
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
  `;const a=document.getElementById("hub-tabs");for(const e of s){const t=document.createElement("button");t.className="hub-tab",t.dataset.tabId=e.id,t.innerHTML=`
      ${e.icon}
      <span>${e.label}</span>
      ${e.badge?`<span class="hub-tab-badge">${e.badge}</span>`:""}
    `,t.addEventListener("click",()=>l(e.id)),a.append(t)}const o=(window.location.hash||"").replace("#",""),i=s.find(e=>e.id===o)?o:s[0].id;l(i),window.addEventListener("hashchange",()=>{const e=(window.location.hash||"").replace("#","");s.find(t=>t.id===e)&&e!==d&&l(e)})}function l(n){var e;const a=s.find(t=>t.id===n);if(!a)return;d=n,document.querySelectorAll(".hub-tab").forEach(t=>{t.classList.toggle("active",t.dataset.tabId===n)}),window.location.hash!==`#${n}`&&history.replaceState(null,"",`#${n}`);const o=document.getElementById("hub-stage");(e=o.querySelector(".hub-loading"))==null||e.remove();for(const t of r.values())t.classList.add("hidden");let i=r.get(n);i?i.classList.remove("hidden"):(i=document.createElement("iframe"),i.className="hub-frame",i.src=h(a),i.title=a.label,o.append(i),r.set(n,i))}function h(n){const a=window.location.pathname;return a.endsWith("-src.html")||a.includes("/src/")?n.devSrc:n.src}document.readyState==="loading"?document.addEventListener("DOMContentLoaded",c):c();

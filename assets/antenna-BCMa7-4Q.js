import"./modulepreload-polyfill-B5Qt9EMX.js";import{G as j,f as J,b as V,p as Q,i as tt}from"./fetch-CXkerRFA.js";const et="sat-groundtrack-state",w=j[0];let I=[],P=null,E=0,u=[],x=0,N=!1,F=null,U=1;function K(){at(),st(),nt()}function at(){try{const e=localStorage.getItem(et);if(!e)return;const a=JSON.parse(e);Array.isArray(a.satellites)&&(I=a.satellites.map(t=>({noradId:t.noradId,name:t.name,color:t.color,satrec:null,passes:null})),P=I.length>0?I[0].noradId:null)}catch{}}async function nt(){const e=document.getElementById("ant-status");for(const a of I)try{e&&(e.textContent=`${a.name} TLE yükleniyor...`);const t=await J(a.noradId);a.satrec=V(t.line1,t.line2),a.name=t.name,a.passes=Q(a.satrec,w,7)}catch{e&&(e.textContent=`${a.name} TLE yüklenemedi`)}e&&(e.textContent=""),X()}function st(){const e=document.getElementById("antenna-app");e.innerHTML=`
    <header class="ant-header">
      <div class="ant-header-top">
        <h1>Anten Takip</h1>
        <div class="ant-header-links">
          <a href="./index.html" class="ant-link">Harita</a>
          <a href="./mobile.html" class="ant-link">Mobil</a>
        </div>
      </div>
      <div class="ant-gs">${w.name} — ${w.lat.toFixed(4)}°N, ${w.lon.toFixed(4)}°E, ${w.alt}m</div>
      <div id="ant-status" class="ant-status"></div>
    </header>

    <div class="ant-controls">
      <div class="ant-select-row">
        <label>Uydu</label>
        <select id="ant-sat-select"></select>
      </div>
      <div class="ant-select-row">
        <label>Geçiş</label>
        <select id="ant-pass-select"></select>
      </div>
    </div>

    <div class="ant-viz-container">
      <div class="ant-viz-panel">
        <div class="ant-viz-title">3B Anten Görünümü</div>
        <canvas id="ant-3d" width="500" height="400"></canvas>
      </div>
      <div class="ant-viz-panel">
        <div class="ant-viz-title">Gökyüzü Haritası (Polar Plot)</div>
        <canvas id="ant-polar" width="400" height="400"></canvas>
      </div>
    </div>

    <div class="ant-data-strip" id="ant-data-strip">
      <div class="ant-data-item">
        <span class="ant-data-label">Azimut</span>
        <span class="ant-data-value" id="d-az">—</span>
      </div>
      <div class="ant-data-item">
        <span class="ant-data-label">Yükseklik</span>
        <span class="ant-data-value" id="d-el">—</span>
      </div>
      <div class="ant-data-item">
        <span class="ant-data-label">Mesafe</span>
        <span class="ant-data-value" id="d-range">—</span>
      </div>
      <div class="ant-data-item">
        <span class="ant-data-label">Zaman</span>
        <span class="ant-data-value" id="d-time">—</span>
      </div>
    </div>

    <div class="ant-timeline">
      <div class="ant-timeline-buttons">
        <button id="ant-play" class="ant-btn">▶ Oynat</button>
        <button id="ant-reset" class="ant-btn">⏮ Başa</button>
        <div class="ant-speed">
          <label>Hız</label>
          <select id="ant-speed-select">
            <option value="0.5">0.5x</option>
            <option value="1" selected>1x</option>
            <option value="2">2x</option>
            <option value="5">5x</option>
            <option value="10">10x</option>
          </select>
        </div>
      </div>
      <div class="ant-slider-row">
        <span id="ant-time-start" class="ant-time-label">--:--</span>
        <input type="range" id="ant-slider" min="0" max="1000" value="0" class="ant-slider" />
        <span id="ant-time-end" class="ant-time-label">--:--</span>
      </div>
    </div>
  `;const a=document.getElementById("ant-sat-select");for(const t of I){const i=document.createElement("option");i.value=t.noradId,i.textContent=t.name,t.noradId===P&&(i.selected=!0),a.append(i)}a.addEventListener("change",()=>{P=parseInt(a.value,10),E=0,X()}),document.getElementById("ant-pass-select").addEventListener("change",t=>{E=parseInt(t.target.value,10),Z()}),document.getElementById("ant-play").addEventListener("click",ct),document.getElementById("ant-reset").addEventListener("click",rt),document.getElementById("ant-slider").addEventListener("input",t=>{x=parseInt(t.target.value,10)/1e3,D(),H()}),document.getElementById("ant-speed-select").addEventListener("change",t=>{U=parseFloat(t.target.value)})}function lt(){const e=document.getElementById("ant-pass-select");e.innerHTML="";const a=I.find(t=>t.noradId===P);!a||!a.passes||a.passes.forEach((t,i)=>{const r=document.createElement("option");r.value=i;const l=t.los.getTime()<Date.now(),n=`${pt(t.aos)} — ${t.maxEl.toFixed(1)}°${l?" (geçmiş)":""}`;r.textContent=n,i===E&&(r.selected=!0),e.append(r)})}function X(){E=0;const e=I.find(a=>a.noradId===P);if(e&&e.passes){const a=Date.now(),t=e.passes.findIndex(i=>i.los.getTime()>a);t>=0&&(E=t)}lt(),Z()}function Z(){D(),x=0,document.getElementById("ant-slider").value=0,ot(),H()}function ot(){u=[];const e=I.find(n=>n.noradId===P);if(!e||!e.satrec||!e.passes||!e.passes[E])return;const a=e.passes[E],t=a.aos.getTime(),r=a.los.getTime()-t,l=Math.max(60,Math.ceil(r/1e3));for(let n=0;n<=l;n++){const m=t+r*n/l,f=new Date(m),s=tt(e.satrec,f,w);s&&u.push({time:m,az:s.azimuth,el:s.elevation,range:s.rangeSat})}document.getElementById("ant-time-start").textContent=Y(a.aos),document.getElementById("ant-time-end").textContent=Y(a.los)}function it(){if(u.length===0)return null;const e=Math.min(Math.floor(x*(u.length-1)),u.length-1);return u[e]}function ct(){N?D():dt()}function dt(){if(u.length===0)return;N=!0,document.getElementById("ant-play").textContent="⏸ Durdur";const a=I.find(n=>n.noradId===P).passes[E],i=(a.los.getTime()-a.aos.getTime())/U/60,r=33,l=r/i;x>=.999&&(x=0),F=setInterval(()=>{x+=l,x>=1&&(x=1,D()),document.getElementById("ant-slider").value=Math.round(x*1e3),H()},r)}function D(){N=!1,F&&(clearInterval(F),F=null),document.getElementById("ant-play").textContent="▶ Oynat"}function rt(){D(),x=0,document.getElementById("ant-slider").value=0,H()}function H(){const e=it();ft(e),mt(e),gt(e)}function ft(e){if(!e){document.getElementById("d-az").textContent="—",document.getElementById("d-el").textContent="—",document.getElementById("d-range").textContent="—",document.getElementById("d-time").textContent="—";return}document.getElementById("d-az").textContent=e.az.toFixed(2)+"°",document.getElementById("d-el").textContent=e.el.toFixed(2)+"°",document.getElementById("d-range").textContent=e.range.toFixed(1)+" km",document.getElementById("d-time").textContent=Y(new Date(e.time))}function mt(e){const a=document.getElementById("ant-3d");if(!a)return;const t=a.getContext("2d"),i=a.width,r=a.height;t.clearRect(0,0,i,r);const l=e?e.az:0,n=e?Math.max(0,e.el):45,m=(l-90)*Math.PI/180,f=n*Math.PI/180,s=i/2,o=r*.75,v=t.createLinearGradient(0,0,0,o);v.addColorStop(0,"#0a0e1a"),v.addColorStop(1,"#1a1e2e"),t.fillStyle=v,t.fillRect(0,0,i,o);const y=t.createLinearGradient(0,o,0,r);y.addColorStop(0,"#1a2a1a"),y.addColorStop(1,"#0d1a0d"),t.fillStyle=y,t.fillRect(0,o,i,r-o),t.strokeStyle="rgba(63, 185, 80, 0.1)",t.lineWidth=.5;for(let h=-8;h<=8;h++){const g=s+h*30,p=s+h*80;t.beginPath(),t.moveTo(g,o),t.lineTo(p,r),t.stroke()}for(let h=1;h<=4;h++){const g=o+h*(r-o)/4,p=.3+.7*(h/4);t.beginPath(),t.moveTo(s-250*p,g),t.lineTo(s+250*p,g),t.stroke()}const S=[.1,.3,.5,.7,.85,.15,.45,.65,.9,.25,.55,.78,.05,.35,.62];t.fillStyle="rgba(255, 255, 255, 0.5)";for(let h=0;h<S.length;h++){const g=S[h]*i,p=S[(h+5)%S.length]*o*.85;t.beginPath(),t.arc(g,p,.8,0,Math.PI*2),t.fill()}t.fillStyle="rgba(255, 255, 255, 0.3)",t.font="11px sans-serif",t.textAlign="center",t.fillText("K",s,o-5),t.fillText("G",s,r-4),t.fillText("D",i-20,o+15),t.fillText("B",20,o+15);const c=40,d=12;t.fillStyle="#3a4a5a",t.fillRect(s-c/2,o-d,c,d),t.fillStyle="#2a3a4a",t.fillRect(s-c/2-4,o-d-3,c+8,4);const b=50,M=8;t.fillStyle="#4a5a6a",t.fillRect(s-M/2,o-d-b,M,b);const k=s,W=o-d-b;t.save(),t.translate(k,W);const C=Math.sin(m),q=55,z=-f,A=C*Math.cos(z)*q,R=Math.sin(z)*q;if(e&&e.el>0){const g=C*Math.cos(z)*130,p=Math.sin(z)*130,T=t.createLinearGradient(A,R,g,p);T.addColorStop(0,"rgba(93, 170, 255, 0.25)"),T.addColorStop(.5,"rgba(93, 170, 255, 0.08)"),T.addColorStop(1,"rgba(93, 170, 255, 0)");const L=20,G=-Math.sin(z)*C,$=Math.cos(z);t.beginPath(),t.moveTo(A-G*5,R-$*5),t.lineTo(g-G*L,p-$*L),t.lineTo(g+G*L,p+$*L),t.lineTo(A+G*5,R+$*5),t.closePath(),t.fillStyle=T,t.fill()}t.strokeStyle="#6a7a8a",t.lineWidth=3,t.beginPath(),t.moveTo(0,0),t.lineTo(A,R),t.stroke();const B=36;t.save(),t.translate(A,R);const _=Math.atan2(R,A);t.rotate(_),t.beginPath(),t.moveTo(0,-B/2),t.quadraticCurveTo(-12,0,0,B/2),t.strokeStyle="#8a9aaa",t.lineWidth=2,t.stroke(),t.beginPath(),t.moveTo(0,-B/2),t.quadraticCurveTo(-12,0,0,B/2),t.lineTo(0,-B/2);const O=t.createLinearGradient(-12,0,4,0);if(O.addColorStop(0,"rgba(120, 140, 170, 0.6)"),O.addColorStop(1,"rgba(80, 100, 130, 0.3)"),t.fillStyle=O,t.fill(),t.beginPath(),t.moveTo(0,-B/2),t.quadraticCurveTo(-14,0,0,B/2),t.strokeStyle="#aabbcc",t.lineWidth=1.5,t.stroke(),t.fillStyle="#5daaff",t.beginPath(),t.arc(4,0,3,0,Math.PI*2),t.fill(),t.restore(),t.restore(),e&&e.el>0){const h=o-20,g=s+C*Math.cos(f)*180,p=o-20-n/90*h*.85,T=t.createRadialGradient(g,p,0,g,p,20);T.addColorStop(0,"rgba(93, 170, 255, 0.4)"),T.addColorStop(1,"rgba(93, 170, 255, 0)"),t.fillStyle=T,t.beginPath(),t.arc(g,p,20,0,Math.PI*2),t.fill(),t.fillStyle="#aabbcc",t.fillRect(g-4,p-2,8,4),t.fillStyle="#5daaff",t.fillRect(g-12,p-1.5,7,3),t.fillRect(g+5,p-1.5,7,3),t.fillStyle="rgba(93, 170, 255, 0.8)",t.font="11px sans-serif",t.textAlign="center";const L=I.find(G=>G.noradId===P);t.fillText(L?L.name:"",g,p-14)}t.fillStyle="rgba(255, 255, 255, 0.6)",t.font="13px monospace",t.textAlign="left",t.fillText(`Az: ${l.toFixed(1)}°`,10,20),t.fillText(`El: ${n.toFixed(1)}°`,10,36)}function gt(e){const a=document.getElementById("ant-polar");if(!a)return;const t=a.getContext("2d"),i=a.width,r=a.height;t.clearRect(0,0,i,r);const l=i/2,n=r/2,m=Math.min(l,n)-30;t.fillStyle="#0d1117",t.fillRect(0,0,i,r),t.strokeStyle="rgba(255, 255, 255, 0.1)",t.lineWidth=.8;for(const f of[0,15,30,45,60,75]){const s=m*(1-f/90);t.beginPath(),t.arc(l,n,s,0,Math.PI*2),t.stroke()}t.fillStyle="rgba(255, 255, 255, 0.3)",t.font="10px sans-serif",t.textAlign="center";for(const f of[0,30,60]){const s=m*(1-f/90);t.fillText(f+"°",l+s+14,n+4)}t.strokeStyle="rgba(255, 255, 255, 0.07)";for(let f=0;f<360;f+=30){const s=(f-90)*Math.PI/180;t.beginPath(),t.moveTo(l,n),t.lineTo(l+m*Math.cos(s),n+m*Math.sin(s)),t.stroke()}if(t.fillStyle="rgba(255, 255, 255, 0.5)",t.font="bold 13px sans-serif",t.textAlign="center",t.textBaseline="middle",t.fillText("K",l,n-m-14),t.fillText("G",l,n+m+14),t.fillText("D",l+m+14,n),t.fillText("B",l-m-14,n),u.length>1){t.beginPath();let f=!0;for(const c of u){if(c.el<0)continue;const d=m*(1-c.el/90),b=(c.az-90)*Math.PI/180,M=l+d*Math.cos(b),k=n+d*Math.sin(b);f?(t.moveTo(M,k),f=!1):t.lineTo(M,k)}if(t.strokeStyle="rgba(93, 170, 255, 0.5)",t.lineWidth=2,t.stroke(),e){const c=Math.floor(x*(u.length-1));t.beginPath(),f=!0;for(let d=0;d<=c&&d<u.length;d++){const b=u[d];if(b.el<0)continue;const M=m*(1-b.el/90),k=(b.az-90)*Math.PI/180,W=l+M*Math.cos(k),C=n+M*Math.sin(k);f?(t.moveTo(W,C),f=!1):t.lineTo(W,C)}t.strokeStyle="#5daaff",t.lineWidth=3,t.stroke()}const s=u[0],o=u[u.length-1];if(s.el>=0){const c=m*(1-s.el/90),d=(s.az-90)*Math.PI/180;t.fillStyle="#3fb950",t.beginPath(),t.arc(l+c*Math.cos(d),n+c*Math.sin(d),4,0,Math.PI*2),t.fill(),t.fillStyle="rgba(63, 185, 80, 0.7)",t.font="10px sans-serif",t.fillText("AOS",l+c*Math.cos(d),n+c*Math.sin(d)-10)}if(o.el>=0){const c=m*(1-o.el/90),d=(o.az-90)*Math.PI/180;t.fillStyle="#f85149",t.beginPath(),t.arc(l+c*Math.cos(d),n+c*Math.sin(d),4,0,Math.PI*2),t.fill(),t.fillStyle="rgba(248, 81, 73, 0.7)",t.font="10px sans-serif",t.fillText("LOS",l+c*Math.cos(d),n+c*Math.sin(d)-10)}let v=u[0];for(const c of u)c.el>v.el&&(v=c);const y=m*(1-v.el/90),S=(v.az-90)*Math.PI/180;t.strokeStyle="rgba(210, 153, 34, 0.6)",t.lineWidth=1,t.beginPath(),t.arc(l+y*Math.cos(S),n+y*Math.sin(S),7,0,Math.PI*2),t.stroke(),t.fillStyle="rgba(210, 153, 34, 0.7)",t.font="10px sans-serif",t.fillText(`TCA ${v.el.toFixed(1)}°`,l+y*Math.cos(S)+10,n+y*Math.sin(S)-4)}if(e&&e.el>=0){const f=m*(1-e.el/90),s=(e.az-90)*Math.PI/180,o=l+f*Math.cos(s),v=n+f*Math.sin(s),y=t.createRadialGradient(o,v,0,o,v,14);y.addColorStop(0,"rgba(93, 170, 255, 0.5)"),y.addColorStop(1,"rgba(93, 170, 255, 0)"),t.fillStyle=y,t.beginPath(),t.arc(o,v,14,0,Math.PI*2),t.fill(),t.fillStyle="#5daaff",t.beginPath(),t.arc(o,v,5,0,Math.PI*2),t.fill(),t.strokeStyle="#fff",t.lineWidth=1.5,t.stroke()}}function Y(e){return e.toLocaleString("tr-TR",{timeZone:"Europe/Istanbul",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:!1})}function pt(e){return e.toLocaleString("tr-TR",{timeZone:"Europe/Istanbul",day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit",hour12:!1})}document.readyState==="loading"?document.addEventListener("DOMContentLoaded",K):K();

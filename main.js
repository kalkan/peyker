const PRESETS = {
  IMECE: "48274",
  GOKTURK2: "39084",
};

function byId(id) {
  return document.getElementById(id);
}

function formatDateTimeLocal(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function downloadTextFile(filename, text, mime = "application/vnd.google-earth.kml+xml;charset=utf-8") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function escapeXml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function buildKml({ name, point, currentTrack = [], futureTrack = [] }) {
  const coordText = (coords) => coords.map(([lat, lon, alt = 0]) => `${lon},${lat},${alt}`).join(" ");
  const parts = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<kml xmlns="http://www.opengis.net/kml/2.2">`,
    `<Document>`,
    `<name>${escapeXml(name)}</name>`,
    `<Style id="currentLine"><LineStyle><color>ff00ffff</color><width>3</width></LineStyle></Style>`,
    `<Style id="futureLine"><LineStyle><color>ff00a5ff</color><width>3</width></LineStyle></Style>`,
    `<Style id="satPoint"><IconStyle><scale>1.1</scale></IconStyle></Style>`,
  ];

  if (point) {
    parts.push(
      `<Placemark><name>${escapeXml(name)} - Canlı Konum</name><styleUrl>#satPoint</styleUrl><Point><coordinates>${point[1]},${point[0]},${point[2] || 0}</coordinates></Point></Placemark>`
    );
  }

  if (currentTrack.length) {
    parts.push(
      `<Placemark><name>${escapeXml(name)} - Canlı İz</name><styleUrl>#currentLine</styleUrl><LineString><tessellate>1</tessellate><coordinates>${coordText(currentTrack)}</coordinates></LineString></Placemark>`
    );
  }

  if (futureTrack.length) {
    parts.push(
      `<Placemark><name>${escapeXml(name)} - Tahmin İzi</name><styleUrl>#futureLine</styleUrl><LineString><tessellate>1</tessellate><coordinates>${coordText(futureTrack)}</coordinates></LineString></Placemark>`
    );
  }

  parts.push(`</Document></kml>`);
  return parts.join("");
}

function extractEpochFromTle(line1) {
  try {
    const year = parseInt(line1.slice(18, 20), 10);
    const dayOfYear = parseFloat(line1.slice(20, 32));
    const fullYear = year < 57 ? 2000 + year : 1900 + year;
    const start = new Date(Date.UTC(fullYear, 0, 1, 0, 0, 0));
    const epoch = new Date(start.getTime() + (dayOfYear - 1) * 86400000);
    return epoch.toISOString().replace("T", " ").replace(".000Z", " UTC");
  } catch {
    return "-";
  }
}

async function fetchTle(noradId) {
  const url = `https://celestrak.org/NORAD/elements/gp.php?CATNR=${encodeURIComponent(noradId)}&FORMAT=TLE`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TLE alınamadı. HTTP ${res.status}`);

  const text = (await res.text()).trim();
  const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (lines.length < 2) throw new Error("Bu NORAD ID için TLE bulunamadı.");

  let name = `NORAD ${noradId}`;
  let line1;
  let line2;

  if (lines.length >= 3) {
    [name, line1, line2] = lines;
  } else {
    [line1, line2] = lines;
  }

  return {
    name,
    line1,
    line2,
    norad: noradId,
    epoch: extractEpochFromTle(line1),
  };
}

class SatelliteTracker {
  constructor() {
    this.tle = null;
    this.satrec = null;
  }

  setTle(tle) {
    this.tle = tle;
    this.satrec = satellite.twoline2satrec(tle.line1, tle.line2);
  }

  compute(date = new Date()) {
    if (!this.satrec) return null;
    const pv = satellite.propagate(this.satrec, date);
    if (!pv.position) return null;

    const gmst = satellite.gstime(date);
    const geodetic = satellite.eciToGeodetic(pv.position, gmst);
    const lat = satellite.degreesLat(geodetic.latitude);
    const lon = satellite.degreesLong(geodetic.longitude);
    const altKm = geodetic.height;
    const speedKmS = pv.velocity
      ? Math.sqrt(pv.velocity.x ** 2 + pv.velocity.y ** 2 + pv.velocity.z ** 2)
      : null;

    return {
      date,
      lat,
      lon,
      altKm,
      speedKmS,
      cartesian: Cesium.Cartesian3.fromDegrees(lon, lat, altKm * 1000),
    };
  }

  buildTrack({ start = new Date(), end, stepMinutes = 5 }) {
    if (!this.satrec || !end || end <= start) return [];
    const points = [];
    const stepMs = Math.max(1, stepMinutes) * 60 * 1000;

    for (let t = start.getTime(); t <= end.getTime(); t += stepMs) {
      const p = this.compute(new Date(t));
      if (p) points.push(p);
    }
    return points;
  }

  buildCenteredTrack(spanMinutes = 90, stepMinutes = 2) {
    const now = new Date();
    return this.buildTrack({
      start: new Date(now.getTime() - spanMinutes * 60 * 1000),
      end: new Date(now.getTime() + spanMinutes * 60 * 1000),
      stepMinutes,
    });
  }
}

const tracker2d = new SatelliteTracker();
const tracker3d = new SatelliteTracker();

const els = {
  tabButtons: document.querySelectorAll(".tab-btn"),
  panels: document.querySelectorAll(".panel"),
  viewers: {
    "2d": byId("map2d"),
    "3d": byId("cesiumContainer"),
  },

  noradId2d: byId("noradId2d"),
  loadBtn2d: byId("loadBtn2d"),
  status2d: byId("status2d"),
  satName2d: byId("satName2d"),
  satNorad2d: byId("satNorad2d"),
  satLat2d: byId("satLat2d"),
  satLon2d: byId("satLon2d"),
  satAlt2d: byId("satAlt2d"),
  satSpeed2d: byId("satSpeed2d"),
  satEpoch2d: byId("satEpoch2d"),
  showCurrentTrack2d: byId("showCurrentTrack2d"),
  showFutureTrack2d: byId("showFutureTrack2d"),
  autoCenter2d: byId("autoCenter2d"),
  forecastStart: byId("forecastStart"),
  forecastHours: byId("forecastHours"),
  forecastStep: byId("forecastStep"),
  drawForecastBtn: byId("drawForecastBtn"),
  tomorrowBtn: byId("tomorrowBtn"),
  nowBtn: byId("nowBtn"),
  clearForecastBtn: byId("clearForecastBtn"),
  exportCurrentKmlBtn: byId("exportCurrentKmlBtn"),
  exportForecastKmlBtn: byId("exportForecastKmlBtn"),

  noradId3d: byId("noradId3d"),
  loadBtn3d: byId("loadBtn3d"),
  status3d: byId("status3d"),
  satName3d: byId("satName3d"),
  satNorad3d: byId("satNorad3d"),
  satLat3d: byId("satLat3d"),
  satLon3d: byId("satLon3d"),
  satAlt3d: byId("satAlt3d"),
  satSpeed3d: byId("satSpeed3d"),
  satEpoch3d: byId("satEpoch3d"),
  followToggle3d: byId("followToggle3d"),
  orbitToggle3d: byId("orbitToggle3d"),
  camHomeBtn: byId("camHomeBtn"),
  camResetNorthBtn: byId("camResetNorthBtn"),
  camToSatelliteBtn: byId("camToSatelliteBtn"),
  camZoomInBtn: byId("camZoomInBtn"),
  camZoomOutBtn: byId("camZoomOutBtn"),
  camTiltUpBtn: byId("camTiltUpBtn"),
  camTiltDownBtn: byId("camTiltDownBtn"),
  camLeftBtn: byId("camLeftBtn"),
  camRightBtn: byId("camRightBtn"),
};

function setStatus(which, msg, isError = false) {
  const el = which === "2d" ? els.status2d : els.status3d;
  el.textContent = msg;
  el.style.color = isError ? "#ff8f8f" : "#7ce0c3";
}

function setInfo(which, { name = "-", norad = "-", lat = "-", lon = "-", alt = "-", speed = "-", epoch = "-" }) {
  const suffix = which === "2d" ? "2d" : "3d";
  els[`satName${suffix}`].textContent = name;
  els[`satNorad${suffix}`].textContent = norad;
  els[`satLat${suffix}`].textContent = lat;
  els[`satLon${suffix}`].textContent = lon;
  els[`satAlt${suffix}`].textContent = alt;
  els[`satSpeed${suffix}`].textContent = speed;
  els[`satEpoch${suffix}`].textContent = epoch;
}

function updateInfoFromPoint(which, tracker, point) {
  if (!point || !tracker.tle) return;
  setInfo(which, {
    name: tracker.tle.name,
    norad: tracker.tle.norad,
    lat: `${point.lat.toFixed(4)}°`,
    lon: `${point.lon.toFixed(4)}°`,
    alt: `${point.altKm.toFixed(2)} km`,
    speed: point.speedKmS ? `${point.speedKmS.toFixed(3)} km/s` : "-",
    epoch: tracker.tle.epoch || "-",
  });
}

function switchTab(tab) {
  els.tabButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.tab === tab));
  els.panels.forEach((panel) => panel.classList.toggle("active", panel.dataset.panel === tab));
  Object.entries(els.viewers).forEach(([key, node]) => node.classList.toggle("active", key === tab));

  if (tab === "2d") {
    map.invalidateSize();
  } else {
    viewer.resize();
  }
}

els.tabButtons.forEach((btn) => btn.addEventListener("click", () => switchTab(btn.dataset.tab)));

// 2D MAP
const map = L.map("map2d", {
  worldCopyJump: true,
  preferCanvas: true,
}).setView([39.0, 35.0], 3);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 18,
  attribution: '&copy; OpenStreetMap contributors',
}).addTo(map);

const marker2d = L.circleMarker([0, 0], {
  radius: 7,
  color: "#00e5ff",
  weight: 2,
  fillColor: "#00e5ff",
  fillOpacity: 0.9,
}).addTo(map);

const currentTrackLayer2d = L.polyline([], { color: "#00ffff", weight: 3 }).addTo(map);
const futureTrackLayer2d = L.polyline([], { color: "#4da3ff", weight: 3, dashArray: "8 8" }).addTo(map);

let currentTrackPoints2d = [];
let futureTrackPoints2d = [];

function setForecastDefaultNow(offsetHours = 0) {
  const d = new Date(Date.now() + offsetHours * 3600 * 1000);
  els.forecastStart.value = formatDateTimeLocal(d);
}
setForecastDefaultNow();

function applyTrackVisibility2d() {
  if (els.showCurrentTrack2d.checked) {
    currentTrackLayer2d.addTo(map);
  } else {
    currentTrackLayer2d.remove();
  }

  if (els.showFutureTrack2d.checked) {
    futureTrackLayer2d.addTo(map);
  } else {
    futureTrackLayer2d.remove();
  }
}

function redrawCurrentTrack2d() {
  currentTrackPoints2d = tracker2d.buildCenteredTrack(90, 2);
  currentTrackLayer2d.setLatLngs(currentTrackPoints2d.map((p) => [p.lat, p.lon]));
}

function redrawFutureTrack2d() {
  if (!tracker2d.tle) return;
  const start = new Date(els.forecastStart.value);
  const hours = Number(els.forecastHours.value) || 24;
  const step = Number(els.forecastStep.value) || 5;
  if (Number.isNaN(start.getTime())) {
    setStatus("2d", "Geçerli bir tarih/saat seç.", true);
    return;
  }

  const end = new Date(start.getTime() + hours * 3600 * 1000);
  futureTrackPoints2d = tracker2d.buildTrack({ start, end, stepMinutes: step });
  futureTrackLayer2d.setLatLngs(futureTrackPoints2d.map((p) => [p.lat, p.lon]));
  if (futureTrackPoints2d.length) {
    map.fitBounds(futureTrackLayer2d.getBounds(), { padding: [30, 30] });
  }
  setStatus("2d", `Tahmin izi çizildi: ${hours} saat / ${step} dk adım`);
}

function clearFutureTrack2d() {
  futureTrackPoints2d = [];
  futureTrackLayer2d.setLatLngs([]);
  setStatus("2d", "Tahmin izi temizlendi.");
}

async function loadSatellite2d(noradId) {
  setStatus("2d", "Uydu verisi alınıyor...");
  setInfo("2d", {});

  try {
    const tle = await fetchTle(noradId);
    tracker2d.setTle(tle);
    const nowPoint = tracker2d.compute(new Date());
    if (!nowPoint) throw new Error("Uydu konumu hesaplanamadı.");

    updateInfoFromPoint("2d", tracker2d, nowPoint);
    marker2d.setLatLng([nowPoint.lat, nowPoint.lon]).bindPopup(`<b>${tle.name}</b><br>NORAD: ${tle.norad}`);

    redrawCurrentTrack2d();
    redrawFutureTrack2d();

    if (els.autoCenter2d.checked) {
      map.setView([nowPoint.lat, nowPoint.lon], 4);
    }

    setStatus("2d", `Yüklendi: ${tle.name}`);
  } catch (err) {
    tracker2d.tle = null;
    tracker2d.satrec = null;
    currentTrackLayer2d.setLatLngs([]);
    futureTrackLayer2d.setLatLngs([]);
    setStatus("2d", err.message || "Bir hata oluştu.", true);
  }
}

function update2dLive() {
  const point = tracker2d.compute(new Date());
  if (!point || !tracker2d.tle) return;

  updateInfoFromPoint("2d", tracker2d, point);
  marker2d.setLatLng([point.lat, point.lon]);

  if (els.autoCenter2d.checked) {
    map.panTo([point.lat, point.lon], { animate: false });
  }

  if (els.showCurrentTrack2d.checked) {
    redrawCurrentTrack2d();
  }
}

els.loadBtn2d.addEventListener("click", () => {
  const id = els.noradId2d.value.trim();
  if (!id) return setStatus("2d", "Lütfen bir NORAD ID gir.", true);
  loadSatellite2d(id);
});

els.noradId2d.addEventListener("keydown", (e) => {
  if (e.key === "Enter") els.loadBtn2d.click();
});

document.querySelectorAll(".quick-2d").forEach((btn) => {
  btn.addEventListener("click", () => {
    els.noradId2d.value = btn.dataset.id;
    loadSatellite2d(btn.dataset.id);
  });
});

els.drawForecastBtn.addEventListener("click", redrawFutureTrack2d);
els.clearForecastBtn.addEventListener("click", clearFutureTrack2d);
els.nowBtn.addEventListener("click", () => {
  setForecastDefaultNow();
  redrawFutureTrack2d();
});
els.tomorrowBtn.addEventListener("click", () => {
  setForecastDefaultNow(24);
  redrawFutureTrack2d();
});

els.showCurrentTrack2d.addEventListener("change", applyTrackVisibility2d);
els.showFutureTrack2d.addEventListener("change", applyTrackVisibility2d);

els.exportCurrentKmlBtn.addEventListener("click", () => {
  if (!tracker2d.tle || !currentTrackPoints2d.length) return setStatus("2d", "Önce uydu yükle.", true);
  const p = tracker2d.compute(new Date());
  const kml = buildKml({
    name: tracker2d.tle.name,
    point: p ? [p.lat, p.lon, Math.round(p.altKm * 1000)] : null,
    currentTrack: currentTrackPoints2d.map((x) => [x.lat, x.lon, Math.round(x.altKm * 1000)]),
  });
  downloadTextFile(`${tracker2d.tle.name.replace(/\s+/g, "_")}_canli_iz.kml`, kml);
  setStatus("2d", "Canlı iz KML indirildi.");
});

els.exportForecastKmlBtn.addEventListener("click", () => {
  if (!tracker2d.tle || !futureTrackPoints2d.length) return setStatus("2d", "Önce tahmin izi çiz.", true);
  const p = tracker2d.compute(new Date());
  const kml = buildKml({
    name: tracker2d.tle.name,
    point: p ? [p.lat, p.lon, Math.round(p.altKm * 1000)] : null,
    futureTrack: futureTrackPoints2d.map((x) => [x.lat, x.lon, Math.round(x.altKm * 1000)]),
  });
  downloadTextFile(`${tracker2d.tle.name.replace(/\s+/g, "_")}_tahmin_iz.kml`, kml);
  setStatus("2d", "Tahmin KML indirildi.");
});

applyTrackVisibility2d();

// 3D VIEWER
const viewer = new Cesium.Viewer("cesiumContainer", {
  animation: false,
  timeline: false,
  baseLayerPicker: true,
  geocoder: false,
  homeButton: true,
  sceneModePicker: false,
  navigationHelpButton: false,
  fullscreenButton: true,
  shouldAnimate: true,
  infoBox: false,
  selectionIndicator: false,
});
viewer.scene.globe.enableLighting = true;
viewer.scene.skyAtmosphere.show = true;
viewer.clock.multiplier = 1;
viewer.clock.shouldAnimate = true;
viewer.scene.globe.depthTestAgainstTerrain = false;

const homeView = {
  destination: Cesium.Cartesian3.fromDegrees(35.0, 39.0, 19000000),
};
viewer.homeButton.viewModel.command.beforeExecute.addEventListener((e) => {
  e.cancel = true;
  viewer.camera.flyTo(homeView);
});
viewer.camera.flyTo(homeView);

let satelliteEntity3d = null;
let labelEntity3d = null;
let orbitEntity3d = null;
let startedTracking3d = false;

function buildOrbitPositions3d() {
  const pts = tracker3d.buildCenteredTrack(90, 2);
  return pts.map((p) => p.cartesian);
}

function clearEntities3d() {
  if (satelliteEntity3d) viewer.entities.remove(satelliteEntity3d);
  if (labelEntity3d) viewer.entities.remove(labelEntity3d);
  if (orbitEntity3d) viewer.entities.remove(orbitEntity3d);
  satelliteEntity3d = null;
  labelEntity3d = null;
  orbitEntity3d = null;
}

function createEntities3d() {
  clearEntities3d();

  const positionProperty = new Cesium.CallbackProperty(() => {
    const p = tracker3d.compute(new Date());
    return p ? p.cartesian : Cesium.Cartesian3.ZERO;
  }, false);

  satelliteEntity3d = viewer.entities.add({
    id: "satellite3d",
    position: positionProperty,
    point: {
      pixelSize: 12,
      color: Cesium.Color.CYAN,
      outlineColor: Cesium.Color.WHITE,
      outlineWidth: 2,
    },
  });

  labelEntity3d = viewer.entities.add({
    position: positionProperty,
    label: {
      text: tracker3d.tle?.name || "Uydu",
      font: "16px sans-serif",
      fillColor: Cesium.Color.WHITE,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 3,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      pixelOffset: new Cesium.Cartesian2(14, -14),
      showBackground: true,
      backgroundColor: new Cesium.Color(0.05, 0.12, 0.21, 0.75),
    },
  });

  orbitEntity3d = viewer.entities.add({
    polyline: {
      positions: new Cesium.CallbackProperty(() => buildOrbitPositions3d(), false),
      width: 2,
      material: Cesium.Color.YELLOW,
      show: els.orbitToggle3d.checked,
    },
  });

  startedTracking3d = false;
}

async function loadSatellite3d(noradId) {
  setStatus("3d", "Uydu verisi alınıyor...");
  setInfo("3d", {});

  try {
    const tle = await fetchTle(noradId);
    tracker3d.setTle(tle);
    createEntities3d();
    update3dLive();
    viewer.scene.requestRender();
    setStatus("3d", `Yüklendi: ${tle.name}`);
  } catch (err) {
    tracker3d.tle = null;
    tracker3d.satrec = null;
    clearEntities3d();
    setStatus("3d", err.message || "Bir hata oluştu.", true);
  }
}

function update3dLive() {
  const point = tracker3d.compute(new Date());
  if (!point || !tracker3d.tle) return;

  updateInfoFromPoint("3d", tracker3d, point);

  if (els.followToggle3d.checked && satelliteEntity3d) {
    if (!startedTracking3d) {
      viewer.trackedEntity = satelliteEntity3d;
      startedTracking3d = true;
    }
  } else if (viewer.trackedEntity) {
    viewer.trackedEntity = undefined;
    startedTracking3d = false;
  }
}

function flyCameraToSatellite() {
  const p = tracker3d.compute(new Date());
  if (!p) return;
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(p.lon, p.lat, Math.max(1200000, p.altKm * 1000 + 700000)),
  });
}

function resetNorthUp() {
  const carto = Cesium.Cartographic.fromCartesian(viewer.camera.positionWC);
  if (!carto) return;
  viewer.camera.setView({
    destination: viewer.camera.positionWC,
    orientation: {
      heading: 0,
      pitch: viewer.camera.pitch,
      roll: 0,
    },
  });
}

function changeTilt(deltaDegrees) {
  viewer.camera.lookUp(Cesium.Math.toRadians(deltaDegrees));
}

function rotateCamera(deltaDegrees) {
  viewer.camera.rotateRight(Cesium.Math.toRadians(deltaDegrees));
}

els.loadBtn3d.addEventListener("click", () => {
  const id = els.noradId3d.value.trim();
  if (!id) return setStatus("3d", "Lütfen bir NORAD ID gir.", true);
  loadSatellite3d(id);
});

els.noradId3d.addEventListener("keydown", (e) => {
  if (e.key === "Enter") els.loadBtn3d.click();
});

document.querySelectorAll(".quick-3d").forEach((btn) => {
  btn.addEventListener("click", () => {
    els.noradId3d.value = btn.dataset.id;
    loadSatellite3d(btn.dataset.id);
  });
});

els.orbitToggle3d.addEventListener("change", () => {
  if (orbitEntity3d?.polyline) orbitEntity3d.polyline.show = els.orbitToggle3d.checked;
});

els.followToggle3d.addEventListener("change", () => {
  if (!els.followToggle3d.checked) {
    viewer.trackedEntity = undefined;
    startedTracking3d = false;
  }
});

els.camHomeBtn.addEventListener("click", () => viewer.camera.flyTo(homeView));
els.camResetNorthBtn.addEventListener("click", resetNorthUp);
els.camToSatelliteBtn.addEventListener("click", flyCameraToSatellite);
els.camZoomInBtn.addEventListener("click", () => viewer.camera.zoomIn(400000));
els.camZoomOutBtn.addEventListener("click", () => viewer.camera.zoomOut(400000));
els.camTiltUpBtn.addEventListener("click", () => changeTilt(7));
els.camTiltDownBtn.addEventListener("click", () => changeTilt(-7));
els.camLeftBtn.addEventListener("click", () => rotateCamera(-12));
els.camRightBtn.addEventListener("click", () => rotateCamera(12));

viewer.clock.onTick.addEventListener(() => {
  update3dLive();
});

setInterval(update2dLive, 2000);

// Initial sync
els.noradId3d.value = PRESETS.IMECE;
els.noradId2d.value = PRESETS.IMECE;
loadSatellite2d(PRESETS.IMECE);
loadSatellite3d(PRESETS.IMECE);
switchTab("2d");

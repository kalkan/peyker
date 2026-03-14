const viewer = new Cesium.Viewer("cesiumContainer", {
  animation: false,
  timeline: false,
  baseLayerPicker: true,
  geocoder: false,
  homeButton: true,
  sceneModePicker: true,
  navigationHelpButton: false,
  fullscreenButton: true,
  shouldAnimate: true,
  infoBox: false,
  selectionIndicator: false,
});

viewer.scene.globe.enableLighting = true;
viewer.clock.multiplier = 1;
viewer.clock.shouldAnimate = true;
viewer.scene.skyAtmosphere.show = true;
viewer.scene.globe.depthTestAgainstTerrain = false;

const els = {
  noradId: document.getElementById("noradId"),
  loadBtn: document.getElementById("loadBtn"),
  followToggle: document.getElementById("followToggle"),
  orbitToggle: document.getElementById("orbitToggle"),
  status: document.getElementById("status"),
  satName: document.getElementById("satName"),
  satNorad: document.getElementById("satNorad"),
  satLat: document.getElementById("satLat"),
  satLon: document.getElementById("satLon"),
  satAlt: document.getElementById("satAlt"),
  satSpeed: document.getElementById("satSpeed"),
  satEpoch: document.getElementById("satEpoch"),
};

let satrec = null;
let currentTle = null;
let satelliteEntity = null;
let orbitEntity = null;
let labelEntity = null;
let startedTracking = false;

function setStatus(msg, isError = false) {
  els.status.textContent = msg;
  els.status.style.color = isError ? "#ff8f8f" : "#7ce0c3";
}

function setInfo({ name = "-", norad = "-", lat = "-", lon = "-", alt = "-", speed = "-", epoch = "-" }) {
  els.satName.textContent = name;
  els.satNorad.textContent = norad;
  els.satLat.textContent = lat;
  els.satLon.textContent = lon;
  els.satAlt.textContent = alt;
  els.satSpeed.textContent = speed;
  els.satEpoch.textContent = epoch;
}

function kmPerSec(positionEci, velocityEci) {
  if (!velocityEci) return null;
  return Math.sqrt(
    velocityEci.x * velocityEci.x +
    velocityEci.y * velocityEci.y +
    velocityEci.z * velocityEci.z
  );
}

function computePosition(date = new Date()) {
  if (!satrec) return null;
  const pv = satellite.propagate(satrec, date);
  if (!pv.position) return null;

  const gmst = satellite.gstime(date);
  const geodetic = satellite.eciToGeodetic(pv.position, gmst);
  const lat = satellite.degreesLat(geodetic.latitude);
  const lon = satellite.degreesLong(geodetic.longitude);
  const altKm = geodetic.height;
  const speedKmS = kmPerSec(pv.position, pv.velocity);

  return {
    date,
    lat,
    lon,
    altKm,
    speedKmS,
    cartesian: Cesium.Cartesian3.fromDegrees(lon, lat, altKm * 1000),
  };
}

function buildOrbitPositions() {
  if (!satrec) return [];
  const positions = [];
  const now = new Date();

  for (let minutes = -90; minutes <= 90; minutes += 2) {
    const t = new Date(now.getTime() + minutes * 60 * 1000);
    const p = computePosition(t);
    if (p) positions.push(p.cartesian);
  }
  return positions;
}

function clearEntities() {
  if (satelliteEntity) viewer.entities.remove(satelliteEntity);
  if (orbitEntity) viewer.entities.remove(orbitEntity);
  if (labelEntity) viewer.entities.remove(labelEntity);
  satelliteEntity = null;
  orbitEntity = null;
  labelEntity = null;
}

function createEntities(name) {
  clearEntities();

  const positionProperty = new Cesium.CallbackProperty(() => {
    const p = computePosition(new Date());
    return p ? p.cartesian : Cesium.Cartesian3.ZERO;
  }, false);

  satelliteEntity = viewer.entities.add({
    id: "satellite",
    position: positionProperty,
    point: {
      pixelSize: 12,
      color: Cesium.Color.CYAN,
      outlineColor: Cesium.Color.WHITE,
      outlineWidth: 2,
    },
  });

  labelEntity = viewer.entities.add({
    position: positionProperty,
    label: {
      text: name,
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

  orbitEntity = viewer.entities.add({
    polyline: {
      positions: new Cesium.CallbackProperty(() => buildOrbitPositions(), false),
      width: 2,
      material: Cesium.Color.YELLOW,
      show: els.orbitToggle.checked,
    },
  });

  startedTracking = false;
}

function updateUi() {
  const p = computePosition(new Date());
  if (!p || !currentTle) return;

  setInfo({
    name: currentTle.name,
    norad: currentTle.norad,
    lat: `${p.lat.toFixed(4)}°`,
    lon: `${p.lon.toFixed(4)}°`,
    alt: `${p.altKm.toFixed(2)} km`,
    speed: p.speedKmS ? `${p.speedKmS.toFixed(3)} km/s` : "-",
    epoch: currentTle.epoch || "-",
  });

  if (els.followToggle.checked && satelliteEntity) {
    if (!startedTracking) {
      viewer.trackedEntity = satelliteEntity;
      startedTracking = true;
    }
  } else if (viewer.trackedEntity) {
    viewer.trackedEntity = undefined;
  }
}

async function fetchTle(noradId) {
  const url = `https://celestrak.org/NORAD/elements/gp.php?CATNR=${encodeURIComponent(noradId)}&FORMAT=TLE`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`TLE alınamadı. HTTP ${res.status}`);
  }
  const text = (await res.text()).trim();
  const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

  if (lines.length < 2) {
    throw new Error("Bu NORAD ID için TLE bulunamadı.");
  }

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

async function loadSatellite(noradId) {
  setStatus("Uydu verisi alınıyor...");
  setInfo({});

  try {
    const tle = await fetchTle(noradId);
    satrec = satellite.twoline2satrec(tle.line1, tle.line2);
    currentTle = tle;

    createEntities(tle.name);
    updateUi();
    viewer.scene.requestRender();

    setStatus(`Yüklendi: ${tle.name}`);
  } catch (err) {
    clearEntities();
    satrec = null;
    currentTle = null;
    setStatus(err.message || "Bir hata oluştu.", true);
  }
}

els.loadBtn.addEventListener("click", () => {
  const noradId = els.noradId.value.trim();
  if (!noradId) {
    setStatus("Lütfen bir NORAD ID gir.", true);
    return;
  }
  loadSatellite(noradId);
});

els.noradId.addEventListener("keydown", (e) => {
  if (e.key === "Enter") els.loadBtn.click();
});

document.querySelectorAll(".quick").forEach((btn) => {
  btn.addEventListener("click", () => {
    const id = btn.dataset.id;
    els.noradId.value = id;
    loadSatellite(id);
  });
});

els.orbitToggle.addEventListener("change", () => {
  if (orbitEntity?.polyline) {
    orbitEntity.polyline.show = els.orbitToggle.checked;
  }
});

viewer.clock.onTick.addEventListener(() => {
  updateUi();
});

viewer.camera.flyHome(0);
loadSatellite(els.noradId.value);

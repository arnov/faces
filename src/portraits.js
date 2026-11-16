const MIN_FACES = 2;
const MAX_FACES = 50;
const FACE_CURVE = 0.65;
const PORTRAIT_SM = 128;
const PORTRAIT_MD = 512;
const PORTRAIT_FULL = 1024;
const FACE_BLEND = 0.78;
const PREVIEW_LIMIT = 8;
const UPGRADE_LIMIT = 3;

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timer = window.setTimeout(() => {
      image.onload = null;
      image.onerror = null;
      reject(new Error(`Timed out ${src}`));
    }, 8000);
    image.decoding = "async";
    image.onload = () => {
      window.clearTimeout(timer);
      resolve(image);
    };
    image.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error(`Failed to load ${src}`));
    };
    image.src = src;
  });
}

const GRADE_GRAIN_SIZE = 256;
let gradeGrain;

function createGradeGrain() {
  const grain = document.createElement("canvas");
  grain.width = GRADE_GRAIN_SIZE;
  grain.height = GRADE_GRAIN_SIZE;
  const ctx = grain.getContext("2d");
  if (!ctx) {
    throw new Error("Could not grade portrait");
  }
  const pixels = ctx.createImageData(GRADE_GRAIN_SIZE, GRADE_GRAIN_SIZE);
  const data = pixels.data;
  for (let i = 0; i < data.length; i += 4) {
    const value = 128 + (Math.random() - 0.5) * 220;
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
    data[i + 3] = 255;
  }
  ctx.putImageData(pixels, 0, 0);
  return grain;
}

function gradePortrait(image, size = 512) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Could not grade portrait");
  }

  const sourceRatio = image.width / image.height;
  let sx = 0;
  let sy = 0;
  let sw = image.width;
  let sh = image.height;
  if (sourceRatio > 1) {
    sw = image.height;
    sx = (image.width - sw) / 2;
  } else {
    sh = image.width;
    sy = (image.height - sh) / 2;
  }

  ctx.filter = "grayscale(1) contrast(1.22)";
  ctx.drawImage(image, sx, sy, sw, sh, 0, 0, size, size);
  ctx.filter = "none";

  const mid = size / 2;
  const wash = ctx.createRadialGradient(mid, mid, 0, mid, mid, size * Math.SQRT1_2);
  wash.addColorStop(0, "rgba(0,0,0,0)");
  wash.addColorStop(0.45, "rgba(0,0,0,0)");
  wash.addColorStop(1, "rgba(0,0,0,0.32)");
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, size, size);

  ctx.fillStyle = "rgba(16, 16, 16, 0.08)";
  ctx.fillRect(0, 0, size, size);

  gradeGrain ??= createGradeGrain();
  ctx.globalAlpha = 0.05;
  ctx.drawImage(gradeGrain, 0, 0, size, size);
  ctx.globalAlpha = 1;

  const fade = ctx.createRadialGradient(mid, mid, 0, mid, mid, mid);
  fade.addColorStop(0, `rgba(0,0,0,${FACE_BLEND})`);
  fade.addColorStop(0.58, `rgba(0,0,0,${FACE_BLEND})`);
  fade.addColorStop(0.82, "rgba(0,0,0,0.32)");
  fade.addColorStop(1, "rgba(0,0,0,0)");
  ctx.globalCompositeOperation = "destination-in";
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = "source-over";

  return canvas;
}

function faceCount(population, largest) {
  if (!largest) {
    return MIN_FACES;
  }
  const share = Math.max(0, population) / largest;
  return Math.max(
    MIN_FACES,
    Math.min(MAX_FACES, Math.round(Math.pow(share, FACE_CURVE) * MAX_FACES)),
  );
}

function genderCounts(total) {
  const women = Math.floor(total / 2);
  return { m: total - women, f: women };
}

function portraitName(iso, gender, index) {
  const suffix = index === 1 ? "" : String(index);
  return `${iso}-${gender}${suffix}.jpg`;
}

function portraitSrc(tier, iso, gender, index) {
  const name = portraitName(iso, gender, index);
  if (tier === "sm") {
    return `portraits/sm/${name}`;
  }
  if (tier === "md") {
    return `portraits/md/${name}`;
  }
  return `portraits/${name}`;
}

function createLimiter(limit) {
  let active = 0;
  const queue = [];

  function pump() {
    while (active < limit && queue.length) {
      const run = queue.shift();
      active += 1;
      Promise.resolve()
        .then(run)
        .finally(() => {
          active -= 1;
          pump();
        });
    }
  }

  return function limitRun(task) {
    return new Promise((resolve, reject) => {
      queue.push(() => task().then(resolve, reject));
      pump();
    });
  };
}

const previewLoad = createLimiter(PREVIEW_LIMIT);

async function loadImageOptional(src) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await previewLoad(() => loadImage(src));
    } catch (error) {
      const timedOut = String(error?.message || "").includes("Timed out");
      if (!timedOut || attempt === 1) {
        return null;
      }
    }
  }
  return null;
}

function createPortrait(iso, gender, index, image) {
  return {
    sm: gradePortrait(image, PORTRAIT_SM),
    md: null,
    full: null,
    mdSrc: portraitSrc("md", iso, gender, index),
    fullSrc: portraitSrc("full", iso, gender, index),
  };
}

function portraitCanvas(record) {
  if (!record) {
    return undefined;
  }
  return record.full || record.md || record.sm;
}

const upgradeQueue = [];
const upgradeStarted = new Set();
let upgradeActive = 0;
let frameTiers = new Map();
let tierBatch = null;
let tierTimer = 0;

function pumpUpgrades() {
  while (upgradeActive < UPGRADE_LIMIT && upgradeQueue.length) {
    const job = upgradeQueue.shift();
    upgradeActive += 1;
    loadImage(job.src)
      .then((image) => {
        const size = job.tier === "full" ? PORTRAIT_FULL : PORTRAIT_MD;
        job.record[job.tier] = gradePortrait(image, size);
        job.onReady();
      })
      .catch(() => {})
      .finally(() => {
        upgradeActive -= 1;
        pumpUpgrades();
      });
  }
}

function queuePortrait(record, tier, onReady) {
  if (tier === "full") {
    for (let i = upgradeQueue.length - 1; i >= 0; i -= 1) {
      const job = upgradeQueue[i];
      if (job.record === record && job.tier === "md") {
        upgradeQueue.splice(i, 1);
        upgradeStarted.delete(job.src);
      }
    }
  }
  if (record[tier]) {
    return;
  }
  const src = tier === "full" ? record.fullSrc : record.mdSrc;
  if (upgradeStarted.has(src)) {
    return;
  }
  upgradeStarted.add(src);
  upgradeQueue.push({ record, tier, src, onReady });
  pumpUpgrades();
}

function beginPortraitFrame() {
  frameTiers = new Map();
  tierBatch = frameTiers;
}

function ensurePortraitTier(record, devicePixels, onReady) {
  if (!record || !onReady) {
    return;
  }
  let tier = null;
  if (devicePixels > PORTRAIT_MD) {
    tier = "full";
  } else if (devicePixels > PORTRAIT_SM) {
    tier = "md";
  }
  if (!tier || record[tier]) {
    return;
  }
  frameTiers.set(record.fullSrc, { record, tier, onReady });
  const batch = frameTiers;
  window.clearTimeout(tierTimer);
  tierTimer = window.setTimeout(() => {
    if (batch !== tierBatch) {
      return;
    }
    tierBatch = null;
    for (const job of batch.values()) {
      queuePortrait(job.record, job.tier, job.onReady);
    }
  }, 120);
}

async function loadGender(iso, gender, count) {
  const records = [];
  for (let i = 1; i <= count; i += 1) {
    const image = await loadImageOptional(portraitSrc("sm", iso, gender, i));
    if (!image) {
      break;
    }
    records.push(createPortrait(iso, gender, i, image));
  }
  return records;
}

async function loadPortraits(countries, onCountry) {
  const largest = Math.max(0, ...countries.map((country) => country.population ?? 0));
  const library = {};
  const ordered = [...countries].sort(
    (a, b) => (b.population ?? 0) - (a.population ?? 0),
  );
  let next = 0;

  async function worker() {
    while (next < ordered.length) {
      const country = ordered[next];
      next += 1;
      const total = faceCount(country.population ?? 0, largest);
      const counts = genderCounts(total);
      const available = FACES_PORTRAITS[country.iso] ?? { m: 0, f: 0 };
      const [men, women] = await Promise.all([
        loadGender(country.iso, "m", Math.min(counts.m, available.m)),
        loadGender(country.iso, "f", Math.min(counts.f, available.f)),
      ]);
      library[country.iso] = { m: men, f: women };
      if (onCountry) {
        onCountry(library);
      }
    }
  }

  const workers = Math.min(PREVIEW_LIMIT, ordered.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return library;
}

function portraitIndex(key, count) {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash + key.charCodeAt(i) * (i + 3)) % 997;
  }
  return hash % count;
}

function allPortraits(set) {
  return [...set.f, ...set.m];
}

function pickFromPool(pool, key) {
  if (!pool.length) {
    return undefined;
  }
  return pool[portraitIndex(key, pool.length)];
}

function pickPortrait(library, iso, key, tile) {
  const set = library[iso] ?? Object.values(library)[0];
  if (!set) {
    return undefined;
  }
  const tiles = (tile?.cols ?? 1) * (tile?.rows ?? 1);
  const bothGenders = set.m.length > 0 && set.f.length > 0;

  if (tile && tiles > 1 && bothGenders) {
    const women = (tile.col + tile.row) % 2 === 0;
    return pickFromPool(women ? set.f : set.m, key);
  }

  return pickFromPool(allPortraits(set), key);
}

function uniquePortraits(library, iso) {
  const set = library[iso];
  if (!set) {
    return [];
  }
  const pool = [];
  const max = Math.max(set.m.length, set.f.length);
  for (let i = 0; i < max; i += 1) {
    if (i < set.f.length) {
      pool.push(set.f[i]);
    }
    if (i < set.m.length) {
      pool.push(set.m[i]);
    }
  }
  return pool;
}

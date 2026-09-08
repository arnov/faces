const MIN_FACES = 2;
const MAX_FACES = 50;
const FACE_CURVE = 0.65;

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timer = window.setTimeout(() => {
      image.onload = null;
      image.onerror = null;
      reject(new Error(`Timed out ${src}`));
    }, 2500);
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

function numberedPaths(iso, gender, count) {
  const paths = [];
  for (let i = 1; i <= count; i += 1) {
    const suffix = i === 1 ? "" : String(i);
    paths.push(`portraits/${iso}-${gender}${suffix}.jpg`);
  }
  return paths;
}

async function loadImageOptional(src) {
  try {
    return await loadImage(src);
  } catch {
    return null;
  }
}

async function loadGender(iso, gender, count) {
  const images = [];
  for (let i = 1; i <= count; i += 1) {
    const suffix = i === 1 ? "" : String(i);
    const image = await loadImageOptional(`portraits/${iso}-${gender}${suffix}.jpg`);
    if (!image) {
      break;
    }
    images.push(image);
  }
  return images;
}

async function loadPortraits(countries) {
  const largest = Math.max(0, ...countries.map((country) => country.population ?? 0));
  const library = {};

  await Promise.all(
    countries.map(async (country) => {
      const total = faceCount(country.population ?? 0, largest);
      const counts = genderCounts(total);
      const [men, women] = await Promise.all([
        loadGender(country.iso, "m", counts.m),
        loadGender(country.iso, "f", counts.f),
      ]);
      library[country.iso] = {
        m: men.map((image) => gradePortrait(image)),
        f: women.map((image) => gradePortrait(image)),
      };
    }),
  );

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

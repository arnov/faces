const { geoArea, geoContains, geoNaturalEarth1, geoPath, zoom: d3zoom, zoomIdentity } = d3;

const SEA_CENTER = "#141a22";
const SEA_EDGE = "#0a0c10";
const LAND = "rgba(120, 118, 116, 0.42)";
const BORDER = "rgba(236, 220, 192, 0.16)";
const BORDER_HOVER = "rgba(247, 236, 214, 0.42)";
const MAX_SCALE = 12000;
const STAMP_SIZE = 256;
const GRAIN_SIZE = 256;
const GRAIN_ALPHA = 0.05;
const FACE_FILL = 0.35;
const FACE_SCREEN = 2.2;
const FACE_BLEND = 0.78;
const SIZE_CURVE = 0.25;
const SIZE_MIN = 0.42;
const SIZE_MAX = 1.85;
const FIT_FILL = 1.35;
const FACE_SCALE = { NL: 0.78, MA: 0.82 };
const FACE_SITE_SCALE = { PS: [1, 0.26] };

function pointer(event, target) {
  const rect = target.getBoundingClientRect();
  return [
    event.clientX - rect.left - target.clientLeft,
    event.clientY - rect.top - target.clientTop,
  ];
}

function select(node) {
  const nodes = node ? [node] : [];

  const selection = {
    node: () => nodes[0],
    property(name, value) {
      for (const el of nodes) {
        el[name] = typeof value === "function" ? value.call(el) : value;
      }
      return selection;
    },
    style(name, value) {
      for (const el of nodes) {
        el.style.setProperty(name, value);
      }
      return selection;
    },
    filter(test) {
      const matched = nodes.filter((el) => test.call(el));
      return matched.length === nodes.length ? selection : select(matched[0]);
    },
    on(typenames, listener, options) {
      for (const spec of typenames.trim().split(/\s+/)) {
        const dot = spec.indexOf(".");
        const type = dot < 0 ? spec : spec.slice(0, dot);
        const name = dot < 0 ? "" : spec.slice(dot + 1);
        for (const el of nodes) {
          if (!el.__on) {
            el.__on = new Map();
          }
          if (!type) {
            for (const [key, entry] of el.__on) {
              if (entry.name === name) {
                el.removeEventListener(entry.type, entry.wrapped, entry.options);
                el.__on.delete(key);
              }
            }
            continue;
          }
          const key = `${type}.${name}`;
          const prev = el.__on.get(key);
          if (prev) {
            el.removeEventListener(prev.type, prev.wrapped, prev.options);
            el.__on.delete(key);
          }
          if (listener == null) {
            continue;
          }
          const wrapped = (event) => listener.call(el, event);
          el.__on.set(key, { type, name, wrapped, options });
          el.addEventListener(type, wrapped, options);
        }
      }
      return selection;
    },
    call(fn, ...args) {
      fn(selection, ...args);
      return selection;
    },
    each(callback) {
      nodes.forEach((el, i) => {
        callback.call(el, el.__data__, i, nodes);
      });
      return selection;
    },
    interrupt() {
      return selection;
    },
  };

  return selection;
}

function createGrain() {
  const grain = document.createElement("canvas");
  grain.width = GRAIN_SIZE;
  grain.height = GRAIN_SIZE;
  const grainContext = grain.getContext("2d");
  if (!grainContext) {
    throw new Error("Canvas is not available");
  }
  const pixels = grainContext.createImageData(GRAIN_SIZE, GRAIN_SIZE);
  const data = pixels.data;
  for (let i = 0; i < data.length; i += 4) {
    const value = 128 + (Math.random() - 0.5) * 220;
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
    data[i + 3] = 255;
  }
  grainContext.putImageData(pixels, 0, 0);
  return grain;
}

function padNumeric(id) {
  return String(id ?? "").padStart(3, "0");
}

const WS_NORTH = 27.667;

function intersectLat(a, b, lat) {
  const t = (lat - a[1]) / ((b[1] - a[1]) || 1e-12);
  return [a[0] + (b[0] - a[0]) * t, lat];
}

function clipRingLat(ring, lat, keepNorth) {
  if (!ring.length) {
    return ring;
  }
  const inside = (point) => (keepNorth ? point[1] >= lat : point[1] <= lat);
  const out = [];
  for (let i = 0; i < ring.length - 1; i += 1) {
    const a = ring[i];
    const b = ring[i + 1];
    const aIn = inside(a);
    const bIn = inside(b);
    if (aIn && bIn) {
      out.push(b);
    } else if (aIn && !bIn) {
      out.push(intersectLat(a, b, lat));
    } else if (!aIn && bIn) {
      out.push(intersectLat(a, b, lat), b);
    }
  }
  if (out.length < 3) {
    return [];
  }
  const first = out[0];
  const last = out[out.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    out.push(first);
  }
  return out;
}

function featurePolys(feature) {
  const geom = feature.geometry;
  return geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
}

function clipFeatureLat(feature, lat, keepNorth) {
  const clipped = [];
  for (const poly of featurePolys(feature)) {
    const outer = clipRingLat(poly[0], lat, keepNorth);
    if (outer.length < 4) {
      continue;
    }
    const holes = poly
      .slice(1)
      .map((ring) => clipRingLat(ring, lat, keepNorth))
      .filter((ring) => ring.length >= 4);
    clipped.push([outer, ...holes]);
  }
  if (!clipped.length) {
    return feature;
  }
  return {
    ...feature,
    geometry:
      clipped.length === 1
        ? { type: "Polygon", coordinates: clipped[0] }
        : { type: "MultiPolygon", coordinates: clipped },
  };
}

function mergeFeatures(base, extra) {
  return {
    ...base,
    geometry: {
      type: "MultiPolygon",
      coordinates: [...featurePolys(base), ...featurePolys(extra)],
    },
  };
}

function drawCover(ctx, image, x, y, width, height) {
  if (width <= 0 || height <= 0) {
    return;
  }

  const imageWidth = "width" in image ? Number(image.width) : 512;
  const imageHeight = "height" in image ? Number(image.height) : 512;
  const imageRatio = imageWidth / imageHeight;
  const targetRatio = width / height;
  let sx = 0;
  let sy = 0;
  let sw = imageWidth;
  let sh = imageHeight;

  if (imageRatio > targetRatio) {
    sw = imageHeight * targetRatio;
    sx = (imageWidth - sw) / 2;
  } else {
    sh = imageWidth / targetRatio;
    sy = (imageHeight - sh) / 2;
  }

  ctx.drawImage(image, sx, sy, sw, sh, x, y, width, height);
}

function referenceFace(countries, largestPop) {
  const reference =
    countries.find((country) => country.iso === "IN") ||
    countries.find((country) => country.iso === "CN") ||
    countries[0];
  if (!reference) {
    return { radiusDeg: 1, areaPerFace: 1 };
  }
  const count = Math.max(1, faceCount(reference.population, largestPop));
  const faceArea = (reference.area * FACE_FILL) / count;
  return {
    radiusDeg: Math.sqrt(faceArea / Math.PI) * (180 / Math.PI),
    areaPerFace: reference.area / count,
  };
}

function countryFaceRadius(country, count, reference) {
  const areaPerFace = country.area / Math.max(count, 1);
  const ratio = areaPerFace / Math.max(reference.areaPerFace, 1e-12);
  const scale = Math.max(SIZE_MIN, Math.min(SIZE_MAX, Math.pow(ratio, SIZE_CURVE)));
  let radiusDeg = reference.radiusDeg * scale;
  const drawnR = radiusDeg * FACE_SCREEN * (Math.PI / 180);
  const drawnArea = count * Math.PI * drawnR * drawnR;
  const room = country.area * FIT_FILL;
  if (drawnArea > room) {
    radiusDeg *= Math.sqrt(room / Math.max(drawnArea, 1e-12));
  }
  return radiusDeg * (FACE_SCALE[country.iso] ?? 1);
}

function seedCountries(countries, portraits) {
  const largestPop = Math.max(0, ...countries.map((country) => country.population));
  const reference = referenceFace(countries, largestPop);
  return countries.map((country) => {
    const faces = uniquePortraits(portraits, country.iso);
    const count = Math.min(faceCount(country.population, largestPop), faces.length);
    return {
      ...country,
      faces,
      sites: (FACE_SITES[country.iso] || []).slice(0, count),
      radiusDeg: countryFaceRadius(country, count, reference),
    };
  });
}

function joinCountries(collection, countries, extras = []) {
  const toIso = numericToIso();
  const byIso = new Map(countries.map((country) => [country.iso, country]));
  const featuresByIso = new Map();

  for (const geoFeature of [...collection.features, ...extras]) {
    const iso = toIso.get(padNumeric(geoFeature.id));
    if (!iso || !byIso.has(iso)) {
      continue;
    }
    const existing = featuresByIso.get(iso);
    if (!existing || geoArea(geoFeature) > geoArea(existing)) {
      featuresByIso.set(iso, geoFeature);
    }
  }

  return countries.flatMap((country) => {
    let geoFeature = featuresByIso.get(country.iso);
    if (!geoFeature) {
      return [];
    }
    const morocco = featuresByIso.get("MA");
    if (country.iso === "MA" && morocco) {
      geoFeature = clipFeatureLat(morocco, WS_NORTH, true);
    }
    if (country.iso === "EH" && morocco) {
      const occupied = clipFeatureLat(morocco, WS_NORTH, false);
      geoFeature = mergeFeatures(geoFeature, occupied);
    }
    return [
      {
        iso: country.iso,
        name: country.name,
        population: country.population ?? 0,
        feature: geoFeature,
        area: geoArea(geoFeature),
      },
    ];
  });
}

function createMap(canvas, label, rawCountries, portraits) {
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas is not available");
  }
  const ctx = context;
  const countries = seedCountries(rawCountries, portraits);

  const projection = geoNaturalEarth1();
  const path = geoPath(projection, ctx);
  const canvasSel = select(canvas);
  const zoomBehavior = d3zoom()
    .scaleExtent([1, MAX_SCALE])
    .on("zoom", (event) => {
      transform = event.transform;
      requestDraw();
    });

  let width = 0;
  let height = 0;
  let dpr = 1;
  let baseScale = 1;
  let baseTranslate = [0, 0];
  let transform = zoomIdentity;
  let hovered;
  let frame = 0;
  const stamp = document.createElement("canvas");
  stamp.width = STAMP_SIZE;
  stamp.height = STAMP_SIZE;
  const stampContext = stamp.getContext("2d");
  if (!stampContext) {
    throw new Error("Canvas is not available");
  }
  const stampCtx = stampContext;
  const grain = createGrain();
  const grainPattern = ctx.createPattern(grain, "repeat");

  function requestDraw() {
    if (frame) {
      return;
    }
    frame = requestAnimationFrame(() => {
      frame = 0;
      draw();
    });
  }

  function applyView() {
    projection.scale(baseScale * transform.k).translate([
      baseTranslate[0] * transform.k + transform.x,
      baseTranslate[1] * transform.k + transform.y,
    ]);
  }

  function layout() {
    const nextWidth = canvas.clientWidth;
    const nextHeight = canvas.clientHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = nextWidth;
    height = nextHeight;
    canvas.width = Math.round(nextWidth * dpr);
    canvas.height = Math.round(nextHeight * dpr);

    const pad = Math.min(width, height) * 0.06;
    projection.fitExtent(
      [
        [pad, pad],
        [width - pad, height - pad],
      ],
      { type: "Sphere" },
    );
    baseScale = projection.scale();
    baseTranslate = projection.translate();

    zoomBehavior.translateExtent([
      [-width * 0.4, -height * 0.4],
      [width * 1.4, height * 1.4],
    ]);
    transform = zoomIdentity;
    canvasSel.call(zoomBehavior).call(zoomBehavior.transform, zoomIdentity);
  }

  function stampPortrait(image) {
    const size = stamp.width;
    const mid = size / 2;
    stampCtx.setTransform(1, 0, 0, 1, 0, 0);
    stampCtx.globalCompositeOperation = "source-over";
    stampCtx.clearRect(0, 0, size, size);
    stampCtx.imageSmoothingEnabled = true;
    stampCtx.imageSmoothingQuality = "high";
    drawCover(stampCtx, image, 0, 0, size, size);
    stampCtx.globalCompositeOperation = "destination-in";
    const fade = stampCtx.createRadialGradient(mid, mid, 0, mid, mid, mid);
    fade.addColorStop(0, `rgba(0,0,0,${FACE_BLEND})`);
    fade.addColorStop(0.58, `rgba(0,0,0,${FACE_BLEND})`);
    fade.addColorStop(0.82, "rgba(0,0,0,0.32)");
    fade.addColorStop(1, "rgba(0,0,0,0)");
    stampCtx.fillStyle = fade;
    stampCtx.fillRect(0, 0, size, size);
    stampCtx.globalCompositeOperation = "source-over";
  }

  function faceScreenSize(site, radiusDeg) {
    const origin = projection(site);
    if (!origin) {
      return null;
    }
    const east = projection([
      site[0] + radiusDeg / Math.max(0.2, Math.cos((site[1] * Math.PI) / 180)),
      site[1],
    ]);
    if (!east) {
      return null;
    }
    const radius = Math.hypot(east[0] - origin[0], east[1] - origin[1]);
    const size = radius * 2 * FACE_SCREEN;
    return { origin, size: Math.max(6, size) };
  }

  function paintCountry(country, active) {
    const bounds = path.bounds(country.feature);
    const x0 = bounds[0][0];
    const y0 = bounds[0][1];
    const bw = bounds[1][0] - x0;
    const bh = bounds[1][1] - y0;
    if (bw <= 0 || bh <= 0) {
      return;
    }
    if (Math.max(bw, bh) < 1.5 && !active) {
      return;
    }
    if (x0 + bw < 0 || y0 + bh < 0 || x0 > width || y0 > height) {
      return;
    }

    ctx.beginPath();
    path(country.feature);
    ctx.fillStyle = LAND;
    ctx.fill();

    ctx.save();
    ctx.clip();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.globalCompositeOperation = "source-over";

    for (let i = 0; i < country.sites.length; i += 1) {
      const siteScale = FACE_SITE_SCALE[country.iso]?.[i] ?? 1;
      const screen = faceScreenSize(country.sites[i], country.radiusDeg * siteScale);
      if (!screen || screen.size < 2) {
        continue;
      }
      const x = screen.origin[0] - screen.size / 2;
      const y = screen.origin[1] - screen.size / 2;
      if (x + screen.size < 0 || y + screen.size < 0 || x > width || y > height) {
        continue;
      }

      const image = country.faces[i];
      if (!image) {
        continue;
      }
      stampPortrait(image);
      ctx.drawImage(stamp, x, y, screen.size, screen.size);
    }

    ctx.restore();

    ctx.beginPath();
    path(country.feature);
    ctx.lineJoin = "round";
    ctx.lineWidth = active ? 0.85 : 0.55;
    ctx.strokeStyle = active ? BORDER_HOVER : BORDER;
    ctx.stroke();
  }

  function paintOcean() {
    const cx = width * 0.5;
    const cy = height * 0.48;
    const radius = Math.hypot(width, height) * 0.55;
    const wash = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    wash.addColorStop(0, SEA_CENTER);
    wash.addColorStop(1, SEA_EDGE);
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, width, height);

    if (grainPattern) {
      ctx.save();
      ctx.globalAlpha = GRAIN_ALPHA;
      ctx.fillStyle = grainPattern;
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
    }
  }

  function draw() {
    applyView();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    paintOcean();

    for (const country of countries) {
      if (country !== hovered) {
        paintCountry(country, false);
      }
    }

    if (hovered) {
      paintCountry(hovered, true);
    }
  }

  function pick(event) {
    applyView();
    const [mx, my] = pointer(event, canvas);
    const lonlat = projection.invert?.([mx, my]);
    if (!lonlat) {
      return undefined;
    }

    for (let i = countries.length - 1; i >= 0; i -= 1) {
      const country = countries[i];
      if (geoContains(country.feature, lonlat)) {
        return country;
      }
    }

    return undefined;
  }

  function hideLabel() {
    label.hidden = true;
    label.classList.remove("is-visible");
    label.textContent = "";
  }

  function placeLabel(event, name) {
    if (!name) {
      hideLabel();
      return;
    }

    const pad = 16;
    const offsetX = 16;
    const offsetY = -18;
    label.hidden = false;
    label.textContent = name;
    const box = label.getBoundingClientRect();
    const left = Math.min(
      window.innerWidth - box.width - pad,
      Math.max(pad, event.clientX + offsetX),
    );
    const top = Math.min(
      window.innerHeight - box.height - pad,
      Math.max(pad, event.clientY + offsetY),
    );
    label.style.left = `${left}px`;
    label.style.top = `${top}px`;
    label.classList.add("is-visible");
  }

  function onPointerMove(event) {
    const next = pick(event);
    if (next !== hovered) {
      hovered = next;
      draw();
    }
    placeLabel(event, next?.name);
  }

  function onPointerLeave() {
    hovered = undefined;
    hideLabel();
    draw();
  }

  function onResize() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      layout();
      draw();
    });
  }

  layout();
  countries.sort((a, b) => b.area - a.area);
  canvasSel.call(zoomBehavior);
  draw();

  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerdown", onPointerMove);
  canvas.addEventListener("pointerleave", onPointerLeave);
  window.addEventListener("resize", onResize);

  return function assignPortraits(library) {
    const next = seedCountries(rawCountries, library);
    next.sort((a, b) => b.area - a.area);
    countries.length = 0;
    for (const country of next) {
      countries.push(country);
    }
    hovered = undefined;
    requestDraw();
  };
}

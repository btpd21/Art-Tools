// Core generator: RNG, noise, shapes, layout, strips, clusters, eggs with visible edges.
function generateCollage(ctx, photos, params) {
  const R = makeRNG(params.seed ?? (Math.random()*1e9)|0);
  const N = makeNoise(R);

  const W = params.width, H = params.height;
  const area = W * H;
  const maxElemArea = area * (params.maxElementPct / 100);

  // Photo cycling to ensure variety and fair use across inputs
  const photoQueue = cycleArray(photos, R);

  // Unique sample registry per image (to avoid repeating regions)
  const cropRegistry = new WeakMap();

  // 1) Draw strips in back
  const strips = makeStrips(R, photoQueue, params, W, H, maxElemArea);
  strips.forEach(s => drawStrip(ctx, s));

  // 2) Prepare clusters
  const clusters = makeClusters(R, photoQueue, params, W, H, maxElemArea, N, cropRegistry);

  // 3) Tiles (excluding clusters)
  const tiles = makeTiles(R, photoQueue, params, W, H, maxElemArea, N, clusters, cropRegistry);

  // 4) Easter eggs
  const eggs = makeEasterEggs(R, photoQueue, params, W, H);

  // Draw order: strips (already), then clusters, then tiles, then eggs
  clusters.forEach(cl => cl.tiles.forEach(t => drawTile(ctx, t)));
  tiles.forEach(t => drawTile(ctx, t));
  eggs.forEach(e => drawTile(ctx, e));

  return {
    seed: R.seed,
    stats: { tiles: tiles.length, strips: strips.length, clusters: clusters.length, eggs: eggs.length },
    strips, clusters, tiles, eggs, width: W, height: H
  };
}

// ---------------- RNG + Noise ----------------
function makeRNG(seed) { // Mulberry32-ish
  let a = (seed >>> 0) || 0x9E3779B9;
  function rand() {
    a += 0x6D2B79F5;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  rand.seed = seed;
  rand.int = (n) => (rand() * n) | 0;
  rand.range = (min, max) => min + (max - min) * rand();
  rand.pick = (arr) => arr[(rand() * arr.length) | 0];
  rand.sign = () => (rand() < 0.5 ? -1 : 1);
  return rand;
}

function makeNoise(R) { // Simple 2D value noise
  const perm = Array.from({length:256}, (_,i)=>i).sort(()=>R()-0.5);
  function hash(x,y){ return perm[(x + perm[y & 255]) & 255] / 255; }
  function lerp(a,b,t){ return a+(b-a)*t; }
  function smooth(t){ return t*t*(3-2*t); }
  return function noise2D(x,y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const v00 = hash(xi, yi), v10 = hash(xi+1, yi), v01 = hash(xi, yi+1), v11 = hash(xi+1, yi+1);
    const x1 = lerp(v00, v10, smooth(xf));
    const x2 = lerp(v01, v11, smooth(xf));
    return lerp(x1, x2, smooth(yf));
  };
}

function cycleArray(arr, R) {
  let i = 0;
  const shuffled = arr.slice().sort(()=>R()-0.5);
  return { next() { const v = shuffled[i % shuffled.length]; i++; return v; } };
}

// ---------------- Strips ----------------
function makeStrips(R, photoQueue, p, W, H, maxElemArea) {
  const count = clampInt(p.strips.count, 0, 50);
  const strips = [];
  let tries = 0;
  const minSide = Math.min(W,H);
  const thicknessMax = minSide * 0.10; // 10% cap
  const thickness = (p.strips.thicknessNorm/100) * thicknessMax;

  while (strips.length < count && tries < count*40) {
    tries++;
    const angle = sampleAngle(R, p.strips.angleMin);
    const opacity = clamp((p.strips.opacityPct/100), 0.5, 1.0);
    const photo = photoQueue.next();

    // Build a long quad spanning the canvas
    const centerX = R.range(0, W);
    const centerY = R.range(0, H);
    const len = Math.hypot(W, H) * 1.8; // overshoot so it spans fully
    const dx = Math.cos(angle) * len/2;
    const dy = Math.sin(angle) * len/2;
    const nx = -Math.sin(angle), ny = Math.cos(angle);
    const halfT = thickness / 2;

    const poly = [
      {x: centerX - dx + nx*halfT, y: centerY - dy + ny*halfT},
      {x: centerX + dx + nx*halfT, y: centerY + dy + ny*halfT},
      {x: centerX + dx - nx*halfT, y: centerY + dy - ny*halfT},
      {x: centerX - dx - nx*halfT, y: centerY - dy - ny*halfT},
    ];

    const a = polygonArea(poly);
    if (a > maxElemArea) continue;

    strips.push({
      kind: 'strip',
      poly, angle, opacity,
      src: { img: photo, sx: 0, sy: 0, sw: photo.width, sh: photo.height },
      blend: 'source-over'
    });
  }
  return strips;
}

// ---------------- Tiles ----------------
function makeTiles(R, photoQueue, p, W, H, maxElemArea, N, clusters, cropRegistry) {
  const target = clampInt(p.tiles.count, 1, 1000);

  const tiles = [];
  let tries = 0;
  let drawnArea = 0;
  const negTarget = clamp(p.negativeSpacePct/100, 0.02, 0.95);
  const totalArea = W*H;

  const minSize = sizeNormToArea(p.tiles.minSizeNorm, totalArea);
  const maxSize = sizeNormToArea(p.tiles.maxSizeNorm, totalArea);

  while (tiles.length < target && tries < target*300) {
    tries++;

    const areaPx = clamp(truncatedNormal(R, (minSize+maxSize)/2, (maxSize-minSize)/3, minSize, maxSize), 20, maxElemArea);
    const aspect = Math.exp(R.range(Math.log(0.35), Math.log(2.8)));
    let bw = Math.sqrt(areaPx * aspect);
    let bh = Math.max(1, areaPx / bw);

    // avoid overfilling negative space
    const currentCoverage = (drawnArea + areaPx) / totalArea;
    if (currentCoverage > (1 - negTarget) && R() < 0.65) continue;

    const cx = R.range(bw/2, W - bw/2);
    const cy = R.range(bh/2, H - bh/2);

    const wantSpecial = (tiles.length / Math.max(1,target)) < (p.tiles.specialPct/100);

    const type = chooseShapeType(R, p.tiles.allow, wantSpecial);
    let poly = makeBasePoly(type, bw, bh, p.tiles, R, N);

    // transform + irregularity
    const angle = (R.range(-1, 1) * (p.tiles.rotRangeDeg * Math.PI/180));
    const skew = (R.range(-1, 1) * (p.tiles.skewRangeDeg * Math.PI/180));
    const flipX = R() < 0.5, flipY = R() < 0.25;
    poly = addIrregularity(poly, p.tiles.irregular, R, N);
    poly = transformPoly(poly, cx, cy, angle, skew, flipX, flipY);

    const a = polygonArea(poly);
    if (a <= 10 || a > maxElemArea) continue;

    const img = photoQueue.next();
    const bbox = polygonBBox(poly);
    const src = chooseDiverseCoverSample(img, bbox.w, bbox.h, R, { overscan: 1.15, diversity: p.tiles.diversity }, cropRegistry);

    const imgRot = (R.range(-1,1) * p.tiles.imgRotRangeDeg) * Math.PI/180;

    const tile = {
      kind: 'tile',
      type, poly, angle, skew, opacity: 1.0,
      src, imgRot, blend: 'source-over',
      edge: { contrast: p.tiles.edgeContrast }
    };
    tiles.push(tile);
    drawnArea += a;
  }

  return tiles;
}

function chooseShapeType(R, allow, wantSpecial) {
  const specials = [];
  if (allow.scissor) specials.push('scissor');
  if (allow.torn) specials.push('torn');
  if (allow.ellipse) specials.push('ellipse');
  if (allow.triangle) specials.push('triangle');
  if (allow.diamond) specials.push('diamond');
  if (allow.hex) specials.push('hex');

  const rectAllowed = allow.rect;
  if (wantSpecial && specials.length) return R.pick(specials);
  if (rectAllowed && (!specials.length || R() < 0.6)) return 'rect';
  return specials.length ? R.pick(specials) : 'rect';
}

function makeBasePoly(type, w, h, tiles, R, N) {
  switch (type) {
    case 'rect':     return makeRectPoly(w,h);
    case 'scissor':  return makeScissorPoly(w,h, tiles.scissorJag, R, N);
    case 'torn':     return makeTornPoly(w,h, tiles.tornRough, R, N);
    case 'ellipse':  return makeEllipsePoly(w,h, R, tiles.irregular);
    case 'triangle': return makeTrianglePoly(w,h, R, tiles.irregular);
    case 'diamond':  return makeDiamondPoly(w,h, R, tiles.irregular);
    case 'hex':      return makeHexPoly(w,h, R, tiles.irregular);
    default:         return makeRectPoly(w,h);
  }
}

// ---------------- Clusters ----------------
function makeClusters(R, photoQueue, p, W, H, maxElemArea, N, cropRegistry) {
  const count = clampInt(p.clusters.count, 0, 30);
  const per = clampInt(p.clusters.tilesPer, 1, 60);
  const opacity = clamp(p.clusters.opacityPct/100, 0.5, 1.0);
  const clusters = [];
  let tries = 0;

  const totalArea = W*H;
  const minSize = sizeNormToArea(p.clusters.minSizeNorm, totalArea);
  const maxSize = sizeNormToArea(p.clusters.maxSizeNorm, totalArea);

  while (clusters.length < count && tries < count*30) {
    tries++;
    const cx = R.range(0.2*W, 0.8*W);
    const cy = R.range(0.2*H, 0.8*H);
    const radius = Math.min(W,H) * 0.18 * (0.8 + R()*0.4);

    const tiles = [];
    for (let i=0; i<per; i++) {
      const ang = R.range(0, Math.PI*2);
      const dist = radius * Math.sqrt(R());
      const tx = cx + Math.cos(ang)*dist;
      const ty = cy + Math.sin(ang)*dist;

      const areaPx = clamp(truncatedNormal(R, (minSize+maxSize)/2, (maxSize-minSize)/3, minSize, Math.min(maxSize, maxElemArea*0.35)), 15, maxElemArea*0.35);
      const aspect = Math.exp(R.range(Math.log(0.4), Math.log(2.2)));
      let bw = Math.sqrt(areaPx * aspect);
      let bh = Math.max(1, areaPx / bw);

      const shapeType = chooseShapeType(R, {
        rect: true, scissor: true, torn: true,
        ellipse: true, triangle: true, diamond: true, hex: true
      }, true);
      let poly = makeBasePoly(shapeType, bw,bh, p.tiles, R, N);
      const rot = R.range(-0.7, 0.7);
      const sk = R.range(-0.15, 0.15);
      const fx = R()<0.5, fy = R()<0.3;
      poly = addIrregularity(poly, p.tiles.irregular, R, N);
      poly = transformPoly(poly, tx, ty, rot, sk, fx, fy);

      const img = photoQueue.next();
      const bbox = polygonBBox(poly);
      const src = chooseDiverseCoverSample(img, bbox.w, bbox.h, R, { overscan: 1.12, diversity: p.tiles.diversity }, cropRegistry);
      const imgRot = (R.range(-1,1) * p.tiles.imgRotRangeDeg) * Math.PI/180;

      tiles.push({ kind:'tile', type:shapeType, poly, angle:rot, skew:sk, opacity, src, imgRot, blend:'source-over', edge: { contrast: p.tiles.edgeContrast } });
    }

    // randomize draw order to add depth layering
    if (p.clusters.layerRnd > 0) {
      const swaps = Math.floor(tiles.length * (p.clusters.layerRnd/100));
      for (let k=0;k<swaps;k++) {
        const a = R.int(tiles.length), b = R.int(tiles.length);
        const tmp = tiles[a]; tiles[a] = tiles[b]; tiles[b] = tmp;
      }
    }

    clusters.push({ cx, cy, tiles });
  }
  return clusters;
}

// ---------------- Eggs ----------------
function makeEasterEggs(R, photoQueue, p, W, H) {
  const count = clampInt(p.eggs.count, 0, 20);
  const maxSize = Math.min(W,H) * (p.eggs.maxSizePct/100);
  const eggs = [];
  for (let i=0; i<count; i++) {
    const img = photoQueue.next();
    const w = Math.min(maxSize, img.width * 0.14) * (0.5 + R()*0.5);
    const h = w * (img.height/img.width) * (0.6 + R()*0.8);
    const x = R.range(w/2, W-w/2);
    const y = R.range(h/2, H-h/2);
    const poly = transformPoly(makeRectPoly(w,h), x, y, R.range(-2,2), R.range(-0.2,0.2), R()<0.5, R()<0.3);
    const src = { img, sx: 0, sy: 0, sw: img.width, sh: img.height };
    eggs.push({ kind:'egg', type:'rect', poly, angle:0, skew:0, opacity: 0.95, src, imgRot: 0, blend:'source-over', edge:{contrast:0} });
  }
  return eggs;
}

// ---------------- Drawing ----------------
function drawStrip(ctx, s) {
  ctx.save();
  ctx.globalCompositeOperation = s.blend;
  ctx.globalAlpha = s.opacity;
  pathPoly(ctx, s.poly);
  ctx.clip();
  drawImageCoverRotated(ctx, s.src.img, 0,0, ctx.canvas.width, ctx.canvas.height, 0, s.src);
  ctx.restore();
}

function drawTile(ctx, t) {
  ctx.save();
  ctx.globalCompositeOperation = t.blend;
  ctx.globalAlpha = t.opacity;
  pathPoly(ctx, t.poly);
  ctx.clip();
  const b = polygonBBox(t.poly);
  drawImageCoverRotated(ctx, t.src.img, b.x, b.y, b.w, b.h, t.imgRot, t.src);
  ctx.restore();

  // edge effect overlay: visible contrast
  if (t.edge && t.edge.contrast > 0) {
    const k = t.edge.contrast/100;
    ctx.save();
    pathPoly(ctx, t.poly);
    ctx.lineWidth = Math.max(1, Math.min(b.w,b.h)*0.006*k + 0.5);
    ctx.strokeStyle = `rgba(255,255,255,${0.18*k})`;
    ctx.stroke();
    ctx.lineWidth *= 0.6;
    ctx.strokeStyle = `rgba(0,0,0,${0.22*k})`;
    ctx.stroke();
    ctx.restore();
  }
}

// ---------------- Shapes ----------------
function makeRectPoly(w,h) { const hw=w/2, hh=h/2; return [{x:-hw,y:-hh},{x:hw,y:-hh},{x:hw,y:hh},{x:-hw,y:hh}]; }

function makeEllipsePoly(w,h,R,irreg) {
  const steps = 36;
  const hw=w/2, hh=h/2;
  const pts = [];
  for (let i=0;i<steps;i++) {
    const t = (i/steps)*Math.PI*2;
    let x = Math.cos(t)*hw, y = Math.sin(t)*hh;
    pts.push({x,y});
  }
  return simplifyPoly(pts, 0.3);
}

function makeTrianglePoly(w,h,R,irreg) {
  const hw=w/2, hh=h/2;
  const pts = [
    {x:0, y:-hh},
    {x:hw, y:hh},
    {x:-hw, y:hh},
  ];
  return pts;
}

function makeDiamondPoly(w,h,R,irreg) {
  const hw=w/2, hh=h/2;
  return [{x:0,y:-hh},{x:hw,y:0},{x:0,y:hh},{x:-hw,y:0}];
}

function makeHexPoly(w,h,R,irreg) {
  const r = Math.min(w,h)/2;
  const pts = [];
  for (let i=0;i<6;i++){
    const a = (i/6)*Math.PI*2;
    pts.push({x: Math.cos(a)*r, y: Math.sin(a)*r});
  }
  return pts;
}

function makeScissorPoly(w,h,jag,R,N) {
  const pts = [];
  const hw=w/2, hh=h/2;
  const edges = [
    [[-hw,-hh],[hw,-hh]],
    [[hw,-hh],[hw,hh]],
    [[hw,hh],[-hw,hh]],
    [[-hw,hh],[-hw,-hh]],
  ];
  const density = 8 + Math.floor(jag/6);
  edges.forEach(([a,b], ei) => {
    for (let i=0;i<=density;i++){
      const t=i/density;
      const x=a[0]+(b[0]-a[0])*t;
      const y=a[1]+(b[1]-a[1])*t;
      const nx = (ei===0||ei===2)? 0 : (ei===1?1:-1);
      const ny = (ei===0? -1 : ei===2?1:0);
      const amp = (w+h)*0.01*(0.4 + jag/100);
      const n = (N(x*0.03, y*0.03)-0.5)*2;
      pts.push({x:x + nx*amp*(0.5+Math.abs(n)), y:y + ny*amp*(0.5+Math.abs(n))});
    }
  });
  return simplifyPoly(pts, 0.8);
}

function makeTornPoly(w,h,rough,R,N) {
  const pts = [];
  const hw=w/2, hh=h/2;
  const steps = 48 + Math.floor(rough/2);
  for (let i=0;i<steps;i++){
    const t=i/steps;
    const ang = t*Math.PI*2;
    const rx = hw*(0.9+0.2*Math.sin(ang*2));
    const ry = hh*(0.9+0.2*Math.cos(ang*2));
    let x = Math.cos(ang)*rx;
    let y = Math.sin(ang)*ry;
    const n = (N(x*0.02+100, y*0.02+100)-0.5)*2;
    const amp = (w+h)*0.03*(rough/100);
    x += Math.cos(ang) * n * amp;
    y += Math.sin(ang) * n * amp;
    pts.push({x,y});
  }
  return simplifyPoly(pts, 0.9);
}

// shape irregularity (post-process)
function addIrregularity(poly, irreg, R, N) {
  if (!irreg) return poly;
  const k = irreg/100;
  const bb = polygonBBox(poly);
  const scale = Math.min(bb.w, bb.h) * 0.06 * k;
  return poly.map(p => {
    const n = (N(p.x*0.03, p.y*0.03)-0.5)*2;
    return { x: p.x + (R()-0.5)*2*scale + n*scale*0.6, y: p.y + (R()-0.5)*2*scale + n*scale*0.6 };
  });
}

// ---------------- Geometry ----------------
function transformPoly(poly, cx, cy, angle, skew, flipX, flipY) {
  const sa = Math.sin(angle), ca = Math.cos(angle);
  const kx = Math.tan(skew);
  return poly.map(p=>{
    let x = p.x * (flipX?-1:1);
    let y = p.y * (flipY?-1:1);
    x = x + kx*y; // skew x by y
    const xr = x*ca - y*sa;
    const yr = x*sa + y*ca;
    return { x: xr + cx, y: yr + cy };
  });
}

function polygonArea(poly) {
  let a=0; for (let i=0;i<poly.length;i++){ const j=(i+1)%poly.length; a += poly[i].x*poly[j].y - poly[j].x*poly[i].y; } return Math.abs(a*0.5);
}
function polygonBBox(poly) {
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  poly.forEach(p=>{
    if(p.x<minX)minX=p.x; if(p.y<minY)minY=p.y; if(p.x>maxX)maxX=p.x; if(p.y>maxY)maxY=p.y;
  });
  return { x:minX, y:minY, w:maxX-minX, h:maxY-minY };
}
function pathPoly(ctx, poly) {
  ctx.beginPath(); ctx.moveTo(poly[0].x, poly[0].y); for (let i=1;i<poly.length;i++) ctx.lineTo(poly[i].x, poly[i].y); ctx.closePath();
}
function simplifyPoly(pts, eps) {
  if (pts.length<=3) return pts;
  const first = pts[0], last = pts[pts.length-1];
  let maxDist=0, idx=-1;
  for (let i=1;i<pts.length-1;i++) {
    const d = pointLineDist(pts[i], first, last);
    if (d>maxDist){ maxDist=d; idx=i; }
  }
  if (maxDist>eps) {
    const left = simplifyPoly(pts.slice(0, idx+1), eps);
    const right = simplifyPoly(pts.slice(idx), eps);
    return left.slice(0,-1).concat(right);
  }
  return [first,last];
}
function pointLineDist(p,a,b) {
  const t = ((p.x-a.x)*(b.x-a.x)+(p.y-a.y)*(b.y-a.y))/((b.x-a.x)**2+(b.y-a.y)**2);
  const tt = Math.max(0, Math.min(1,t));
  const x = a.x + (b.x-a.x)*tt;
  const y = a.y + (b.y-a.y)*tt;
  return Math.hypot(p.x-x, p.y-y);
}

// ---------------- Image drawing & sampling ----------------
function drawImageCoverRotated(ctx, img, dx, dy, dw, dh, rot, crop) {
  // Draw image to dest rect using provided crop (if any) with rotation
  const ir = img.width / img.height;
  let sx=0, sy=0, sw=img.width, sh=img.height;
  if (crop && Number.isFinite(crop.sw) && Number.isFinite(crop.sh)) {
    sx = clamp(+(crop.sx||0), 0, Math.max(0, img.width - crop.sw));
    sy = clamp(+(crop.sy||0), 0, Math.max(0, img.height - crop.sh));
    sw = clamp(+crop.sw, 1, img.width);
    sh = clamp(+crop.sh, 1, img.height);
  } else {
    // center cover
    const dr = dw / dh;
    if (ir > dr) { sh = img.height; sw = sh * dr; sx = (img.width - sw) / 2; sy = 0; }
    else { sw = img.width; sh = sw / dr; sx = 0; sy = (img.height - sh) / 2; }
  }

  ctx.save();
  // transform to dest bbox center then rotate
  ctx.translate(dx + dw/2, dy + dh/2);
  ctx.rotate(rot || 0);
  // draw centered
  ctx.drawImage(img, sx, sy, sw, sh, -dw/2, -dh/2, dw, dh);
  ctx.restore();
}

// Choose source crop while avoiding reusing similar regions on the same image
function chooseDiverseCoverSample(img, w, h, R, opts = {}, registry) {
  const overscan = clamp(opts.overscan ?? 1.15, 1.0, 2.0);
  const dr = Math.max(1e-6, w / Math.max(1e-6, h));
  const ir = img.width / img.height;

  let sw, sh;
  if (ir > dr) { sh = img.height / overscan; sw = sh * dr; }
  else { sw = img.width / overscan; sh = sw / dr; }
  sw = Math.min(sw, img.width);
  sh = Math.min(sh, img.height);

  // diversity as minimum distance in source space
  const minDist = (opts.diversity ?? 50) / 100 * Math.min(img.width, img.height) * 0.35;

  if (!registry.has(img)) registry.set(img, []);
  const points = registry.get(img);

  let attempts = 0, sx=0, sy=0;
  while (attempts++ < 40) {
    sx = R.range(0, Math.max(0, img.width - sw));
    sy = R.range(0, Math.max(0, img.height - sh));
    const cx = sx + sw/2, cy = sy + sh/2;
    let ok = true;
    for (let p of points) {
      const d = Math.hypot(p.cx - cx, p.cy - cy);
      if (d < minDist) { ok = false; break; }
    }
    if (ok) { points.push({cx, cy}); break; }
  }

  return { img, sx, sy, sw, sh };
}

// ---------------- Utils ----------------
function truncatedNormal(R, mean, sd, min, max) {
  for (let i=0;i<18;i++){
    const u1 = R(), u2 = R();
    const z = Math.sqrt(-2*Math.log(u1+1e-9)) * Math.cos(2*Math.PI*u2);
    const v = mean + z * sd;
    if (v>=min && v<=max) return v;
  }
  return clamp(mean, min, max);
}

function sampleAngle(R, minDev) {
  const dev = minDev * Math.PI/180;
  const choices = [
    R.range(dev, Math.PI/2 - dev),
    R.range(Math.PI/2 + dev, Math.PI - dev),
    R.range(Math.PI + dev, 3*Math.PI/2 - dev),
    R.range(3*Math.PI/2 + dev, 2*Math.PI - dev),
  ];
  return choices[(R()*choices.length)|0];
}

function clamp(x, a, b){ return Math.min(b, Math.max(a, x)); }
function clampInt(x, a, b){ return Math.floor(clamp(x, a, b)); }

// map 0..100 "norm" → area in pixels (fraction of canvas area)
function sizeNormToArea(norm, totalArea) {
  // Exponential-ish response so extremes feel impactful
  const t = clamp(norm/100, 0, 1);
  const f = 0.0002 + Math.pow(t, 2.2) * 0.06; // from 0.02% to 6% of canvas by default
  return totalArea * f;
}

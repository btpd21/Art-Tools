javascript
// Core generator: RNG, noise, contour builders, layout logic,
// strips, tiles, clusters, eggs. Draws to 2D canvas with alpha.

function generateCollage(ctx, photos, params) {
  const R = makeRNG(params.seed ?? (Math.random()*1e9)|0);
  const N = makeNoise(R);

  const W = params.width, H = params.height;
  const area = W * H;
  const maxElemArea = area * (params.maxElementPct / 100);

  // Photo cycling to ensure variety and fair use across inputs
  const photoQueue = cycleArray(photos, R);

  // 1) Draw strips in back
  const strips = makeStrips(R, photoQueue, params, W, H, maxElemArea);
  strips.forEach(s => drawStrip(ctx, s));

  // 2) Prepare clusters
  const clusters = makeClusters(R, photoQueue, params, W, H, maxElemArea, N);

  // 3) Tiles (excluding clusters)
  const tiles = makeTiles(R, photoQueue, params, W, H, maxElemArea, N, clusters);

  // 4) Easter eggs
  const eggs = makeEasterEggs(R, photoQueue, params, W, H);

  // Draw order: strips (already), then clusters, then tiles, then eggs
  clusters.forEach(cl => cl.tiles.forEach(t => drawTile(ctx, t)));
  tiles.forEach(t => drawTile(ctx, t));
  eggs.forEach(e => drawTile(ctx, e));

  return {
    seed: R.seed,
    stats: { tiles: tiles.length, strips: strips.length, clusters: clusters.length, eggs: eggs.length },
    strips, clusters, tiles, eggs,
    width: W, height: H
  };
}

function makeRNG(seed) {
  // Mulberry32
  let a = (seed >>> 0) || 0x9E3779B9;
  function rand() { a += 0x6D2B79F5; let t = Math.imul(a ^ (a >>> 15), 1 | a); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
  rand.seed = seed;
  rand.int = (n) => (rand() * n) | 0;
  rand.range = (min, max) => min + (max - min) * rand();
  rand.pick = (arr) => arr[(rand() * arr.length) | 0];
  rand.sign = () => (rand() < 0.5 ? -1 : 1);
  return rand;
}

function makeNoise(R) {
  // Simple 2D value noise
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

// Strips
function makeStrips(R, photoQueue, p, W, H, maxElemArea) {
  const count = clampInt(p.strips.count, 0, 50);
  const strips = [];
  let tries = 0;
  while (strips.length < count && tries < count*40) {
    tries++;
    const angle = sampleAngle(R, p.strips.angleMin);
    const thickness = (p.strips.thicknessPct/100) * Math.min(W, H);
    const opacity = clamp((p.strips.opacityPct/100), 0.76, 1.0);
    const photo = photoQueue.next();

    // Build a long quad spanning the canvas
    const centerX = R.range(0, W);
    const centerY = R.range(0, H);
    const len = Math.hypot(W, H) * 1.6; // overshoot so it spans fully
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

    // Check not excessive area
    const a = polygonArea(poly);
    if (a > maxElemArea) continue;

    strips.push({
      kind: 'strip',
      poly, angle, opacity,
      src: { img: photo, sx: 0, sy: 0, sw: photo.width, sh: photo.height }, // pattern fill approximated in draw
      blend: 'source-over'
    });
  }
  return strips;
}

// Tiles and clusters
function makeTiles(R, photoQueue, p, W, H, maxElemArea, N, clusters) {
  const target = clampInt(p.tiles.count, 1, 400);
  const specialTarget = Math.round(target * clamp(p.tiles.specialPct/100, 0, 1));
  const tiles = [];
  let specialMade = 0;
  let tries = 0;

  const negTarget = clamp(p.negativeSpacePct/100, 0.05, 0.9);
  let drawnArea = 0;

  while (tiles.length < target && tries < target*250) {
    tries++;
    // Area via truncated normal
    const meanPct = p.tiles.sizeMeanPct/100;
    const spreadPct = p.tiles.sizeSpreadPct/100;
    let areaFrac = truncatedNormal(R, meanPct, spreadPct, 0.001, p.maxElementPct/100);
    const areaPx = areaFrac * (W*H);
    if (areaPx > maxElemArea) continue;

    // Base shape type
    const wantSpecial = specialMade < specialTarget;
    const type = chooseShapeType(R, p, wantSpecial);

    // Create base rectangle dims from area and random aspect
    const aspect = Math.exp(R.range(Math.log(0.35), Math.log(2.8)));
    let bw = Math.sqrt(areaPx * aspect);
    let bh = areaPx / bw;
    // Position
    const cx = R.range(bw/2, W - bw/2);
    const cy = R.range(bh/2, H - bh/2);

    // Rotation/Skew, avoiding exact alignment for most
    let angle = (R.range(-1, 1) * (p.tiles.rotRangeDeg * Math.PI/180));
    if (R() < 0.18) angle = snapish(angle, Math.PI/2, 12 * Math.PI/180); // allow small fraction near-aligned
    const skew = R.range(-1, 1) * (p.tiles.skewRangeDeg * Math.PI/180);
    const flipX = R() < 0.5, flipY = R() < 0.25;

    // Build polygon for contour
    let poly = [];
    if (type === 'rect') {
      poly = makeRectPoly(bw, bh);
    } else if (type === 'scissor') {
      poly = makeScissorPoly(bw, bh, p.tiles.scissorJag, R, N);
    } else { // torn
      poly = makeTornPoly(bw, bh, p.tiles.tornRough, R, N);
    }

    // Transform polygon
    poly = transformPoly(poly, cx, cy, angle, skew, flipX, flipY);

    // Size and bounds checks
    const a = polygonArea(poly);
    if (a <= 10 || a > maxElemArea) continue;

    // Negative space steering: avoid overfilling
    const currentCoverage = (drawnArea + a) / (W*H);
    if (currentCoverage > (1 - negTarget) && R() < 0.6) continue;

    // Choose photo sample region with cover-like behavior and multi-scale sampling
    const img = photoQueue.next();
    const bbox = polygonBBox(poly);
    const scale = clamp(truncatedNormal(R, 1.0, 0.35, 0.35, 2.0), 0.35, 2.0);
    const src = chooseCoverSample(img, bbox.w, bbox.h, R, { scale, overscan: 1.15 });

    const tile = {
      kind: 'tile',
      type, poly, angle, skew, opacity: 1.0,
      src: src, blend: 'source-over'
    };
    tiles.push(tile);
    if (type !== 'rect') specialMade++;
    drawnArea += a;
  }
  return tiles;
}

function chooseShapeType(R, p, wantSpecial) {
  const allow = p.tiles.allow;
  const specials = [];
  if (allow.scissor) specials.push('scissor');
  if (allow.torn) specials.push('torn');
  const rectAllowed = allow.rect;
  if (wantSpecial && specials.length) return R.pick(specials);
  if (rectAllowed && (!specials.length || R() < 0.6)) return 'rect';
  return specials.length ? R.pick(specials) : 'rect';
}

function makeClusters(R, photoQueue, p, W, H, maxElemArea, N) {
  const count = clampInt(p.clusters.count, 0, 20);
  const per = clampInt(p.clusters.tilesPer, 1, 50);
  const opacity = clamp(p.clusters.opacityPct/100, 0.76, 1.0);
  const clusters = [];
  let tries = 0;
  while (clusters.length < count && tries < count*30) {
    tries++;
    const cx = R.range(0.2*W, 0.8*W);
    const cy = R.range(0.2*H, 0.8*H);
    const radius = Math.min(W,H) * 0.18 * (0.8 + R()*0.4);

    const tiles = [];
    for (let i=0; i<per; i++) {
      const angle = R.range(0, Math.PI*2);
      const dist = radius * Math.sqrt(R());
      const tx = cx + Math.cos(angle)*dist;
      const ty = cy + Math.sin(angle)*dist;

      // modest areas so clusters don’t dominate
      const areaPx = Math.min(maxElemArea*0.35, (W*H) * truncatedNormal(R, 0.008, 0.006, 0.001, 0.04));
      const aspect = Math.exp(R.range(Math.log(0.4), Math.log(2.2)));
      let bw = Math.sqrt(areaPx * aspect);
      let bh = areaPx / bw;

      const shapeType = R() < 0.55 ? 'scissor' : (R()<0.75 ? 'torn' : 'rect');
      let poly = shapeType==='rect'?makeRectPoly(bw,bh):shapeType==='scissor'?makeScissorPoly(bw,bh,55,R,N):makeTornPoly(bw,bh,60,R,N);
      const rot = R.range(-0.9, 0.9);
      const sk = R.range(-0.15, 0.15);
      const fx = R()<0.5, fy = R()<0.3;
      poly = transformPoly(poly, tx, ty, rot, sk, fx, fy);

      const img = photoQueue.next();
      const bbox = polygonBBox(poly);
      const scale = clamp(truncatedNormal(R, 1.0, 0.35, 0.35, 2.0), 0.35, 2.0);
      const src = chooseCoverSample(img, bbox.w, bbox.h, R, { scale, overscan: 1.12 });

      tiles.push({ kind:'tile', type:shapeType, poly, angle:rot, skew:sk, opacity, src, blend:'source-over' });
    }
    clusters.push({ cx, cy, tiles });
  }
  return clusters;
}

function makeEasterEggs(R, photoQueue, p, W, H) {
  const count = clampInt(p.eggs.count, 0, 20);
  const maxSize = Math.min(W,H) * (p.eggs.maxSizePct/100);
  const eggs = [];
  for (let i=0; i<count; i++) {
    const img = photoQueue.next();
    const w = Math.min(maxSize, img.width * 0.12) * (0.4 + R()*0.6);
    const h = w * (img.height/img.width) * (0.6 + R()*0.8);
    const x = R.range(w/2, W-w/2);
    const y = R.range(h/2, H-h/2);
    const poly = transformPoly(makeRectPoly(w,h), x, y, R.range(-2,2), R.range(-0.2,0.2), R()<0.5, R()<0.3);
    const src = { img, sx: 0, sy: 0, sw: img.width, sh: img.height };
    eggs.push({ kind:'egg', type:'rect', poly, angle:0, skew:0, opacity: 0.95, src, blend:'source-over' });
  }
  return eggs;
}

// Drawing
function drawStrip(ctx, s) {
  ctx.save();
  ctx.globalCompositeOperation = s.blend;
  ctx.globalAlpha = s.opacity;
  pathPoly(ctx, s.poly);
  ctx.clip();
  drawImageCover(ctx, s.src.img, 0,0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();
}

function drawTile(ctx, t) {
  ctx.save();
  ctx.globalCompositeOperation = t.blend;
  ctx.globalAlpha = t.opacity;
  pathPoly(ctx, t.poly);
  ctx.clip();
  const b = polygonBBox(t.poly);
  drawImageCover(ctx, t.src.img, b.x, b.y, b.w, b.h, t.src);
  ctx.restore();
}

// Shape generators
function makeRectPoly(w,h) {
  const hw=w/2, hh=h/2;
  return [{x:-hw,y:-hh},{x:hw,y:-hh},{x:hw,y:hh},{x:-hw,y:hh}];
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
  const density = 6 + Math.floor(jag/8);
  edges.forEach(([a,b], ei) => {
    for (let i=0;i<=density;i++){
      const t=i/density;
      const x=a[0]+(b[0]-a[0])*t;
      const y=a[1]+(b[1]-a[1])*t;
      const nx = (ei===0||ei===2)? 0 : (ei===1?1:-1);
      const ny = (ei===0? -1 : ei===2?1:0);
      const amp = (w+h)*0.006*(0.5 + jag/100);
      const n = (N(x*0.03, y*0.03)-0.5)*2;
      pts.push({x:x + nx*amp*(0.5+Math.abs(n)), y:y + ny*amp*(0.5+Math.abs(n))});
    }
  });
  return simplifyPoly(pts, 0.5);
}

function makeTornPoly(w,h,rough,R,N) {
  const pts = [];
  const hw=w/2, hh=h/2;
  const steps = 40 + Math.floor(rough/2);
  for (let i=0;i<steps;i++){
    const t=i/steps;
    const ang = t*Math.PI*2;
    const rx = hw*(0.9+0.2*Math.sin(ang*2));
    const ry = hh*(0.9+0.2*Math.cos(ang*2));
    let x = Math.cos(ang)*rx;
    let y = Math.sin(ang)*ry;
    const n = (N(x*0.015+100, y*0.015+100)-0.5)*2;
    const amp = (w+h)*0.02*(rough/100);
    x += Math.cos(ang) * n * amp;
    y += Math.sin(ang) * n * amp;
    pts.push({x,y});
  }
  return simplifyPoly(pts, 0.7);
}

// Geometry helpers
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

function snapish(angle, step, tol) {
  const k = Math.round(angle/step);
  const target = k*step;
  if (Math.abs(target - angle) < tol) return target + (Math.random()*tol*0.3);
  return angle;
}

function polygonArea(poly) {
  let a=0;
  for (let i=0;i<poly.length;i++){
    const j=(i+1)%poly.length;
    a += poly[i].x*poly[j].y - poly[j].x*poly[i].y;
  }
  return Math.abs(a*0.5);
}

function polygonBBox(poly) {
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  poly.forEach(p=>{ if(p.x<minX)minX=p.x; if(p.y<minY)minY=p.y; if(p.x>maxX)maxX=p.x; if(p.y>maxY)maxY=p.y; });
  return { x:minX, y:minY, w:maxX-minX, h:maxY-minY };
}

function simplifyPoly(pts, eps) {
  // Ramer–Douglas–Peucker
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

function pathPoly(ctx, poly) {
  ctx.beginPath();
  ctx.moveTo(poly[0].x, poly[0].y);
  for (let i=1;i<poly.length;i++) ctx.lineTo(poly[i].x, poly[i].y);
  ctx.closePath();
}

// Draw image to dest rect using provided crop (if any), otherwise fallback to cover
function drawImageCover(ctx, img, dx, dy, dw, dh, crop) {
  if (crop && Number.isFinite(crop.sw) && Number.isFinite(crop.sh)) {
    const sx = clamp(+(crop.sx||0), 0, Math.max(0, img.width - crop.sw));
    const sy = clamp(+(crop.sy||0), 0, Math.max(0, img.height - crop.sh));
    const sw = clamp(+crop.sw, 1, img.width);
    const sh = clamp(+crop.sh, 1, img.height);
    ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
    return;
  }
  // Fallback: classic cover crop centered
  const ir = img.width / img.height;
  const dr = dw / dh;
  let sw, sh, sx, sy;
  if (ir > dr) { // source wider, crop sides
    sh = img.height;
    sw = sh * dr;
    sx = (img.width - sw) / 2;
    sy = 0;
  } else { // source taller, crop top/bottom
    sw = img.width;
    sh = sw / dr;
    sx = 0;
    sy = (img.height - sh) / 2;
  }
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
}

// Multi-scale cover crop chooser with overscan
function chooseCoverSample(img, w, h, R, opts = {}) {
  const overscan = clamp(opts.overscan ?? 1.15, 1.0, 2.0);
  // truncated normal around 1.0 with gentle tails
  const s = clamp(opts.scale ?? truncatedNormal(R, 1.0, 0.35, 0.35, 2.0), 0.35, 2.0);

  const dr = Math.max(1e-6, w / Math.max(1e-6, h)); // dest aspect
  const ir = img.width / img.height;

  // Base crop that would cover the destination at scale s
  let sw, sh;
  if (ir > dr) {
    // image wider than dest: limit by height
    sh = img.height / s / overscan;
    sw = sh * dr;
  } else {
    // image taller or equal: limit by width
    sw = img.width / s / overscan;
    sh = sw / dr;
  }

  // Clamp crop to image bounds, preserving aspect
  sw = Math.min(sw, img.width);
  sh = Math.min(sh, img.height);

  // If crop is too small due to tiny images, relax overscan/scale
  if (sw < 1 || sh < 1) {
    sw = Math.max(1, Math.min(img.width, img.width / overscan));
    sh = Math.max(1, Math.min(img.height, img.height / overscan));
  }

  // Randomize crop position
  const sx = R.range(0, Math.max(0, img.width - sw));
  const sy = R.range(0, Math.max(0, img.height - sh));

  return { img, sx, sy, sw, sh };
}

function truncatedNormal(R, mean, sd, min, max) {
  for (let i=0;i<12;i++){
    const u1 = R(), u2 = R();
    const z = Math.sqrt(-2*Math.log(u1+1e-9)) * Math.cos(2*Math.PI*u2);
    const v = mean + z * sd;
    if (v>=min && v<=max) return v;
  }
  // fallback
  return clamp(mean, min, max);
}

function sampleAngle(R, minDev) {
  // avoid angles near 0 or 90 deg
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

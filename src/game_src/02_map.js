// ============================================================
// RA2 Web - Part 2: Map generation (temperate theater, original tiles)
// ============================================================

// tile ids reference assets loaded from tiles/*.png
const T = {
  GRASS: 'clear01',
  GRASS_ALT: 'clear01a',
  GRASS_B: 'clear01b',
  GRASS_C: 'clear01c',
  ROUGH: 'rough01', ROUGH2: 'rough03', ROUGH3: 'rough05', ROUGH4: 'rough07',
  RUFF: 'ruff01',
  PAVE: 'pave01', PAVE2: 'pave02', PAVE3: 'pave03',
  WATER: 'water01', WATER2: 'water02', WATER3: 'water03',
  SHORE_N: 'shore01', SHORE_S: 'shore05', SHORE_E: 'shore09', SHORE_W: 'shore13',
  // lat transition tiles (grass-thick)
  CLAT: 'clat01', CLAT2: 'clat02',
};

class GameMap {
  constructor(w, h, rng) {
    this.w = w; this.h = h;
    this.rng = rng;
    // grid arrays
    this.tile = new Array(w * h).fill(T.GRASS);
    this.tileVariant = new Uint8Array(w * h);   // index into variant list
    this.occupancy = new Int32Array(w * h).fill(0); // 0 empty, else entity id
    this.overlay = new Array(w * h).fill(null);  // {kind:'ore'|'gem'|'tree'|'wall', amount}
    this.sightBlocked = new Uint8Array(w * h);   // trees block sight
    this.shroud = new Uint8Array(w * h).fill(1); // 1=shrouded, 2=explored(fog), 3=visible
    this.height = new Uint8Array(w * h);
  }
  idx(tx, ty) { return ty * this.w + tx; }
  inBounds(tx, ty) { return tx >= 0 && ty >= 0 && tx < this.w && ty < this.h; }
  getTile(tx, ty) { return this.inBounds(tx, ty) ? this.tile[this.idx(tx, ty)] : null; }
  passable(tx, ty) {
    if (!this.inBounds(tx, ty)) return false;
    const i = this.idx(tx, ty);
    const t = this.tile[i];
    if (t === T.WATER || t === T.WATER2 || t === T.WATER3) return false;
    const ov = this.overlay[i];
    if (ov && (ov.kind === 'tree' || ov.kind === 'rock')) return false;
    if (this.occupancy[i] !== 0) return false;
    return true;
  }
  buildableTerrain(tx, ty) {
    if (!this.inBounds(tx, ty)) return false;
    const i = this.idx(tx, ty);
    const t = this.tile[i];
    if (t === T.WATER || t === T.WATER2 || t === T.WATER3) return false;
    if (t && (t.startsWith('shore'))) return false;
    const ov = this.overlay[i];
    if (ov && ov.kind !== 'ore' && ov.kind !== 'gem') return false;
    return true;
  }

  // ---------- procedural generation ----------
  generate(playerSide) {
    const rng = this.rng;
    const w = this.w, h = this.h;
    // 1. base grass with rough patches
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = this.idx(x, y);
        this.tile[i] = rng() < 0.06 ? T.GRASS_ALT : T.GRASS;
        this.tileVariant[i] = Math.floor(rng() * 4);
      }
    }
    // 2. rough patches (organic blobs)
    const blobs = 26;
    for (let b = 0; b < blobs; b++) {
      const cx = 2 + rng() * (w - 4), cy = 2 + rng() * (h - 4);
      const r = 2 + rng() * 4;
      const roughTiles = [T.ROUGH, T.ROUGH2, T.ROUGH3, T.ROUGH4];
      for (let y = Math.max(0, cy - r); y <= Math.min(h - 1, cy + r); y++) {
        for (let x = Math.max(0, cx - r); x <= Math.min(w - 1, cx + r); x++) {
          const d = Math.sqrt(dist2(x, y, cx, cy));
          if (d < r && rng() < 0.8) {
            const i = this.idx(Math.floor(x), Math.floor(y));
            this.tile[i] = roughTiles[Math.floor(rng() * roughTiles.length)];
          }
        }
      }
    }
    // 3. water lakes (away from base areas)
    const lakes = 3 + Math.floor(rng() * 3);
    const baseAreas = [{ x: 10, y: h - 12 }, { x: w - 12, y: 10 }]; // player SW, enemy NE
    for (let l = 0; l < lakes; l++) {
      let cx = 4 + rng() * (w - 8), cy = 4 + rng() * (h - 8);
      // avoid base areas
      let tries = 0;
      while (tries++ < 20 && baseAreas.some(a => dist2(cx, cy, a.x, a.y) < 30 * 30)) {
        cx = 4 + rng() * (w - 8); cy = 4 + rng() * (h - 8);
      }
      const r = 3 + rng() * 4;
      const lakeCells = [];
      for (let y = Math.max(1, cy - r); y <= Math.min(h - 2, cy + r); y++) {
        for (let x = Math.max(1, cx - r); x <= Math.min(w - 2, cx + r); x++) {
          const d = Math.sqrt(dist2(x, y, cx, cy));
          if (d < r * (0.7 + rng() * 0.3)) {
            const i = this.idx(Math.floor(x), Math.floor(y));
            this.tile[i] = rng() < 0.4 ? T.WATER2 : T.WATER;
            lakeCells.push({ x: Math.floor(x), y: Math.floor(y) });
          }
        }
      }
      // shore ring
      for (const c of lakeCells) {
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = c.x + dx, ny = c.y + dy;
          if (!this.inBounds(nx, ny)) continue;
          const ni = this.idx(nx, ny);
          if (this.tile[ni] !== T.WATER && this.tile[ni] !== T.WATER2) {
            this.tile[ni] = T.SHORE_S;
          }
        }
      }
    }
    // 4. ore fields: near both bases (2 big) + 2 neutral
    const oreSpots = [
      { x: 16, y: h - 16, r: 4, gems: false },
      { x: w - 17, y: 15, r: 4, gems: false },
      { x: Math.floor(w / 2), y: Math.floor(h / 2), r: 5, gems: false },
      { x: 10, y: 10, r: 3, gems: true },
      { x: w - 11, y: h - 11, r: 3, gems: true },
    ];
    for (const spot of oreSpots) {
      for (let y = spot.y - spot.r; y <= spot.y + spot.r; y++) {
        for (let x = spot.x - spot.r; x <= spot.x + spot.r; x++) {
          if (!this.inBounds(x, y)) continue;
          const d = Math.sqrt(dist2(x, y, spot.x, spot.y));
          if (d <= spot.r * (0.75 + rng() * 0.25)) {
            const i = this.idx(x, y);
            if (this.tile[i] === T.WATER || this.tile[i] === T.WATER2) continue;
            const kind = spot.gems && rng() < 0.65 ? 'gem' : 'ore';
            this.overlay[i] = { kind, amount: kind === 'gem' ? 3 : Math.floor(rng() * 3) };
          }
        }
      }
    }
    // clear ore near starting conyard spots
    const clearings = [{ x: 10, y: h - 10, r: 3 }, { x: w - 11, y: 11, r: 3 }];
    for (const c of clearings) {
      for (let y = c.y - c.r; y <= c.y + c.r; y++) for (let x = c.x - c.r; x <= c.x + c.r; x++) {
        if (this.inBounds(x, y)) {
          const i = this.idx(x, y);
          if (this.overlay[i] && (this.overlay[i].kind === 'ore' || this.overlay[i].kind === 'gem') && dist2(x, y, c.x, c.y) < (c.r - 1) * (c.r - 1)) {
            this.overlay[i] = null;
          }
        }
      }
    }
    // 5.5 connectivity guarantee: player base ↔ enemy base ↔ ore must be reachable
    this.ensureConnectivity([{ x: 10, y: h - 10 }, { x: w - 11, y: 11 }, { x: 16, y: h - 16 }, { x: w - 17, y: 15 }]);

    // 5. trees clusters
    const treeKinds = ['tree01', 'tree02', 'tree03', 'tree05', 'tree08', 'tree10', 'tree12', 'trock02', 'trock03'];
    const treeBlobs = 34;
    for (let b = 0; b < treeBlobs; b++) {
      const cx = 3 + Math.floor(rng() * (w - 6)), cy = 3 + Math.floor(rng() * (h - 6));
      // avoid base + ore
      if (baseAreas.some(a => dist2(cx, cy, a.x, a.y) < 12 * 12)) continue;
      if (oreSpots.some(s => dist2(cx, cy, s.x, s.y) < (s.r + 3) * (s.r + 3))) continue;
      const n = 2 + Math.floor(rng() * 5);
      for (let k = 0; k < n; k++) {
        const x = cx + Math.floor(rng() * 3 - 1), y = cy + Math.floor(rng() * 3 - 1);
        if (!this.inBounds(x, y)) continue;
        const i = this.idx(x, y);
        if (this.overlay[i] || this.tile[i] === T.WATER || this.tile[i] === T.WATER2) continue;
        this.overlay[i] = { kind: 'tree', art: treeKinds[Math.floor(rng() * treeKinds.length)], variant: Math.floor(rng() * 3) };
        this.sightBlocked[i] = 1;
      }
    }
  }

  ensureConnectivity(keyPoints) {
    // flood fill from first point
    const start = keyPoints[0];
    const seen = new Uint8Array(this.w * this.h);
    const q = [this.idx(Math.floor(start.x), Math.floor(start.y))];
    seen[q[0]] = 1;
    while (q.length) {
      const c = q.pop();
      const cx = c % this.w, cy = (c / this.w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (!this.inBounds(nx, ny)) continue;
        const ni = this.idx(nx, ny);
        if (seen[ni]) continue;
        const t = this.tile[ni];
        if (t === T.WATER || t === T.WATER2 || t === T.WATER3) continue;
        const ov = this.overlay[ni];
        if (ov && (ov.kind === 'tree' || ov.kind === 'rock')) continue;
        seen[ni] = 1;
        q.push(ni);
      }
    }
    // carve path for unreachable points
    for (const pt of keyPoints.slice(1)) {
      const ti = this.idx(Math.floor(pt.x), Math.floor(pt.y));
      if (seen[ti]) continue;
      // straight line carve from start to pt
      const steps = Math.ceil(Math.hypot(pt.x - start.x, pt.y - start.y)) * 2;
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const x = Math.floor(lerp(start.x, pt.x, t)), y = Math.floor(lerp(start.y, pt.y, t));
        if (!this.inBounds(x, y)) continue;
        const i = this.idx(x, y);
        const tl = this.tile[i];
        if (tl === T.WATER || tl === T.WATER2 || tl === T.WATER3 || tl.startsWith('shore')) this.tile[i] = T.GRASS;
        const ov = this.overlay[i];
        if (ov && (ov.kind === 'tree' || ov.kind === 'rock')) { this.overlay[i] = null; this.sightBlocked[i] = 0; }
      }
    }
  }

  // ore growth (like TiberiumGrows)
  growOre(rng) {
    const changes = [];
    for (let ty = 1; ty < this.h - 1; ty += 2) {
      for (let tx = 1; tx < this.w - 1; tx += 2) {
        const i = this.idx(tx, ty);
        const ov = this.overlay[i];
        if (ov && ov.kind === 'ore' && ov.amount < 4 && rng() < 0.08) {
          // spread to a neighbor
          const nx = tx + Math.floor(rng() * 3) - 1, ny = ty + Math.floor(rng() * 3) - 1;
          if (this.inBounds(nx, ny)) {
            const ni = this.idx(nx, ny);
            if (!this.overlay[ni] && this.buildableTerrain(nx, ny) && this.occupancy[ni] === 0) {
              this.overlay[ni] = { kind: 'ore', amount: 0 };
            }
          }
        }
      }
    }
    return changes;
  }
}

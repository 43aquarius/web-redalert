// ============================================================
// RA2 Web - Part 4: Pathfinding, combat resolution, game core
// ============================================================

// ---------- A* pathfinding on tile grid ----------
class PathFinder {
  constructor(map) { this.map = map; }
  find(sx, sy, gx, gy, isInfantry = false, selfId = 0) {
    const map = this.map, w = map.w, h = map.h;
    if (!map.inBounds(gx, gy)) return null;
    const start = map.idx(sx, sy), goal = map.idx(gx, gy);
    if (start === goal) return [{ x: gx + 0.5, y: gy + 0.5 }];
    // if goal blocked, find nearest passable around goal
    if (!map.passable(gx, gy)) {
      let best = null, bd = Infinity;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const nx = gx + dx, ny = gy + dy;
        if (map.passable(nx, ny)) {
          const d = dx * dx + dy * dy;
          if (d < bd) { bd = d; best = { x: nx, y: ny }; }
        }
      }
      if (!best) return null;
      gx = best.x; gy = best.y;
    }
    const open = new MinHeap();
    const gScore = new Float32Array(w * h).fill(Infinity);
    const cameFrom = new Int32Array(w * h).fill(-1);
    const closed = new Uint8Array(w * h);
    const hEst = (i) => {
      const x = i % w, y = (i / w) | 0;
      return Math.abs(x - gx) + Math.abs(y - gy);
    };
    gScore[start] = 0;
    open.push(start, hEst(start));
    const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.41], [1, -1, 1.41], [-1, 1, 1.41], [-1, -1, 1.41]];
    let iter = 0;
    while (!open.empty() && iter++ < 6000) {
      const cur = open.pop();
      if (cur === goal) {
        // reconstruct
        const path = [];
        let n = cur;
        while (n !== -1 && n !== start) {
          path.push({ x: (n % w) + 0.5, y: ((n / w) | 0) + 0.5 });
          n = cameFrom[n];
        }
        path.reverse();
        return this.smooth(path);
      }
      if (closed[cur]) continue;
      closed[cur] = 1;
      const cx = cur % w, cy = (cur / w) | 0;
      for (const [dx, dy, cost] of DIRS) {
        const nx = cx + dx, ny = cy + dy;
        if (!map.inBounds(nx, ny)) continue;
        const ni = map.idx(nx, ny);
        if (closed[ni]) continue;
        // passability: allow own tile
        if (ni !== goal && !(map.passable(nx, ny) || (ni === start))) continue;
        // diagonal must have both straights passable
        if (dx !== 0 && dy !== 0) {
          if (!map.passable(cx + dx, cy) && map.occupancy[map.idx(cx + dx, cy)] !== selfId) continue;
          if (!map.passable(cx, cy + dy) && map.occupancy[map.idx(cx, cy + dy)] !== selfId) continue;
        }
        const tg = gScore[cur] + cost;
        if (tg < gScore[ni]) {
          gScore[ni] = tg;
          cameFrom[ni] = cur;
          open.push(ni, tg + hEst(ni));
        }
      }
    }
    return null;
  }
  // line-of-sight smoothing
  smooth(path) {
    if (!path || path.length < 3) return path;
    const out = [path[0]];
    let i = 0;
    while (i < path.length - 1) {
      let j = path.length - 1;
      for (; j > i + 1; j--) {
        if (this.los(path[i], path[j])) break;
      }
      out.push(path[j]);
      i = j;
    }
    return out;
  }
  los(a, b) {
    const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 2);
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      const x = Math.floor(lerp(a.x, b.x, t)), y = Math.floor(lerp(a.y, b.y, t));
      if (!this.map.passable(x, y)) return false;
    }
    return true;
  }
}

class MinHeap {
  constructor() { this.items = []; this.prios = []; }
  empty() { return this.items.length === 0; }
  push(item, prio) {
    this.items.push(item); this.prios.push(prio);
    let i = this.items.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.prios[p] <= this.prios[i]) break;
      [this.items[p], this.items[i]] = [this.items[i], this.items[p]];
      [this.prios[p], this.prios[i]] = [this.prios[i], this.prios[p]];
      i = p;
    }
  }
  pop() {
    const top = this.items[0];
    const li = this.items.length - 1;
    this.items[0] = this.items[li]; this.prios[0] = this.prios[li];
    this.items.pop(); this.prios.pop();
    let i = 0;
    for (;;) {
      const l = i * 2 + 1, r = i * 2 + 2;
      let m = i;
      if (l < this.items.length && this.prios[l] < this.prios[m]) m = l;
      if (r < this.items.length && this.prios[r] < this.prios[m]) m = r;
      if (m === i) break;
      [this.items[m], this.items[i]] = [this.items[i], this.items[m]];
      [this.prios[m], this.prios[i]] = [this.prios[i], this.prios[m]];
      i = m;
    }
    return top;
  }
}

// ============================================================
// Game core
// ============================================================
class Game {
  constructor(assets, playerSide, difficulty) {
    this.assets = assets;
    this.data = assets.gameData;
    this.playerSide = playerSide;             // 'allied' | 'soviet'
    this.enemySide = playerSide === 'allied' ? 'soviet' : 'allied';
    this.difficulty = difficulty;             // 0 easy 1 normal 2 hard
    this.rng = makeRng(Date.now() & 0xffffffff);
    this.map = new GameMap(MAP_W, MAP_H, this.rng);
    this.map.generate(playerSide);
    this.pathFinder = new PathFinder(this.map);
    this.buildings = [];
    this.units = [];
    this.projectiles = [];
    this.effects = [];
    this.credits = { player: 6000, enemy: 5000 + difficulty * 2500 };
    this.powerGen = { player: 0, enemy: 0 };
    this.powerDrain = { player: 0, enemy: 0 };
    this.weapons = this.data.weapons;
    this.warheads = this.data.warheads;
    this.time = 0;
    this.gameOver = null; // 'win' | 'lose'
    this.speed = 1;
    this.oreTimer = 0;
    this.evaTimer = 0;
    this.briefing = null;
    this.buildQueue = { player: [] }; // per-owner queues handled via building.producing
    this._recomputePower();
    this._initDefs();
  }

  _initDefs() {
    // attach helper fields to defs
    for (const [id, b] of Object.entries(this.data.buildings)) {
      b._id = id;
      const m = String(b.size || '1x1').match(/(\d+)x(\d+)/);
      b._foundation = [parseInt(m?.[1] ?? 1), parseInt(m?.[2] ?? 1)];
      // normalize factory types
      const fmap = { infantrytype: 'infantry', unittype: 'vehicle', buildingtype: 'building', aircrafttype: 'aircraft', infantry: 'infantry', vehicle: 'vehicle' };
      b._factory = fmap[b.factory] ?? null;
      if (id === 'nuclearmissile') b._super = { type: 'nuke', recharge: 360, damage: 500 };
      if (id === 'chronosphere') b._super = { type: 'chrono', recharge: 300 };
      if (id === 'weather') b._super = { type: 'storm', recharge: 300 };
      // defense weapons
      if (id === 'teslacoil') b._weapon = 'tesla';
      if (id === 'prismtower') b._weapon = 'prismshot';
      if (id === 'pillbox') b._weapon = 'm60';
      if (id === 'flakcannon') b._weapon = 'flakgun';
    }
    for (const [id, u] of Object.entries(this.data.vehicles)) {
      u._id = id;
      if (id === 'harvester') u._harvester = true;
      if (id === 'harrier' || id === 'kirov') { u._air = true; u._turret = false; }
      if (id === 'rhino' || id === 'grizzly' || id === 'teslatank' || id === 'prismtank' || id === 'ifv' || id === 'ltnk' || id === 'v3launcher') u._turret = true;
    }
    for (const [id, i] of Object.entries(this.data.infantry)) {
      i._id = id;
      i._infantry = true;
    }
    // weapon aliases (rules names → our anims)
    const w = this.weapons;
    if (w.tesla) { w.tesla.anim = 'electro'; w.tesla.projectile = 'beam'; w.tesla.speed = 999; }
    if (w.prismshot) { w.prismshot.anim = null; w.prismshot.projectile = 'beam'; w.prismshot.speed = 999; }
  }

  getUnitDef(id) { return this.data.vehicles[id] ?? this.data.infantry[id] ?? this.data.buildings[id]; }

  // ---------- power ----------
  _recomputePower() {
    for (const owner of ['player', 'enemy']) {
      let gen = 0, drain = 0;
      for (const b of this.buildings) {
        if (b.owner !== owner || b.dead || !b.built) continue;
        const p = b.power;
        if (p > 0) gen += p; else drain -= p;
      }
      this.powerGen[owner] = gen;
      this.powerDrain[owner] = drain;
      this._powerRatio = this._powerRatio ?? {};
      this._powerRatio[owner] = gen >= drain ? 1 : gen / Math.max(1, drain);
    }
  }
  get powerRatio() { return this._powerRatio?.player ?? 1; }
  get enemyPowerRatio() { return this._powerRatio?.enemy ?? 1; }

  addCredits(owner, amount) { this.credits[owner] += amount; }
  spendCredits(owner, amount) {
    if (this.credits[owner] >= amount) { this.credits[owner] -= amount; return true; }
    return false;
  }

  // ---------- entity management ----------
  addBuilding(buildingId, owner, tx, ty, instant = false) {
    const def = this.data.buildings[buildingId];
    if (!def) return null;
    const b = new Building(def, def.side, tx, ty, this, owner);
    if (instant) { b.buildProgress = 1; b.built = true; }
    this.buildings.push(b);
    // occupancy
    for (let y = ty; y < ty + b.fh; y++) for (let x = tx; x < tx + b.fw; x++) {
      if (this.map.inBounds(x, y)) {
        this.map.occupancy[this.map.idx(x, y)] = b.id;
        const ov = this.map.overlay[this.map.idx(x, y)];
        if (ov && (ov.kind === 'ore' || ov.kind === 'gem')) this.map.overlay[this.map.idx(x, y)] = null;
      }
    }
    this._recomputePower();
    this.revealAround(b.tx + b.fw / 2, b.ty + b.fh / 2, b.sight, owner);
    return b;
  }

  canPlaceBuilding(buildingId, tx, ty) {
    const def = this.data.buildings[buildingId];
    if (!def) return false;
    const [fw, fh] = def._foundation;
    // adjacency: must touch existing building (except conyard)
    let adjacent = false;
    const isConyard = buildingId.includes('conyard');
    for (let y = ty - 1; y <= ty + fh; y++) for (let x = tx - 1; x <= tx + fw; x++) {
      if (x >= tx && x < tx + fw && y >= ty && y < ty + fh) {
        if (!this.map.buildableTerrain(x, y)) return false;
        if (this.map.occupancy[this.map.idx(x, y)] !== 0) return false;
      } else if (this.map.inBounds(x, y) && this.map.occupancy[this.map.idx(x, y)] !== 0) {
        const e = this.entityById(this.map.occupancy[this.map.idx(x, y)]);
        if (e && e.kind === 'building' && e.owner === 'player') adjacent = true;
      }
    }
    return isConyard || adjacent;
  }

  entityById(id) {
    for (const b of this.buildings) if (b.id === id) return b;
    for (const u of this.units) if (u.id === id) return u;
    return null;
  }

  addUnit(unitId, owner, x, y) {
    const def = this.data.vehicles[unitId] ?? this.data.infantry[unitId];
    if (!def) return null;
    const u = new Unit(def, unitId, this, owner);
    u.x = x; u.y = y;
    this.units.push(u);
    this.updateUnitTile(u);
    this.revealAround(x, y, u.sight, owner);
    return u;
  }

  updateUnitTile(u) {
    const tx = Math.floor(u.x), ty = Math.floor(u.y);
    if (tx === u.tx && ty === u.ty) return;
    if (this.map.inBounds(u.tx, u.ty) && this.map.occupancy[this.map.idx(u.tx, u.ty)] === u.id) {
      this.map.occupancy[this.map.idx(u.tx, u.ty)] = 0;
    }
    u.tx = tx; u.ty = ty;
    if (this.map.inBounds(tx, ty) && this.map.occupancy[this.map.idx(tx, ty)] === 0) {
      this.map.occupancy[this.map.idx(tx, ty)] = u.id;
    }
  }

  findPath(unit, gx, gy) {
    return this.pathFinder.find(Math.floor(unit.x), Math.floor(unit.y), gx, gy, unit.isInfantry, unit.id);
  }

  // ---------- combat ----------
  fireWeapon(from, to, wep) {
    if (!wep) return;
    const wh = this.warheads[wep.warhead];
    let damage = wep.damage * (from.veteran ? 1.1 : 1);
    // muzzle flash / beam effects
    const a = from.centerPx ?? from.px;
    const b = to.centerPx ?? to.px;
    if (wep.projectile === 'beam') {
      // tesla/prism: instant beam effect
      this.addBeam(a.x, a.y - 10, b.x, b.y - 8, wep.anim === 'electro' ? 'electro' : 'prism');
      this.impactAt(to, wep, damage, wh, from);
      this.sfx('tesla' in this._sfxMap ? (wep.anim === 'electro' ? 'tesla' : 'prism') : null);
    } else {
      this.projectiles.push(new Projectile(this, from, to, wep, damage));
      if (wep.projectile === 'v3') this.sfx('v3launch');
      else this.sfx('cannon');
    }
    if (wep.anim === 'GUNFIRE' || wep.anim === 'gunfire') {
      this.addEffect('gunfire', b.x + (Math.random() - 0.5) * 10, b.y - 6, { frames: 4, fps: 12 });
    }
  }

  impact(proj) {
    const t = proj.target;
    if (t && !t.dead) {
      this.impactAt(t, proj.wep, proj.damage, this.warheads[proj.wep.warhead], proj.source);
    } else {
      // ground impact
      this.addEffect('explosml', proj.tx, proj.ty, { frames: 14, fps: 22 });
    }
    const wh = this.warheads[proj.wep.warhead];
    const spread = wh?.spread ?? 0;
    if (spread > 1) {
      // area damage
      this.areaDamage(proj.tx, proj.ty, spread, proj.damage, wh, proj.wep);
    }
  }

  impactAt(t, wep, damage, wh, attacker) {
    if (t.kind === 'building' || t.kind === 'unit') t.damage(damage, wh, this, attacker);
    const c = t.centerPx ?? t.px;
    const animId = this.explosionFor(wep, damage);
    this.addEffect(animId, c.x, c.y, { frames: this._animFrames(animId), fps: 20 });
    this.sfx(damage >= 120 ? 'bigboom' : 'boom');
  }

  explosionFor(wep, damage) {
    if (damage >= 300) return 'nukeanim';
    if (damage >= 120) return 'explolrg';
    if (damage >= 60) return 'explomed';
    return 'explosml';
  }
  _animFrames(id) { return ANIM_FRAMES[id] ?? 15; }

  areaDamage(x, y, radius, damage, wh, wep) {
    const targets = [...this.buildings.filter(b => !b.dead), ...this.units.filter(u => !u.dead)];
    for (const t of targets) {
      const c = t.centerPx ?? t.px;
      const d = Math.hypot(c.x - x, c.y - y) / TW;
      if (d <= radius) {
        const falloff = clamp(1 - d / radius * 0.6, 0.3, 1);
        t.damage(damage * falloff, wh, this);
      }
    }
  }

  findTargetForBuilding(b, range) {
    let best = null, bd = Infinity;
    const bx = b.tx + b.fw / 2, by = b.ty + b.fh / 2;
    for (const u of this.units) {
      if (u.dead || u.owner === b.owner || u.isAircraft) continue;
      const d = dist2(u.x, u.y, bx, by);
      if (d < range * range && d < bd) { bd = d; best = u; }
    }
    return best;
  }
  findAttackerOf(u) {
    // find enemy that recently damaged this unit (simplified: nearest enemy in weapon range)
    const wep = this.weapons[u.def.weapon];
    if (!wep) return null;
    return this.findTargetNear(u, wep.range);
  }
  findTargetNear(u, range) {
    let best = null, bd = Infinity;
    for (const e of [...this.units, ...this.buildings]) {
      if (e.dead || e.owner === u.owner) continue;
      const ex = e.x ?? e.tx + 0.5, ey = e.y ?? e.ty + 0.5;
      const d = dist2(u.x, u.y, ex, ey);
      if (d < range * range && d < bd) { bd = d; best = e; }
    }
    return best;
  }

  // ---------- destruction ----------
  destroyBuilding(b) {
    if (b.dead) return;
    b.dead = true;
    const c = b.centerPx;
    // big explosion + debris
    this.addEffect('explolrg', c.x, c.y - 10, { frames: this._animFrames('explolrg'), fps: 16, scale: Math.max(1, b.fw / 2) });
    this.addEffect('debris1lg', c.x, c.y, { frames: 15, fps: 10 });
    this.sfx('bigboom');
    // free occupancy
    for (let y = b.ty; y < b.ty + b.fh; y++) for (let x = b.tx; x < b.tx + b.fw; x++) {
      if (this.map.inBounds(x, y) && this.map.occupancy[this.map.idx(x, y)] === b.id) {
        this.map.occupancy[this.map.idx(x, y)] = 0;
      }
    }
    this._recomputePower();
    if (b.owner === 'player') this.eva('baseUnderAttack');
    // sell refund nothing
    this.checkVictory();
  }
  destroyUnit(u) {
    if (u.dead) return;
    u.dead = true;
    const c = u.px;
    if (u.isInfantry) {
      this.addEffect('infdie', c.x, c.y, { frames: 8, fps: 10, scale: 1 });
    } else {
      this.addEffect('explomed', c.x, c.y, { frames: 15, fps: 20 });
      this.addEffect('debris4lg', c.x, c.y, { frames: 15, fps: 10 });
    }
    this.sfx(u.isInfantry ? 'scream' : 'boom');
    if (this.map.inBounds(u.tx, u.ty) && this.map.occupancy[this.map.idx(u.tx, u.ty)] === u.id) {
      this.map.occupancy[this.map.idx(u.tx, u.ty)] = 0;
    }
    if (u.owner === 'player' && u.def._harvester) this.eva('minerUnderAttack');
  }

  checkVictory() {
    const enemyBuildings = this.buildings.filter(b => !b.dead && b.owner === 'enemy').length;
    const playerBuildings = this.buildings.filter(b => !b.dead && b.owner === 'player').length;
    if (enemyBuildings === 0) this.gameOver = 'win';
    else if (playerBuildings === 0) this.gameOver = 'lose';
  }

  // ---------- effects ----------
  addEffect(animId, x, y, opts) {
    const e = new Effect(animId, x, y, opts);
    e.frameCount = opts.frames ?? ANIM_FRAMES[animId] ?? 15;
    this.effects.push(e);
    return e;
  }
  addBeam(x1, y1, x2, y2, kind) {
    this.effects.push({ kind: 'beam', x1, y1, x2, y2, t: 0, dur: 0.25, beamKind: kind, dead: false });
    (this.beams ??= []).push(this.effects[this.effects.length - 1]);
  }

  // ---------- helpers ----------
  findNearestOre(x, y) {
    let best = null, bd = Infinity;
    const cx = Math.floor(x), cy = Math.floor(y);
    for (let ty = 0; ty < this.map.h; ty++) {
      for (let tx = 0; tx < this.map.w; tx++) {
        const ov = this.map.overlay[this.map.idx(tx, ty)];
        if (ov && (ov.kind === 'ore' || ov.kind === 'gem')) {
          const d = dist2(tx, ty, cx, cy);
          if (d < bd) { bd = d; best = { x: tx, y: ty }; }
        }
      }
    }
    return best;
  }
  findRefinery(owner) {
    return this.buildings.find(b => !b.dead && b.built && b.owner === owner && b.gameId.includes('refinery')) || null;
  }

  completeProduction(building) {
    const p = building.producing;
    if (!p) return;
    const def = this.getUnitDef(p.unitId);
    if (!def) { building.producing = null; return; }
    // find spawn spot around building
    const spot = this.findSpawnSpot(building);
    if (!spot) { p.progress = 1; return; } // wait for space
    const u = this.addUnit(p.unitId, building.owner, spot.x, spot.y);
    building.producing = null;
    if (building.owner === 'player') {
      this.eva('unitReady');
    }
  }
  findSpawnSpot(b) {
    for (let r = 1; r <= 4; r++) {
      const spots = [];
      for (let dy = -r; dy <= b.fh + r - 1; dy++) {
        for (let dx = -r; dx <= b.fw + r - 1; dx++) {
          const x = b.tx + dx, y = b.ty + dy;
          if (x >= b.tx && x < b.tx + b.fw && y >= b.ty && y < b.ty + b.fh) continue;
          if (this.map.passable(x, y)) spots.push({ x: x + 0.5, y: y + 0.5 });
        }
      }
      if (spots.length) return spots[Math.floor(this.rng() * spots.length)];
    }
    return null;
  }

  // ---------- fog of war ----------
  revealAround(tx, ty, radius, owner) {
    if (owner !== 'player') return;
    const r = radius + 1;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const x = Math.floor(tx + dx), y = Math.floor(ty + dy);
      if (!this.map.inBounds(x, y)) continue;
      if (dx * dx + dy * dy <= r * r) {
        this.map.shroud[this.map.idx(x, y)] = 3;
      }
    }
  }
  fogTick() {
    // decay visible -> explored (fog), then re-reveal by player entities
    const sh = this.map.shroud;
    for (let i = 0; i < sh.length; i++) if (sh[i] === 3) sh[i] = 2;
    for (const b of this.buildings) {
      if (b.dead || b.owner !== 'player' || !b.built) continue;
      this.revealAround(b.tx + b.fw / 2, b.ty + b.fh / 2, b.sight, 'player');
    }
    for (const u of this.units) {
      if (u.dead || u.owner !== 'player') continue;
      this.revealAround(u.x, u.y, u.sight, 'player');
    }
  }
  visible(i) { return this.map.shroud[i] === 3; }
  explored(i) { return this.map.shroud[i] >= 2; }

  // ---------- EVA voice ----------
  eva(key) {
    const map = this._sfxMap ?? {};
    const url = map[key];
    if (url) this.assets.sound.playSfxFromUrl(url, 0.9);
  }
  sfx(key) {
    const map = this._sfxMap ?? {};
    const url = map[key];
    if (url) this.assets.sound.playSfxFromUrl(url, 0.6);
    else this.assets.sound.synth(key, key === 'bigboom' ? 0.7 : 0.4);
  }

  // ---------- main update ----------
  update(dt) {
    if (this.gameOver) return;
    this.time += dt;
    for (const b of this.buildings) b.update(this, dt);
    for (const u of this.units) u.update(this, dt);
    for (const p of this.projectiles) p.update(this, dt);
    for (const e of this.effects) if (e.update) e.update(dt);
    // beams
    for (const e of this.effects) if (e.kind === 'beam') { e.t += dt; if (e.t >= e.dur) e.dead = true; }
    // cleanup
    this.buildings = this.buildings.filter(b => !b.dead || b.keepForAnim);
    this.units = this.units.filter(u => !u.dead);
    this.projectiles = this.projectiles.filter(p => !p.dead);
    this.effects = this.effects.filter(e => !e.dead);
    // ore growth every ~5s
    this.oreTimer += dt;
    if (this.oreTimer > 5) { this.oreTimer = 0; this.map.growOre(this.rng); }
    // fog update ~ every 0.4s
    this._fogTimer = (this._fogTimer ?? 0) + dt;
    if (this._fogTimer > 0.4) { this._fogTimer = 0; this.fogTick(); }
    // AI
    this.ai?.update(this, dt);
    // enemy power recompute occasionally
    this._pwTimer = (this._pwTimer ?? 0) + dt;
    if (this._pwTimer > 1) { this._pwTimer = 0; this._recomputePower(); }
  }
}

const ANIM_FRAMES = {
  explolrg: 21, explosml: 14, explomed: 15, s_bang48: 23, s_clsn58: 21, s_tumu60: 21,
  fire01: 30, fire02: 64, twlt070: 26, twlt100: 21, gunfire: 4, piff: 7, piffpiff: 12,
  nukeanim: 39, nukeball: 20, nukepuff: 20, mininuke: 39, ring1: 21, sgrysmk1: 20,
  water_exp: 16, missiletrail: 46, electro: 15, debris1lg: 15, debris4lg: 15, debris5sm: 15,
  infdie: 8,
};

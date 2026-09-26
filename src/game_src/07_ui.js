// ============================================================
// RA2 Web - Part 7: UI — sidebar (original graphics), input, menus
// ============================================================
const $ = id => document.getElementById(id);

class UI {
  constructor(game, renderer, assets) {
    this.game = game;
    this.renderer = renderer;
    this.assets = assets;
    this.tab = 'buildings';   // buildings | defense | infantry | vehicles
    this.buildSelection = null; // selected building to place
    this.sellMode = false;
    this.repairMode = false;
    this.dragStart = null;
    this.dragEnd = null;
    this.mouse = { x: 0, y: 0 };
    this.hoverCell = null;
    this._creditsAnim = 0;
    this.initSidebar();
    this.initInput();
    this.updateSidebar();
  }

  // ---------- sidebar construction ----------
  initSidebar() {
    const g = this.game, side = g.playerSide;
    const A = this.assets;
    const sb = $('sidebar');
    // background from original art
    const bg = A.img('ui_side_' + (side === 'soviet' ? 'soviet' : 'allied') + '_side1');
    if (bg) {
      sb.style.backgroundImage = `url(${bg.src})`;
      sb.style.backgroundSize = '100% 100%';
    } else {
      sb.style.background = side === 'soviet'
        ? 'linear-gradient(#8c2a20,#5a1a14 60%,#40100c)'
        : 'linear-gradient(#2a4a8c,#1a2a5a 60%,#101a40)';
    }
    // top: credits + power
    const top = document.createElement('div');
    top.id = 'sb-top';
    top.innerHTML = `
      <div id="credits-box"><span id="credits-val">0</span></div>
      <div id="power-box"><div id="power-bar"><div id="power-fill"></div></div><span id="power-txt">100%</span></div>
    `;
    sb.appendChild(top);
    // tabs
    const tabs = document.createElement('div');
    tabs.id = 'sb-tabs';
    const tabDefs = [
      ['buildings', '建造', 'bld'],
      ['defense', '防御', 'def'],
      ['infantry', '步兵', 'inf'],
      ['vehicles', '战车', 'veh'],
    ];
    for (const [id, label] of tabDefs) {
      const t = document.createElement('button');
      t.className = 'sb-tab';
      t.dataset.tab = id;
      t.textContent = label;
      t.onclick = () => { this.tab = id; this.updateSidebar(); this.assets.sound.resume(); };
      tabs.appendChild(t);
    }
    sb.appendChild(tabs);
    // cameo grid
    const grid = document.createElement('div');
    grid.id = 'sb-grid';
    sb.appendChild(grid);
    // minimap
    const miniWrap = document.createElement('div');
    miniWrap.id = 'mini-wrap';
    const mini = document.createElement('canvas');
    mini.id = 'minimap';
    mini.width = 190; mini.height = 190;
    miniWrap.appendChild(mini);
    sb.appendChild(miniWrap);
    // sell/repair
    const tools = document.createElement('div');
    tools.id = 'sb-tools';
    tools.innerHTML = `
      <button id="btn-repair" title="维修模式">🔧 维修</button>
      <button id="btn-sell" title="出售模式">💰 出售</button>
    `;
    sb.appendChild(tools);
    $('btn-repair').onclick = () => {
      this.repairMode = !this.repairMode; this.sellMode = false;
      $('btn-repair').classList.toggle('active', this.repairMode);
      $('btn-sell').classList.remove('active');
    };
    $('btn-sell').onclick = () => {
      this.sellMode = !this.sellMode; this.repairMode = false;
      $('btn-sell').classList.toggle('active', this.sellMode);
      $('btn-repair').classList.remove('active');
    };
    // GitHub icon (top-right of screen, separate)
    this.addGithubIcon();
    // selection info bar
    const info = document.createElement('div');
    info.id = 'info-bar';
    document.body.appendChild(info);
    // superweapon bar
    const sw = document.createElement('div');
    sw.id = 'sw-bar';
    document.body.appendChild(sw);
  }

  addGithubIcon() {
    if ($('github-link')) return;
    const a = document.createElement('a');
    a.id = 'github-link';
    a.href = 'https://github.com/43aquarius/web-redalert';
    a.target = '_blank';
    a.title = 'GitHub 仓库';
    a.innerHTML = `<svg viewBox="0 0 16 16" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"></path></svg>`;
    document.body.appendChild(a);
  }

  // ---------- sidebar content ----------
  availableItems() {
    const g = this.game, side = g.playerSide;
    const defs = { buildings: [], defense: [], infantry: [], vehicles: [] };
    for (const [id, b] of Object.entries(g.data.buildings)) {
      if (b.side !== side) continue;
      if (!b.cost) continue;
      const cat = b.buildcat === 'combat' ? 'defense' : 'buildings';
      if (this.tab === 'defense' || this.tab === 'buildings') {} // filter at render
      defs[cat].push({ id, def: b, type: 'building' });
    }
    for (const [id, u] of Object.entries(g.data.infantry)) {
      if (u.side !== side && u.side !== 'both') continue;
      defs.infantry.push({ id, def: u, type: 'unit' });
    }
    for (const [id, u] of Object.entries(g.data.vehicles)) {
      if (u.side !== side && u.side !== 'both') continue;
      defs.vehicles.push({ id, def: u, type: 'unit' });
    }
    return defs;
  }

  isAvailable(entry) {
    const g = this.game;
    const def = entry.def;
    // conyard required always (implicit)
    const has = (req) => {
      if (!req.length) return true;
      return req.every(r => {
        const myB = g.buildings.filter(b => !b.dead && b.owner === 'player' && b.built);
        if (r === 'POWER') return myB.some(b => b.power > 0);
        if (r === 'PROC') return myB.some(b => b.gameId.includes('refinery'));
        if (r === 'BARRACKS') return myB.some(b => b.gameId.includes('barracks'));
        if (r === 'WEAPONS') return myB.some(b => b.gameId.includes('warfactory'));
        if (r === 'RADAR') return myB.some(b => b.gameId.includes('radar') || b.gameId.includes('airforce'));
        if (r === 'TECH') return myB.some(b => b.gameId.includes('battlelab'));
        if (r === 'GACNST' || r === 'NACNST') return myB.some(b => b.gameId.includes('conyard'));
        return myB.some(b => b.gameId.toLowerCase().includes(r.toLowerCase()));
      });
    };
    return has(def.prereq ?? []);
  }

  updateSidebar() {
    const g = this.game;
    // tabs active state
    document.querySelectorAll('.sb-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === this.tab));
    const grid = $('sb-grid');
    grid.innerHTML = '';
    const items = this.availableItems()[this.tab] ?? [];
    // sort by tech level then cost
    items.sort((a, b) => (a.def.tech ?? 1) - (b.def.tech ?? 1) || (a.def.cost ?? 0) - (b.def.cost ?? 0));
    for (const item of items) {
      const cell = document.createElement('div');
      cell.className = 'cameo';
      const img = this.assets.img('cam_' + item.id);
      if (img) {
        const bg = document.createElement('img');
        bg.src = img.src;
        bg.draggable = false;
        cell.appendChild(bg);
      } else {
        cell.textContent = item.def.name?.slice(0, 4) ?? item.id;
      }
      const avail = this.isAvailable(item);
      const affordable = g.credits.player >= item.def.cost;
      cell.classList.toggle('unavailable', !avail);
      cell.classList.toggle('poor', avail && !affordable);
      cell.title = `${item.def.name} — $${item.def.cost}`;
      // click → start placement (building) or queue production (unit)
      cell.onclick = () => {
        if (!avail) return;
        this.assets.sound.resume();
        if (item.type === 'building') {
          this.buildSelection = item.id;
          g.placement = { buildingId: item.id, tx: -1, ty: -1 };
        } else {
          this.queueProduction(item);
        }
      };
      grid.appendChild(cell);
    }
    // production progress display handled in tick
    this.updateSuperweapons();
  }

  queueProduction(item) {
    const g = this.game;
    const def = item.def;
    if (!g.spendCredits('player', def.cost)) { this.flashCredits(); return; }
    // find producing factory for the type
    const factoryType = item.type === 'unit' && def._infantry ? 'infantry' : 'vehicle';
    let factory = g.buildings.find(b => !b.dead && b.built && b.owner === 'player' &&
      ((item.type === 'building') ? false : (b.def._factory === factoryType || (factoryType === 'vehicle' && b.def._factory === 'vehicle'))));
    if (!factory) { g.addCredits('player', def.cost); return; }
    if (factory.producing) {
      // queue up to 1 extra: replace simple approach - refund
      g.addCredits('player', def.cost);
      return;
    }
    factory.producing = { unitId: item.id, progress: 0 };
    g.eva('building');
  }

  flashCredits() {
    const el = $('credits-box');
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 300);
  }

  updateSuperweapons() {
    const g = this.game;
    const bar = $('sw-bar');
    const sws = g.buildings.filter(b => !b.dead && b.built && b.owner === 'player' && b.def._super);
    if (!sws.length) { bar.innerHTML = ''; bar.style.display = 'none'; return; }
    bar.style.display = 'flex';
    bar.innerHTML = '';
    for (const sw of sws) {
      const d = document.createElement('div');
      d.className = 'sw-item';
      const ready = sw.superCharge >= 1;
      d.innerHTML = `<div class="sw-name">${sw.name}</div>
        <div class="sw-charge ${ready ? 'ready' : ''}" style="width:${clamp(sw.superCharge * 100, 0, 100)}%"></div>`;
      if (ready) {
        d.classList.add('ready');
        d.onclick = () => this.fireSuperweapon(sw);
      }
      bar.appendChild(d);
    }
  }

  fireSuperweapon(sw) {
    const g = this.game;
    if (sw.superCharge < 1 || !sw.def._super) return;
    const type = sw.def._super.type;
    if (type === 'nuke') {
      // click target mode
      this.nukeArmed = sw;
      this.renderer.game.eva('nukeReady');
    } else if (type === 'chrono') {
      // chronosphere: teleport own units — simplified: teleport selected units to click
      this.chronoArmed = sw;
    } else if (type === 'storm') {
      this.stormArmed = sw;
    }
  }

  // ---------- input ----------
  initInput() {
    const cv = this.renderer.canvas;
    const g = this.game;
    cv.addEventListener('mousemove', e => {
      const r = cv.getBoundingClientRect();
      this.mouse.x = e.clientX - r.left;
      this.mouse.y = e.clientY - r.top;
      this._mouseMoved = true;
      if (g.placement) {
        const w = this.renderer.screenToWorld(this.mouse.x, this.mouse.y);
        const t = screenToTile(w.x, w.y);
        g.placement.tx = Math.floor(t.tx);
        g.placement.ty = Math.floor(t.ty);
      }
      // edge scroll handled in tick
    });
    cv.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      this.assets.sound.init();
      this.assets.sound.resume();
      const r = cv.getBoundingClientRect();
      this.dragStart = { x: e.clientX - r.left, y: e.clientY - r.top };
    });
    cv.addEventListener('mouseup', e => {
      if (e.button !== 0) return;
      const r = cv.getBoundingClientRect();
      this.dragEnd = { x: e.clientX - r.left, y: e.clientY - r.top };
      this.handleClick(e);
      this.dragStart = this.dragEnd = null;
    });
    cv.addEventListener('contextmenu', e => {
      e.preventDefault();
      // right click: cancel placement/modes, or stop units
      if (g.placement) { g.placement = null; this.buildSelection = null; return; }
      if (this.sellMode || this.repairMode) { this.sellMode = this.repairMode = false; $('btn-sell').classList.remove('active'); $('btn-repair').classList.remove('active'); return; }
      if (this.nukeArmed) { this.nukeArmed = null; return; }
      const selected = g.units.filter(u => u.selected && u.owner === 'player');
      for (const u of selected) u.orderStop();
    });
    // wheel zoom
    cv.addEventListener('wheel', e => {
      e.preventDefault();
      this.renderer.zoom = clamp(this.renderer.zoom * (e.deltaY < 0 ? 1.1 : 0.9), 0.5, 2);
    }, { passive: false });
    // keyboard
    window.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        if (g.placement) { g.placement = null; this.buildSelection = null; }
        this.nukeArmed = null;
        for (const u of g.units) u.selected = false;
        for (const b of g.buildings) b.selected = false;
        this.updateInfoBar(null);
      }
      if (e.key === 's' || e.key === 'S') {
        const sel = g.units.filter(u => u.selected && u.owner === 'player');
        for (const u of sel) u.orderStop();
      }
      if (e.key === 'h' || e.key === 'H') {
        // center on conyard
        const cy = g.buildings.find(b => !b.dead && b.owner === 'player' && b.gameId.includes('conyard'));
        if (cy) this.renderer.centerOn(cy.tx, cy.ty);
      }
    });
    // minimap click/drag
    const mini = $('minimap');
    const miniNav = e => {
      const r = mini.getBoundingClientRect();
      const mx = (e.clientX - r.left) / r.width, my = (e.clientY - r.top) / r.height;
      this.renderer.centerOn(mx * g.map.w, my * g.map.h);
    };
    mini.addEventListener('mousedown', e => { this._miniDrag = true; miniNav(e); });
    window.addEventListener('mousemove', e => { if (this._miniDrag) miniNav(e); });
    window.addEventListener('mouseup', () => this._miniDrag = false);
  }

  handleClick(e) {
    const g = this.game, R = this.renderer;
    const w = R.screenToWorld(this.mouse.x, this.mouse.y);
    const t = screenToTile(w.x, w.y);
    const tx = Math.floor(t.tx), ty = Math.floor(t.ty);

    // superweapon targeting
    if (this.nukeArmed) {
      const sw = this.nukeArmed;
      this.nukeArmed = null;
      sw.superCharge = 0;
      const c = tileToScreen(tx, ty);
      g.nukeIncoming = { target: { tx, ty, fw: 1, fh: 1, centerPx: c }, t: 0, dur: 3.5, owner: 'player' };
      g.eva('nukeLaunched');
      return;
    }
    if (this.stormArmed) {
      const sw = this.stormArmed;
      this.stormArmed = null;
      sw.superCharge = 0;
      const c = tileToScreen(tx, ty);
      // lightning storm: multiple strikes over 3s
      for (let i = 0; i < 9; i++) {
        setTimeout(() => {
          const ox = c.x + (Math.random() - 0.5) * 5 * TW, oy = c.y + (Math.random() - 0.5) * 5 * TH;
          g.areaDamage(ox, oy, 2.2, 90, null, null);
          g.addEffect('twlt100', ox, oy - 10, { frames: 21, fps: 16, scale: 1.6 });
        }, i * 350);
      }
      g.eva('stormCreated');
      return;
    }
    if (this.chronoArmed) {
      const sw = this.chronoArmed;
      const sel = g.units.filter(u => u.selected && u.owner === 'player' && !u.isAircraft);
      if (sel.length && g.map.passable(tx, ty)) {
        sw.superCharge = 0;
        this.chronoArmed = null;
        for (const u of sel) {
          g.addEffect('ring1', u.px.x, u.px.y - 8, { frames: 21, fps: 18 });
          u.x = tx + 0.5 + (Math.random() - 0.5) * 1.5;
          u.y = ty + 0.5 + (Math.random() - 0.5) * 1.5;
          u.path = null;
          g.updateUnitTile(u);
          g.addEffect('ring1', u.px.x, u.px.y - 8, { frames: 21, fps: 18 });
        }
        g.eva('chronoDone');
      }
      return;
    }

    // building placement
    if (g.placement && this.buildSelection) {
      if (g.canPlaceBuilding(this.buildSelection, tx, ty)) {
        const def = g.data.buildings[this.buildSelection];
        if (g.spendCredits('player', def.cost)) {
          g.addBuilding(this.buildSelection, 'player', tx, ty);
          g.eva('constructionComplete');
          g.placement = null;
          this.buildSelection = null;
        } else this.flashCredits();
      }
      return;
    }

    // sell mode
    if (this.sellMode) {
      const b = g.buildings.find(b => !b.dead && b.owner === 'player' && b.occupies(tx, ty));
      if (b) {
        g.addCredits('player', Math.floor(b.def.cost * 0.5));
        g.destroyBuilding(b);
        g.eva('sold');
      }
      return;
    }
    // repair mode: (simplified) heal building
    if (this.repairMode) {
      const b = g.buildings.find(b => !b.dead && b.owner === 'player' && b.occupies(tx, ty));
      if (b && b.hp < b.maxHp) {
        const cost = (b.maxHp - b.hp) * 0.25;
        if (g.credits.player >= cost) {
          g.credits.player -= cost;
          b.hp = b.maxHp;
          g.addEffect('healone', b.centerPx.x, b.centerPx.y - 10, { frames: 14, fps: 14 });
        }
      }
      return;
    }

    // unit commanding
    const selected = g.units.filter(u => u.selected && u.owner === 'player');
    if (selected.length) {
      // attack enemy under cursor?
      const hitU = g.units.find(u => !u.dead && u.owner !== 'player' && Math.hypot(u.px.x - w.x, u.px.y - w.y) < 18);
      const hitB = g.buildings.find(b => !b.dead && b.owner !== 'player' && b.occupies(tx, ty));
      const hitOre = g.units.find(u => !u.dead && u.owner === 'player' && u.def._harvester && false);
      if (hitU || hitB) {
        const tgt = hitU || hitB;
        for (const u of selected) u.orderAttack(g, tgt);
        this.showMoveMarker(w.x, w.y, '#ff5040');
      } else if (g.map.inBounds(tx, ty) && g.map.shroud[g.map.idx(tx, ty)] !== 1) {
        // move formation
        const n = selected.length;
        const cols = Math.ceil(Math.sqrt(n));
        selected.forEach((u, i) => {
          const ox = (i % cols - (cols - 1) / 2) * 1.1;
          const oy = (Math.floor(i / cols) - (Math.ceil(n / cols) - 1) / 2) * 1.1;
          u.orderMove(g, clamp(Math.floor(tx + ox), 1, g.map.w - 2), clamp(Math.floor(ty + oy), 1, g.map.h - 2), false);
        });
        this.showMoveMarker(w.x, w.y, '#57ff57');
      }
      return;
    }

    // selection (box or click)
    if (this.dragStart && Math.hypot(this.dragEnd.x - this.dragStart.x, this.dragEnd.y - this.dragStart.y) > 8) {
      // box select
      const x1 = Math.min(this.dragStart.x, this.dragEnd.x), x2 = Math.max(this.dragStart.x, this.dragEnd.x);
      const y1 = Math.min(this.dragStart.y, this.dragEnd.y), y2 = Math.max(this.dragStart.y, this.dragEnd.y);
      for (const u of g.units) {
        u.selected = false;
        if (u.owner !== 'player' || u.dead) continue;
        const p = u.px;
        const s = R.worldToScreen(p.x, p.y);
        if (s.x >= x1 && s.x <= x2 && s.y >= y1 - 20 && s.y <= y2) u.selected = true;
      }
      for (const b of g.buildings) b.selected = false;
    } else {
      // click select
      const hitU = g.units.find(u => !u.dead && g.map.shroud[g.map.idx(clamp(Math.floor(u.x), 0, g.map.w - 1), clamp(Math.floor(u.y), 0, g.map.h - 1))] === 3 && Math.hypot(u.px.x - w.x, u.px.y - w.y) < 16);
      const hitB = g.buildings.find(b => !b.dead && g.map.shroud[g.map.idx(clamp(b.tx, 0, g.map.w - 1), clamp(b.ty, 0, g.map.h - 1))] >= 2 && b.occupies(tx, ty));
      for (const u of g.units) u.selected = !!hitU && u === hitU && u.owner === 'player';
      for (const b of g.buildings) b.selected = !!hitB && b === hitB && b.owner === 'player';
    }
    this.updateInfoBar(g.units.find(u => u.selected) || g.buildings.find(b => b.selected) || null);
  }

  showMoveMarker(x, y, color) {
    this._markers = this._markers || [];
    this._markers.push({ x, y, t: 0, color });
  }

  updateInfoBar(ent) {
    const bar = $('info-bar');
    if (!ent) { bar.style.display = 'none'; return; }
    bar.style.display = 'block';
    const hp = Math.ceil(ent.hp), mhp = ent.maxHp;
    let extra = '';
    if (ent.kind === 'building') {
      if (ent.producing) {
        const d = this.game.getUnitDef(ent.producing.unitId);
        extra = `<div class="prod"><span>生产: ${d?.name ?? ''}</span><div class="prod-bar"><div style="width:${Math.floor(ent.producing.progress * 100)}%"></div></div></div>`;
      }
      if (ent.def._super) extra += `<div class="sw">充能 ${(ent.superCharge * 100).toFixed(0)}%</div>`;
    } else if (ent.def._harvester) {
      extra = `<div class="carry">矿石 ${Math.floor(ent.carry)}/${ent.capacity}</div>`;
    }
    bar.innerHTML = `<b>${ent.name}</b> <span class="hp">${hp}/${mhp}</span>${extra}`;
  }

  // ---------- per-frame UI update ----------
  tick(dt) {
    const g = this.game;
    // credits display (animated)
    const target = Math.floor(g.credits.player);
    const cur = parseInt($('credits-val').textContent.replace(/,/g, '')) || 0;
    if (cur !== target) {
      const next = Math.abs(target - cur) < 3 ? target : cur + Math.sign(target - cur) * Math.max(1, Math.floor(Math.abs(target - cur) * 0.2));
      $('credits-val').textContent = next.toLocaleString();
    }
    // power
    const gen = g.powerGen.player, drain = g.powerDrain.player;
    const ratio = gen >= drain ? 1 : gen / Math.max(1, drain);
    const fill = $('power-fill');
    fill.style.width = clamp((drain === 0 ? 0 : Math.min(1, drain / Math.max(gen, 1))) * 100, 0, 100) + '%';
    fill.style.background = ratio >= 1 ? '#4ce04c' : '#e0c84c';
    $('power-txt').textContent = `${gen}/${drain}`;
    fill.parentElement.classList.toggle('low', ratio < 1);
    // production progress refresh (info bar)
    const selB = g.buildings.find(b => b.selected);
    if (selB) this.updateInfoBar(selB);
    // superweapons (every ~0.5s)
    this._swTimer = (this._swTimer ?? 0) + dt;
    if (this._swTimer > 0.5) { this._swTimer = 0; this.updateSuperweapons(); }
    // sidebar availability refresh every 1s
    this._sbTimer = (this._sbTimer ?? 0) + dt;
    if (this._sbTimer > 1) { this._sbTimer = 0; this.updateSidebar(); }
    // edge scroll
    this.edgeScroll(dt);
    // markers
    if (this._markers) {
      for (const m of this._markers) m.t += dt;
      this._markers = this._markers.filter(m => m.t < 0.6);
    }
  }

  edgeScroll(dt) {
    const R = this.renderer, M = 24;
    const speed = 620 * dt;
    if (!this._mouseMoved) return;
    if (this.mouse.x < M) R.camX -= speed * 0.8;
    if (this.mouse.x > R.vw - M) R.camX += speed * 0.8;
    if (this.mouse.y < M) R.camY -= speed;
    if (this.mouse.y > R.vh - M) R.camY += speed;
    // keyboard scroll
    if (this._keys) {
      if (this._keys.ArrowLeft) R.camX -= speed * 0.8;
      if (this._keys.ArrowRight) R.camX += speed * 0.8;
      if (this._keys.ArrowUp) R.camY -= speed;
      if (this._keys.ArrowDown) R.camY += speed;
    }
    R.clampCam();
  }

  drawMarkers(ctx) {
    if (!this._markers) return;
    ctx.save();
    for (const m of this._markers) {
      const k = 1 - m.t / 0.6;
      ctx.strokeStyle = m.color;
      ctx.globalAlpha = k;
      ctx.lineWidth = 2;
      const r = 6 + (1 - k) * 14;
      ctx.beginPath();
      ctx.ellipse(m.x, m.y, r, r * 0.5, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
}

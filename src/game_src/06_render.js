// ============================================================
// RA2 Web - Part 6: Isometric renderer (canvas 2D)
// ============================================================
class Renderer {
  constructor(canvas, minimapCanvas, game, assets) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.mini = minimapCanvas;
    this.mctx = minimapCanvas.getContext('2d');
    this.game = game;
    this.assets = assets;
    this.camX = 0; this.camY = 0;
    this.zoom = 1;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }
  resize() {
    const sidebar = document.getElementById('sidebar');
    const w = window.innerWidth - (sidebar ? sidebar.offsetWidth : 0);
    const h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = w * dpr; this.canvas.height = h * dpr;
    this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px';
    this.dpr = dpr;
    this.vw = w; this.vh = h;
  }
  centerOn(tx, ty) {
    const s = tileToScreen(tx, ty);
    this.camX = s.x - this.vw / 2;
    this.camY = s.y - this.vh / 2;
    this.clampCam();
  }
  clampCam() {
    const m = this.game.map;
    // iso map spans x in [-h*TW/2, w*TW/2], y in [0, (w+h)*TH/2]
    const minX = -m.h * TW / 2 - TW, maxX = m.w * TW / 2 + TW;
    const minY = -TH * 4, maxY = (m.w + m.h) * TH / 2 + TH * 4;
    this.camX = clamp(this.camX, minX, maxX - this.vw);
    this.camY = clamp(this.camY, minY, maxY - this.vh);
  }
  screenToCanvas(x, y) { return { x: (x + this.camX) * this.dpr, y: (y + this.camY) * this.dpr }; }
  worldToScreen(wx, wy) { return { x: wx - this.camX, y: wy - this.camY }; }
  screenToWorld(sx, sy) { return { x: sx + this.camX, y: sy + this.camY }; }

  draw() {
    const ctx = this.ctx, g = this.game, A = this.assets;
    const dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    // bg
    ctx.fillStyle = '#0a0c10';
    ctx.fillRect(0, 0, this.vw, this.vh);
    ctx.save();
    ctx.translate(-this.camX, -this.camY);

    const m = g.map;
    // visible tile range
    const tl = screenToTile(this.camX - TW, this.camY - TH * 6);
    const br = screenToTile(this.camX + this.vw + TW, this.camY + this.vh + TH * 8);
    const tilesDrawn = new Set();

    // ---- terrain pass ----
    for (let ty = Math.max(0, Math.floor(tl.ty) - 2); ty <= Math.min(m.h - 1, Math.ceil(br.ty) + 2); ty++) {
      for (let tx = Math.max(0, Math.floor(tl.tx) - 2); tx <= Math.min(m.w - 1, Math.ceil(br.tx) + 2); tx++) {
        const i = m.idx(tx, ty);
        if (m.shroud[i] === 1) continue;   // unexplored
        const s = tileToScreen(tx, ty);
        const tileId = m.tile[i];
        const img = A.img('tile_' + tileId);
        if (img) {
          ctx.drawImage(img, s.x, s.y, TW, TH);
        } else {
          ctx.fillStyle = '#3a5f3a';
          ctx.beginPath();
          ctx.moveTo(s.x + TW / 2, s.y); ctx.lineTo(s.x + TW, s.y + TH / 2);
          ctx.lineTo(s.x + TW / 2, s.y + TH); ctx.lineTo(s.x, s.y + TH / 2);
          ctx.fill();
        }
      }
    }

    // ---- overlays (ore, trees) + buildings + units in painter order ----
    // build render list sorted by screen y
    const list = [];
    for (let ty = Math.max(0, Math.floor(tl.ty) - 4); ty <= Math.min(m.h - 1, Math.ceil(br.ty) + 4); ty++) {
      for (let tx = Math.max(0, Math.floor(tl.tx) - 4); tx <= Math.min(m.w - 1, Math.ceil(br.tx) + 4); tx++) {
        const i = m.idx(tx, ty);
        if (m.shroud[i] === 1) continue;
        const ov = m.overlay[i];
        if (ov) {
          const s = tileToScreen(tx, ty);
          if (ov.kind === 'ore' || ov.kind === 'gem') {
            const stage = clamp(Math.floor(ov.amount) + 1, 1, 4);
            const artId = ov.kind === 'gem' ? `gem${String(clamp(stage, 1, 12)).padStart(2, '0')}` : `tib${String(clamp(stage * 3, 1, 20)).padStart(2, '0')}`;
            const img = A.img('ore_' + artId);
            if (img) list.push({ y: s.y + TH - 4, draw: () => ctx.drawImage(img, s.x, s.y, TW, TH) });
          } else if (ov.kind === 'tree' || ov.kind === 'rock') {
            const img = A.img('tree_' + ov.art);
            if (img) list.push({ y: s.y + TH - 2, draw: () => ctx.drawImage(img, s.x - TW * 0.25, s.y - img.height + TH + 4, TW * 1.5, img.height) });
          }
        }
        // building on this tile?
        const occ = m.occupancy[i];
        if (occ !== 0) {
          const e = g.entityById(occ);
          if (e && e.kind === 'building' && !e._listed) {
            e._listed = true;
            list.push(this.buildingDraw(e));
          }
        }
      }
    }
    // units (aircraft last)
    for (const u of g.units) {
      if (u.dead) continue;
      const ti = m.idx(clamp(Math.floor(u.x), 0, m.w - 1), clamp(Math.floor(u.y), 0, m.h - 1));
      if (m.shroud[ti] === 1 && u.owner !== 'player') continue;
      if (m.shroud[ti] !== 3 && u.owner !== 'player') continue;
      const p = u.px;
      if (p.x < this.camX - 100 || p.x > this.camX + this.vw + 100 || p.y < this.camY - 120 || p.y > this.camY + this.vh + 120) continue;
      list.push(this.unitDraw(u, p));
      if (u.isAircraft) list[list.length - 1].y -= 60 * SCALE / 2;
    }
    // effects & projectiles
    for (const e of g.effects) {
      if (e.kind === 'beam') {
        list.push({ y: e.y2, draw: () => this.drawBeam(ctx, e) });
      } else {
        list.push({ y: e.y + 4, draw: () => this.drawEffect(ctx, e) });
      }
    }
    for (const p of g.projectiles) {
      const pos = p.pos;
      list.push({ y: pos.y, draw: () => this.drawProjectile(ctx, p, pos) });
    }
    // nuke incoming marker
    if (g.nukeIncoming) {
      const t = g.nukeIncoming.target;
      const c = tileToScreen(t.tx + t.fw / 2, t.ty + t.fh / 2);
      list.push({ y: c.y + 8, draw: () => this.drawNukeMarker(ctx, c, g.nukeIncoming.t / g.nukeIncoming.dur) });
    }
    // sort & draw
    list.sort((a, b) => a.y - b.y);
    for (const item of list) item.draw();
    for (const b of g.buildings) b._listed = false;

    // ---- selection & health bars (post pass) ----
    this.drawSelections(ctx);
    // ---- placement ghost ----
    if (g.placement) this.drawPlacement(ctx);

    ctx.restore();

    // fog pass (screen-space darkening for explored-not-visible)
    this.drawFog(ctx);

    // minimap
    this.drawMinimap();
  }

  buildingDraw(b) {
    const g = this.game;
    return {
      y: tileToScreen(b.tx + b.fw, b.ty + b.fh).y,
      draw: () => {
        const ctx = this.ctx, A = this.assets;
        const s = tileToScreen(b.tx, b.ty);
        // buildup animation
        if (!b.built) {
          const mk = A.img('mk_' + b.gameId);
          if (mk && b.def._mkMeta) {
            const meta = b.def._mkMeta;
            const fi = Math.min(meta.frames - 1, Math.floor(b.buildProgress * meta.frames));
            const col = fi % meta.cols, row = Math.floor(fi / meta.cols);
            const fw = meta.fw * 2, fh = meta.fh * 2;
            // draw frame (1x asset at 2x)
            ctx.drawImage(mk, col * meta.fw, row * meta.fh, meta.fw, meta.fh, s.x, s.y - (fh - b.fh * TH), fw, fh);
            return;
          }
        }
        const img = A.img('bld_' + b.gameId);
        if (img) {
          const bw = img.width, bh = img.height;
          // building bottom aligns to tile rect bottom; art includes extra height
          const dx = s.x + (b.fw * TW - bw) / 2;
          const dy = s.y + b.fh * TH - bh;
          // flicker during buildup
          if (!b.built) {
            ctx.globalAlpha = 0.55 + Math.sin(this.time * 20) * 0.2;
          }
          ctx.drawImage(img, dx, dy);
          ctx.globalAlpha = 1;
          // damage tint
          if (b.hp < b.maxHp * 0.4 && b.built) {
            ctx.drawImage(img, dx, dy);
            ctx.save();
            ctx.globalCompositeOperation = 'source-atop';
            ctx.fillStyle = 'rgba(60,20,10,0.35)';
            ctx.fillRect(dx, dy, bw, bh);
            ctx.restore();
          }
        } else {
          // fallback
          ctx.fillStyle = b.owner === 'player' ? '#3d5a80' : '#803d3d';
          ctx.fillRect(s.x, s.y, b.fw * TW, b.fh * TH);
        }
        // superweapon charge indicator
        if (b.def._super && b.built && b.superCharge > 0.02 && b.owner === 'player') {
          const c = tileToScreen(b.tx + b.fw / 2, b.ty);
          const w = 40;
          ctx.fillStyle = '#222'; ctx.fillRect(c.x - w / 2, c.y - 14, w, 5);
          ctx.fillStyle = b.superCharge >= 1 ? '#ffd24a' : '#4ac2ff';
          ctx.fillRect(c.x - w / 2 + 1, c.y - 13, (w - 2) * b.superCharge, 3);
        }
      }
    };
  }

  unitDraw(u, p) {
    return {
      y: p.y + (u.isAircraft ? -40 : 0),
      draw: () => {
        const ctx = this.ctx, A = this.assets;
        if (u.isInfantry) {
          const img = A.img('inf_' + u.gameId);
          if (img) {
            const meta = INFANTRY_META[u.gameId] ?? { cellW: 64, cellH: 64, walkPer: 6 };
            // facing → 8 dirs; facing is screen radians; dir 0 = east
            let dir = Math.round(((u.facing / (Math.PI * 2)) % 1 + 1) % 1 * 8) % 8;
            const walking = !!u.path && u.path.length;
            const frame = walking ? 1 + (Math.floor(u.walkTimer) % meta.walkPer) : 0;
            const cellW = meta.cellW, cellH = meta.cellH;
            const sx = dir * cellW, sy = frame * cellH;
            const w = cellW * 0.5, h = cellH * 0.5;
            ctx.drawImage(img, sx, sy, cellW, cellH, p.x - w / 2, p.y - h + 6, w, h);
          } else {
            ctx.fillStyle = u.owner === 'player' ? '#4a78c2' : '#c2504a';
            ctx.fillRect(p.x - 4, p.y - 10, 8, 10);
          }
        } else {
          // vehicle voxel sprite
          const img = A.img('veh_' + u.gameId);
          if (img) {
            const meta = VEHICLE_META[u.gameId] ?? { cellW: 60, cellH: 48, cols: 8 };
            const dir = Math.round((((u.facing / (Math.PI * 2)) % 1) + 1) % 1 * 32) % 32;
            const col = dir % meta.cols, row = Math.floor(dir / meta.cols);
            const cw = meta.cellW, ch = meta.cellH;
            const w = cw * 0.62, h = ch * 0.62;
            const dy = u.isAircraft ? p.y - 42 : p.y - h + 10;
            // shadow for aircraft
            if (u.isAircraft) {
              ctx.fillStyle = 'rgba(0,0,0,0.3)';
              ctx.beginPath();
              ctx.ellipse(p.x, p.y + 2, w * 0.3, 6, 0, 0, Math.PI * 2);
              ctx.fill();
            }
            ctx.drawImage(img, col * cw, row * ch, cw, ch, p.x - w / 2, dy, w, h);
            // turret
            if (u.def._turret) {
              const timg = A.img('veh_' + u.gameId + '_tur');
              if (timg) {
                const tdir = Math.round((((u.turretFacing / (Math.PI * 2)) % 1) + 1) % 1 * 32) % 32;
                const tcol = tdir % meta.cols, trow = Math.floor(tdir / meta.cols);
                ctx.drawImage(timg, tcol * cw, trow * ch, cw, ch, p.x - w / 2, dy, w, h);
              }
            }
          } else {
            ctx.fillStyle = u.owner === 'player' ? '#4a78c2' : '#c2504a';
            ctx.fillRect(p.x - 8, p.y - 8, 16, 12);
          }
        }
        // harvester carry indicator
        if (u.def._harvester && u.carry > 0) {
          ctx.fillStyle = '#ffd24a';
          ctx.fillRect(p.x - 10, p.y - 18, 20 * clamp(u.carry / u.capacity, 0, 1), 3);
        }
      }
    };
  }

  drawProjectile(ctx, p, pos) {
    ctx.save();
    if (p.wep.projectile === 'v3') {
      ctx.fillStyle = '#d8d8d8';
      ctx.beginPath(); ctx.ellipse(pos.x, pos.y, 4, 9, Math.atan2(p.ty - p.y, p.tx - p.x) + Math.PI / 2, 0, Math.PI * 2); ctx.fill();
      // exhaust
      ctx.fillStyle = 'rgba(255,160,60,0.7)';
      ctx.beginPath(); ctx.arc(pos.x - (p.tx - p.x) * 0.02, pos.y - (p.ty - p.y) * 0.02 + 4, 3, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.fillStyle = p.wep.bright ? '#ffe9a0' : '#e8e8e8';
      ctx.beginPath(); ctx.arc(pos.x, pos.y, 3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  drawEffect(ctx, e) {
    const A = this.assets;
    const img = A.img('anim_' + e.animId);
    if (!img) return;
    const meta = ANIM_ASSET_META[e.animId] ?? { fw: 100, fh: 90, cols: 8 };
    const fi = Math.min(meta.frames - 1, Math.floor(e.t * e.fps));
    const col = fi % meta.cols, row = Math.floor(fi / meta.cols);
    const w = meta.fw * (e.scale ?? 1) * 0.9, h = meta.fh * (e.scale ?? 1) * 0.9;
    ctx.drawImage(img, col * meta.fw, row * meta.fh, meta.fw, meta.fh, e.x - w / 2, e.y - h / 2, w, h);
  }

  drawBeam(ctx, e) {
    const k = 1 - e.t / e.dur;
    ctx.save();
    ctx.globalAlpha = clamp(k * 1.6, 0, 1);
    if (e.beamKind === 'electro') {
      // tesla bolt: jagged polyline
      ctx.strokeStyle = '#7ec8ff';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      const segs = 8;
      ctx.moveTo(e.x1, e.y1);
      for (let s = 1; s <= segs; s++) {
        const t = s / segs;
        const jx = (Math.random() - 0.5) * 18 * (s < segs ? 1 : 0);
        const jy = (Math.random() - 0.5) * 18 * (s < segs ? 1 : 0);
        ctx.lineTo(lerp(e.x1, e.x2, t) + jx, lerp(e.y1, e.y2, t) + jy);
      }
      ctx.stroke();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.stroke();
    } else {
      // prism beam
      const grad = ctx.createLinearGradient(e.x1, e.y1, e.x2, e.y2);
      grad.addColorStop(0, 'rgba(120,220,255,0.9)');
      grad.addColorStop(1, 'rgba(255,255,255,0.95)');
      ctx.strokeStyle = grad;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(e.x1, e.y1); ctx.lineTo(e.x2, e.y2);
      ctx.stroke();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
    }
    ctx.restore();
  }

  drawNukeMarker(ctx, c, k) {
    ctx.save();
    ctx.strokeStyle = '#ff3b30';
    ctx.lineWidth = 2;
    const r = 30 + Math.sin(this.time * 8) * 5;
    ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = 'rgba(255,60,50,0.15)';
    ctx.fill();
    ctx.restore();
  }

  drawSelections(ctx) {
    const g = this.game;
    ctx.save();
    for (const u of g.units) {
      if (!u.selected || u.dead) continue;
      const p = u.px;
      const w = u.isInfantry ? 14 : 22;
      ctx.strokeStyle = '#57ff57';
      ctx.lineWidth = 1.5;
      // iso selection ellipse
      ctx.beginPath();
      ctx.ellipse(p.x, p.y + 2, w, w * 0.5, 0, 0, Math.PI * 2);
      ctx.stroke();
      this.drawHpBar(ctx, p.x, p.y - (u.isInfantry ? 18 : 26), 24, u.hp / u.maxHp, u.owner);
    }
    for (const b of g.buildings) {
      if (!b.selected || b.dead) continue;
      const s = tileToScreen(b.tx, b.ty);
      ctx.strokeStyle = '#57ff57';
      ctx.lineWidth = 2;
      ctx.strokeRect(s.x + 2, s.y + 2, b.fw * TW - 4, b.fh * TH - 4);
      this.drawHpBar(ctx, s.x + b.fw * TW / 2, s.y - 10, Math.max(40, b.fw * TW * 0.6), b.hp / b.maxHp, b.owner);
    }
    ctx.restore();
  }
  drawHpBar(ctx, cx, cy, w, ratio, owner) {
    const h = 4;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(cx - w / 2, cy, w, h);
    ctx.fillStyle = ratio > 0.6 ? '#4ce04c' : ratio > 0.3 ? '#e0c84c' : '#e04c4c';
    ctx.fillRect(cx - w / 2 + 1, cy + 1, (w - 2) * clamp(ratio, 0, 1), h - 2);
  }

  drawPlacement(ctx) {
    const g = this.game, p = g.placement;
    const def = g.data.buildings[p.buildingId];
    if (!def) return;
    const [fw, fh] = def._foundation;
    const ok = g.canPlaceBuilding(p.buildingId, p.tx, p.ty);
    const s = tileToScreen(p.tx, p.ty);
    const img = this.assets.img('bld_' + p.buildingId);
    ctx.save();
    ctx.globalAlpha = 0.75;
    if (img) ctx.drawImage(img, s.x + (fw * TW - img.width) / 2, s.y + fh * TH - img.height);
    ctx.globalAlpha = 1;
    // grid overlay
    for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
      const c = tileToScreen(p.tx + x, p.ty + y);
      ctx.fillStyle = ok ? 'rgba(60,220,60,0.35)' : 'rgba(220,60,60,0.35)';
      ctx.beginPath();
      ctx.moveTo(c.x + TW / 2, c.y); ctx.lineTo(c.x + TW, c.y + TH / 2);
      ctx.lineTo(c.x + TW / 2, c.y + TH); ctx.lineTo(c.x, c.y + TH / 2);
      ctx.fill();
    }
    ctx.restore();
  }

  drawFog(ctx) {
    const g = this.game, m = g.map;
    // draw fog only for explored-but-not-visible tiles
    const tl = screenToTile(this.camX - TW, this.camY - TH * 4);
    const br = screenToTile(this.camX + this.vw + TW, this.camY + this.vh + TH * 6);
    ctx.save();
    ctx.translate(-this.camX, -this.camY);
    for (let ty = Math.max(0, Math.floor(tl.ty) - 2); ty <= Math.min(m.h - 1, Math.ceil(br.ty) + 2); ty++) {
      for (let tx = Math.max(0, Math.floor(tl.tx) - 2); tx <= Math.min(m.w - 1, Math.ceil(br.tx) + 2); tx++) {
        const i = m.idx(tx, ty);
        if (m.shroud[i] === 2) {
          const s = tileToScreen(tx, ty);
          ctx.fillStyle = 'rgba(6,8,12,0.55)';
          ctx.beginPath();
          ctx.moveTo(s.x + TW / 2, s.y); ctx.lineTo(s.x + TW, s.y + TH / 2);
          ctx.lineTo(s.x + TW / 2, s.y + TH); ctx.lineTo(s.x, s.y + TH / 2);
          ctx.fill();
        }
      }
    }
    ctx.restore();
  }

  drawMinimap() {
    const g = this.game, m = g.map;
    const ctx = this.mctx;
    const W = this.mini.width, H = this.mini.height;
    ctx.fillStyle = '#101418';
    ctx.fillRect(0, 0, W, H);
    const sx = W / m.w, sy = H / m.h;
    // terrain
    const img = this._miniCache;
    if (!img || this._miniTick !== Math.floor(g.time)) {
      this._miniTick = Math.floor(g.time);
      const off = document.createElement('canvas');
      off.width = m.w; off.height = m.h;
      const octx = off.getContext('2d');
      const id = octx.createImageData(m.w, m.h);
      for (let ty = 0; ty < m.h; ty++) {
        for (let tx = 0; tx < m.w; tx++) {
          const i = m.idx(tx, ty);
          const o = (ty * m.w + tx) * 4;
          if (m.shroud[i] === 1) { id.data[o] = 8; id.data[o + 1] = 10; id.data[o + 2] = 14; }
          else {
            const t = m.tile[i];
            let r = 60, gg = 92, b = 48;
            if (t === T.WATER || t === T.WATER2) { r = 28; gg = 52; b = 96; }
            else if (t && t.startsWith('shore')) { r = 122; gg = 130; b = 96; }
            else if (t && t.startsWith('rough')) { r = 88; gg = 100; b = 52; }
            const ov = m.overlay[i];
            if (ov) {
              if (ov.kind === 'ore') { r = 160; gg = 130; b = 40; }
              else if (ov.kind === 'gem') { r = 200; gg = 80; b = 200; }
              else if (ov.kind === 'tree') { r = 26; gg = 62; b = 30; }
            }
            if (m.shroud[i] === 2) { r *= 0.55; gg *= 0.55; b *= 0.55; }
            id.data[o] = r; id.data[o + 1] = gg; id.data[o + 2] = b;
          }
          id.data[o + 3] = 255;
        }
      }
      octx.putImageData(id, 0, 0);
      this._miniCache = off;
    }
    if (this._miniCache) ctx.drawImage(this._miniCache, 0, 0, W, H);
    // entities
    for (const b of g.buildings) {
      if (b.dead) continue;
      const i = m.idx(clamp(b.tx, 0, m.w - 1), clamp(b.ty, 0, m.h - 1));
      if (b.owner === 'enemy' && m.shroud[i] !== 3) continue;
      ctx.fillStyle = b.owner === 'player' ? '#4ac2ff' : '#ff5040';
      ctx.fillRect(b.tx * sx, b.ty * sy, Math.max(2, b.fw * sx), Math.max(2, b.fh * sy));
    }
    for (const u of g.units) {
      if (u.dead) continue;
      const i = m.idx(clamp(Math.floor(u.x), 0, m.w - 1), clamp(Math.floor(u.y), 0, m.h - 1));
      if (u.owner === 'enemy' && m.shroud[i] !== 3) continue;
      ctx.fillStyle = u.owner === 'player' ? '#7ee7ff' : '#ff8060';
      ctx.fillRect(u.x * sx - 1, u.y * sy - 1, 2.5, 2.5);
    }
    // camera rect
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 1;
    const tl = screenToTile(this.camX, this.camY);
    const sz = screenToTile(this.camX + this.vw, this.camY + this.vh);
    ctx.strokeRect(tl.tx * sx, tl.ty * sy, (sz.tx - tl.tx) * sx, (sz.ty - tl.ty) * sy);
  }
}

// asset metadata injected at build time
const ANIM_ASSET_META = window.__ANIM_META__ || {};
const VEHICLE_META = window.__VEHICLE_META__ || {};
const INFANTRY_META = window.__INFANTRY_META__ || {};

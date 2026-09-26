// ============================================================
// RA2 Web - Part 3: Entities (buildings, units, projectiles, effects)
// ============================================================

let ENTITY_ID = 1;
function nextId() { return ENTITY_ID++; }

// ---------- armor table from rules ----------
const ARMOR_INDEX = { none: 0, flak: 1, plate: 2, light: 3, medium: 4, heavy: 5, wood: 6, steel: 7, concrete: 8 };
function damageMultiplier(wh, armor) {
  if (!wh) return 1;
  const ai = ARMOR_INDEX[armor] ?? 0;
  return wh.verses?.[ai] ?? 1;
}

// ---------- Building ----------
class Building {
  constructor(def, side, tx, ty, game, owner) {
    this.id = nextId();
    this.kind = 'building';
    this.def = def;            // game_data.buildings[id]
    this.gameId = def._id;
    this.owner = owner;        // 'player' | 'enemy'
    this.side = side;
    this.tx = tx; this.ty = ty;
    const [fw, fh] = def._foundation;
    this.fw = fw; this.fh = fh;
    this.name = def.name;
    this.hp = def.strength;
    this.maxHp = def.strength;
    this.armor = def.armor ?? 'wood';
    this.power = def.power || 0;   // >0 production, <0 drain
    this.sight = def.sight || 4;
    this.built = false;
    this.buildProgress = 0;        // buildup animation progress 0..1
    this.buildTime = Math.max(0.8, (def.cost / 1000) * 0.9); // seconds-ish, tuned
    this.producing = null;         // {unitId, progress}
    this.weaponCooldown = 0;
    this.superCharge = 0;          // 0..1
    this.superTarget = null;
    this.animTimer = Math.random() * 2;
    this.selected = false;
    this.soldAmount = 0;
    this.dead = false;
    this.dockX = tx + Math.floor(fw / 2);
    this.dockY = ty + fh;          // refinery dock below
    this.smokeTimer = 0;
  }
  get centerPx() { return tileToScreen(this.tx + this.fw / 2, this.ty + this.fh / 2); }
  occupies(tx, ty) { return tx >= this.tx && tx < this.tx + this.fw && ty >= this.ty && ty < this.ty + this.fh; }

  update(game, dt) {
    if (this.dead) return;
    if (!this.built) {
      this.buildProgress = Math.min(1, this.buildProgress + dt / this.buildTime);
      if (this.buildProgress >= 1) this.built = true;
      return;
    }
    // damaged smoke
    if (this.hp < this.maxHp * 0.5) {
      this.smokeTimer -= dt;
      if (this.smokeTimer <= 0) {
        this.smokeTimer = 0.5 + Math.random() * 0.5;
        const c = this.centerPx;
        game.addEffect('fire01', c.x + (Math.random() - 0.5) * this.fw * TW * 0.4, c.y - Math.random() * 20, { frames: 30, fps: 18, scale: 0.5 });
      }
    }
    // production
    if (this.producing) {
      if (this.producing) {
        const pr = this.owner === 'player' ? game.powerRatio : game.enemyPowerRatio;
        const speedMul = pr < 1 ? 0.4 : 1;
        const unitDef = game.getUnitDef(this.producing.unitId);
        const buildTime = Math.max(1.5, (unitDef.cost / 1000) * 1.6);
        this.producing.progress += (dt / buildTime) * speedMul;
        if (this.producing.progress >= 1) {
          game.completeProduction(this);
        }
      }
    }
    // defensive weapons fire
    const wep = game.weapons[this.def.weapon || this.def._weapon];
    if (wep && this.built) {
      this.weaponCooldown -= dt;
      if (this.weaponCooldown <= 0) {
        const target = game.findTargetForBuilding(this, wep.range);
        if (target) {
          game.fireWeapon(this, target, wep);
          this.weaponCooldown = wep.rof / 30 / 2; // rof in ticks; halved for game feel
        } else this.weaponCooldown = 0.15;
      }
    }
    // superweapon charging
    if (this.def._super && game.powerRatio >= 1) {
      this.superCharge = Math.min(1, this.superCharge + dt / this.def._super.recharge);
    }
  }

  damage(amount, wh, game) {
    if (this.dead || !this.built && this.buildProgress < 0.3) return;
    const mul = damageMultiplier(wh, this.armor);
    const dmg = amount * mul;
    this.hp -= dmg;
    if (this.hp <= 0) {
      this.hp = 0;
      game.destroyBuilding(this);
    }
  }
}

// ---------- Unit (vehicle + infantry + aircraft) ----------
class Unit {
  constructor(def, unitId, game, owner) {
    this.id = nextId();
    this.kind = 'unit';
    this.def = def;
    this.gameId = unitId;
    this.owner = owner;
    this.side = def.side;
    this.name = def.name;
    this.isInfantry = !!def._infantry;
    this.isAircraft = !!def._air;
    this.hp = def.strength;
    this.maxHp = def.strength;
    this.armor = def.armor || (this.isInfantry ? 'flak' : 'light');
    // position in tile floats
    this.x = 0; this.y = 0;
    this.tx = 0; this.ty = 0; // current tile
    this.facing = 0;          // radians (screen space), 0 = +x (east)
    this.turretFacing = 0;
    this.speed = (def.speed || 4) * (this.isInfantry ? 0.55 : 1.0) * 0.85; // tiles/sec tuned
    this.sight = def.sight || 5;
    this.selected = false;
    this.dead = false;
    // movement
    this.path = null;
    this.dest = null;
    this.moveTarget = null;   // entity target to chase
    this.attackTarget = null;
    this.attackMove = false;
    this.weaponCooldown = 0;
    this.harvestState = null; // harvester state machine
    this.carry = 0;           // ore carried
    this.capacity = 500;
    this.deployed = false;
    this.veteran = 0;
    this.walkFrame = 0;
    this.walkTimer = 0;
    this.strafe = (Math.random() - 0.5) * 0.3;
  }
  get px() { const s = tileToScreen(this.x, this.y); return s; }
  get centerPx() { return this.px; }

  update(game, dt) {
    if (this.dead) return;
    this.weaponCooldown -= dt;
    // harvester logic
    if (this.def._harvester) { this.updateHarvest(game, dt); }
    else {
      // attack-move / chase
      if (this.attackTarget) {
        if (this.attackTarget.dead) { this.attackTarget = null; }
        else {
          const wep = game.weapons[this.def.weapon];
          const range = wep ? wep.range : 5;
          const d = Math.sqrt(dist2(this.x, this.y, this.attackTarget.x ?? this.attackTarget.tx + 0.5, this.attackTarget.y ?? this.attackTarget.ty + 0.5));
          if (d <= range) {
            this.path = null; this.dest = null;
            this.faceTarget();
            if (this.weaponCooldown <= 0) {
              game.fireWeapon(this, this.attackTarget, wep);
              this.weaponCooldown = (wep?.rof ?? 50) / 30 / 1.6;
            }
          } else if (this.moveTarget === this.attackTarget) {
            // keep chasing
            if (!this.path || this.repathTimer <= 0) {
              this.setPathTo(game, this.attackTarget.x ?? this.attackTarget.tx + 0.5, this.attackTarget.y ?? this.attackTarget.ty + 0.5);
              this.repathTimer = 1.0;
            }
          }
        }
      }
      this.repathTimer = (this.repathTimer ?? 0) - dt;
    }
    // auto return fire when idle
    if (!this.attackTarget && !this.def._harvester && this.weaponCooldown <= 0) {
      const wep = game.weapons[this.def.weapon];
      if (wep) {
        const t = game.findTargetNear(this, wep.range);
        if (t) this.attackTarget = t;
      }
    }
    // stuck detection: attacking but no path and out of range → timeout
    if (this.attackTarget && !this.path) {
      this._stuckTimer = (this._stuckTimer ?? 0) + dt;
      if (this._stuckTimer > 4) {
        this.attackTarget = null;
        this.moveTarget = null;
        this._stuckTimer = 0;
      }
    } else this._stuckTimer = 0;
    this.updateMovement(game, dt);
  }

  faceTarget() {
    const t = this.attackTarget;
    if (!t) return;
    const tx = t.x ?? t.tx + 0.5, ty = t.y ?? t.ty + 0.5;
    // direction in SCREEN space (iso): convert tile delta to screen delta
    const dx = (tx - this.x) - (ty - this.y); // screen x direction (unnormalized)
    const dy = ((tx - this.x) + (ty - this.y)) * 0.5;
    const targetFacing = Math.atan2(dy, dx);
    this.turretFacing = targetFacing;
    if (!this.def._turret) this.facing = targetFacing;
  }

  setPathTo(game, tx, ty) {
    this.path = game.findPath(this, Math.round(tx), Math.round(ty));
    if (this.path && this.path.length) this.dest = this.path[this.path.length - 1];
  }

  orderMove(game, tx, ty, attackMove = false) {
    this.attackTarget = null;
    this.moveTarget = null;
    this.attackMove = attackMove;
    this.setPathTo(game, tx, ty);
  }
  orderAttack(game, target) {
    this.attackTarget = target;
    this.moveTarget = target;
    this.attackMove = false;
    this.setPathTo(game, target.x ?? target.tx + 0.5, target.y ?? target.ty + 0.5);
    this.repathTimer = 0;
  }
  orderStop() {
    this.path = null; this.dest = null; this.attackTarget = null; this.moveTarget = null; this.attackMove = false;
  }

  updateMovement(game, dt) {
    if (!this.path || !this.path.length) { this.walkTimer = 0; return; }
    const next = this.path[0];
    const dx = next.x - this.x, dy = next.y - this.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.05) { this.path.shift(); return; }
    let sp = this.speed * dt;
    if (d < sp) sp = d;
    this.x += dx / d * sp;
    this.y += dy / d * sp;
    // facing in screen space
    const sdx = dx - dy, sdy = (dx + dy) * 0.5;
    const targetFacing = Math.atan2(sdy, sdx);
    // rotate facing toward target
    let diff = targetFacing - this.facing;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const rotSpeed = 10 * dt;
    this.facing += clamp(diff, -rotSpeed, rotSpeed);
    this.walkTimer += dt * 8;
    // occupancy
    game.updateUnitTile(this);
    // attack-move auto acquire
    if (this.attackMove && !this.attackTarget && this.weaponCooldown <= 0.5) {
      const wep = game.weapons[this.def.weapon];
      if (wep) {
        const t = game.findTargetNear(this, wep.range + 2);
        if (t) this.attackTarget = t;
      }
    }
  }

  // ---------- harvester state machine ----------
  updateHarvest(game, dt) {
    const S = this.harvestState ?? 'toOre';
    const map = game.map;
    if (S === 'toOre') {
      if (!this.harvestTile || !map.overlay[map.idx(this.harvestTile.x, this.harvestTile.y)]) {
        this.harvestTile = game.findNearestOre(this.x, this.y);
        if (!this.harvestTile) {
          // wander idle
          if (!this.path || !this.path.length) {
            const rx = Math.floor(this.x + (Math.random() - 0.5) * 8), ry = Math.floor(this.y + (Math.random() - 0.5) * 8);
            if (map.passable(rx, ry)) this.setPathTo(game, rx, ry);
          }
          return;
        }
        this.setPathTo(game, this.harvestTile.x, this.harvestTile.y);
      }
      const ht = this.harvestTile;
      const d = Math.hypot(ht.x - this.x, ht.y - this.y);
      if (d < 0.8) {
        this.harvestState = 'harvesting';
        this.path = null;
      }
    } else if (S === 'harvesting') {
      const i = map.idx(Math.round(this.x), Math.round(this.y));
      const ov = this.overlayNear(game);
      if (ov && this.carry < this.capacity) {
        const rate = 60 * dt; // credits per second of mining
        const take = Math.min(rate, this.capacity - this.carry, (ov.amount + 1) * 100 / 3);
        this.carry += take;
        ov.amount -= take / (100 / 3);
        if (ov.amount <= -0.5) { map.overlay[ov.i] = null; }
        if (!this._mineFx) this._mineFx = 0;
        this._mineFx += dt;
      } else {
        this.harvestState = 'toBase';
        this.homeRefinery = game.findRefinery(this.owner);
      }
    } else if (S === 'toBase') {
      if (!this.homeRefinery || this.homeRefinery.dead) {
        this.homeRefinery = game.findRefinery(this.owner);
        if (!this.homeRefinery) { this.harvestState = 'harvesting'; return; }
      }
      const r = this.homeRefinery;
      const d = Math.hypot(r.tx + r.fw / 2 - this.x, r.ty + r.fh - 0.5 - this.y);
      if (d < 1.2) {
        this.harvestState = 'unloading';
        this.path = null;
      } else {
        if (!this.path || !this.path.length) {
          this.setPathTo(game, r.tx + Math.floor(r.fw / 2), r.ty + r.fh);
        }
      }
    } else if (S === 'unloading') {
      const r = this.homeRefinery;
      if (!r || r.dead) { this.harvestState = 'toBase'; return; }
      if (this.carry > 0) {
        const unload = 300 * dt;
        const give = Math.min(unload, this.carry);
        this.carry -= give;
        game.addCredits(this.owner, give);
      } else {
        this.harvestState = 'toOre';
        this.harvestTile = null;
      }
    }
  }
  overlayNear(game) {
    // find ore at current or adjacent tile
    const tx = Math.round(this.x), ty = Math.round(this.y);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (game.map.inBounds(tx + dx, ty + dy)) {
        const i = game.map.idx(tx + dx, ty + dy);
        const ov = game.map.overlay[i];
        if (ov && (ov.kind === 'ore' || ov.kind === 'gem') && ov.amount > -0.5) return { ...ov, i };
      }
    }
    return null;
  }

  damage(amount, wh, game, attacker) {
    if (this.dead) return;
    const mul = damageMultiplier(wh, this.armor);
    this.hp -= amount * mul;
    // retaliation: switch to attacker if idle or chasing something unreachable
    if (attacker && !attacker.dead && attacker.owner !== this.owner) {
      if (!this.attackTarget || this.attackTarget.dead || this._stuckTimer > 2) {
        this.attackTarget = attacker;
        this.moveTarget = attacker;
        this._stuckTimer = 0;
      }
    }
    if (this.hp <= 0) {
      this.hp = 0;
      game.destroyUnit(this);
    }
  }
}

// ---------- Projectile ----------
class Projectile {
  constructor(game, from, to, wep, damage) {
    this.id = nextId();
    this.kind = 'projectile';
    this.wep = wep;
    this.damage = damage;
    this.source = from;
    const a = from.centerPx ?? from.px;
    const b = to.centerPx ?? to.px;
    this.x = a.x; this.y = a.y - 14 * SCALE / 2;
    this.tx = b.x; this.ty = b.y - 8;
    this.target = to;
    const d = Math.hypot(this.tx - this.x, this.ty - this.y);
    this.dur = Math.max(0.12, d / (wep.speed * 260 * SCALE / 2));
    this.t = 0;
    this.dead = false;
    this.arc = wep.projectile === 'cannon' || wep.projectile === 'howitzer' ? Math.min(0.5, d / 900) : 0;
    this.trail = wep.projectile === 'v3' || wep._missile;
  }
  update(game, dt) {
    this.t += dt / this.dur;
    if (this.t >= 1) {
      this.dead = true;
      game.impact(this);
    }
  }
  get pos() {
    const x = lerp(this.x, this.tx, this.t);
    const y = lerp(this.y, this.ty, this.t);
    const arc = Math.sin(this.t * Math.PI) * this.arc * 160;
    return { x, y: y - arc };
  }
}

// ---------- Effect (animations) ----------
class Effect {
  constructor(animId, x, y, opts = {}) {
    this.id = nextId();
    this.kind = 'effect';
    this.animId = animId;
    this.x = x; this.y = y;
    this.t = 0;
    this.fps = opts.fps ?? 14;
    this.scale = opts.scale ?? 1;
    this.once = opts.once !== false;
    this.dead = false;
    this.frameCount = opts.frames ?? 0;
  }
  update(dt) {
    this.t += dt;
    if (this.once && this.frameCount && this.t * this.fps >= this.frameCount) this.dead = true;
    if (!this.frameCount && this.t > 2.5) this.dead = true;
  }
}

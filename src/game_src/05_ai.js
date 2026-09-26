// ============================================================
// RA2 Web - Part 5: Enemy AI commander
// ============================================================
class EnemyAI {
  constructor(game) {
    this.game = game;
    this.buildOrder = this.makeBuildOrder(game.enemySide);
    this.buildIndex = 0;
    this.buildTimer = 3;
    this.attackTimer = 110;   // first wave (give player time to build)
    this.waveSize = 3;
    this.harvNeeded = 2;
    this.defenseCount = 0;
    this.superTimer = 300;
  }
  makeBuildOrder(side) {
    if (side === 'soviet') {
      return ['spower', 'srefinery', 'sbarracks', 'spower', 'swarfactory', 'sradar', 'spower',
        'teslacoil', 'sbattlelab', 'teslacoil', 'nuclearmissile', 'spower', 'teslacoil'];
    }
    return ['apower', 'arefinery', 'abarracks', 'apower', 'awarfactory', 'airforce', 'apower',
      'prismtower', 'abattlelab', 'chronosphere', 'apower', 'prismtower'];
  }
  unitMix(side) {
    if (side === 'soviet') {
      return [
        { id: 'rhino', w: 5 }, { id: 'rhino', w: 5 }, { id: 'teslatank', w: 3 },
        { id: 'v3launcher', w: 1 }, { id: 'htk', w: 2 }, { id: 'flaktrooper', w: 2 },
        { id: 'teslatrooper', w: 3 }, { id: 'conscript', w: 3 }, { id: 'kirov', w: 0.4 },
      ];
    }
    return [
      { id: 'grizzly', w: 5 }, { id: 'grizzly', w: 5 }, { id: 'prismtank', w: 3 },
      { id: 'ifv', w: 2 }, { id: 'gi', w: 4 }, { id: 'gi', w: 4 }, { id: 'tanya', w: 0.5 },
      { id: 'chronolegion', w: 1 }, { id: 'harrier', w: 1.5 },
    ];
  }

  update(game, dt) {
    if (game.gameOver) return;
    const diff = game.difficulty;
    const creditRate = [14, 22, 34][diff];
    game.addCredits('enemy', creditRate * dt);
    // enemy harvesters auto-mine via unit logic

    // ---- construction ----
    this.buildTimer -= dt;
    if (this.buildTimer <= 0) {
      this.buildTimer = [6, 4.2, 3][diff];
      this.tryBuild(game);
    }
    // ---- production ----
    this.prodTimer = (this.prodTimer ?? 2) - dt;
    if (this.prodTimer <= 0) {
      this.prodTimer = [9, 6.5, 4.5][diff];
      this.tryProduce(game);
    }
    // ---- attack waves ----
    this.attackTimer -= dt;
    if (this.attackTimer <= 0) {
      this.attackTimer = [100, 70, 48][diff];
      this.launchWave(game);
    }
    // ---- superweapon ----
    this.superTimer -= dt;
    if (this.superTimer <= 0) {
      this.superTimer = 400;
      const sw = game.buildings.find(b => !b.dead && b.owner === 'enemy' && b.gameId === 'nuclearmissile' && b.superCharge >= 1);
      if (sw) this.launchNuke(game, sw);
    }
    // idle units guard: send to mid map occasionally
    this.guardTimer = (this.guardTimer ?? 10) - dt;
    if (this.guardTimer <= 0) {
      this.guardTimer = 12;
      for (const u of game.units) {
        if (u.owner !== 'enemy' || u.dead || u.def._harvester) continue;
        if (!u.attackTarget && !u.path) {
          if (Math.random() < 0.5) {
            // patrol toward player base area
            const pb = game.buildings.find(b => !b.dead && b.owner === 'player');
            if (pb) {
              const tx = Math.floor(pb.tx + (Math.random() - 0.5) * 10);
              const ty = Math.floor(pb.ty + (Math.random() - 0.5) * 10);
              u.orderMove(game, clamp(tx, 2, MAP_W - 3), clamp(ty, 2, MAP_H - 3), true);
            }
          }
        }
      }
    }
  }

  tryBuild(game) {
    // prerequisites & money
    const order = this.buildOrder;
    if (this.buildIndex >= order.length) {
      // late game: defenses & extra power
      const side = game.enemySide;
      const extra = [side === 'soviet' ? 'teslacoil' : 'prismtower', side === 'soviet' ? 'spower' : 'apower', 'srefinery'.replace('s', side === 'soviet' ? 's' : 'a')];
      const pick = extra[this.defenseCount++ % extra.length];
      this.placeBuilding(game, pick);
      return;
    }
    const bid = order[this.buildIndex];
    const def = game.data.buildings[bid];
    if (!def) { this.buildIndex++; return; }
    if (game.credits.enemy < def.cost) return;
    // check prereqs
    const has = (req) => {
      if (req === 'POWER') return game.buildings.some(b => !b.dead && b.owner === 'enemy' && b.power > 0);
      if (req === 'PROC') return game.buildings.some(b => !b.dead && b.owner === 'enemy' && b.gameId.includes('refinery'));
      if (req === 'BARRACKS') return game.buildings.some(b => !b.dead && b.owner === 'enemy' && (b.gameId.includes('barracks')));
      if (req === 'WEAPONS') return game.buildings.some(b => !b.dead && b.owner === 'enemy' && b.gameId.includes('warfactory'));
      if (req === 'RADAR') return game.buildings.some(b => !b.dead && b.owner === 'enemy' && (b.gameId.includes('radar') || b.gameId.includes('airforce')));
      if (req === 'TECH') return game.buildings.some(b => !b.dead && b.owner === 'enemy' && b.gameId.includes('battlelab'));
      if (req === 'GACNST' || req === 'NACNST' || req === 'FACT') return game.buildings.some(b => !b.dead && b.owner === 'enemy' && b.gameId.includes('conyard'));
      if (req === 'GAPILE' || req === 'NAHAND') return game.buildings.some(b => !b.dead && b.owner === 'enemy' && b.gameId.includes('barracks'));
      if (req === 'GAWEAP' || req === 'NAWEAP') return game.buildings.some(b => !b.dead && b.owner === 'enemy' && b.gameId.includes('warfactory'));
      if (req === 'GAREF' || req === 'NAREF') return game.buildings.some(b => !b.dead && b.owner === 'enemy' && b.gameId.includes('refinery'));
      if (req === 'GAAIRC' || req === 'NARADR') return game.buildings.some(b => !b.dead && b.owner === 'enemy' && (b.gameId.includes('radar') || b.gameId.includes('airforce')));
      if (req === 'GATECH' || req === 'NATECH') return game.buildings.some(b => !b.dead && b.owner === 'enemy' && b.gameId.includes('battlelab'));
      return game.buildings.some(b => !b.dead && b.owner === 'enemy' && b.gameId.toLowerCase().includes(req.toLowerCase().slice(-4)));
    };
    for (const r of def.prereq) if (!has(r)) return;
    if (this.placeBuilding(game, bid)) this.buildIndex++;
  }

  placeBuilding(game, bid) {
    const def = game.data.buildings[bid];
    if (!def || game.credits.enemy < def.cost) return false;
    // find spot near base
    const base = game.buildings.filter(b => !b.dead && b.owner === 'enemy');
    if (!base.length) return false;
    const ref = base[Math.floor(Math.random() * base.length)];
    const [fw, fh] = def._foundation;
    for (let attempt = 0; attempt < 60; attempt++) {
      const tx = ref.tx + Math.floor((Math.random() - 0.5) * 14);
      const ty = ref.ty + Math.floor((Math.random() - 0.5) * 14);
      let ok = true;
      let adjacent = false;
      for (let y = ty - 1; y <= ty + fh && ok; y++) for (let x = tx - 1; x <= tx + fw && ok; x++) {
        if (x >= tx && x < tx + fw && y >= ty && y < ty + fh) {
          if (!game.map.buildableTerrain(x, y) || game.map.occupancy[game.map.idx(x, y)] !== 0) ok = false;
        } else if (game.map.inBounds(x, y) && game.map.occupancy[game.map.idx(x, y)] !== 0) {
          const e = game.entityById(game.map.occupancy[game.map.idx(x, y)]);
          if (e && e.owner === 'enemy') adjacent = true;
        }
      }
      if (ok && adjacent) {
        game.spendCredits('enemy', def.cost);
        game.addBuilding(bid, 'enemy', tx, ty, true);
        return true;
      }
    }
    return false;
  }

  tryProduce(game) {
    // keep 2-3 harvesters
    const harv = game.units.filter(u => !u.dead && u.owner === 'enemy' && u.def._harvester).length;
    const refCount = game.buildings.filter(b => !b.dead && b.built && b.owner === 'enemy' && b.gameId.includes('refinery')).length;
    if (harv < refCount * 2 + 1) {
      const wf = game.buildings.find(b => !b.dead && b.built && b.owner === 'enemy' && b.gameId.includes('warfactory') && !b.producing);
      if (wf && game.credits.enemy >= 1400) {
        game.credits.enemy -= 1400;
        wf.producing = { unitId: 'harvester', progress: 0 };
        return;
      }
    }
    // pick from mix
    const mix = this.unitMix(game.enemySide);
    const factories = game.buildings.filter(b => !b.dead && b.built && b.owner === 'enemy' && !b.producing && (b.def._factory === 'infantry' || b.def._factory === 'vehicle'));
    if (!factories.length) return;
    const totalW = mix.reduce((s, m) => s + m.w, 0);
    let r = Math.random() * totalW;
    let pick = mix[0];
    for (const m of mix) { r -= m.w; if (r <= 0) { pick = m; break; } }
    const def = game.getUnitDef(pick.id);
    if (!def) return;
    const f = factories.find(f => (def._infantry && f.def._factory === 'infantry') || (!def._infantry && f.def._factory === 'vehicle'));
    if (!f) return;
    if (game.credits.enemy >= def.cost) {
      game.credits.enemy -= def.cost;
      f.producing = { unitId: pick.id, progress: 0 };
    }
  }

  launchWave(game) {
    const diff = game.difficulty;
    this.waveSize += [0.4, 0.8, 1.2][diff];
    const size = Math.floor(this.waveSize);
    const army = game.units.filter(u => !u.dead && u.owner === 'enemy' && !u.def._harvester);
    const candidates = army.slice(-Math.max(size, Math.floor(army.length * 0.7)));
    const targets = game.buildings.filter(b => !b.dead && b.owner === 'player');
    if (!targets.length) return;
    const tgt = targets[Math.floor(Math.random() * targets.length)];
    let launched = 0;
    for (const u of candidates) {
      if (launched >= size && army.length > size * 2) break;
      u.orderAttack(game, tgt);
      launched++;
    }
    if (launched > 0 && game.explored(game.map.idx(clamp(Math.floor(tgt.tx), 0, MAP_W - 1), clamp(Math.floor(tgt.ty), 0, MAP_H - 1)))) {
      game.eva('enemyDetected');
    }
  }

  launchNuke(game, silo) {
    // target player's densest area
    const targets = game.buildings.filter(b => !b.dead && b.owner === 'player');
    if (!targets.length) return;
    let best = targets[0], bestScore = -1;
    for (const t of targets) {
      let score = 0;
      for (const t2 of targets) {
        if (Math.hypot(t2.tx - t.tx, t2.ty - t.ty) < 6) score++;
      }
      if (score > bestScore) { bestScore = score; best = t; }
    }
    silo.superCharge = 0;
    game.nukeIncoming = { target: best, t: 0, dur: 4, silo };
    game.eva('nukeLaunched');
  }
}

// nuke update hook (called from game.update via ai)
function updateNuke(game, dt) {
  const n = game.nukeIncoming;
  if (!n) return;
  n.t += dt;
  if (n.t >= n.dur) {
    game.nukeIncoming = null;
    const c = tileToScreen(n.target.tx + n.target.fw / 2, n.target.ty + n.target.fh / 2);
    // massive area damage
    game.areaDamage(c.x, c.y - 10, 5.5, 500, game.warheads['nuke'] ?? null, null);
    game.addEffect('nukeanim', c.x, c.y - 30, { frames: 39, fps: 14, scale: 2 });
    game.addEffect('ring1', c.x, c.y - 6, { frames: 21, fps: 14, scale: 2.4 });
    game.sfx('nukewe');
    game.eva('nukeDetonated');
  }
}

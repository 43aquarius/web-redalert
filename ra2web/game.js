/* 红色警戒2 Web 复刻引擎 — 原版素材版
 * 渲染: Canvas 2D 等距 (60x30 tiles)
 * 素材: RA2 VXL/SHP/TMP 原版数据预渲染图集
 */
'use strict';

// ============ 常量 ============
const TILE_W = 60, TILE_H = 30;
const FACINGS32 = 32, FACINGS8 = 8;
const MAP_W = 78, MAP_H = 78;

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const dist = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);
const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const choice = arr => arr[Math.floor(Math.random() * arr.length)];

// ============ 资源加载 ============
const Assets = {
    images: {},      // name -> Image
    manifests: {},
    audio: {},       // name -> ArrayBuffer (decoded later)
    audioRaw: {},    // name -> arraybuffer raw
    baseUrl: 'assets/',

    loadImage(name) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => { this.images[name] = img; resolve(img); };
            img.onerror = () => reject(new Error('img ' + name));
            const emb = (typeof EMBED !== 'undefined') ? EMBED[name] : null;
            img.src = emb || this.baseUrl + name;
        });
    },

    async load(list) {
        for (const item of list) {
            if (typeof item === 'string') {
                await this.loadImage(item);
            } else if (item.audio) {
                await this.loadAudio(item.audio);
            }
        }
    },

    async loadAudio(name) {
        if (this.audioRaw[name] !== undefined) return;
        try {
            const emb = (typeof EMBED !== 'undefined') ? EMBED['audio/' + name] : null;
            if (emb) {
                const r = await fetch(emb);
                this.audioRaw[name] = await r.arrayBuffer();
            } else {
                const r = await fetch(this.baseUrl + name);
                this.audioRaw[name] = await r.arrayBuffer();
            }
        } catch (e) {
            this.audioRaw[name] = null;
        }
    },
};

// ============ 音频系统 ============
class AudioSys {
    constructor() {
        this.ctx = null;
        this.buffers = new Map();
        this.sfxGain = null;
        this.evaGain = null;
        this.musicGain = null;
        this.evaQueue = [];
        this.evaPlaying = false;
        this.lastPlayed = new Map();
        this.enabled = true;
    }

    init() {
        if (this.ctx) return;
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.sfxGain = this.ctx.createGain(); this.sfxGain.gain.value = 0.7;
        this.evaGain = this.ctx.createGain(); this.evaGain.gain.value = 0.9;
        this.musicGain = this.ctx.createGain(); this.musicGain.gain.value = 0.45;
        this.sfxGain.connect(this.ctx.destination);
        this.evaGain.connect(this.ctx.destination);
        this.musicGain.connect(this.ctx.destination);
    }

    async getBuffer(name) {
        if (this.buffers.has(name)) return this.buffers.get(name);
        const raw = Assets.audioRaw[name];
        if (!raw) { this.buffers.set(name, null); return null; }
        try {
            const buf = await this.ctx.decodeAudioData(raw.slice(0));
            this.buffers.set(name, buf);
            return buf;
        } catch (e) {
            this.buffers.set(name, null);
            return null;
        }
    }

    async play(name, { gain = 1, rate = 1 } = {}) {
        if (!this.enabled || !this.ctx) return;
        const buf = await this.getBuffer(name);
        if (!buf) return;
        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        src.playbackRate.value = rate;
        const g = this.ctx.createGain();
        g.gain.value = gain;
        src.connect(g); g.connect(this.sfxGain);
        src.start();
        return src;
    }

    // throttle same sound
    async playThrottled(name, ms = 90, gain = 1) {
        const t = performance.now();
        if ((this.lastPlayed.get(name) || 0) + ms > t) return;
        this.lastPlayed.set(name, t);
        await this.play(name, { gain });
    }

    async playEva(eventName) {
        if (!this.enabled || !this.ctx) return;
        const eva = GAMEDATA.eva[eventName];
        if (!eva) return;
        const side = Game.player.side === 'soviet' ? 'sov' : 'ally';
        const file = eva[side] || eva.ally || eva.sov;
        if (!file) return;
        this.evaQueue.push(file);
        this._drainEva();
    }

    async _drainEva() {
        if (this.evaPlaying || !this.evaQueue.length) return;
        this.evaPlaying = true;
        const file = this.evaQueue.shift();
        const buf = await this.getBuffer(file);
        if (buf) {
            await new Promise(res => {
                const src = this.ctx.createBufferSource();
                src.buffer = buf;
                src.connect(this.evaGain);
                src.onended = res;
                src.start();
            });
        }
        this.evaPlaying = false;
        this._drainEva();
    }

    setEvaVolume(v) { if (this.evaGain) this.evaGain.gain.value = v; }
}


// ============ 原版音效映射 ============
const SoundMap = {
    data: null,
    init() { this.data = Assets._soundMap || {}; },
    weapon(uid) { return (this.data.weapons || {})[uid] || null; },
    die(uid) { return (this.data.die || {})[uid] || (this.data.events || {}).vehdie; },
    event(name) { return (this.data.events || {})[name] || null; },
    voice(uid, kind) {
        const v = (this.data.voice || {})[uid];
        if (v && v[kind] && v[kind].length) return v[kind];
        // fallback generic vehicle voice
        const side = Game.players.length ? Game.players[Game.playerIndex].side : 'allied';
        const g = (this.data.voice || {})[side === 'soviet' ? 'VEH_SOV' : 'VEH_ALL'];
        return g ? g[kind] : null;
    },
};

// ============ iso 坐标 ============
function cellToScreen(x, y) {
    return { x: (x - y) * TILE_W / 2, y: (x + y) * TILE_H / 2 };
}
function screenToCell(sx, sy, camX, camY) {
    const px = sx + camX, py = sy + camY;
    const dx = px / (TILE_W / 2), dy = py / (TILE_H / 2);
    return { x: Math.floor((dy + dx) / 2), y: Math.floor((dy - dx) / 2) };
}

// 朝向角 -> 帧索引 (32向, 帧渲染时 yaw=f*11.25, yaw0 = 朝+X)
// 屏幕上 dx,dy: facing 0 = 北(0,-1)。frame = angle 转换
function angleToFrame32(dx, dy) {
    // world angle: 0 = east(+x), ccw positive
    let a = Math.atan2(-dy, dx); // screen y inverted
    if (a < 0) a += Math.PI * 2;
    // RA2 facings: 0 = NE.. use frame = round(a / 11.25) with calibration offset
    let f = Math.round(a / (Math.PI * 2 / FACINGS32)) % FACINGS32;
    return f;
}
function angleToFrame8(dx, dy) {
    let a = Math.atan2(-dy, dx);
    if (a < 0) a += Math.PI * 2;
    return Math.round(a / (Math.PI * 2 / FACINGS8)) % FACINGS8;
}

// ============ 地图 ============
class GameMap {
    constructor(w, h) {
        this.w = w; this.h = h;
        // terrain tile per cell
        this.tiles = new Array(w * h).fill('clear01');
        this.ore = new Float32Array(w * h);
        this.gem = new Float32Array(w * h);
        this.occupied = new Array(w * h).fill(null); // entity occupying
        this.water = new Uint8Array(w * h);
        this.sight = new Uint8Array(w * h);   // explored
    }
    idx(x, y) { return y * this.w + x; }
    inb(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
    get(x, y) { return this.tiles[this.idx(x, y)]; }
    set(x, y, t) { this.tiles[this.idx(x, y)] = t; }
    passable(x, y) {
        if (!this.inb(x, y)) return false;
        return !this.water[this.idx(x, y)] && !this.occupied[this.idx(x, y)];
    }
    buildable(x, y) {
        if (!this.inb(x, y)) return false;
        if (this.water[this.idx(x, y)]) return false;
        if (this.occupied[this.idx(x, y)]) return false;
        if (this.ore[this.idx(x, y)] > 0 || this.gem[this.idx(x, y)] > 0) return false;
        const t = this.tiles[this.idx(x, y)];
        if (t.startsWith('cliff') || t.startsWith('ramp')) return false;
        return true;
    }

    generate(seed) {
        // base grass
        for (let y = 0; y < this.h; y++)
            for (let x = 0; x < this.w; x++)
                this.tiles[this.idx(x, y)] = Math.random() < 0.15 ? 'ruff01' : 'clear01';
        // lake(s)
        const lakes = [[randi(14, 24), randi(40, 62), randi(5, 8)],
                       [randi(52, 64), randi(14, 30), randi(4, 7)]];
        for (const [lx, ly, lr] of lakes) {
            for (let y = ly - lr - 2; y <= ly + lr + 2; y++)
                for (let x = lx - lr - 2; x <= lx + lr + 2; x++) {
                    if (!this.inb(x, y)) continue;
                    const d = dist(x, y, lx, ly);
                    if (d < lr * 0.75) { this.water[this.idx(x, y)] = 1; this.tiles[this.idx(x, y)] = choice(['water01', 'water02', 'water03']); }
                    else if (d < lr && !this.water[this.idx(x, y)]) this.tiles[this.idx(x, y)] = choice(['shore01', 'shore02', 'shore03', 'shore04']);
                }
        }
        // clear start areas (corners)
        const clearings = [[10, 10, 9], [this.w - 11, this.h - 11, 9]];
        for (const [cx, cy, r] of clearings) {
            for (let y = cy - r; y <= cy + r; y++)
                for (let x = cx - r; x <= cx + r; x++) {
                    if (!this.inb(x, y)) continue;
                    if (dist(x, y, cx, cy) <= r) {
                        this.water[this.idx(x, y)] = 0;
                        this.tiles[this.idx(x, y)] = 'clear01';
                        this.ore[this.idx(x, y)] = 0;
                        this.gem[this.idx(x, y)] = 0;
                    }
                }
        }
        // ore fields (near each start, mid)
        const oreFields = [
            [18, 14, 7, 7], [this.w - 19, this.h - 15, 7, 7],
            [14, this.h - 18, 6, 6], [this.w - 15, 18, 6, 6],
            [Math.floor(this.w / 2), Math.floor(this.h / 2), 9, 8],
        ];
        for (const [ox, oy, rw, rh] of oreFields) {
            for (let y = oy - rh; y <= oy + rh; y++)
                for (let x = ox - rw; x <= ox + rw; x++) {
                    if (!this.inb(x, y) || this.water[this.idx(x, y)]) continue;
                    const d = dist(x, y, ox, oy) / Math.max(rw, rh);
                    if (d < 0.85 && Math.random() < 0.8) {
                        if (d < 0.3 && Math.random() < 0.35) this.gem[this.idx(x, y)] = randi(4, 8);
                        else this.ore[this.idx(x, y)] = Math.min(12, this.ore[this.idx(x, y)] + randi(4, 11));
                    }
                }
        }
        // decorative clumps
        for (let i = 0; i < 26; i++) {
            const x = randi(2, this.w - 3), y = randi(2, this.h - 3);
            if (this.water[this.idx(x, y)] || this.ore[this.idx(x, y)]) continue;
            const r = randi(1, 2);
            for (let dy = -r; dy <= r; dy++)
                for (let dx = -r; dx <= r; dx++)
                    if (this.inb(x + dx, y + dy) && Math.random() < 0.7)
                        this.tiles[this.idx(x + dx, y + dy)] = choice(['clat01', 'clat02', 'clat03', 'dlat01', 'glat01']);
        }
    }
}

// ============ 寻路 (A*) ============
class Pathfinder {
    static find(map, sx, sy, tx, ty, maxNodes = 9000) {
        if (sx === tx && sy === ty) return [];
        if (!map.inb(tx, ty)) return null;
        const W = map.w;
        const open = new MinHeap();
        const g = new Map();
        const came = new Map();
        const h = (x, y) => Math.abs(x - tx) + Math.abs(y - ty);
        const startKey = sy * W + sx;
        g.set(startKey, 0);
        open.push(startKey, h(sx, sy));
        let nodes = 0;
        const goalKey = ty * W + tx;
        while (open.size && nodes++ < maxNodes) {
            const cur = open.pop();
            if (cur === goalKey) {
                const path = [];
                let k = cur;
                while (k !== startKey) {
                    path.push([k % W, Math.floor(k / W)]);
                    k = came.get(k);
                }
                return path.reverse();
            }
            const cx = cur % W, cy = Math.floor(cur / W);
            const cg = g.get(cur);
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
                const nx = cx + dx, ny = cy + dy;
                if (!map.passable(nx, ny)) continue;
                if (dx !== 0 && dy !== 0) { // diagonal: no corner cutting
                    if (!map.passable(cx + dx, cy) || !map.passable(cx, cy + dy)) continue;
                }
                const nk = ny * W + nx;
                const ng = cg + (dx && dy ? 1.414 : 1);
                if (ng < (g.get(nk) ?? Infinity)) {
                    g.set(nk, ng);
                    came.set(nk, cur);
                    open.push(nk, ng + h(nx, ny));
                }
            }
        }
        return null;
    }
}

class MinHeap {
    constructor() { this.a = []; this.p = []; }
    get size() { return this.a.length; }
    push(v, pri) {
        this.a.push(v); this.p.push(pri);
        let i = this.a.length - 1;
        while (i > 0) {
            const par = (i - 1) >> 1;
            if (this.p[par] <= this.p[i]) break;
            [this.a[par], this.a[i]] = [this.a[i], this.a[par]];
            [this.p[par], this.p[i]] = [this.p[i], this.p[par]];
            i = par;
        }
    }
    pop() {
        const top = this.a[0];
        const v = this.a.pop(), p = this.p.pop();
        if (this.a.length) {
            this.a[0] = v; this.p[0] = p;
            let i = 0;
            for (;;) {
                const l = i * 2 + 1, r = l + 1;
                let m = i;
                if (l < this.a.length && this.p[l] < this.p[m]) m = l;
                if (r < this.a.length && this.p[r] < this.p[m]) m = r;
                if (m === i) break;
                [this.a[m], this.a[i]] = [this.a[i], this.a[m]];
                [this.p[m], this.p[i]] = [this.p[i], this.p[m]];
                i = m;
            }
        }
        return top;
    }
}

// ============ 实体 ============
let ENTITY_ID = 1;

class Entity {
    constructor(owner, x, y) {
        this.id = ENTITY_ID++;
        this.owner = owner;      // player index
        this.x = x; this.y = y;  // anchor cell
        this.hp = 100; this.maxHp = 100;
        this.dead = false;
        this.selected = false;
        this.flash = 0;          // damage flash timer
    }
    get def() { return null; }
    get isBuilding() { return false; }
    get isUnit() { return false; }
}

class Unit extends Entity {
    constructor(owner, unitId, x, y) {
        super(owner, x, y);
        this.uid = unitId;
        const def = GAMEDATA.units[unitId];
        this.fx = x + 0.5; this.fy = y + 0.5;
        this.hp = this.maxHp = def.hp;
        this.facing = 0;
        this.turretFacing = 0;
        this.path = null;
        this.pathIdx = 0;
        this.target = null;       // attack target entity
        this.moveGoal = null;     // {x, y, tag}
        this.attackMove = false;
        this.state = 'idle';      // idle/move/attack/harvest/return
        this.cool = 0;
        this.speed = def.speed || 6;
        this.kind = def.kind;
        this.harvestAmt = 0;
        this.deployTimer = 0;
        this.frame = 0;           // walk anim frame
        this.frameT = 0;
        this.turretDef = def.turret !== false && GAMEDATA.unitsManifest[unitId] && GAMEDATA.unitsManifest[unitId].turret;
        this.ironCurtain = 0;
        this.spawnProtect = 0;
    }
    get def() { return GAMEDATA.units[this.uid]; }
    get isUnit() { return true; }
    get teamColor() { return Game.players[this.owner].color; }

    orderMove(x, y, tag) {
        this.target = null;
        this.attackMove = false;
        this.state = 'move';
        this.moveGoal = { x, y, tag };
        this.path = null;
        this._repath();
    }
    orderAttack(target) {
        this.target = target;
        this.state = 'attack';
        this.path = null;
    }
    orderAttackMove(x, y) {
        this.attackMove = true;
        this.state = 'move';
        this.moveGoal = { x, y };
        this.path = null;
        this._repath();
    }
    _repath() {
        const sx = Math.floor(this.fx), sy = Math.floor(this.fy);
        let { x: gx, y: gy } = this.moveGoal;
        if (!Game.map.passable(gx, gy)) {
            // find nearest passable
            let best = null, bd = 1e9;
            for (let dy = -4; dy <= 4; dy++)
                for (let dx = -4; dx <= 4; dx++) {
                    const nx = gx + dx, ny = gy + dy;
                    if (Game.map.passable(nx, ny)) {
                        const d = Math.abs(dx) + Math.abs(dy);
                        if (d < bd) { bd = d; best = [nx, ny]; }
                    }
                }
            if (!best) { this.state = 'idle'; return; }
            [gx, gy] = best;
        }
        this.path = Pathfinder.find(Game.map, sx, sy, gx, gy);
        this.pathIdx = 0;
        if (!this.path) this.state = 'idle';
    }

    update(dt) {
        if (this.dead) return;
        this.cool = Math.max(0, this.cool - dt);
        this.flash = Math.max(0, this.flash - dt);
        this.ironCurtain = Math.max(0, this.ironCurtain - dt);
        const def = this.def;

        // turret tracks target
        if (this.target && !this.target.dead) {
            const dx = this.target.x + 0.5 - this.fx, dy = this.target.y + 0.5 - this.fy;
            if (this.turretDef !== false) {
                const want = angleToFrame32(dx, dy);
                this.turretFacing = rotateToward(this.turretFacing, want, dt * 10);
            }
        } else if (this.turretDef !== false && this.state !== 'attack') {
            this.turretFacing = rotateToward(this.turretFacing, this.facing, dt * 6);
        }

        switch (this.state) {
            case 'move': this._updateMove(dt); break;
            case 'attack': this._updateAttack(dt); break;
            case 'harvest': this._updateHarvest(dt); break;
            case 'return': this._updateReturn(dt); break;
            case 'idle': this._updateIdle(dt); break;
        }
        // walk animation
        if (this.state === 'move' && this.kind === 'infantry') {
            this.frameT += dt * 8;
            if (this.frameT >= 1) { this.frameT = 0; this.frame = (this.frame + 1) % 6; }
        }
        if (this.spawnProtect > 0) this.spawnProtect -= dt;
    }

    _updateMove(dt) {
        // attack-move engages enemies
        if (this.attackMove) {
            const t = this.findTargetInRange(this.sightRange + 2);
            if (t) { this._engage(t); return; }
        }
        if (!this.path || this.pathIdx >= this.path.length) {
            if (this.moveGoal && this.moveGoal.tag === 'dock') { this.state = 'return'; return; }
            if (this.harvestPending) {
                this.harvestPending = false;
                this.state = 'harvest';
                return;
            }
            this.state = 'idle';
            return;
        }
        const [nx, ny] = this.path[this.pathIdx];
        const cx = nx + 0.5, cy = ny + 0.5;
        const dx = cx - this.fx, dy = cy - this.fy;
        const d = Math.hypot(dx, dy);
        // facing
        if (d > 0.01) {
            const want = this.kind === 'infantry' ? angleToFrame8(dx, dy) : angleToFrame32(dx, dy);
            this.facing = rotateToward(this.facing, want, dt * (this.kind === 'infantry' ? 9 : 7), this.kind === 'infantry' ? 8 : 32);
            if (this.turretDef !== false && !this.target) this.turretFacing = this.facing;
        }
        const sp = this._speedPx() * dt;
        if (d <= sp) {
            // release old cell, occupy new
            this.fx = cx; this.fy = cy;
            this.x = nx; this.y = ny;
            this.pathIdx++;
            if (this.pathIdx >= this.path.length) {
                this.path = null;
                if (this.moveGoal && this.moveGoal.tag === 'dock') { this.state = 'return'; return; }
                this.state = 'idle';
            }
        } else {
            this.fx += dx / d * sp;
            this.fy += dy / d * sp;
            this.x = Math.floor(this.fx); this.y = Math.floor(this.fy);
        }
    }
    _speedPx() {
        // speed stat ~ 1..10 -> cells/sec
        return 0.6 + this.speed * 0.22;
    }
    _moveToward(tx, ty, dt) {
        const dx = tx - this.fx, dy = ty - this.fy;
        const d = Math.hypot(dx, dy);
        if (d < 0.2) return;
        const want = this.kind === 'infantry' ? angleToFrame8(dx, dy) : angleToFrame32(dx, dy);
        this.facing = rotateToward(this.facing, want, dt * (this.kind === 'infantry' ? 9 : 7), this.kind === 'infantry' ? 8 : 32);
        const sp = this._speedPx() * dt;
        const nx = this.fx + dx / d * sp, ny = this.fy + dy / d * sp;
        if (Game.map.passable(Math.floor(nx), Math.floor(ny)) && !Game.map.water[Game.map.idx(Math.floor(nx), Math.floor(ny))]) {
            this.fx = nx; this.fy = ny;
            this.x = Math.floor(this.fx); this.y = Math.floor(this.fy);
        } else {
            // slide along axis
            if (Game.map.passable(Math.floor(nx), Math.floor(this.fy))) { this.fx = nx; }
            if (Game.map.passable(Math.floor(this.fx), Math.floor(ny))) { this.fy = ny; }
            this.x = Math.floor(this.fx); this.y = Math.floor(this.fy);
        }
        if (this.kind === 'infantry') { this.frameT += dt * 8; if (this.frameT >= 1) { this.frameT = 0; this.frame = (this.frame + 1) % 6; } }
    }
    get sightRange() { return this.kind === 'flyer' ? 9 : 7; }
    get weaponRange() {
        const w = this.def.weapon;
        return w ? w.range : 4;
    }

    _updateAttack(dt) {
        const t = this.target;
        if (!t || t.dead) {
            this.target = null;
            // retarget if attack-move
            if (this.attackMove && this.moveGoal) { this.state = 'move'; this._repath(); }
            else this.state = 'idle';
            return;
        }
        const d = dist(this.fx, this.fy, t.x + (t.isBuilding ? (t.def.size[0] - 1) / 2 : 0.5), t.fy !== undefined ? t.fy : t.y + 0.5);
        const rng = this.weaponRange + (t.isBuilding ? t.def.size[0] / 2 : 0);
        if (d > rng + 0.5) {
            // chase
            if (!this.path || this.pathIdx >= this.path.length) {
                this.moveGoal = { x: Math.floor(t.x), y: Math.floor(t.y) };
                this._repath();
                if (!this.path) {
                    // long-range fallback: walk straight toward target
                    this._moveToward(t.x + 0.5, t.fy !== undefined ? t.fy + 0.5 : t.y + 0.5, dt);
                    return;
                }
                if (this.state === 'idle') { this.state = 'attack'; }
            }
            if (this.path) this._updateMove(dt);
            this.state = 'attack';
        } else {
            // in range: face & fire
            const tx = t.x + 0.5, ty = (t.fy !== undefined ? t.fy : t.y + 0.5);
            const dx = tx - this.fx, dy = ty - this.fy;
            const want = this.kind === 'infantry' ? angleToFrame8(dx, dy) : angleToFrame32(dx, dy);
            if (this.turretDef !== false) {
                this.turretFacing = rotateToward(this.turretFacing, want, dt * 10);
            } else {
                this.facing = rotateToward(this.facing, want, dt * 7, this.kind === 'infantry' ? 8 : 32);
            }
            this._tryFire(t, dx, dy);
        }
    }

    _tryFire(t, dx, dy) {
        if (this.cool > 0) return;
        const w = this.def.weapon;
        if (!w) return;
        this.cool = Math.max(0.3, w.rof / 54); // ROF frames (60fps logic) -> sec
        Game.spawnProjectile(this, t, w);
        // report sound
        const snd = weaponSound(this.uid, this.kind);
        if (snd) Audio.playThrottled(snd, 120, 0.8);
        if (this.kind === 'infantry') this.frame = 'fire';
    }

    _updateIdle(dt) {
        // harvesters auto-seek ore
        if (this.def.harvester) {
            const i = Game.map.idx(Math.floor(this.fx), Math.floor(this.fy));
            if ((Game.map.ore[i] > 0 || Game.map.gem[i] > 0) && this.harvestAmt < 500) {
                this.state = 'harvest';
                return;
            }
            if (this.harvestAmt >= 500) {
                if (Game.findRefinery(this.owner)) this._returnOre();
                return; // full and no refinery: wait
            }
            const t = this.findOreNear();
            if (t) {
                // adjacent or on ore already?
                if (Math.abs(t[0] - Math.floor(this.fx)) + Math.abs(t[1] - Math.floor(this.fy)) <= 1) {
                    this.state = 'harvest';
                } else {
                    this._goHarvest(t);
                }
            }
            return;
        }
        // auto-defense: attack nearby enemies (combat units)
        if (this.def.weapon && !this.def.harvester && !this.def.engineer && !this.def.mcv) {
            const t = this.findTargetInRange(this.weaponRange);
            if (t) this._engage(t);
        }
    }

    _engage(t) {
        this.target = t;
        if (this.state !== 'attack') this.state = 'attack';
        this.path = null;
    }

    findTargetInRange(r) {
        let best = null, bd = 1e9;
        for (const e of Game.entities) {
            if (e.dead || e.owner === this.owner) continue;
            if (Game.players[e.owner].team === Game.players[this.owner].team) continue;
            if (e.isUnit && e.def.flyer && !canHitAir(this)) continue;
            if (e.isBuilding && e.def.wall) continue;
            const d = dist(this.fx, this.fy, e.fx ?? e.x, e.fy ?? e.y) - (e.isBuilding ? e.def.size[0] / 2 : 0);
            if (d <= r && d < bd) { bd = d; best = e; }
        }
        return best;
    }

    findOreNear() {
        const cx = Math.floor(this.fx), cy = Math.floor(this.fy);
        let best = null, bd = 1e9;
        for (let dy = -18; dy <= 18; dy++)
            for (let dx = -18; dx <= 18; dx++) {
                const x = cx + dx, y = cy + dy;
                if (!Game.map.inb(x, y)) continue;
                const i = Game.map.idx(x, y);
                if (Game.map.ore[i] > 0 || Game.map.gem[i] > 0) {
                    const d = Math.abs(dx) + Math.abs(dy);
                    if (d < bd) { bd = d; best = [x, y]; }
                }
            }
        return best;
    }

    _goHarvest(cell) {
        this.harvestCell = cell;
        this.moveGoal = { x: cell[0], y: cell[1] };
        this.state = 'move';
        this._repath();
        this.state = 'move';
        this.harvestPending = true;
    }

    _updateHarvest(dt) {
        const i = Game.map.idx(Math.floor(this.fx), Math.floor(this.fy));
        if (this.harvestAmt >= 500) {
            this._returnOre();
            return;
        }
        if (!Game.map.ore[i] && !Game.map.gem[i]) {
            // look around: adjacent ore?
            let found = false;
            for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
                const j = Game.map.idx(Math.floor(this.fx)+dx, Math.floor(this.fy)+dy);
                if (Game.map.inb(Math.floor(this.fx)+dx, Math.floor(this.fy)+dy) && (Game.map.ore[j] > 0 || Game.map.gem[j] > 0)) {
                    if (Game.map.passable(Math.floor(this.fx)+dx, Math.floor(this.fy)+dy)) {
                        this.orderMove(Math.floor(this.fx)+dx, Math.floor(this.fy)+dy);
                        this.harvestPending = true;
                        found = true;
                        break;
                    }
                }
            }
            if (!found) {
                if (this.harvestAmt > 0) this._returnOre();
                else this.state = 'idle';
            }
            return;
        }
        this.harvT = (this.harvT || 0) + dt;
        if (this.harvT > 0.55) {
            this.harvT = 0;
            const take = Math.min(28, Game.map.ore[i] || 0);
            if (take > 0) {
                Game.map.ore[i] -= take;
                this.harvestAmt += take;
                const om = SoundMap.event('oremine'); if (om) Audio.playThrottled(om[0], 400, 0.5);
                return;
            }
            const gtake = Math.min(28, Game.map.gem[i] || 0);
            if (gtake > 0) {
                Game.map.gem[i] -= gtake;
                this.harvestAmt += gtake * 2;
                return;
            }
            this._returnOre();
        }
    }
    _returnOre() {
        const ref = Game.findRefinery(this.owner);
        if (!ref) { this.state = 'idle'; return; }
        const dock = ref.dockCell();
        this.moveGoal = { x: dock[0], y: dock[1], tag: 'dock' };
        this.state = 'move';
        this._repath();
        this.state = 'move';
    }
    _updateReturn(dt) {
        const ref = Game.findRefinery(this.owner);
        if (!ref) { this.state = 'idle'; return; }
        const d = dist(this.fx, this.fy, ref.x + 1.5, ref.y + 1.5);
        if (d < 2.6) {
            if (this.harvestAmt > 0) {
                Game.players[this.owner].credits += this.harvestAmt;
                if (this.owner === Game.playerIndex) { const op = SoundMap.event('orepop'); if (op) Audio.playThrottled(op[0], 250, 0.6); }
                this.harvestAmt = 0;
                const rf = SoundMap.event('refine'); if (rf) Audio.playThrottled(rf[0], 500, 0.55);
            }
            // back to field
            const t = this.findOreNear();
            if (t) { this._goHarvest(t); }
            else this.state = 'idle';
            return;
        }
        // keep moving
        if (!this.path || this.pathIdx >= this.path.length) this._returnOre();
        else this._updateMove(dt);
    }

    damage(amount, attacker) {
        if (this.ironCurtain > 0) return;
        this.hp -= amount;
        this.flash = 0.15;
        if (this.hp <= 0) {
            this.dead = true;
            Game.spawnExplosion(this.fx, this.fy, this.kind === 'infantry' ? 'small' : 'vehicle');
            const dsn = SoundMap.die(this.uid);
            if (dsn) Audio.playThrottled(choice(dsn), 150, 0.8);
            if (attacker && attacker.owner === Game.playerIndex) Game.stats.kills++;
        } else if (attacker && this.state === 'idle' && this.def.weapon) {
            // return fire
            this._engage(attacker);
        }
    }
}

function rotateToward(cur, want, step, mod = 32) {
    let d = ((want - cur) % mod + mod) % mod;
    if (d > mod / 2) d -= mod;
    if (Math.abs(d) <= step) return want % mod;
    return ((cur + Math.sign(d) * step) % mod + mod) % mod;
}

function canHitAir(unit) {
    return unit.def.antiAir || unit.uid === 'ZEP' || unit.uid === 'SHAD';
}

function weaponSound(uid, kind) {
    const list = SoundMap.weapon(uid);
    if (list && list.length) return list[Math.floor(Math.random() * list.length)];
    return null;
}

// ============ 建筑 ============
class Building extends Entity {
    constructor(owner, bid, x, y) {
        super(owner, x, y);
        this.bid = bid;
        const def = GAMEDATA.buildings[bid];
        this.hp = this.maxHp = def.hp;
        this.w = def.size[0]; this.h = def.size[1];
        this.prodQueue = [];
        this.prodProgress = 0;
        this.prodItem = null;
        this.rallyX = null; this.rallyY = null;
        this.animFrame = 0;
        this.animT = 0;
        this.superCharge = 0;      // 0..1
        this.superReady = false;
        this.isPrimary = false;
        this.ironCurtain = 0;
        this.deconstruct = 0;
    }
    get def() { return GAMEDATA.buildings[this.bid]; }
    get isBuilding() { return true; }
    get teamColor() { return Game.players[this.owner].color; }

    occupy() {
        for (let dy = 0; dy < this.h; dy++)
            for (let dx = 0; dx < this.w; dx++) {
                const i = Game.map.idx(this.x + dx, this.y + dy);
                Game.map.occupied[i] = this;
                if (this.def.wall) Game.map.walls = Game.map.walls || new Set();
            }
    }
    unoccupy() {
        for (let dy = 0; dy < this.h; dy++)
            for (let dx = 0; dx < this.w; dx++) {
                const i = Game.map.idx(this.x + dx, this.y + dy);
                if (Game.map.occupied[i] === this) Game.map.occupied[i] = null;
            }
    }
    dockCell() {
        // docking spot in front (below) of refinery
        return [this.x + this.w - 1, this.y + this.h];
    }
    centerPx() {
        const c = cellToScreen(this.x + this.w / 2, this.y + this.h / 2);
        return c;
    }

    update(dt) {
        if (this.dead) return;
        this.flash = Math.max(0, this.flash - dt);
        this.ironCurtain = Math.max(0, this.ironCurtain - dt);
        // idle anim
        if ((GAMEDATA.buildingsManifest[this.bid] || {}).frames > 1) {
            this.animT += dt;
            if (this.animT > 0.5) { this.animT = 0; this.animFrame = (this.animFrame + 1) % GAMEDATA.buildingsManifest[this.bid].frames; }
        }
        // production
        if (this.prodItem) {
            const def = this.prodItem.startsWith('b:') ? null : (GAMEDATA.units[this.prodItem] || GAMEDATA.buildings[this.prodItem]);
            const cost = GAMEDATA.buildings[this.prodItem] ? GAMEDATA.buildings[this.prodItem].cost : (def ? def.cost : 0);
            const item = this.prodItem.startsWith('b:') ? this.prodItem.slice(2) : this.prodItem;
            const idef = GAMEDATA.units[item] || GAMEDATA.buildings[item];
            const speed = Game.players[this.owner].lowPower ? 0.35 : 1;
            if (idef) {
                this.prodProgress += dt * speed / buildTime(idef);
                // charging credits
                const p = this.owner;
                const due = Math.round(idef.cost * Math.min(1, this.prodProgress));
                if (due > (this.prodPaid || 0) && Game.players[p].credits >= due - (this.prodPaid || 0)) {
                    Game.players[p].credits -= due - (this.prodPaid || 0);
                    this.prodPaid = due;
                }
                if (this.prodProgress >= 1) {
                    this._finishProduction(item);
                }
            }
        } else if (this.prodQueue.length && !this.prodItem) {
            const next = this.prodQueue.shift();
            this.prodItem = next;
            this.prodProgress = 0;
            this.prodPaid = 0;
        }
        // superweapon charge
        if (this.def.super) {
            const spd = Game.players[this.owner].lowPower ? 0.4 : 1;
            this.superCharge += dt * spd / SUPER_TIMES[this.def.super];
            if (this.superCharge >= 1) {
                this.superCharge = 1;
                if (!this.superReady) {
                    this.superReady = true;
                    if (this.owner === Game.playerIndex) {
                        Audio.playEva(this.def.super === 'nuclear' ? 'EVA_NuclearMissileReady' :
                                      this.def.super === 'ironcurtain' ? 'EVA_IronCurtainReady' : 'EVA_ChronosphereReady');
                        toast(this.def.super === 'nuclear' ? '核弹已就绪！' : this.def.super === 'ironcurtain' ? '铁幕装置已就绪！' : '超时空传送已就绪！');
                    }
                }
            }
        }
        // repair beacon passive heal (service depot not needed for buildings) - skip
    }

    _finishProduction(item) {
        const isB = !!GAMEDATA.buildings[item];
        if (isB) {
            // building ready -> placement mode (player) / AI auto-place
            Game.players[this.owner].readyBuilding = item;
            this.prodItem = null;
            this.prodProgress = 0;
            if (this.owner === Game.playerIndex) {
                Audio.playEva('EVA_NewConstructionOptions');
                toast('建筑就绪 - 点击战场放置');
            }
            return;
        }
        // unit: spawn at factory exit
        const spawn = this._spawnCell();
        if (!spawn) { // blocked: hold
            this.prodProgress = 1;
            return;
        }
        const u = new Unit(this.owner, item, spawn[0], spawn[1]);
        u.spawnProtect = 0.5;
        Game.entities.push(u);
        if (this.rallyX !== null) u.orderMove(this.rallyX, this.rallyY);
        this.prodItem = null;
        this.prodProgress = 0;
        Game.stats.produced++;
        if (this.owner === Game.playerIndex) {
            const mc = SoundMap.event('menuclick'); if (mc) Audio.playThrottled(mc[0], 300, 0.7);
        }
    }

    _spawnCell() {
        const dirs = [[this.x - 1, this.y + this.h - 1], [this.x + this.w, this.y + this.h - 1],
                      [this.x, this.y + this.h], [this.x + this.w - 1, this.y - 1],
                      [this.x - 1, this.y], [this.x + this.w, this.y]];
        for (const [x, y] of dirs) {
            if (Game.map.passable(x, y) && !Game.unitAt(x, y)) return [x, y];
        }
        for (let r = 2; r < 5; r++) {
            for (let dy = -r; dy <= r; dy++)
                for (let dx = -r; dx <= r; dx++) {
                    const x = this.x + dx, y = this.y + this.h + dy;
                    if (Game.map.passable(x, y) && !Game.unitAt(x, y)) return [x, y];
                }
        }
        return null;
    }

    damage(amount, attacker) {
        if (this.def.wall) { // walls
            this.hp -= amount;
            if (this.hp <= 0) this.dead = true;
            return;
        }
        if (this.ironCurtain > 0) return;
        this.hp -= amount;
        this.flash = 0.15;
        if (this.hp <= 0) {
            this.dead = true;
            this.unoccupy();
            Game.spawnExplosion(this.x + this.w / 2, this.y + this.h / 2, 'building');
            const bd = SoundMap.event('blddie'); if (bd) Audio.playThrottled(choice(bd), 300, 1);
            if (this.owner === Game.playerIndex) {
                Audio.playEva('EVA_StructureLost');
            }
            if (attacker && attacker.owner === Game.playerIndex) Game.stats.kills++;
            // cascading: was it production?
        } else if (this.hp < this.maxHp * 0.4 && this.owner === Game.playerIndex && Math.random() < 0.008) {
            Audio.playEva('EVA_OurBaseIsUnderAttack');
        }
    }
}

function buildTime(def) {
    // seconds: cost/300 + 3 (approx RA2 feel)
    return 3 + def.cost / 320;
}

const SUPER_TIMES = { nuclear: 360, ironcurtain: 300, chronosphere: 240 };

// ============ 弹道与特效 ============
class Projectile {
    constructor(x, y, tx, ty, w, src) {
        this.x = x; this.y = y;
        this.tx = tx; this.ty = ty;
        this.weapon = w;
        this.src = src;
        this.kind = 'shell';
        if (w.warhead && /tesla|bolt/i.test(w.warhead)) this.kind = 'tesla';
        else if (w.warhead && /prism/i.test(w.warhead)) this.kind = 'prism';
        else if (w.speed === 0) this.kind = 'beam';
        this.speed = w.speed ? Math.max(6, w.speed * 0.06) : 14;
        this.dead = false;
        this.trail = [];
    }
    update(dt) {
        const dx = this.tx - this.x, dy = this.ty - this.y;
        const d = Math.hypot(dx, dy);
        if (d < this.speed * dt + 0.1) {
            this.dead = true;
            Game.impact(this.tx, this.ty, this.weapon, this.src);
            return;
        }
        this.x += dx / d * this.speed * dt;
        this.y += dy / d * this.speed * dt;
        this.trail.push([this.x, this.y]);
        if (this.trail.length > 6) this.trail.shift();
    }
}

class Effect {
    constructor(kind, x, y, ttl, extra) {
        this.kind = kind; this.x = x; this.y = y;
        this.t = 0; this.ttl = ttl;
        this.dead = false;
        Object.assign(this, extra || {});
    }
    update(dt) {
        this.t += dt;
        if (this.t >= this.ttl) this.dead = true;
    }
}

// ============ 游戏主体 ============
class Player {
    constructor(idx, side, color, isAI, name) {
        this.index = idx;
        this.side = side;         // allied / soviet
        this.color = color;       // team color key
        this.isAI = isAI;
        this.name = name;
        this.credits = 6000;
        this.power = 0;
        this.powerDrain = 0;
        this.lowPower = false;
        this.readyBuilding = null;   // building awaiting placement
        this.team = idx === 0 ? 0 : 1; // 0 player team, 1 enemy team
        this.hasRadar = false;
    }
    get prod() { return GAMEDATA.production[this.side]; }
}

const Game = {
    entities: [],
    projectiles: [],
    effects: [],
    players: [],
    playerIndex: 0,
    map: null,
    camX: 0, camY: 0,
    canvas: null, ctx: null,
    radarCanvas: null, radarCtx: null,
    running: false,
    paused: false,
    gameOver: false,
    time: 0,
    stats: { kills: 0, produced: 0, mined: 0 },
    selection: [],
    placing: null,          // building def being placed
    mode: 'normal',         // normal / repair / sell
    mouse: { x: -100, y: -100, down: false, dragStart: null },
    keys: new Set(),
    selectedTab: 'buildings',
    lastEvaAttack: 0,
    _buildT: 0,

    init() {
        this.canvas = $('mainCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.radarCanvas = $('radarCanvas');
        this.radarCtx = this.radarCanvas.getContext('2d');
        this.resize();
        window.addEventListener('resize', () => this.resize());
    },

    resize() {
        const bf = $('battlefield');
        this.canvas.width = bf.clientWidth;
        this.canvas.height = bf.clientHeight;
        const r = $('radar');
        this.radarCanvas.width = r.clientWidth;
        this.radarCanvas.height = r.clientHeight;
    },

    start(playerSide, difficulty) {
        this.entities = [];
        this.projectiles = [];
        this.effects = [];
        this.time = 0;
        this.gameOver = false;
        this.paused = false;
        this.selection = [];
        this.stats = { kills: 0, produced: 0, mined: 0 };
        this.map = new GameMap(MAP_W, MAP_H);
        this.map.generate(Math.random());

        this.players = [
            new Player(0, playerSide, 'blue', false, '指挥官'),
            new Player(1, playerSide === 'soviet' ? 'allied' : 'soviet', 'red', true, '敌方指挥官'),
        ];
        this.playerIndex = 0;
        this.difficulty = difficulty;
        const aiSpeed = difficulty === 'easy' ? 0.55 : difficulty === 'hard' ? 1.5 : 1.0;
        this.ai = new AIController(this.players[1], aiSpeed);

        // starting bases
        const ps = this.players[0], es = this.players[1];
        const conyardId = ps.side === 'allied' ? 'GACNST' : 'NACNST';
        this.placeBuilding(0, conyardId, 8, 8);
        this.spawnUnit(0, ps.side === 'allied' ? 'CMIN' : 'HARV', 12, 13);
        this.spawnUnit(0, ps.side === 'allied' ? 'CMIN' : 'HARV', 13, 12);
        this.spawnUnit(0, ps.side === 'allied' ? 'MTNK' : 'HTNK', 13, 14);
        this.spawnUnit(0, 'ENGINEER', 11, 11);
        this.spawnUnit(0, ps.side === 'allied' ? 'GI' : 'E2', 12, 12);
        this.spawnUnit(0, ps.side === 'allied' ? 'GI' : 'E2', 14, 12);

        const ecy = es.side === 'allied' ? 'GACNST' : 'NACNST';
        this.placeBuilding(1, ecy, MAP_W - 11, MAP_H - 11);
        this.spawnUnit(1, es.side === 'allied' ? 'CMIN' : 'HARV', MAP_W - 15, MAP_H - 13);
        this.spawnUnit(1, es.side === 'allied' ? 'CMIN' : 'HARV', MAP_W - 13, MAP_H - 15);
        this.spawnUnit(1, es.side === 'allied' ? 'MTNK' : 'HTNK', MAP_W - 14, MAP_H - 12);
        for (let i = 0; i < 4; i++)
            this.spawnUnit(1, es.side === 'allied' ? 'GI' : 'E2', MAP_W - 13 + i % 2, MAP_H - 13 + Math.floor(i / 2));

        // initial camera on base
        const c = cellToScreen(10, 10);
        this.camX = c.x - this.canvas.width / 2;
        this.camY = c.y - this.canvas.height / 2;
        this.clampCam();

        Sidebar.init();
        Sidebar.refresh();
        this.running = true;
        Audio.playEva('EVA_EstablishBattlefieldControl');
        toast(ps.side === 'soviet' ? '苏军基地已建立 - 消灭盟军！' : '盟军基地已建立 - 消灭苏军！');
    },

    spawnUnit(owner, uid, x, y) {
        const u = new Unit(owner, uid, x, y);
        this.entities.push(u);
        return u;
    },

    placeBuilding(owner, bid, x, y) {
        const b = new Building(owner, bid, x, y);
        if (bid === 'GAWALL') { b.hp = b.maxHp = 300; }
        this.entities.push(b);
        b.occupy();
        return b;
    },

    findRefinery(owner) {
        for (const e of this.entities)
            if (!e.dead && e.isBuilding && e.owner === owner && e.def.isRefinery) return e;
        return null;
    },
    unitAt(x, y) {
        for (const e of this.entities)
            if (!e.dead && e.isUnit && Math.floor(e.fx) === x && Math.floor(e.fy) === y) return e;
        return null;
    },

    // ---- combat resolution ----
    spawnProjectile(src, target, w) {
        const sx = src.fx ?? src.x + 0.5;
        const sy = src.fy ?? src.y + 0.5;
        const tx = target.fx ?? target.x + (target.isBuilding ? target.w / 2 : 0.5);
        const ty = target.fy ?? target.y + (target.isBuilding ? target.h / 2 : 0.5);
        this.projectiles.push(new Projectile(sx, sy, tx, ty, w, src));
    },

    impact(x, y, w, src) {
        const dmg = w.damage;
        // area damage
        const spread = 0.9;
        for (const e of this.entities) {
            if (e.dead || e === src) continue;
            if (e.owner === src.owner && !friendlyFire) continue;
            if (Game.players[e.owner].team === Game.players[src.owner].team) continue;
            const ex = e.fx ?? e.x + (e.isBuilding ? e.w / 2 : 0.5);
            const ey = e.fy ?? e.y + (e.isBuilding ? e.h / 2 : 0.5);
            const d = dist(x, y, ex, ey);
            const r = spread + (e.isBuilding ? e.def.size[0] / 2 : 0);
            if (d <= r) {
                let mult = 1;
                if (e.isBuilding) mult = 0.9;
                if (e.def && e.def.wall) mult = 0.5;
                e.damage(dmg * mult, src);
            }
        }
        // fx
        if (w.warhead && /nuke/i.test(w.warhead)) {
            this.spawnExplosion(x, y, 'nuke');
        } else if (dmg >= 120) {
            this.spawnExplosion(x, y, 'big');
            const eb = SoundMap.event('expl_big'); if (eb) Audio.playThrottled(choice(eb), 150, 1);
        } else if (dmg >= 30) {
            this.spawnExplosion(x, y, 'small');
            const em = SoundMap.event('expl_med'); if (em) Audio.playThrottled(choice(em), 120, 0.85);
        } else {
            this.effects.push(new Effect('hit', x, y, 0.18));
        }
        if (w.warhead && /tesla|bolt/i.test(w.warhead)) {
            this.effects.push(new Effect('tesla', x, y, 0.25));
            const tw = SoundMap.weapon('TESLA'); if (tw) Audio.playThrottled(tw[0], 200, 0.9);
        }
        if (w.warhead && /prism/i.test(w.warhead)) {
            this.effects.push(new Effect('prismhit', x, y, 0.2));
            const pw = SoundMap.weapon('ATESLA'); if (pw) Audio.playThrottled(pw[0], 200, 0.9);
        }
    },

    spawnExplosion(x, y, size) {
        const ttl = size === 'nuke' ? 2.2 : size === 'building' ? 1.4 : size === 'big' ? 1.0 : 0.6;
        this.effects.push(new Effect('expl', x, y, ttl, { size }));
        if (size === 'nuke') {
            this.effects.push(new Effect('flash', x, y, 0.9));
            this.effects.push(new Effect('mushroom', x, y, 2.6));
            const nk = SoundMap.event('nuke'); if (nk) Audio.play(nk[0], { gain: 1 });
        } else if (size === 'building') {
            this.effects.push(new Effect('smoke', x, y, 2.5));
        }
    },

    // ---- 主循环 ----
    update(dt) {
        if (!this.running || this.paused || this.gameOver) return;
        this.time += dt;
        // economy tick: refineries give trickle
        for (const p of this.players) {
            let power = 0, drain = 0;
            let hasRef = false, hasRadar = false;
            for (const e of this.entities) {
                if (e.dead || !e.isBuilding || e.owner !== p.index) continue;
                if (e.def.power > 0) power += e.def.power;
                if (e.def.power < 0) drain += -e.def.power;
                if (e.def.isRefinery) hasRef = true;
                if (e.def.radar) hasRadar = true;
            }
            p.power = power; p.powerDrain = drain;
            const wasLow = p.lowPower;
            p.lowPower = power < drain;
            if (p.lowPower && !wasLow && p.index === this.playerIndex) {
                Audio.playEva('EVA_LowPower');
            }
            p.hasRadar = hasRadar && !p.lowPower;
            if (hasRef) p.credits += dt * 6;
        }

        for (const e of this.entities) e.update(dt);
        for (const p of this.projectiles) p.update(dt);
        for (const fx of this.effects) fx.update(dt);

        // cleanup
        this.entities = this.entities.filter(e => !e.dead);
        this.projectiles = this.projectiles.filter(p => !p.dead);
        this.effects = this.effects.filter(f => !f.dead);
        this.selection = this.selection.filter(e => !e.dead);

        // AI
        this.ai.update(dt);

        // victory check
        const cony = e => !e.dead && e.isBuilding && (e.bid === 'GACNST' || e.bid === 'NACNST');
        const playerAlive = this.entities.some(e => cony(e) && e.owner === 0);
        const enemyAlive = this.entities.some(e => cony(e) && e.owner === 1);
        if (!enemyAlive) this.endGame(true);
        else if (!playerAlive) this.endGame(false);

        // player under attack EVA
        this._checkUnderAttack();

        // edge scroll
        this._edgeScroll(dt);
        this.clampCam();

        Sidebar.tick(dt);
    },

    _checkUnderAttack() {
        const now = this.time;
        if (now - this.lastEvaAttack < 25) return;
        for (const e of this.entities) {
            if (e.dead || e.owner !== this.playerIndex || !e.flash) continue;
            if (e.isBuilding || e.def.harvester) {
                this.lastEvaAttack = now;
                Audio.playEva(e.def.harvester ? 'EVA_OreMinerUnderAttack' : 'EVA_OurBaseIsUnderAttack');
                break;
            }
        }
    },

    _edgeScroll(dt) {
        const m = this.mouse;
        if (m.x < 0) return;
        const sp = 620 * dt;
        const W = this.canvas.width, H = this.canvas.height;
        if (m.x < 14) this.camX -= sp;
        if (m.x > W - 14) this.camX += sp;
        if (m.y < 14) this.camY -= sp;
        if (m.y > H - 14) this.camY += sp;
        // keys
        if (this.keys.has('ArrowLeft') || this.keys.has('KeyA')) this.camX -= sp;
        if (this.keys.has('ArrowRight') || this.keys.has('KeyD')) this.camX += sp;
        if (this.keys.has('ArrowUp') || this.keys.has('KeyW')) this.camY -= sp;
        if (this.keys.has('ArrowDown') || this.keys.has('KeyS')) this.camY += sp;
    },

    clampCam() {
        const c = cellToScreen(MAP_W, MAP_H);
        this.camX = clamp(this.camX, -TILE_W, c.x - this.canvas.width + TILE_W);
        this.camY = clamp(this.camY, -TILE_H, c.y - this.canvas.height + TILE_H);
    },

    endGame(win) {
        this.gameOver = true;
        const mins = Math.floor(this.time / 60), secs = Math.floor(this.time % 60);
        $('endTitle').textContent = win ? '胜 利' : '战 败';
        $('endTitle').className = win ? 'win' : 'lose';
        $('endStats').innerHTML =
            `作战时长 ${mins}分${secs}秒<br>` +
            `消灭敌军 ${this.stats.kills} · 生产单位 ${this.stats.produced}<br>` +
            `阵营 ${this.players[0].side === 'soviet' ? '苏军' : '盟军'} · 难度 ${this.difficulty === 'easy' ? '简单' : this.difficulty === 'hard' ? '困难' : '普通'}`;
        $('endScreen').style.display = 'flex';
        Audio.playEva(win ? 'EVA_YouAreVictorious' : 'EVA_YouHaveLost');
    },

    // ---- selection & orders ----
    selectAt(sx, sy, additive) {
        const cell = screenToCell(sx, sy, this.camX, this.camY);
        let hit = null;
        // units first (pixel-accurate-ish via proximity)
        let bd = 1.4;
        for (const e of this.entities) {
            if (e.dead || e.owner !== this.playerIndex) continue;
            if (e.isBuilding) {
                if (cell.x >= e.x && cell.x < e.x + e.w && cell.y >= e.y && cell.y < e.y + e.h) { hit = e; bd = -1; break; }
            } else {
                const d = dist(cell.x, cell.y, e.fx, e.fy);
                if (d < bd) { bd = d; hit = e; }
            }
        }
        if (!additive) this.selection = [];
        if (hit && !this.selection.includes(hit)) {
            this.selection.push(hit);
            hit.selected = true;
            if (hit.isUnit) {
                const v = SoundMap.voice(hit.uid, 'select');
                if (v) Audio.playThrottled(choice(v), 250, 0.85);
            } else Audio.playThrottled(SoundMap.event('menuclick') ? SoundMap.event('menuclick')[0] : null, 150, 0.6);
        }
        for (const e of this.entities) e.selected = this.selection.includes(e);
        Sidebar.refresh();
    },

    issueOrder(sx, sy) {
        if (!this.selection.length) return;
        const cell = screenToCell(sx, sy, this.camX, this.camY);
        // attack target?
        let target = null;
        for (const e of this.entities) {
            if (e.dead || Game.players[e.owner].team === Game.players[this.playerIndex].team) continue;
            if (e.isBuilding) {
                if (cell.x >= e.x && cell.x < e.x + e.w && cell.y >= e.y && cell.y < e.y + e.h) { target = e; break; }
            } else if (dist(cell.x, cell.y, e.fx, e.fy) < 0.9) { target = e; break; }
        }
        let acted = false;
        for (const u of this.selection) {
            if (!u.isUnit || u.owner !== this.playerIndex) continue;
            if (target && u.def.weapon) u.orderAttack(target);
            else if (u.def.engineer && !target) {
                // engineer: try capture enemy building
                let cap = null;
                for (const e of this.entities) {
                    if (e.dead || e.isUnit || e.owner === this.playerIndex) continue;
                    if (cell.x >= e.x && cell.x < e.x + e.w && cell.y >= e.y && cell.y < e.y + e.h) { cap = e; break; }
                }
                if (cap) { u.orderAttack(cap); acted = true; }
                else u.orderMove(cell.x, cell.y);
            }
            else u.orderMove(cell.x, cell.y);
            acted = true;
        }
        if (acted) {
            const u0 = this.selection.find(u => u.isUnit);
            if (u0) { const v = SoundMap.voice(u0.uid, 'move'); if (v) Audio.playThrottled(choice(v), 260, 0.85); }
        }
    },

    // ---- placement ----
    canPlace(bid, x, y) {
        const def = GAMEDATA.buildings[bid];
        for (let dy = 0; dy < def.size[1]; dy++)
            for (let dx = 0; dx < def.size[0]; dx++)
                if (!Game.map.buildable(x + dx, y + dy)) return false;
        return true;
    },

    confirmPlace(x, y) {
        const bid = this.placing;
        if (!bid || !this.canPlace(bid, x, y)) return false;
        const b = this.placeBuilding(this.playerIndex, bid, x, y);
        this.placing = null;
        this.players[this.playerIndex].readyBuilding = null;
        Audio.playEva('EVA_ConstructionComplete');
        Audio.playEva('EVA_ConstructionComplete');
        Sidebar.refresh();
        return true;
    },
};

const friendlyFire = false;

// ============ 渲染器 ============
const Renderer = {
    terrainImg: null, terrainMap: null,
    unitsImgs: {}, unitFrames: {},
    infImgs: {},
    bldImgs: {},
    cameoImg: null, cameos: null,
    ovlImg: null, ovlMap: null,

    init() {
        this.terrainImg = Assets.images['terrain.png'];
        this.terrainMap = GAMEDATA.terrainManifest;
        for (const c of ['blue', 'red', 'yellow', 'green', 'grey']) {
            if (Assets.images['units_' + c + '.png']) this.unitsImgs[c] = Assets.images['units_' + c + '.png'];
        }
        this.unitFrames = GAMEDATA.unitsManifest;
        this.cameoImg = Assets.images['cameos.png'];
        this.cameos = GAMEDATA.cameos;
        this.ovlImg = Assets.images['overlays.png'];
        this.ovlMap = GAMEDATA.overlaysManifest;
        for (const uid in GAMEDATA.infManifest) {
            this.infImgs[uid] = Assets.images['inf_' + uid + '.png'];
        }
        for (const bid in GAMEDATA.buildingsManifest) {
            this.bldImgs[bid] = Assets.images['bld_' + bid + '.png'];
        }
    },

    draw(ctx) {
        const cam = { x: Game.camX, y: Game.camY };
        ctx.fillStyle = '#0a0a12';
        ctx.fillRect(0, 0, Game.canvas.width, Game.canvas.height);
        ctx.save();
        ctx.translate(-cam.x, -cam.y);

        this._drawTerrain(ctx, cam);
        this._drawOverlays(ctx, cam);
        this._drawPlacementGrid(ctx);
        this._drawEntities(ctx, cam);
        for (const p of Game.projectiles) this._drawProjectile(ctx, p);
        for (const fx of Game.effects) this._drawEffect(ctx, fx);
        this._drawSelectionUI(ctx);
        ctx.restore();
        this._drawDragBox(ctx);
    },

    _tileSrc(name) {
        const t = this.terrainMap[name] || this.terrainMap[name + '_0'];
        if (!t) return null;
        return [t.x, t.y, 60, 30];
    },

    _drawTerrain(ctx, cam) {
        const W = Game.canvas.width, H = Game.canvas.height;
        const img = this.terrainImg;
        if (!img) return;
        // visible cell range
        const minCx = Math.max(0, Math.floor((cam.y / (TILE_H / 2) - cam.x / (TILE_W / 2)) / 2) - 2);
        const minCy = Math.max(0, Math.floor((cam.y / (TILE_H / 2) + cam.x / (TILE_W / 2)) / 2) - 2);
        const spanX = Math.ceil(W / TILE_W) + Math.ceil(H / TILE_H) + 4;
        for (let y = minCy; y < minCy + spanX && y < Game.map.h; y++) {
            for (let x = minCx; x < minCx + spanX && x < Game.map.w; x++) {
                const s = this._tileSrc(Game.map.get(x, y));
                if (!s) continue;
                const p = cellToScreen(x, y);
                ctx.drawImage(img, s[0], s[1], s[2], s[3], p.x, p.y, TILE_W, TILE_H);
            }
        }
    },

    _drawOverlays(ctx, cam) {
        const img = this.ovlImg;
        if (!img) return;
        const W = Game.canvas.width, H = Game.canvas.height;
        const minCx = Math.max(0, Math.floor((cam.y / (TILE_H / 2) - cam.x / (TILE_W / 2)) / 2) - 2);
        const minCy = Math.max(0, Math.floor((cam.y / (TILE_H / 2) + cam.x / (TILE_W / 2)) / 2) - 2);
        const spanX = Math.ceil(W / TILE_W) + Math.ceil(H / TILE_H) + 4;
        const cell = { cw: 74, ch: 66 };
        for (let y = minCy; y < minCy + spanX && y < Game.map.h; y++) {
            for (let x = minCx; x < minCx + spanX && x < Game.map.w; x++) {
                const i = Game.map.idx(x, y);
                let name = null;
                if (Game.map.gem[i] > 0) name = 'gem' + clamp(Math.ceil(Game.map.gem[i]), 1, 12);
                else if (Game.map.ore[i] > 0) name = 'ore' + clamp(Math.ceil(Game.map.ore[i]), 1, 12);
                else if (Game.map.get(x, y) === 'clear01' || true) {
                    // walls drawn as entities
                }
                if (!name) continue;
                const o = this.ovlMap[name];
                if (!o) continue;
                const p = cellToScreen(x, y);
                ctx.drawImage(img, o.x, o.y, o.w, o.h,
                    p.x + TILE_W / 2 - o.w / 2, p.y + TILE_H / 2 - o.h * 0.55, o.w, o.h);
            }
        }
    },

    _drawPlacementGrid(ctx) {
        if (!Game.placing) return;
        const def = GAMEDATA.buildings[Game.placing];
        const cell = screenToCell(Game.mouse.x, Game.mouse.y, Game.camX, Game.camY);
        const ok = Game.canPlace(Game.placing, cell.x, cell.y);
        for (let dy = 0; dy < def.size[1]; dy++)
            for (let dx = 0; dx < def.size[0]; dx++) {
                const p = cellToScreen(cell.x + dx, cell.y + dy);
                ctx.fillStyle = ok ? 'rgba(60,230,90,.32)' : 'rgba(230,60,50,.35)';
                ctx.beginPath();
                ctx.moveTo(p.x + TILE_W / 2, p.y);
                ctx.lineTo(p.x + TILE_W, p.y + TILE_H / 2);
                ctx.lineTo(p.x + TILE_W / 2, p.y + TILE_H);
                ctx.lineTo(p.x, p.y + TILE_H / 2);
                ctx.closePath();
                ctx.fill();
                ctx.strokeStyle = ok ? 'rgba(120,255,140,.8)' : 'rgba(255,110,90,.8)';
                ctx.stroke();
            }
        // building preview
        const bimg = this.bldImgs[Game.placing];
        if (bimg) {
            const bm = GAMEDATA.buildingsManifest[Game.placing];
            const c = cellToScreen(cell.x + def.size[0] / 2, cell.y + def.size[1] / 2);
            ctx.globalAlpha = 0.75;
            ctx.drawImage(bimg, 0, 0, bm.w, bm.h, c.x - bm.w / 2, c.y - bm.h + def.size[1] * TILE_H / 2, bm.w, bm.h);
            ctx.globalAlpha = 1;
        }
    },

    _drawEntities(ctx, cam) {
        // painter order by (x+y)
        const ents = Game.entities.slice().sort((a, b) => {
            const da = (a.fx ?? a.x) + (a.fy ?? a.y);
            const db = (b.fx ?? b.x) + (b.fy ?? b.y);
            return da - db;
        });
        for (const e of ents) {
            if (e.isBuilding) this._drawBuilding(ctx, e);
            else if (e.kind === 'infantry') this._drawInfantry(ctx, e);
            else this._drawVehicle(ctx, e);
        }
    },

    _drawBuilding(ctx, b) {
        const img = this.bldImgs[b.bid];
        if (!img) return;
        const bm = GAMEDATA.buildingsManifest[b.bid];
        const def = b.def;
        const c = cellToScreen(b.x + def.size[0] / 2, b.y + def.size[1] / 2);
        const w = bm.w, h = bm.h;
        const dx = c.x - w / 2;
        const dy = c.y - h + def.size[1] * TILE_H / 2 + 2;
        // draw anim frame if present
        const frames = bm.frames || 1;
        ctx.drawImage(img, b.animFrame % frames * w, 0, w, h, dx, dy, w, h);
        // health/flash/selection
        this._entDecor(ctx, b, c.x, c.y + def.size[1] * TILE_H / 2, w);
        // damaged smoke
        if (b.hp < b.maxHp * 0.5 && Math.random() < 0.1) {
            Game.effects.push(new Effect('smoke', b.x + def.size[0] / 2 + rand(-0.5, 0.5), b.y + def.size[1] / 2 + rand(-0.5, 0.5), 1.2));
        }
        // production indicator
        if (b.prodItem && b.owner === Game.playerIndex) {
            ctx.fillStyle = '#38e848';
            ctx.fillRect(dx, dy - 4, w * Math.min(1, b.prodProgress), 3);
        }
        if (b.ironCurtain > 0) {
            ctx.globalAlpha = 0.4 + Math.sin(Game.time * 8) * 0.1;
            ctx.fillStyle = '#c840f0';
            ctx.fillRect(dx, dy - 2, w, 3);
            ctx.globalAlpha = 1;
        }
    },

    _drawInfantry(ctx, u) {
        const img = this.infImgs[u.uid];
        if (!img) return;
        const m = GAMEDATA.infManifest[u.uid];
        if (!m) return;
        const p = cellToScreen(u.fx, u.fy);
        // frame selection: stand/walk/fire sequences are per-facing rows
        let seq = m.stand, idx = 0;
        if (u.state === 'move') { seq = m.walk; idx = (u.facing % 8) * m.walk.per + u.frame; }
        else if (u.state === 'attack' && u.cool > 0.1) { seq = m.fire; idx = u.facing % 8; }
        else { idx = u.facing % 8; }
        const gx = (seq.start + idx) % 8 * m.cw;
        const gy = Math.floor((seq.start + idx) / 8) * m.ch;
        ctx.drawImage(img, gx, gy, m.cw, m.ch, p.x + TILE_W / 2 - m.cw / 2, p.y + TILE_H / 2 - m.ch + 6, m.cw, m.ch);
        this._entDecor(ctx, u, p.x + TILE_W / 2, p.y + TILE_H / 2, m.cw);
    },

    _drawVehicle(ctx, u) {
        const frames = this.unitFrames[u.uid];
        if (!frames) return;
        const img = this.unitsImgs[u.teamColor] || this.unitsImgs['blue'];
        if (!img) return;
        const p = cellToScreen(u.fx, u.fy);
        const b = frames.body;
        const fi = u.facing % 32;
        const f = b.frames[fi];
        const cx = b.x + fi * b.cw + b.cw / 2;
        const cy = b.y + (f.y + f.h / 2);
        let drawY = p.y + TILE_H / 2 - (f.y + f.h / 2) - 2;
        if (u.def.flyer) drawY -= 26 + Math.sin(Game.time * 2 + u.id) * 4; // hover
        ctx.drawImage(img, cx - f.w / 2, b.y + f.y, f.w, f.h,
            p.x + TILE_W / 2 - f.w / 2, drawY, f.w, f.h);
        // turret overlay
        if (frames.turret && u.turretDef !== false) {
            const t = frames.turret;
            const ti = u.turretFacing % 32;
            const tf = t.frames[ti];
            const tcx = t.x + ti * t.cw + t.cw / 2;
            const toff = frames.turretOffsetPx || 0;
            ctx.drawImage(img, tcx - tf.w / 2, t.y + tf.y, tf.w, tf.h,
                p.x + TILE_W / 2 - tf.w / 2, drawY + (f.h - tf.h) / 2 - 2, tf.w, tf.h);
        }
        this._entDecor(ctx, u, p.x + TILE_W / 2, p.y + TILE_H / 2, b.cw);
        // harvester load pips
        if (u.def.harvester && u.harvestAmt > 0) {
            ctx.fillStyle = '#ffd858';
            const n = Math.min(4, Math.ceil(u.harvestAmt / 125));
            for (let i = 0; i < n; i++) ctx.fillRect(p.x + TILE_W / 2 - 8 + i * 5, p.y + TILE_H / 2 + 4, 3, 3);
        }
    },

    _entDecor(ctx, e, sx, sy, w) {
        if (e.selected) {
            // RA2 selection bracket corners
            const hw = Math.max(10, w / 2 - 2), hh = 8;
            ctx.strokeStyle = '#58f878';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            const y = sy - 2;
            // four corner brackets
            const cs = 5;
            ctx.moveTo(sx - hw, y - hh + cs); ctx.lineTo(sx - hw, y - hh); ctx.lineTo(sx - hw + cs, y - hh);
            ctx.moveTo(sx + hw - cs, y - hh); ctx.lineTo(sx + hw, y - hh); ctx.lineTo(sx + hw, y - hh + cs);
            ctx.moveTo(sx + hw, y + hh - cs); ctx.lineTo(sx + hw, y + hh); ctx.lineTo(sx + hw - cs, y + hh);
            ctx.moveTo(sx - hw + cs, y + hh); ctx.lineTo(sx - hw, y + hh); ctx.lineTo(sx - hw, y + hh - cs);
            ctx.stroke();
        }
        if (e.flash > 0) {
            ctx.globalAlpha = e.flash * 4;
            ctx.fillStyle = '#ff5040';
            const r = 12;
            ctx.fillRect(sx - r, sy - r / 2, r * 2, r);
            ctx.globalAlpha = 1;
        }
        // health bar when damaged or selected
        if ((e.hp < e.maxHp || e.selected) && e.hp > 0 && !e.def.wall) {
            const ratio = clamp(e.hp / e.maxHp, 0, 1);
            const bw = 22;
            const y = sy + 10;
            ctx.fillStyle = 'rgba(0,0,0,.6)';
            ctx.fillRect(sx - bw / 2 - 1, y - 1, bw + 2, 5);
            ctx.fillStyle = ratio > 0.6 ? '#48d858' : ratio > 0.3 ? '#e8c840' : '#e05038';
            ctx.fillRect(sx - bw / 2, y, bw * ratio, 3);
        }
    },

    _drawProjectile(ctx, p) {
        const a = cellToScreen(p.x, p.y);
        const b = cellToScreen(p.tx, p.ty);
        if (p.kind === 'tesla') {
            // electric bolt (draw at target when close)
            if (!p.dead) {
                ctx.strokeStyle = 'rgba(140,200,255,.9)';
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.moveTo(a.x + TILE_W / 2, a.y + TILE_H / 2);
                let px = a.x, py = a.y;
                for (const [tx, ty] of p.trail) {
                    const s = cellToScreen(tx, ty);
                    ctx.lineTo(s.x + TILE_W / 2, s.y + TILE_H / 2);
                }
                ctx.lineTo(b.x + TILE_W / 2, b.y + TILE_H / 2);
                ctx.stroke();
            }
        } else if (p.kind === 'prism') {
            ctx.strokeStyle = 'rgba(120,220,255,.85)';
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.moveTo(a.x + TILE_W / 2, a.y + TILE_H / 2 - 8);
            ctx.lineTo(b.x + TILE_W / 2, b.y + TILE_H / 2 - 8);
            ctx.stroke();
        } else {
            // shell with small trail
            ctx.fillStyle = '#ffe8a0';
            ctx.beginPath();
            ctx.arc(a.x + TILE_W / 2, a.y + TILE_H / 2 - 6, 2.4, 0, Math.PI * 2);
            ctx.fill();
            if (p.trail.length) {
                ctx.strokeStyle = 'rgba(255,200,120,.4)';
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                for (let i = 0; i < p.trail.length; i++) {
                    const s = cellToScreen(p.trail[i][0], p.trail[i][1]);
                    if (i === 0) ctx.moveTo(s.x + TILE_W / 2, s.y + TILE_H / 2 - 6);
                    else ctx.lineTo(s.x + TILE_W / 2, s.y + TILE_H / 2 - 6);
                }
                ctx.stroke();
            }
        }
    },

    _drawEffect(ctx, fx) {
        const p = cellToScreen(fx.x, fx.y);
        const cx = p.x + TILE_W / 2, cy = p.y + TILE_H / 2;
        const t = fx.t / fx.ttl;
        if (fx.kind === 'expl') {
            const sizes = { small: 14, vehicle: 20, big: 30, building: 46, nuke: 130 };
            const r = sizes[fx.size] * (0.3 + t * 1.4);
            ctx.globalAlpha = 1 - t;
            const g = ctx.createRadialGradient(cx, cy - 8, 0, cx, cy - 8, r);
            g.addColorStop(0, '#fff8d0');
            g.addColorStop(0.35, '#f8a028');
            g.addColorStop(0.7, '#d04818');
            g.addColorStop(1, 'rgba(60,20,10,0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(cx, cy - 8, r, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1;
        } else if (fx.kind === 'flash') {
            ctx.globalAlpha = (1 - t) * 0.9;
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, Game.canvas.width, Game.canvas.height);
            ctx.globalAlpha = 1;
        } else if (fx.kind === 'mushroom') {
            const r = 60 * (0.5 + t);
            ctx.globalAlpha = 1 - t * 0.8;
            const g = ctx.createRadialGradient(cx, cy - 40, 0, cx, cy - 30, r * 1.8);
            g.addColorStop(0, 'rgba(255,240,200,.9)');
            g.addColorStop(0.5, 'rgba(180,90,40,.7)');
            g.addColorStop(1, 'rgba(60,40,30,0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.ellipse(cx, cy - 34, r * 1.5, r, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1;
        } else if (fx.kind === 'tesla') {
            ctx.strokeStyle = 'rgba(150,210,255,' + (1 - t) + ')';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(cx, cy - 20);
            let x = cx, y = cy - 20;
            for (let i = 0; i < 5; i++) {
                x += rand(-14, 14); y += 8;
                ctx.lineTo(x, y);
            }
            ctx.stroke();
        } else if (fx.kind === 'prismhit') {
            ctx.globalAlpha = 1 - t;
            const r = 16 * (0.4 + t);
            const g = ctx.createRadialGradient(cx, cy - 8, 0, cx, cy - 8, r);
            g.addColorStop(0, '#e8f8ff');
            g.addColorStop(1, 'rgba(80,180,255,0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(cx, cy - 8, r, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1;
        } else if (fx.kind === 'hit') {
            ctx.globalAlpha = 1 - t;
            ctx.fillStyle = '#ffd070';
            ctx.beginPath();
            ctx.arc(cx, cy - 6, 4 * (1 - t * 0.5), 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1;
        } else if (fx.kind === 'smoke') {
            ctx.globalAlpha = (1 - t) * 0.5;
            ctx.fillStyle = '#303038';
            const r = 6 + t * 14;
            const oy = fx.y0 ?? 0;
            ctx.beginPath();
            ctx.arc(cx + Math.sin(fx.t * 2 + fx.x) * 6, cy - 10 - t * 30, r, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1;
        }
    },

    _drawSelectionUI(ctx) {
        // move-target marker
        if (Game.orderMarker && Game.orderMarker.t > 0) {
            const m = Game.orderMarker;
            const p = cellToScreen(m.x, m.y);
            ctx.strokeStyle = 'rgba(88,248,120,' + m.t + ')';
            ctx.lineWidth = 2;
            const r = 12 * (1.5 - m.t);
            ctx.beginPath();
            ctx.ellipse(p.x + TILE_W / 2, p.y + TILE_H / 2, r, r / 2, 0, 0, Math.PI * 2);
            ctx.stroke();
        }
    },

    _drawDragBox(ctx) {
        const m = Game.mouse;
        if (m.dragStart && m.down) {
            ctx.strokeStyle = '#58f878';
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 3]);
            ctx.strokeRect(m.dragStart.x, m.dragStart.y, m.x - m.dragStart.x, m.y - m.dragStart.y);
            ctx.setLineDash([]);
        }
    },

    drawRadar() {
        const rc = Game.radarCtx;
        if (!rc) return;
        const W = Game.radarCanvas.width, H = Game.radarCanvas.height;
        const p = Game.players[Game.playerIndex];
        if (!p.hasRadar) {
            rc.fillStyle = '#060a10';
            rc.fillRect(0, 0, W, H);
            rc.fillStyle = '#3a4a5a';
            rc.font = '10px sans-serif';
            rc.textAlign = 'center';
            rc.fillText('需要 电力+雷达 ', W / 2, H / 2);
            return;
        }
        const sc = Math.min(W / Game.map.w, H / Game.map.h);
        rc.fillStyle = '#0a1420';
        rc.fillRect(0, 0, W, H);
        // terrain
        for (let y = 0; y < Game.map.h; y += 2)
            for (let x = 0; x < Game.map.w; x += 2) {
                const i = Game.map.idx(x, y);
                let col = '#1c4020';
                if (Game.map.water[i]) col = '#103048';
                else if (Game.map.ore[i] || Game.map.gem[i]) col = '#c8a028';
                rc.fillStyle = col;
                rc.fillRect(x * sc, y * sc, 2 * sc, 2 * sc);
            }
        // entities
        for (const e of Game.entities) {
            if (e.dead) continue;
            const friendly = Game.players[e.owner].team === Game.players[Game.playerIndex].team;
            if (!friendly) {
                // enemy only if in explored area
                const i = Game.map.idx(clamp(Math.floor(e.fx ?? e.x), 0, Game.map.w - 1), clamp(Math.floor(e.fy ?? e.y), 0, Game.map.h - 1));
            }
            rc.fillStyle = e.owner === Game.playerIndex ? '#38f858' : (friendly ? '#58a8f8' : '#f84838');
            const ex = (e.fx ?? e.x + (e.isBuilding ? e.w / 2 : 0.5)) * sc;
            const ey = (e.fy ?? e.y + (e.isBuilding ? e.h / 2 : 0.5)) * sc;
            const sz = e.isBuilding ? Math.max(2, e.w * sc) : 2;
            rc.fillRect(ex - sz / 2, ey - sz / 2, sz, sz);
        }
        // viewport rect
        const tl = screenToCell(0, 0, Game.camX, Game.camY);
        const br = screenToCell(Game.canvas.width, Game.canvas.height, Game.camX, Game.camY);
        rc.strokeStyle = 'rgba(255,255,255,.5)';
        rc.lineWidth = 1;
        rc.strokeRect(tl.x * sc, tl.y * sc, (br.x - tl.x) * sc, (br.y - tl.y) * sc);
    },
};

// ============ 侧边栏 ============
const Sidebar = {
    init() {
        this.grid = $('buildGrid');
        this.grid.innerHTML = '';
        this.slots = {};
        document.querySelectorAll('.tab').forEach(t => {
            t.classList.toggle('disabled', !Game.players[Game.playerIndex].prod);
            t.onclick = () => {
                Game.selectedTab = t.dataset.tab;
                document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
                t.classList.add('active');
                this.refresh();
            };
        });
        document.querySelector('.tab[data-tab="buildings"]').classList.add('active');
        $('btnRepair').onclick = () => this.toggleMode('repair');
        $('btnSell').onclick = () => this.toggleMode('sell');
        $('btnPause').onclick = () => Game.paused ? resumeGame() : pauseGame();
    },

    toggleMode(m) {
        Game.mode = Game.mode === m ? 'normal' : m;
        $('btnRepair').classList.toggle('active', Game.mode === 'repair');
        $('btnSell').classList.toggle('active', Game.mode === 'sell');
    },

    refresh() {
        if (!Game.players.length) return;
        const p = Game.players[Game.playerIndex];
        const items = (p.prod[Game.selectedTab] || []).filter(id => {
            const def = GAMEDATA.buildings[id] || GAMEDATA.units[id];
            if (!def) return false;
            return def.techLevel <= 10;
        });
        // build slots
        const keys = new Set(items);
        for (const k in this.slots) {
            if (!keys.has(k)) { this.slots[k].remove(); delete this.slots[k]; }
        }
        for (const id of items) {
            if (this.slots[id]) continue;
            const slot = document.createElement('div');
            slot.className = 'slot';
            const def = GAMEDATA.buildings[id] || GAMEDATA.units[id];
            const cam = Renderer.cameos && Renderer.cameos[id];
            if (Renderer.cameoImg && cam) {
                const im = document.createElement('img');
                im.src = Renderer.cameoImg.src;
                im.style.objectPosition = `-${cam.x}px -${cam.y}px`;
                im.style.width = 'auto';
                im.style.height = 'auto';
                im.style.maxWidth = 'none';
                im.style.transform = 'scale(1.0)';
                slot.appendChild(im);
                // use background instead
                im.remove();
                slot.style.backgroundImage = `url(${Renderer.cameoImg.src})`;
                slot.style.backgroundPosition = `-${cam.x}px -${cam.y}px`;
                slot.style.backgroundRepeat = 'no-repeat';
                slot.style.backgroundSize = 'auto';
            }
            const cost = document.createElement('div');
            cost.className = 'cost';
            cost.textContent = def.cost;
            slot.appendChild(cost);
            const prog = document.createElement('div');
            prog.className = 'prog';
            const fill = document.createElement('div');
            fill.className = 'progfill';
            prog.appendChild(fill);
            slot.appendChild(prog);
            const ready = document.createElement('div');
            ready.className = 'ready';
            slot.appendChild(ready);
            const qc = document.createElement('div');
            qc.className = 'queueCount';
            slot.appendChild(qc);
            slot.onmousemove = ev => this.showTip(ev, id);
            slot.onmouseleave = () => $('tooltip').style.display = 'none';
            slot.onclick = () => this.clickItem(id);
            this.grid.appendChild(slot);
            this.slots[id] = slot;
        }
        // order DOM to match items order
        for (const id of items) {
            if (this.slots[id]) this.grid.appendChild(this.slots[id]);
        }
        this._updateLocks();
    },

    _updateLocks() {
        const p = Game.players[Game.playerIndex];
        const owned = new Set(Game.entities.filter(e => !e.dead && e.isBuilding && e.owner === p.index).map(e => e.bid));
        for (const id in this.slots) {
            const def = GAMEDATA.buildings[id] || GAMEDATA.units[id];
            const prereqOk = (def.prereq || []).every(pr => owned.has(pr) || (pr === 'GATECH' && owned.has('GATECH')));
            const factoryOk = Game.selectedTab === 'buildings' ? true : this._hasFactory(Game.selectedTab);
            this.slots[id].classList.toggle('locked', !prereqOk || !factoryOk);
            this.slots[id]._prereqOk = prereqOk && factoryOk;
        }
    },

    _hasFactory(tab) {
        const p = Game.players[Game.playerIndex];
        const need = tab === 'infantry' ? 'pile' : 'weap';
        return Game.entities.some(e => !e.dead && e.isBuilding && e.owner === p.index &&
            ((need === 'pile' && (e.bid === 'GAPILE' || e.bid === 'NAHAND')) ||
             (need === 'weap' && (e.bid === 'GAWEAP' || e.bid === 'NAWEAP'))));
    },

    showTip(ev, id) {
        const def = GAMEDATA.buildings[id] || GAMEDATA.units[id];
        const tip = $('tooltip');
        let html = `<b>${def.name}</b><br>$ ${def.cost}`;
        if (def.hp) html += ` · 耐久 ${def.hp}`;
        if (def.power) html += ` · 电力 ${def.power > 0 ? '+' : ''}${def.power}`;
        if (def.weapon) html += ` · 伤害 ${def.weapon.damage}`;
        if (def.speed) html += ` · 速度 ${def.speed}`;
        if (def.super) html += ` · 超级武器`;
        tip.innerHTML = html;
        tip.style.display = 'block';
        const bf = $('battlefield').getBoundingClientRect();
        tip.style.left = (ev.clientX - bf.left + 14) + 'px';
        tip.style.top = (ev.clientY - bf.top + 10) + 'px';
    },

    clickItem(id) {
        const slot = this.slots[id];
        if (!slot._prereqOk) {
            
            toast(' prerequisites 前置建筑未满足');
            return;
        }
        const p = Game.players[Game.playerIndex];
        const def = GAMEDATA.buildings[id] || GAMEDATA.units[id];
        // building placement mode (from readyBuilding)
        if (GAMEDATA.buildings[id] && p.readyBuilding === id) {
            Game.placing = id;
            toast('点击战场放置建筑');
            return;
        }
        if (GAMEDATA.buildings[id]) {
            // queue at conyard
            const cyq = Game.entities.find(e => !e.dead && e.isBuilding && e.owner === p.index && e.def.isBase);
            if (!cyq) return;
            const bdef = GAMEDATA.buildings[id];
            const queued = cyq.prodQueue.filter(x => x === id).length + (cyq.prodItem === id ? 1 : 0);
            if (queued >= 1) { toast('该建筑已在队列中'); return; }
            if (p.credits < bdef.cost) { Audio.playEva('EVA_InsufficientFunds'); toast('资金不足'); return; }
            cyq.prodQueue.push(id);
            Audio.playEva('EVA_Building');
            return;
        }
        // queue unit production
        const factory = this._findFactory();
        if (!factory) return;
        const existing = factory.prodQueue.filter(x => x === id).length;
        if ((factory.prodItem === id ? 1 : 0) + existing >= 5) { toast('队列已满'); return; }
        if (p.credits < def.cost) {
            Audio.playEva('EVA_InsufficientFunds');
            toast('资金不足');
            return;
        }
        factory.prodQueue.push(id);
        const mc2 = SoundMap.event('menuclick'); if (mc2) Audio.playThrottled(mc2[0], 250, 0.6);
    },

    _findFactory() {
        const p = Game.players[Game.playerIndex];
        const tab = Game.selectedTab;
        const isB = tab === 'infantry';
        const candidates = Game.entities.filter(e => !e.dead && e.isBuilding && e.owner === p.index &&
            ((isB && (e.bid === 'GAPILE' || e.bid === 'NAHAND')) ||
             (!isB && (e.bid === 'GAWEAP' || e.bid === 'NAWEAP'))));
        return candidates.find(c => c.isPrimary) || candidates[0] || null;
    },

    tick(dt) {
        const p = Game.players[Game.playerIndex];
        if (!p) return;
        // credits display
        $('credits').textContent = '$ ' + Math.floor(p.credits).toLocaleString();
        // power bar
        const ratio = p.powerDrain > 0 ? clamp(p.power / p.powerDrain, 0, 1) : 1;
        const fill = $('powerFill');
        fill.style.width = (ratio * 100) + '%';
        fill.classList.toggle('low', p.power < p.powerDrain);
        $('powerText').textContent = `${p.powerDrain}/${p.power}`;
        // production progress per slot
        const factory = this._findFactory();
        for (const id in this.slots) {
            const slot = this.slots[id];
            const ready = slot.querySelector('.ready');
            const fillEl = slot.querySelector('.progfill');
            const qc = slot.querySelector('.queueCount');
            let count = 0, prog = 0;
            if (factory) {
                if (factory.prodItem === id) prog = Math.min(1, factory.prodProgress);
                count = factory.prodQueue.filter(x => x === id).length + (factory.prodItem === id ? 1 : 0);
            }
            if (GAMEDATA.buildings[id] && p.readyBuilding === id) {
                ready.style.display = 'block';
                fillEl.style.width = '100%';
            } else {
                ready.style.display = 'none';
                fillEl.style.width = (prog * 100) + '%';
            }
            qc.textContent = count > 1 ? '×' + count : '';
        }
        // superweapons
        this._tickSuper();
        // radar
        Renderer.drawRadar();
    },

    _tickSuper() {
        const bar = $('swBar');
        const p = Game.players[Game.playerIndex];
        const sws = Game.entities.filter(e => !e.dead && e.isBuilding && e.owner === p.index && e.def.super);
        if (sws.length !== bar.children.length) {
            bar.innerHTML = '';
            for (const b of sws) {
                const icon = document.createElement('div');
                icon.className = 'swIcon';
                icon.title = b.def.name;
                const cd = document.createElement('div');
                cd.className = 'cd';
                const txt = document.createElement('div');
                txt.className = 'cdTxt';
                icon.appendChild(cd); icon.appendChild(txt);
                icon.onclick = () => Game.armSuper(b);
                bar.appendChild(icon);
                b._swIcon = icon;
            }
        }
        for (const b of sws) {
            if (!b._swIcon) continue;
            b._swIcon.classList.toggle('ready', b.superReady);
            const cd = b._swIcon.querySelector('.cd');
            cd.style.height = ((1 - b.superCharge) * 100) + '%';
            b._swIcon.querySelector('.cdTxt').textContent = b.superReady ? '' :
                Math.ceil((1 - b.superCharge) * SUPER_TIMES[b.def.super]) + 's';
        }
    },
};

// ============ AI ============
class AIController {
    constructor(player, speed) {
        this.p = player;
        this.speed = speed;
        this.t = 0;
        this.buildIdx = 0;
        this.waveT = 40;
        this.waveN = 0;
        this.scoutT = 15;
        this.buildOrder = player.side === 'soviet'
            ? ['NAPOWR', 'NAREFN', 'NAHAND', 'NAWEAP', 'NAPOWR', 'NALASR', 'NARADR', 'NAPOWR', 'TESLA', 'NAWEAP2', 'NAMISL', 'NAPOWR', 'TESLA', 'NAIRON', 'NAWEAP3']
            : ['GAPOWR', 'GAREFN', 'GAPILE', 'GAWEAP', 'GAPOWR', 'GAPILL', 'GAAIRC', 'GAPOWR', 'NASAM', 'ATESLA', 'GATECH', 'GAPOWR', 'ATESLA', 'GACSPH'];
    }

    update(dt) {
        this.t += dt * this.speed;
        if (this.t < 1) return;
        this.t = 0;
        const p = this.p;
        // cleanup dead
        const conyard = Game.entities.find(e => !e.dead && e.isBuilding && e.owner === p.index && e.def.isBase);
        if (!conyard) return;

        // count buildings
        const counts = {};
        for (const e of Game.entities) {
            if (e.dead || !e.isBuilding || e.owner !== p.index) continue;
            counts[e.bid] = (counts[e.bid] || 0) + 1;
        }
        // build next in order
        const step = this.buildOrder[this.buildIdx];
        if (step && !p.readyBuilding) {
            const real = step.replace(/[23]$/, ''); // NAWEAP2 -> NAWEAP
            if (GAMEDATA.buildings[step]) {
                const def = GAMEDATA.buildings[step];
                if (p.credits >= def.cost + 200 && this._hasPrereq(p, def)) {
                    const spot = this._findSpot(def);
                    if (spot) {
                        p.credits -= def.cost;
                        const b = Game.placeBuilding(p.index, step, spot[0], spot[1]);
                        if (def.isRefinery) this.dock = b;
                        this.buildIdx++;
                    }
                }
            } else if (GAMEDATA.buildings[real]) {
                const def = GAMEDATA.buildings[real];
                if (p.credits >= def.cost + 200 && this._hasPrereq(p, def)) {
                    const spot = this._findSpot(def);
                    if (spot) {
                        p.credits -= def.cost;
                        Game.placeBuilding(p.index, real, spot[0], spot[1]);
                        this.buildIdx++;
                    }
                }
            }
        }
        // unit production
        const bld = e => Game.entities.filter(x => !x.dead && x.isBuilding && x.owner === p.index && x.bid === e)[0];
        const barracks = bld(p.side === 'soviet' ? 'NAHAND' : 'GAPILE');
        const factory = bld(p.side === 'soviet' ? 'NAWEAP' : 'GAWEAP');
        if (barracks && !barracks.prodItem && !barracks.prodQueue.length && p.credits > 1200) {
            const inf = p.side === 'soviet' ? ['E2', 'E2', 'SHK', 'DOG', 'E2', 'DESO'] : ['GI', 'GI', 'DOG', 'GI', 'GHOST', 'TANY'];
            barracks.prodQueue.push(choice(inf));
        }
        if (factory && !factory.prodItem && !factory.prodQueue.length && p.credits > 1500) {
            const veh = p.side === 'soviet'
                ? ['HARV', 'HTNK', 'HTNK', 'HTK', 'TTNK', 'APOC', 'V3']
                : ['CMIN', 'MTNK', 'MTNK', 'FV', 'MGTK', 'SREF', 'TNKD'];
            factory.prodQueue.push(choice(veh));
        }
        // defensive use of superweapons
        this._useSuper();
        // attack waves
        this.waveT -= 1 / this.speed;
        if (this.waveT <= 0) {
            this.waveT = 55 - Math.min(30, this.waveN * 2);
            this._launchWave();
            this.waveN++;
        }
        // idle units defend
        this._defend();
    }

    _hasPrereq(p, def) {
        const owned = new Set(Game.entities.filter(e => !e.dead && e.isBuilding && e.owner === p.index).map(e => e.bid));
        return (def.prereq || []).every(pr => owned.has(pr));
    }

    _findSpot(def) {
        const base = Game.entities.find(e => !e.dead && e.isBuilding && e.owner === this.p.index && e.def.isBase);
        const bx = base.x, by = base.y;
        for (let r = 3; r < 16; r++) {
            for (let i = 0; i < 24; i++) {
                const x = bx + randi(-r, r), y = by + randi(-r, r);
                if (Game.canPlace(def.id, x, y)) {
                    // avoid refinery dock blockage
                    if (def.isRefinery && !Game.map.passable(x + def.size[0] - 1, y + def.size[1])) continue;
                    return [x, y];
                }
            }
        }
        return null;
    }

    _launchWave() {
        const units = Game.entities.filter(e => !e.dead && e.isUnit && e.owner === this.p.index &&
            e.def.weapon && !e.def.harvester && !e.def.mcv && !e.def.engineer);
        const attackers = units.slice(0, Math.min(units.length, 4 + this.waveN * 2));
        // target: player buildings (prefer production)
        const targets = Game.entities.filter(e => !e.dead && e.isBuilding && e.owner === Game.playerIndex);
        if (!targets.length || !attackers.length) return;
        const t = choice(targets);
        for (const u of attackers) {
            u.orderAttackMove(t.x, t.y);
        }
    }

    _defend() {
        for (const u of Game.entities) {
            if (u.dead || !u.isUnit || u.owner !== this.p.index || u.state !== 'idle') continue;
            if (!u.def.weapon) continue;
            // enemy near own base?
            const base = Game.entities.find(e => !e.dead && e.isBuilding && e.owner === this.p.index && e.def.isBase);
            if (!base) continue;
            if (dist(u.fx, u.fy, base.x, base.y) < 20) {
                const t = u.findTargetInRange(9);
                if (t) u._engage(t);
            }
        }
    }

    _useSuper() {
        for (const b of Game.entities) {
            if (b.dead || !b.isBuilding || b.owner !== this.p.index || !b.superReady) continue;
            // nuke/chronosphere/iron: aim at player army cluster or base
            const targets = Game.entities.filter(e => !e.dead && e.owner === Game.playerIndex);
            if (!targets.length) continue;
            // cluster: pick building with most neighbors
            let best = null, bn = -1;
            for (const t of targets) {
                if (!t.isBuilding || t.def.wall) continue;
                let n = 0;
                for (const o of targets) if (dist(o.x, o.y, t.x, t.y) < 5) n++;
                if (n > bn) { bn = n; best = t; }
            }
            if (best) {
                if (b.def.super === 'nuclear') Game.fireSuper(b, Math.floor(best.x + best.w / 2), Math.floor(best.y + best.h / 2));
                else if (b.def.super === 'ironcurtain') {
                    // buff own tanks
                    const own = Game.entities.filter(e => !e.dead && e.isUnit && e.owner === this.p.index && e.def.weapon);
                    for (const u of own.slice(0, 9)) u.ironCurtain = 24;
                    b.superReady = false; b.superCharge = 0;
                } else {
                    // chrono: teleport own units near player base
                    const own = Game.entities.filter(e => !e.dead && e.isUnit && e.owner === this.p.index && e.def.weapon && !e.def.flyer);
                    const strike = own.filter(u => dist(u.fx, u.fy, b.x, b.y) > 25).slice(0, 6);
                    for (const u of strike) {
                        u.fx = best.x - 2 + rand(-2, 2); u.fy = best.y - 2 + rand(-2, 2);
                        u.x = Math.floor(u.fx); u.y = Math.floor(u.fy);
                    }
                    b.superReady = false; b.superCharge = 0;
                }
            }
        }
    }
}

// ============ 超级武器 ============
Game.armSuper = function (b) {
    if (!b.superReady) { toast('充能中 ' + Math.ceil((1 - b.superCharge) * SUPER_TIMES[b.def.super]) + ' 秒'); return; }
    Game.armedSuper = b;
    toast(b.def.super === 'nuclear' ? '核弹已瞄准 - 点击目标位置' :
          b.def.super === 'ironcurtain' ? '铁幕已就绪 - 点击己方单位群' : '超时空传送 - 点击己方单位群');
};

Game.fireSuper = function (b, x, y) {
    const kind = b.def.super;
    b.superReady = false;
    b.superCharge = 0;
    if (kind === 'nuclear') {
        // incoming missile animation
        Game.effects.push(new Effect('nukeIncoming', x, y, 2.6));
        Audio.playEva('EVA_NuclearMissileLaunched');
        toast('警告：核弹来袭！');
        setTimeout(() => {
            if (Game.gameOver) return;
            Game.spawnExplosion(x, y, 'nuke');
            // big area damage
            for (const e of Game.entities) {
                if (e.dead) continue;
                const ex = e.fx ?? e.x + (e.isBuilding ? e.w / 2 : 0.5);
                const ey = e.fy ?? e.y + (e.isBuilding ? e.h / 2 : 0.5);
                const d = dist(x, y, ex, ey);
                const r = 5.5;
                if (d < r) {
                    const dmg = 900 * (1 - d / r * 0.75);
                    if (Game.players[e.owner].team !== Game.players[b.owner].team) e.damage(dmg, b);
                    else if (d < r * 0.5) e.damage(dmg * 0.3, b); // friendly边缘伤害
                }
            }
        }, 2600);
    } else if (kind === 'ironcurtain') {
        let n = 0;
        for (const e of Game.entities) {
            if (e.dead || e.owner !== b.owner || !e.isUnit) continue;
            if (dist(e.fx, e.fy, x, y) < 2.6) { e.ironCurtain = 24; n++; }
        }
        Audio.playEva('EVA_IronCurtainActivated');
        toast('铁幕装置启动：' + n + ' 个单位无敌 24 秒');
    } else if (kind === 'chronosphere') {
        let n = 0;
        for (const e of Game.entities) {
            if (e.dead || e.owner !== b.owner || !e.isUnit || e.def.harvester) continue;
            if (dist(e.fx, e.fy, x, y) < 2.6) {
                Game.effects.push(new Effect('chronoflash', e.fx, e.fy, 0.6));
                e.fx = Game.chronoTarget.x + rand(-1, 1);
                e.fy = Game.chronoTarget.y + rand(-1, 1);
                e.x = Math.floor(e.fx); e.y = Math.floor(e.fy);
                e.path = null;
                n++;
            }
        }
        Audio.playEva('EVA_ChronosphereActivated');
        toast('超时空传送完成：' + n + ' 个单位');
    }
};

// ============ 输入 ============
function setupInput() {
    const cv = $('mainCanvas');
    const bf = $('battlefield');

    bf.addEventListener('mousemove', ev => {
        const r = bf.getBoundingClientRect();
        Game.mouse.x = ev.clientX - r.left;
        Game.mouse.y = ev.clientY - r.top;
    });
    bf.addEventListener('mouseleave', () => { Game.mouse.x = -100; Game.mouse.y = -100; });

    bf.addEventListener('mousedown', ev => {
        if (ev.button === 0) {
            if (Game.placing) {
                const cell = screenToCell(Game.mouse.x, Game.mouse.y, Game.camX, Game.camY);
                if (Game.confirmPlace(cell.x, cell.y)) return;
                return;
            }
            if (Game.armedSuper) {
                const cell = screenToCell(Game.mouse.x, Game.mouse.y, Game.camX, Game.camY);
                Game.chronoTarget = cell;
                Game.fireSuper(Game.armedSuper, cell.x, cell.y);
                Game.armedSuper = null;
                return;
            }
            if (Game.mode === 'repair' || Game.mode === 'sell') {
                const cell = screenToCell(Game.mouse.x, Game.mouse.y, Game.camX, Game.camY);
                const b = Game.entities.find(e => !e.dead && e.isBuilding && e.owner === Game.playerIndex &&
                    cell.x >= e.x && cell.x < e.x + e.w && cell.y >= e.y && cell.y < e.y + e.h);
                if (b && !b.def.wall) {
                    if (Game.mode === 'sell') sellBuilding(b);
                    else repairBuilding(b);
                }
                return;
            }
            Game.mouse.down = true;
            Game.mouse.dragStart = { x: Game.mouse.x, y: Game.mouse.y };
        } else if (ev.button === 2) {
            // right click: order / cancel
            if (Game.placing) { Game.placing = null; return; }
            if (Game.armedSuper) { Game.armedSuper = null; return; }
            if (Game.mode !== 'normal') { Sidebar.toggleMode(Game.mode); return; }
            Game.issueOrder(Game.mouse.x, Game.mouse.y);
            const cell = screenToCell(Game.mouse.x, Game.mouse.y, Game.camX, Game.camY);
            Game.orderMarker = { x: cell.x, y: cell.y, t: 1 };
        }
    });

    window.addEventListener('mouseup', ev => {
        if (ev.button !== 0) return;
        if (!Game.mouse.down) return;
        Game.mouse.down = false;
        const ds = Game.mouse.dragStart;
        Game.mouse.dragStart = null;
        if (!ds) return;
        const w = Math.abs(Game.mouse.x - ds.x), h = Math.abs(Game.mouse.y - ds.y);
        if (w < 5 && h < 5) {
            Game.selectAt(Game.mouse.x, Game.mouse.y, ev.shiftKey);
        } else {
            // box select units only
            if (!ev.shiftKey) Game.selection = [];
            const x1 = Math.min(ds.x, Game.mouse.x), x2 = Math.max(ds.x, Game.mouse.x);
            const y1 = Math.min(ds.y, Game.mouse.y), y2 = Math.max(ds.y, Game.mouse.y);
            const c1 = screenToCell(x1, y1, Game.camX, Game.camY);
            const c2 = screenToCell(x2, y2, Game.camX, Game.camY);
            // box in screen space: project each unit
            for (const e of Game.entities) {
                if (e.dead || !e.isUnit || e.owner !== Game.playerIndex) continue;
                const p = cellToScreen(e.fx, e.fy);
                if (p.x + TILE_W / 2 - Game.camX >= x1 && p.x + TILE_W / 2 - Game.camX <= x2 &&
                    p.y + TILE_H / 2 - Game.camY >= y1 && p.y + TILE_H / 2 - Game.camY <= y2) {
                    if (!Game.selection.includes(e)) Game.selection.push(e);
                }
            }
            for (const e of Game.entities) e.selected = Game.selection.includes(e);
            if (Game.selection.length) {
                const u0 = Game.selection.find(u => u.isUnit);
                if (u0) { const v = SoundMap.voice(u0.uid, 'select'); if (v) Audio.playThrottled(choice(v), 250, 0.85); }
            }
            Sidebar.refresh();
        }
    });

    bf.addEventListener('contextmenu', ev => ev.preventDefault());

    // wheel zoom
    bf.addEventListener('wheel', ev => {
        ev.preventDefault();
        const factor = ev.deltaY < 0 ? 0.9 : 1.1;
        const nz = clamp((Game.zoom || 1) * factor, 0.7, 2.2);
        Game.zoom = nz;
        Game.canvas.style.transformOrigin = 'center';
    }, { passive: false });

    window.addEventListener('keydown', ev => {
        Game.keys.add(ev.code);
        if (ev.code === 'KeyH') {
            // superweapon hotkeys handled by icons
        }
        if (ev.code === 'Escape') {
            Game.placing = null;
            Game.armedSuper = null;
            if (Game.mode !== 'normal') Sidebar.toggleMode(Game.mode);
        }
        if (ev.code === 'KeyP') { Game.paused ? resumeGame() : pauseGame(); }
    });
    window.addEventListener('keyup', ev => Game.keys.delete(ev.code));

    // radar click -> jump camera
    $('radar').addEventListener('mousedown', ev => {
        const r = $('radar').getBoundingClientRect();
        const p = Game.players[Game.playerIndex];
        if (!p || !p.hasRadar) return;
        const sc = Math.min(Game.radarCanvas.width / Game.map.w, Game.radarCanvas.height / Game.map.h);
        const mx = (ev.clientX - r.left) * (Game.radarCanvas.width / r.width);
        const my = (ev.clientY - r.top) * (Game.radarCanvas.height / r.height);
        const cx = mx / sc, cy = my / sc;
        const c = cellToScreen(cx, cy);
        Game.camX = c.x - Game.canvas.width / 2;
        Game.camY = c.y - Game.canvas.height / 2;
        Game.clampCam();
    });
}

function sellBuilding(b) {
    const refund = Math.floor((GAMEDATA.buildings[b.bid].cost || 300) * 0.55 * (b.hp / b.maxHp));
    Game.players[Game.playerIndex].credits += refund;
    b.dead = true;
    b.unoccupy();
    Game.effects.push(new Effect('sell', b.x + b.w / 2, b.y + b.h / 2, 0.8));
    const se = SoundMap.event('sell'); if (se) Audio.playThrottled(se[0], 200, 0.8);
    Audio.playEva('EVA_StructureSold');
}

function repairBuilding(b) {
    const p = Game.players[Game.playerIndex];
    const cost = Math.ceil((b.maxHp - b.hp) * 0.25);
    if (b.hp >= b.maxHp) { toast('建筑完好'); return; }
    if (p.credits < 10) { Audio.playEva('EVA_InsufficientFunds'); return; }
    const heal = Math.min(b.maxHp - b.hp, 40);
    b.hp += heal;
    p.credits -= Math.ceil(heal * 0.25);
    const rp = SoundMap.event('repair'); if (rp) Audio.playThrottled(rp[0], 300, 0.6);
}

// ============ 提示 ============
let toastTimer = null;
function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.style.display = 'none', 2600);
}

function pauseGame() {
    Game.paused = true;
    $('pauseMenu').style.display = 'flex';
}
function resumeGame() {
    Game.paused = false;
    $('pauseMenu').style.display = 'none';
}

// ============ 启动 ============
const Audio = new AudioSys();

function collectEssentialAudio() {
    const sm = JSON.parse(JSON.stringify(Assets._soundMap || {}));
    const names = new Set();
    for (const k in sm.weapons || {}) (sm.weapons[k] || []).slice(0, 2).forEach(n => names.add(n));
    for (const k in sm.events || {}) (sm.events[k] || []).slice(0, 2).forEach(n => names.add(n));
    for (const k in sm.die || {}) (sm.die[k] || []).slice(0, 2).forEach(n => names.add(n));
    for (const k in sm.voice || {}) {
        const v = sm.voice[k];
        if (v.select) v.select.slice(0, 2).forEach(n => names.add(n));
        if (v.move) v.move.slice(0, 2).forEach(n => names.add(n));
    }
    return [...names];
}

async function boot() {
    const bar = $('loadBar');
    const setP = v => bar.style.width = v + '%';

    // sound map
    try {
        if (typeof EMBED !== 'undefined' && EMBED['sound_map.json']) {
            Assets._soundMap = JSON.parse(atob(EMBED['sound_map.json']));
        } else {
            const r = await fetch(Assets.baseUrl + 'sound_map.json');
            Assets._soundMap = await r.json();
        }
        SoundMap.init();
    } catch (e) { console.warn('sound map missing'); }
    // images
    const imgs = ['terrain.png', 'overlays.png', 'cameos.png',
                  'units_blue.png', 'units_red.png', 'units_grey.png',
                  'inf_GI.png', 'inf_E2.png', 'inf_ENGINEER.png', 'inf_DOG.png', 'inf_TANY.png',
                  'inf_SHK.png', 'inf_IVAN.png', 'inf_DESO.png', 'inf_YURI.png', 'inf_CLEG.png',
                  'inf_SPY.png', 'inf_GHOST.png', 'inf_DRON.png'];
    let done = 0;
    for (const im of imgs) {
        try { await Assets.loadImage(im); } catch (e) { console.warn('missing img', im); }
        done++;
        setP(done / (imgs.length + 20) * 60);
    }
    // building images
    for (const bid in GAMEDATA.buildingsManifest) {
        try { await Assets.loadImage('bld_' + bid + '.png'); } catch (e) { console.warn('missing bld', bid); }
        done++;
        setP(60 + done / (Object.keys(GAMEDATA.buildingsManifest).length + 30) * 25);
    }
    // audio essentials
    for (const a of collectEssentialAudio()) {
        await Assets.loadAudio('audio/' + a + '.ogg');
    }
    setP(88);
    // EVA files (all sides for player + enemy announcements we only need player's side but load both)
    const evaFiles = new Set();
    for (const ev in GAMEDATA.eva) {
        const m = GAMEDATA.eva[ev];
        if (m.ally) evaFiles.add(m.ally);
        if (m.sov) evaFiles.add(m.sov);
    }
    for (const f of evaFiles) {
        await Assets.loadAudio('audio/' + f + '.ogg');
    }
    setP(96);

    Renderer.init();
    Game.init();
    setupInput();
    setP(100);

    // start screen
    $('loading').classList.add('hidden');
    setTimeout(() => $('loading').style.display = 'none', 600);
    $('startScreen').style.display = 'flex';

    let pickedSide = 'allied';
    let pickedDiff = 'normal';
    document.querySelectorAll('.sideCard').forEach(c => {
        c.onclick = () => {
            document.querySelectorAll('.sideCard').forEach(x => x.style.borderColor = '#2c3c4c');
            c.style.borderColor = c.classList.contains('ally') ? '#4a9af0' : '#e05038';
            pickedSide = c.dataset.side;
        };
    });
    document.querySelectorAll('.diff').forEach(d => {
        d.onclick = () => {
            document.querySelectorAll('.diff').forEach(x => x.classList.remove('sel'));
            d.classList.add('sel');
            pickedDiff = d.dataset.diff;
        };
    });
    $('startBtn').onclick = () => {
        Audio.init();
        $('startScreen').style.display = 'none';
        Game.start(pickedSide, pickedDiff);
    };
    $('btnResume').onclick = resumeGame;
    $('btnRestart').onclick = () => location.reload();
    $('btnAgain').onclick = () => location.reload();

    // main loop (setTimeout keeps running even when page is hidden)
    let last = performance.now();
    function frame() {
        const now = performance.now();
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        try {
            Game.update(dt);
            if (Game.orderMarker) Game.orderMarker.t -= dt * 1.4;
            if (Game.running) Renderer.draw(Game.ctx);
        } catch (e) {
            console.error('frame error:', e);
        }
        setTimeout(frame, 33);
    }
    setTimeout(frame, 33);
}

boot();

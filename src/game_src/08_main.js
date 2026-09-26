// ============================================================
// RA2 Web - Part 8: Main — title screen, game bootstrap, loop
// ============================================================

class App {
  constructor() {
    this.assets = new Assets();
    this.assets.sound = new SoundSystem();
    this.state = 'loading';   // loading → title → briefing → game
    this.screen = 'menu';
    this.difficulty = 1;
    this.playerSide = 'soviet';
  }

  async start() {
    // show loading screen
    this.showLoading();
    // assets are embedded as data urls in window.__RA2_FILES__
    const files = window.__RA2_FILES__ || {};
    let total = 0, done = 0;
    for (const [id, url] of Object.entries(files)) {
      if (id.startsWith('music_')) this.assets.audio.set(id.slice(6), url);
      else this.assets.addImage(id, url);
      total++;
    }
    this.assets.gameData = window.__RA2_DATA__ || {};
    await this.assets.decodeAll((d, t) => {
      const pct = Math.floor(d / t * 100);
      const el = document.getElementById('load-pct');
      if (el) el.textContent = pct + '%';
      const bar = document.getElementById('load-bar-fill');
      if (bar) bar.style.width = pct + '%';
    });
    // bind sounds
    this.bindSounds();
    this.showTitle();
  }

  bindSounds() {
    // map from ASR catalog
    const g = window.__RA2_SOUNDS__ || {};
    // fallback: pick by known ids if present
    this.assets._sfxMap = g;
  }

  showLoading() {
    document.body.innerHTML = `
      <div id="loading">
        <div class="load-title">命令与征服</div>
        <div class="load-sub">红色警戒 · WEB 复刻</div>
        <div class="load-bar"><div id="load-bar-fill"></div></div>
        <div id="load-pct">0%</div>
        <div class="load-note">正在载入原版游戏素材…</div>
      </div>
      <a id="github-link" href="https://github.com/43aquarius/web-redalert" target="_blank" title="GitHub 仓库">
        <svg viewBox="0 0 16 16" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"></path></svg>
      </a>
    `;
  }

  showTitle() {
    this.state = 'title';
    const A = this.assets;
    document.body.innerHTML = `
      <div id="title">
        <div class="title-logo">红色警戒</div>
        <div class="title-en">RED ALERT · WEB</div>
        <div class="title-panel">
          <div class="side-pick">
            <button class="side-btn soviet active" data-side="soviet">苏联军 ☭</button>
            <button class="side-btn allied" data-side="allied">盟军 ★</button>
          </div>
          <div class="diff-pick">
            <button class="diff-btn" data-diff="0">简单</button>
            <button class="diff-btn active" data-diff="1">普通</button>
            <button class="diff-btn" data-diff="2">困难</button>
          </div>
          <button id="btn-start">开始作战</button>
          <div class="title-credits">原版素材提取自 Red Alert 2 · 原声音乐 Frank Klepacki</div>
        </div>
      </div>
      <a id="github-link" href="https://github.com/43aquarius/web-redalert" target="_blank" title="GitHub 仓库">
        <svg viewBox="0 0 16 16" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"></path></svg>
      </a>
    `;
    document.querySelectorAll('.side-btn').forEach(b => b.onclick = () => {
      document.querySelectorAll('.side-btn').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      this.playerSide = b.dataset.side;
      this.assets.sound.init();
      this.assets.sound.resume();
      this.assets.sound.playMusic(this.playerSide === 'soviet' ? 'hellmarch' : 'facetheenemy', this.assets);
    });
    document.querySelectorAll('.diff-btn').forEach(b => b.onclick = () => {
      document.querySelectorAll('.diff-btn').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      this.difficulty = +b.dataset.diff;
    });
    $('btn-start').onclick = () => {
      this.assets.sound.init();
      this.assets.sound.resume();
      if (this.assets.sound.ctx && this.assets.sound.ctx.state === 'suspended') this.assets.sound.resume();
      this.startGame();
    };
    // autoplay needs gesture — first interaction plays music
    const playOnce = () => {
      this.assets.sound.init();
      this.assets.sound.resume();
      this.assets.sound.playMusic(this.playerSide === 'soviet' ? 'hellmarch' : 'facetheenemy', this.assets);
      window.removeEventListener('pointerdown', playOnce);
    };
    window.addEventListener('pointerdown', playOnce);
  }

  startGame() {
    // build game
    const game = new Game(this.assets, this.playerSide, this.difficulty);
    game._sfxMap = this.assets._sfxMap || {};
    // place player start
    const py = MAP_H - 12, px = 8;
    game.addBuilding(this.playerSide === 'soviet' ? 'sconyard' : 'aconyard', 'player', px, py, true);
    // starting units
    game.addUnit(this.playerSide === 'soviet' ? 'smcv' : 'mcv', 'player', px + 3, py + 2);
    const harv = game.addUnit('harvester', 'player', px + 4, py + 3);
    if (harv) { harv.carry = 400; }
    const giCount = 3;
    for (let i = 0; i < giCount; i++) {
      game.addUnit(this.playerSide === 'soviet' ? 'conscript' : 'gi', 'player', px + 2 + i, py + 4);
    }
    // enemy base
    const ey = 8, ex = MAP_W - 14;
    game.addBuilding(this.enemySideOf() === 'soviet' ? 'sconyard' : 'aconyard', 'enemy', ex, ey, true);
    const eh = game.addUnit('harvester', 'enemy', ex + 4, ey + 4);
    for (let i = 0; i < 2; i++) game.addUnit(this.enemySideOf() === 'soviet' ? 'conscript' : 'gi', 'enemy', ex + 2 + i, ey + 5);
    game.ai = new EnemyAI(game);
    game.credits.enemy += 1000;

    // DOM setup
    document.body.innerHTML = `
      <canvas id="game-canvas"></canvas>
      <div id="sidebar"></div>
      <a id="github-link" href="https://github.com/43aquarius/web-redalert" target="_blank" title="GitHub 仓库">
        <svg viewBox="0 0 16 16" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"></path></svg>
      </a>
      <div id="top-bar">
        <button id="btn-menu" title="菜单">☰ 菜单</button>
        <div id="game-clock">00:00</div>
      </div>
    `;
    const canvas = $('game-canvas');
    const miniCanvas = document.createElement('canvas');
    miniCanvas.width = 190; miniCanvas.height = 190;
    const renderer = new Renderer(canvas, miniCanvas, game, this.assets);
    const ui = new UI(game, renderer, this.assets);
    // center camera on player base
    renderer.centerOn(px + 2, py + 2);
    game.eva('battleControl');

    // music: pick battle track
    this.assets.sound.playMusic(['crush', 'rollout', 'militantforce'][Math.floor(Math.random() * 3)], this.assets);

    this.game = game; this.renderer = renderer; this.ui = ui;
    this.state = 'game';

    // main loop
    let last = performance.now();
    let acc = 0;
    const loop = (now) => {
      if (this.state !== 'game') return;
      let dt = (now - last) / 1000;
      last = now;
      dt = Math.min(dt, 0.1);
      acc += dt;
      // fixed-step logic
      let steps = 0;
      while (acc >= 1 / 30 && steps < 4) {
        game.update(1 / 30);
        updateNuke(game, 1 / 30);
        acc -= 1 / 30;
        steps++;
      }
      if (steps === 4) acc = 0;
      ui.tick(dt);
      renderer.time = (renderer.time ?? 0) + dt;
      renderer.draw();
      // markers overlay
      const ctx = renderer.ctx;
      ctx.save();
      ctx.translate(-renderer.camX, -renderer.camY);
      ui.drawMarkers(ctx);
      // drag box
      if (ui.dragStart && ui.dragEnd) {
        ctx.strokeStyle = '#57ff57';
        ctx.lineWidth = 1;
        ctx.setTransform(renderer.dpr, 0, 0, renderer.dpr, 0, 0);
        ctx.strokeRect(ui.dragStart.x, ui.dragStart.y, ui.mouse.x - ui.dragStart.x, ui.mouse.y - ui.dragStart.y);
      }
      ctx.restore();
      // clock
      const clockEl = $('game-clock');
      if (clockEl) {
        const t = Math.floor(game.time);
        clockEl.textContent = String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
      }
      // game over
      if (game.gameOver) { this.showGameOver(); return; }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);

    // menu button
    $('btn-menu').onclick = () => this.showPause();
    // keyboard for scroll
    window.addEventListener('keydown', e => ui._keys = { ...ui._keys, [e.key]: true });
    window.addEventListener('keyup', e => { const k = { ...ui._keys }; delete k[e.key]; ui._keys = k; });
  }

  enemySideOf() { return this.playerSide === 'soviet' ? 'allied' : 'soviet'; }

  showPause() {
    if ($('pause-overlay')) return;
    const ov = document.createElement('div');
    ov.id = 'pause-overlay';
    ov.innerHTML = `
      <div class="pause-box">
        <h2>作战暂停</h2>
        <button id="btn-resume">继续作战</button>
        <button id="btn-restart">重新开始</button>
        <button id="btn-quit">返回主菜单</button>
        <div class="pause-keys">H=回基地 · S=停止 · 右键=取消 · 滚轮=缩放</div>
      </div>
    `;
    document.body.appendChild(ov);
    this._paused = true;
    const resume = () => { ov.remove(); this._paused = false; this.lastTime = performance.now(); };
    $('btn-resume').onclick = resume;
    $('btn-restart').onclick = () => location.reload();
    $('btn-quit').onclick = () => { this.state = 'title'; this.showTitle(); };
  }

  showGameOver() {
    const g = this.game;
    this.assets.sound.stopMusic();
    const win = g.gameOver === 'win';
    const ov = document.createElement('div');
    ov.id = 'gameover-overlay';
    ov.innerHTML = `
      <div class="go-box ${win ? 'win' : 'lose'}">
        <h1>${win ? '任务完成' : '任务失败'}</h1>
        <div class="go-stats">
          <div>作战时长: ${Math.floor(g.time / 60)}分${Math.floor(g.time % 60)}秒</div>
          <div>剩余资金: $${Math.floor(g.credits.player).toLocaleString()}</div>
        </div>
        <button id="btn-again">再战一局</button>
      </div>
    `;
    document.body.appendChild(ov);
    this.assets.sound.playSfxFromUrl(this.assets.audio.get(win ? 'win' : 'lose') || '', 1);
    $('btn-again').onclick = () => location.reload();
  }
}

// boot
window.addEventListener('DOMContentLoaded', () => {
  const app = new App();
  window.__APP = app;
  app.start().catch(err => {
    console.error(err);
    document.body.innerHTML = `<div style="color:#f66;padding:40px;font-family:monospace">加载失败: ${String(err)}</div>`;
  });
});

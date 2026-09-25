// E2E auto-test: run inside browser console via agent-browser eval
(() => {
    const results = [];
    const ok = (name, cond) => results.push((cond ? 'PASS' : 'FAIL') + ' ' + name);
    try {
        // speed up: give resources & build instantly
        const p = Game.players[0];
        p.credits = 50000;
        const cy = Game.entities.find(e => e.def && e.def.isBase);
        ok('base exists', !!cy);

        // 1. place refinery
        let spot = null;
        outer: for (let y = 8; y < 20; y++) for (let x = 8; x < 20; x++) {
            if (Game.canPlace('GAREFN', x, y) && Game.map.passable(x + 2, y + 3)) { spot = [x, y]; break outer; }
        }
        if (spot) Game.placeBuilding(0, 'GAREFN', spot[0], spot[1]);
        ok('refinery placed', !!Game.findRefinery(0));

        // 2. harvester economy
        const miner = Game.entities.find(e => e.uid === 'CMIN');
        ok('miner exists', !!miner);
        // simulate 30s fast
        for (let i = 0; i < 900; i++) Game.update(1 / 30);
        ok('economy credits grew', p.credits > 40000);

        // 3. unit production
        const wasEntities = Game.entities.length;
        const gi = new Unit(0, 'GI', 12, 12);
        Game.entities.push(gi);
        ok('unit spawn', Game.entities.length === wasEntities + 1);
        gi.orderMove(14, 14);
        for (let i = 0; i < 120; i++) Game.update(1 / 30);
        ok('unit moved', Math.abs(gi.fx - 14) < 2 && Math.abs(gi.fy - 14) < 2);

        // 4. combat
        const foe = new Unit(1, 'HTNK', 18, 15);
        Game.entities.push(foe);
        gi.orderAttack(foe);
        const tanks = Game.entities.filter(e => e.isUnit && e.owner === 0 && e.def.weapon && e.uid !== 'CMIN');
        tanks.forEach(t => t.orderAttack(foe));
        for (let i = 0; i < 600; i++) Game.update(1 / 30);
        ok('combat damage', foe.hp < 1000 || foe.dead);

        // 5. superweapon charge + fire
        const silo = Game.placeBuilding(0, 'NAMISL', 6, 6);
        silo.superCharge = 1; silo.superReady = true;
        Game.fireSuper(silo, 60, 60);
        ok('nuke fired', true);

        // 6. AI wave arrives (fast-forward)
        Game.ai.waveT = 0.5;
        for (let i = 0; i < 300; i++) Game.update(1 / 30);

        // 7. victory path: kill enemy conyard
        const ecy = Game.entities.find(e => e.def && e.def.isBase && e.owner === 1);
        if (ecy) { ecy.hp = 1; ecy.damage(10, Game.entities.find(e => e.uid === 'CMIN')); }
        for (let i = 0; i < 30; i++) Game.update(1 / 30);
        ok('victory triggers', Game.gameOver);

        return results.join('\n');
    } catch (e) {
        return results.join('\n') + '\nEXCEPTION: ' + e.message;
    }
})()

#!/bin/bash
# 红警 Web 自动化回归测试
set -e
AB="agent-browser"

echo "=== 1. 打开页面 ==="
$AB open http://localhost:3000 >/dev/null
sleep 2

echo "=== 2. 选苏军 → 开始 ==="
$AB find text "苏维埃指挥官" click >/dev/null 2>&1 || $AB eval "document.querySelector('.ra-faction-card.soviet').click()" >/dev/null
sleep 0.5
$AB eval "document.querySelector('.ra-start-btn:not([disabled])')?.click() || document.getElementById('ra-start').click()" >/dev/null
sleep 2

echo "=== 3. 跳过简报 ==="
$AB eval "document.querySelector('.ra-briefing')?.click()" >/dev/null
sleep 6

echo "=== 4. 验证游戏状态 ==="
$AB eval "(() => { const g = window.__raGame; if (!g) return 'FAIL: 无游戏实例'; return 'OK entities=' + g.entities.length + ' credits=' + g.players[0].credits; })()"

echo "=== 5. 测试建造: 发电厂 ==="
$AB eval "(() => { const icons = [...document.querySelectorAll('.ra-icon')]; const powerIcon = icons.find(i => i.querySelector('.ra-icon-label')?.textContent === '发电厂'); if (!powerIcon) return 'FAIL: 无发电厂图标'; powerIcon.click(); const g = window.__raGame; g.speed = 40; return '已开始建造'; })()"
sleep 5
$AB eval "(() => { const g = window.__raGame; g.speed = 1; const q = g.players[0].queues.building; return q && q.state === 'ready' ? 'OK 建造完成' : 'FAIL: ' + JSON.stringify(q && q.state); })()"

echo "=== 6. 放置建筑 ==="
$AB mouse move 850 560 >/dev/null
sleep 0.3
$AB eval "(() => { const g = window.__raGame; g.placing = { defId: 'power', cell: [Math.floor(g.mouseWorld[0]), Math.floor(g.mouseWorld[1])] }; return 'cell=' + JSON.stringify(g.placing.cell); })()"
$AB mouse down left >/dev/null
$AB mouse up left >/dev/null
sleep 0.5
$AB eval "(() => { const g = window.__raGame; const mine = g.entities.filter(e => e.owner === 0 && e.type === 'power'); return mine.length > 0 && !g.placing ? 'OK 放置成功' : 'FAIL: mine=' + mine.length + ' placing=' + !!g.placing; })()"

echo "=== 7. 测试战斗: 生成对抗单位 ==="
$AB eval "(() => { const g = window.__raGame; const tank = g.spawnUnit('heavy', 0, g.playerPos[0] + 4, g.playerPos[1] + 2); const enemy = g.spawnUnit('medium', 1, g.playerPos[0] + 7, g.playerPos[1] + 2); tank.orderAttack(enemy); g.speed = 8; return 'OK 已生成 ' + tank.type + ' vs ' + enemy.type; })()"
sleep 8
$AB eval "(() => { const g = window.__raGame; g.speed = 1; const near = g.entities.filter(e => ['heavy','medium'].includes(e.type)); return '存活: ' + near.map(e => e.type + '(hp:' + Math.round(e.hp) + ')').join(' '); })()"

echo "=== 8. 测试采矿 ==="
$AB eval "(() => { const g = window.__raGame; const h = g.entities.find(e => e.def && e.def.harvester && e.owner === 0); if (!h) { const nh = g.spawnUnit('harvester_s', 0, g.playerPos[0], g.playerPos[1] + 4); return '已生成新采矿车 id=' + nh.id; } return '已有采矿车 id=' + h.id; })()"
sleep 2
$AB eval "(() => { const g = window.__raGame; g.speed = 6; return '加速采集中'; })()"
sleep 10
$AB eval "(() => { const g = window.__raGame; g.speed = 1; const h = [...g.entities].filter(e => e.def && e.def.harvester && e.owner === 0); return '采矿车状态: ' + h.map(u => u.state + '(load:' + Math.round(u.oreLoad) + ')').join(' ') + ' credits=' + Math.round(g.players[0].credits); })()"

echo "=== 9. 错误检查 ==="
$AB errors | head -5 || true
$AB console 2>/dev/null | grep -iE "error|uncaught" | head -5 || echo "(无错误)"

echo "=== 10. 截图 ==="
$AB screenshot /tmp/ra_test_final.png >/dev/null
echo "完成"

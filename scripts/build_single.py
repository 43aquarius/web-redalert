#!/usr/bin/env python3
"""Build single-HTML redalert2: inline all assets as base64 data URLs."""
import base64
import json
import os
import sys

WEB = '/home/z/my-project/ra2web'
ASSETS = '/home/z/my-project/assets_ra2'
AUDIO = f'{ASSETS}/audio'
OUT = '/home/z/my-project/download/redalert2.html'

# ---- collect audio set ----
sm = json.load(open(f'{ASSETS}/sound_map.json'))
audio_files = set()
for k, v in sm.get('weapons', {}).items():
    audio_files.update((v or [])[:2])
for k, v in sm.get('events', {}).items():
    audio_files.update((v or [])[:2])
for k, v in sm.get('die', {}).items():
    audio_files.update((v or [])[:2])
for k, v in sm.get('voice', {}).items():
    if isinstance(v, dict):
        audio_files.update((v.get('select') or [])[:2])
        audio_files.update((v.get('move') or [])[:2])
    elif isinstance(v, list):
        audio_files.update(v[:2])
# EVA both sides (all events)
for ev, sides in json.load(open(f'{ASSETS}/audio_manifest.json')).get('eva', {}).items():
    for side in ('ally', 'sov'):
        if sides.get(side):
            audio_files.add(sides[side].replace('audio/', '').replace('.ogg', ''))

# ---- collect images ----
images = ['terrain.png', 'overlays.png', 'cameos.png',
          'units_blue.png', 'units_red.png', 'units_grey.png']
for uid in json.load(open(f'{ASSETS}/inf_manifest.json'))['infantry']:
    images.append(f'inf_{uid}.png')
for bid in json.load(open(f'{ASSETS}/bld_manifest.json'))['buildings']:
    images.append(f'bld_{bid}.png')

# ---- build EMBED dict ----
embed = {}
missing = []
for name in images:
    path = f'{ASSETS}/{name}'
    if not os.path.exists(path):
        missing.append(name)
        continue
    b64 = base64.b64encode(open(path, 'rb').read()).decode()
    embed[name] = f'data:image/png;base64,{b64}'

audio_size = 0
for name in sorted(audio_files):
    path = f'{AUDIO}/{name}.ogg'
    if not os.path.exists(path):
        continue
    data = open(path, 'rb').read()
    audio_size += len(data)
    b64 = base64.b64encode(data).decode()
    embed[f'audio/{name}'] = f'data:audio/ogg;base64,{b64}'

sm_b64 = base64.b64encode(json.dumps(sm).encode()).decode()
embed['sound_map.json'] = sm_b64

print(f'images: {len([k for k in embed if k.endswith(".png")])} ({sum(len(v) for k, v in embed.items() if k.endswith(".png")) // 1024 // 1024}MB b64)')
print(f'audio: {len([k for k in embed if k.startswith("audio/")])} files ({audio_size // 1024 // 1024}MB raw)')
if missing:
    print('MISSING:', missing)

# ---- assemble HTML ----
html = open(f'{WEB}/index.html').read()
data_js = open(f'{WEB}/data.js').read()
game_js = open(f'{WEB}/game.js').read()

# strip external script tags, inject embedded
html = html.replace('<script src="data.js"></script>', '')
html = html.replace('<script src="game.js"></script>', '')

embed_js = f'<script>window.EMBED = {json.dumps(embed)};</script>'
combined = f'<script>\n{data_js}\n</script>\n{embed_js}\n<script>\n{game_js}\n</script>'
html = html.replace('</body>', combined + '\n</body>')

os.makedirs(os.path.dirname(OUT), exist_ok=True)
open(OUT, 'w').write(html)
size = os.path.getsize(OUT)
print(f'OUTPUT: {OUT} = {size / 1024 / 1024:.1f} MB')

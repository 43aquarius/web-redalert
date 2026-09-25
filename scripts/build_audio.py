#!/usr/bin/env python3
"""Convert RA2 audio to compact OGG for single-HTML embedding.

sfx: audio.bag (raw IMA ADPCM) + audio.idx -> build WAV header -> ffmpeg ogg
eva: eva-ally/sov mixes (standard IMA ADPCM WAV) -> ffmpeg ogg
Outputs -> /home/z/my-project/assets_ra2/audio/*.ogg + audio_manifest.json
"""
import sys
import os
import json
import struct
import subprocess

sys.path.insert(0, '/home/z/my-project/scripts')
from mix2 import Mix2

CDN = '/home/z/my-project/assets_raw2/cdn'
OUT = '/home/z/my-project/assets_ra2/audio'
TMP = '/home/z/my-project/assets_raw2/audio_tmp'
os.makedirs(OUT, exist_ok=True)
os.makedirs(TMP, exist_ok=True)


def parse_idx(data):
    assert data[:4] == b'GABA'
    ver, n = struct.unpack_from('<II', data, 4)
    entries = {}
    pos = 12
    for i in range(n):
        raw = data[pos:pos + 16]
        pos += 16
        name = raw.split(b'\x00')[0].decode('ascii', 'ignore')
        off, ln, rate, flags, chunk = struct.unpack_from('<IIIII', data, pos)
        pos += 20
        entries[name] = (off, ln, rate, flags, chunk)
    return entries


def build_wav(raw, rate, flags, chunk):
    """Wrap raw IMA ADPCM data into a WAV container (engine-exact)."""
    channels = 2 if (flags & 0x01) else 1
    if (flags & 0x02):  # plain PCM
        hdr = b'RIFF' + struct.pack('<I', len(raw) + 36) + b'WAVEfmt ' + struct.pack(
            '<IHHIIHH', 16, 1, channels, rate, rate * channels * 2, channels * 2, 16
        ) + b'data' + struct.pack('<I', len(raw))
        return hdr + raw
    # IMA ADPCM (flags & 0x08)
    blockAlign = chunk if chunk > 0 else 512
    samplesPerBlock = 1017
    numBlocks = max(2, (len(raw) + blockAlign - 1) // blockAlign)
    totalData = numBlocks * blockAlign
    padding = totalData - len(raw)
    byteRate = 11100 * channels * (rate // 22050)
    out = b'RIFF' + struct.pack('<I', 52 + totalData) + b'WAVEfmt '
    out += struct.pack('<IHHIIHHHH', 20, 17, channels, rate, byteRate, blockAlign, 4, 2, samplesPerBlock)
    out += b'fact' + struct.pack('<II', 4, samplesPerBlock * numBlocks)
    out += b'data' + struct.pack('<I', totalData)
    out += raw + b'\x00' * padding
    return out


def ffmpeg_ogg(src_wav, dst_ogg, bitrate='48k'):
    r = subprocess.run(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error',
                        '-i', src_wav, '-c:a', 'libvorbis', '-b:a', bitrate,
                        '-ar', '22050', '-ac', '1', dst_ogg],
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    return r.returncode == 0 and os.path.getsize(dst_ogg) > 200


def load_sound_events():
    """sound.ini -> {event: [names]} + list of all referenced names."""
    import re
    txt = open('/home/z/my-project/assets_raw2/extracted/sound.ini', encoding='latin-1').read()
    secs = {}
    cur = None
    for ln in txt.splitlines():
        ln = ln.split(';')[0].strip()
        if ln.startswith('[') and ln.endswith(']'):
            cur = ln[1:-1]
            secs[cur] = {}
        elif cur and '=' in ln:
            k, v = ln.split('=', 1)
            secs[cur][k.strip()] = v.strip()
    events = {}
    allnames = set()
    for name, kv in secs.items():
        if name == 'SoundList':
            continue
        lower_kv = {k.lower(): v for k, v in kv.items()}
        if 'sounds' in lower_kv:
            names = []
            for f in lower_kv['sounds'].replace(',', ' ').split():
                f = f.strip().lstrip('$').lower()
                if f and f != 'none':
                    names.append(f)
                    allnames.add(f)
            if names:
                events[name.lower()] = names
    return events, allnames


def main():
    sm = Mix2(f'{CDN}/sounds.mix')
    idx = parse_idx(sm.get('audio.idx'))
    bag = sm.get('audio.bag')
    events, allnames = load_sound_events()
    print('sound events:', len(events), 'names:', len(allnames))

    manifest = {}
    converted = 0
    skipped = 0
    # convert ALL referenced sfx (they're small)
    for name in sorted(allnames):
        if name not in idx:
            skipped += 1
            continue
        off, ln, rate, flags, chunk = idx[name]
        raw = bag[off:off + ln]
        wav = build_wav(raw, rate, flags, chunk)
        tmp_wav = f'{TMP}/{name}.wav'
        open(tmp_wav, 'wb').write(wav)
        dst = f'{OUT}/{name}.ogg'
        if ffmpeg_ogg(tmp_wav, dst):
            converted += 1
        else:
            skipped += 1
        os.unlink(tmp_wav)
    print(f'sfx converted: {converted}, skipped: {skipped}')
    manifest['sfx'] = list(events.keys())

    # EVA: all 222
    eva_events = {}
    txt = open('/home/z/my-project/assets_raw2/extracted/eva.ini', encoding='latin-1').read()
    secs = {}
    cur = None
    for ln in txt.splitlines():
        ln = ln.split(';')[0].strip()
        if ln.startswith('[') and ln.endswith(']'):
            cur = ln[1:-1]
            secs[cur] = {}
        elif cur and '=' in ln:
            k, v = ln.split('=', 1)
            secs[cur][k.strip()] = v.strip()
    eva_map = {}
    for ev, kv in secs.items():
        lower_kv = {k.lower(): v for k, v in kv.items()}
        for side, mix_name, prefix in (('allied', 'eva-ally.mix', 'ally'), ('russian', 'eva-sov.mix', 'sov')):
            if side in lower_kv:
                fn = lower_kv[side].strip().lower()
                eva_map[(prefix, fn)] = ev
    eva_out = {}
    for mix_name, prefix in (('eva-ally.mix', 'ally'), ('eva-sov.mix', 'sov')):
        m = Mix2(f'{CDN}/{mix_name}')
        for h, (o, l) in m.entries.items():
            pass
        for n, (o, l) in m.names.items():
            pass
        # names unknown; probe by eva.ini referenced names
        for (p, fn), ev in eva_map.items():
            if p != prefix:
                continue
            data = m.get(fn + '.wav')
            if not data:
                continue
            dst = f'{OUT}/eva_{prefix}_{fn}.ogg'
            tmp_wav = f'{TMP}/eva_{prefix}_{fn}.wav'
            open(tmp_wav, 'wb').write(data)
            if ffmpeg_ogg(tmp_wav, dst, '40k'):
                eva_out[f'{prefix}_{fn}'] = ev
            os.unlink(tmp_wav)
    print('eva converted:', len(eva_out))
    # build eva event -> file mapping
    eva_event_map = {}
    for key, ev in eva_out.items():
        side = 'ally' if key.startswith('ally_') else 'sov'
        base = key.split('_', 1)[1]
        eva_event_map.setdefault(ev, {})[side] = f'eva_{key}'
    manifest['eva'] = eva_event_map
    json.dump(manifest, open('/home/z/my-project/assets_ra2/audio_manifest.json', 'w'))
    print('manifest saved')


if __name__ == '__main__':
    main()

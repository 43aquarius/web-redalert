#!/bin/bash
# Robust ranged/resumable downloader for wyhjres CDN
OUTDIR="/home/z/my-project/assets_raw2/cdn"
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
REF="https://game.ra2web.com/"
cd "$OUTDIR"
FILES="anims.mix build-gen.mix cameo.mix eva-ally.mix eva-sov.mix ini.mix isosnow.mix isotemp.mix isourb.mix sidec01.mix sidec02.mix sno.mix snow.mix sounds.mix strings.mix tem.mix temperat.mix ui.mix urb.mix urban.mix vxl.mix"
for f in $FILES; do
  [ -f "$f.done" ] && continue
  echo ">>> $f"
  for i in $(seq 1 300); do
    curl -sS -f --max-time 90 -C - -A "$UA" -e "$REF" -o "$f" "https://wyhjres.ra2web.cn/$f" && { touch "$f.done"; break; }
    sleep 2
  done
  if [ -f "$f.done" ]; then echo "    OK $(stat -c%s "$f") bytes"; else echo "    FAILED $f"; fi
done
echo "ALL DONE"

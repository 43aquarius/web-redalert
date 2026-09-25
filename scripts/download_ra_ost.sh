#!/bin/bash
# 下载红警1完整原声带 (Frank Klepacki 1996, EA官方免费发布的游戏原声)
# 来源: archive.org/red_alert_soundtrack-1996
NODE="${NODE:-ia902801}"
OUT="/tmp/ra_assets/ost"
mkdir -p "$OUT"

TRACKS=(
"01. Hell March" "02. Radio" "03. Crush" "04. Roll Out" "05. Mud"
"06. Twin Cannon" "07. Face the Enemy" "08. Run" "09. Terminate" "10. Big Foot"
"11. Workmen" "12. Militant Force" "13. Dense" "14. Vector"
)

ok=0; fail=0
for t in "${TRACKS[@]}"; do
  enc=$(echo "$t" | sed 's/ /%20/g')
  name=$(echo "$t" | tr ' ' '-' | tr 'A-Z' 'a-z')
  dest="$OUT/$name.mp3"
  if [ -s "$dest" ] && file -b "$dest" | grep -qi "audio\|mpeg"; then
    echo "SKIP(exists): $name"
    ok=$((ok+1)); continue
  fi
  for node in "$NODE" ia802801 ia801504 ia601504; do
    timeout 90 curl -s "https://$node.us.archive.org/27/items/red_alert_soundtrack-1996/$enc.mp3" -o "$dest"
    if [ -s "$dest" ] && file -b "$dest" | grep -qi "audio\|mpeg"; then
      echo "OK($node): $name ($(du -h "$dest" | cut -f1))"
      ok=$((ok+1)); break
    fi
  done
  if ! file -b "$dest" 2>/dev/null | grep -qi "audio\|mpeg"; then
    echo "FAIL: $t"; rm -f "$dest"; fail=$((fail+1))
  fi
done
echo "=== 完成: $ok 成功, $fail 失败 ==="

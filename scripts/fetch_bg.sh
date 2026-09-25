#!/bin/bash
# Robust background download with resume + retry
URL="$1"; OUT="$2"
cd "$(dirname "$OUT")"
for i in $(seq 1 200); do
  curl -sL --retry 3 --retry-delay 3 -C - -o "$OUT" "$URL" && break
  echo "retry $i..." >> dl_retry.log
  sleep 3
done
echo "DONE $(date) size=$(stat -c%s "$OUT" 2>/dev/null)" >> dl_retry.log

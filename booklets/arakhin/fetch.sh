#!/bin/bash
# fetch.sh OUTNAME REF VERSION
# Saves one text from Sefaria to raw/OUTNAME.json, unless that file already exists.
# Retries on rate limiting (429) and server errors. Gives up at once on 404 (no such text).
out="raw/$1.json"; [ -s "$out" ] && exit 0
mkdir -p raw
for i in 1 2 3 4; do
  code=$(curl -s --max-time 40 -w '%{http_code}' -G "https://www.sefaria.org/api/v3/texts/$2" \
         --data-urlencode "version=$3" -o "$out")
  if [ "$code" = 200 ]; then sleep 2; exit 0; fi
  rm -f "$out"
  if [ "$code" = 404 ]; then echo "not on Sefaria: $2 ($3)" >&2; sleep 2; exit 1; fi
  echo "HTTP $code for $2, retrying" >&2; sleep $((i * 10))
done
exit 1

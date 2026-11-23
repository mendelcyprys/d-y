#!/bin/bash
# Downloads everything the booklet needs from Sefaria into raw/ (about 150 requests, a few minutes).
# Safe to re-run: files that are already there are kept.
set -e
cd "$(dirname "$0")"
F=./fetch.sh
ROMM="hebrew|Mishnah, ed. Romm, Vilna 1913"

for c in 1 2 3 4 5 6 7 8 9; do
  $F m$c      Mishnah_Arakhin.$c                      "hebrew|Torat Emet 357"   # printed (vocalized)
  $F bart$c   Bartenura_on_Mishnah_Arakhin.$c         "hebrew|Torat-Emet"       # printed
  $F tyt$c    Tosafot_Yom_Tov_on_Mishnah_Arakhin.$c   "$ROMM"                   # read for the notes
  $F yachin$c Yachin_on_Mishnah_Arakhin.$c            "$ROMM"
  $F boaz$c   Boaz_on_Mishnah_Arakhin.$c              "$ROMM" || true           # only chapters 1, 3, 4, 8, 9 exist
  $F rambam$c Rambam_on_Mishnah_Arakhin.$c            "hebrew|Vilna edition"
  $F ms$c     Melekhet_Shelomoh_on_Mishnah_Arakhin.$c "$ROMM"
done

# The verses. v_ is printed (Aleppo-based); w_ is a second edition (Leningrad-based) used only by verify.py.
for r in Leviticus.27 Leviticus.25.8-34 Exodus.21.28-32 Exodus.22.15-16 Deuteronomy.22.13-19 \
         Deuteronomy.22.28-29 Numbers.13.32 Numbers.14.22 Numbers.14.36-37 Numbers.18.14 \
         Leviticus.1.3 Deuteronomy.15.19; do
  n=$(echo "$r" | tr '.-' '__')
  $F "v_$n" "$r" "hebrew|Miqra according to the Masorah"
  $F "w_$n" "$r" "hebrew|Tanach with Ta'amei Hamikra"
done

# Which daf of the Gemara takes up each mishnah (Sefaria's "mishnah in talmud" links).
for c in 1 2 3 4 5 6 7 8 9; do
  if [ ! -s raw/links$c.json ]; then
    curl -s --max-time 60 "https://www.sefaria.org/api/links/Mishnah_Arakhin.$c?with_text=0" -o raw/links$c.json
    sleep 2
  fi
done
python3 -I dafmap.py

# Daf Yomi dates for Arakhin in cycle 14, from the app's own schedule.
node daf-dates.mjs > raw/dafdates.json

echo "done: $(ls raw | wc -l) files in raw/"

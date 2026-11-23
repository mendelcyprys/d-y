#!/bin/bash
# Downloads the fonts (SIL Open Font License, packaged by Fontsource on npm) into fonts/.
#   Frank Ruhl Libre: Mishnah and inline Hebrew.  Noto Rashi Hebrew: Bartenura.
#   Noto Serif Hebrew: the verses (it has the ta'amim).  EB Garamond: English.
set -e
cd "$(dirname "$0")"
mkdir -p fonts && cd fonts
for p in frank-ruhl-libre noto-rashi-hebrew noto-serif-hebrew eb-garamond; do
  dir="fontsource-$p-5.3.0"
  [ -d "$dir" ] && continue
  npm pack --silent "@fontsource/$p@5.3.0" >/dev/null
  mkdir -p "$dir" && tar xzf "$dir.tgz" -C "$dir" && rm "$dir.tgz"
done
ls

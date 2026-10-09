#!/usr/bin/env bash
# Convert DWG/DWT files to DXF (and back) with the ODA File Converter, headless.
#
#   scripts/dwg2dxf.sh <input-dir> <output-dir> [DXF|DWG] [ACAD2018|ACAD2013|ACAD2000|...] [filter]
#
# Defaults: DXF, ACAD2018, "*.dw*". The converter is a Qt GUI binary; it runs under Xvfb here.
# It is installed per machine, not in the repo (free download, EULA, not redistributable):
#   https://www.opendesign.com/guestfiles/oda_file_converter  →  ODAFileConverter_QT6_lnxX64_11dll.AppImage
#   ~/apps/oda-file-converter/ODAFileConverter.AppImage, extracted with --appimage-extract.
# The DXF import in ManualCAD (src/io) reads what it writes; the open-source alternative is LibreDWG's dwg2dxf
# (AUR libredwg-git), which handles the same files with more warnings.
set -euo pipefail

in=${1:?input dir}
out=${2:?output dir}
fmt=${3:-DXF}
ver=${4:-ACAD2018}
filter=${5:-*.dw*}
bin=${ODA_FILE_CONVERTER:-$HOME/apps/oda-file-converter/squashfs-root/AppRun}

if [ ! -x "$bin" ]; then
  echo "ODA File Converter not found at $bin (set ODA_FILE_CONVERTER)" >&2
  exit 1
fi
mkdir -p "$out"
if command -v xvfb-run >/dev/null; then
  xvfb-run -a "$bin" "$(realpath "$in")" "$(realpath "$out")" "$ver" "$fmt" 0 1 "$filter"
else
  "$bin" "$(realpath "$in")" "$(realpath "$out")" "$ver" "$fmt" 0 1 "$filter"
fi
ls -la "$out"

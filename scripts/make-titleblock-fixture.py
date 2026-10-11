"""Write samples/synthetic/titleblock-bbrz-r2018.dxf and titleblock-bbrz-small-r2018.dxf: the BBRZ title block
drawings (samples/bbrz-dxf) used as blocks and inserted into a paper-space layout the way a student drawing does
(attributes filled in), the large one with the BBRZ parts list block and two extension rows above it.
Run with ezdxf:  ~/apps/ezdxf-venv/bin/python scripts/make-titleblock-fixture.py
"""
from pathlib import Path

import ezdxf
from ezdxf.addons import Importer

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "samples" / "bbrz-dxf"
OUT = ROOT / "samples" / "synthetic"


def block_from(doc, drawing: str, name: str) -> None:
    src = ezdxf.readfile(SRC / drawing)
    blk = doc.blocks.new(name)
    imp = Importer(src, doc)
    imp.import_entities(list(src.modelspace()), blk)
    imp.finalize()


def sheet(width: float, height: float):
    doc = ezdxf.new("R2018", setup=True)
    doc.header["$INSUNITS"] = 4
    msp = doc.modelspace()
    # a part: 80 x 40 plate with a bore
    msp.add_lwpolyline([(0, 0), (80, 0), (80, 40), (0, 40)], close=True)
    msp.add_circle((40, 20), 8)
    doc.layouts.rename("Layout1", "Blatt")  # the active layout, which the importer reads
    layout = doc.layouts.get("Blatt")
    layout.page_setup(size=(width, height), margins=(0, 0, 0, 0), units="mm")
    layout.add_viewport(center=(width / 2, height / 2 + 20), size=(120, 80), view_center_point=(40, 20), view_height=80)
    return doc, layout


# large title block on A3 landscape, parts list above it
doc, layout = sheet(420, 297)
block_from(doc, "A4 bis A0_PLR_m_SK_BBRZ.dxf", "A4 bis A0_PLR_m_SK_BBRZ")
block_from(doc, "Stückliste_BBRZ.dxf", "Stückliste_BBRZ")
block_from(doc, "Stückliste_Erweiterung_BBRZ.dxf", "Stückliste_Erweiterung_BBRZ")
ref = layout.add_blockref("A4 bis A0_PLR_m_SK_BBRZ", (420, 0))
ref.add_auto_attribs(
    {
        "ZEICHNUNGNR.": "ZA 38",
        "TITEL_BENENNUNG": "Gabelgelenk",
        "MAßSTAB": "1:1",
        "NEBENMAßSTAB": "2:1",
        "KLASSE": "JET MZ_1_2",
        "TOLERANZ": "m",
        "GEZ-NAME": "Muster",
        "GEPR-TAG": "",
        "GEPR-NAME": "",
        "PLOT-TAG": "----",
        "DOKU_ART": "Zusammenbauzeichnung",
    }
)
# the parts list sits on the title block (51 mm high), its right edge on the frame
ref = layout.add_blockref("Stückliste_BBRZ", (410, 61))
ref.add_auto_attribs({"TEIL1": "1", "ZEICHNUNGSNUMMER": "ZA 38-1", "TEIL1-STÜCK": "1", "TEIL1-BENENNUNG": "Gabel", "TEIL1-WERKSTOFF/NORMKBZ": "S235JR"})
# extension rows inserted top-down on purpose: the importer orders rows by height, row 1 lowest
ref = layout.add_blockref("Stückliste_Erweiterung_BBRZ", (410, 81))
ref.add_auto_attribs({"TEIL": "3", "TEIL-STÜCK": "2", "TEIL-BENENNUNG": "Sicherungsring", "TEIL-WERKSTOFF/NORMKBZ": "DIN 471 - 12x1"})
ref = layout.add_blockref("Stückliste_Erweiterung_BBRZ", (410, 75))
ref.add_auto_attribs({"TEIL": "2", "ZEICHNUNGSNUMMER": "ZA 38-2", "TEIL-STÜCK": "1", "TEIL-BENENNUNG": "Bolzen", "TEIL-WERKSTOFF/NORMKBZ": "C45"})
doc.saveas(OUT / "titleblock-bbrz-r2018.dxf")
print("wrote", OUT / "titleblock-bbrz-r2018.dxf")

# small school title block on A4 portrait
doc, layout = sheet(210, 297)
block_from(doc, "A4-PLR_m_kleinem_SK_BBRZ-MB.dxf", "A4-PLR_m_kleinem_SK_BBRZ-MB")
ref = layout.add_blockref("A4-PLR_m_kleinem_SK_BBRZ-MB", (0, 0))
ref.add_auto_attribs({"NAME": "Muster", "BLATT-NR": "3", "DATUM": "11.10.2026", "BENENNUNG": "Grundplatte", "KLASSE": "JET MZ_1_2"})
doc.saveas(OUT / "titleblock-bbrz-small-r2018.dxf")
print("wrote", OUT / "titleblock-bbrz-small-r2018.dxf")

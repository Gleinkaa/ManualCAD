"""Write samples/synthetic/symbols-bbrz-r2018.dxf: the two BBRZ symbol drawings (samples/bbrz-dxf) used as blocks,
inserted the way a student drawing inserts them (attributes filled in), plus one block edited down to the
removal-required variant. Run with ezdxf:  ~/apps/ezdxf-venv/bin/python scripts/make-symbol-fixture.py
"""
from pathlib import Path

import ezdxf
from ezdxf.addons import Importer

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "samples" / "bbrz-dxf"
OUT = ROOT / "samples" / "synthetic" / "symbols-bbrz-r2018.dxf"

doc = ezdxf.new("R2018", setup=True)
doc.header["$INSUNITS"] = 4
msp = doc.modelspace()


def block_from(drawing: str, name: str, keep=lambda e: True) -> None:
    src = ezdxf.readfile(SRC / drawing)
    blk = doc.blocks.new(name)
    imp = Importer(src, doc)
    imp.import_entities([e for e in src.modelspace() if keep(e)], blk)
    imp.finalize()
    # the Importer skips MULTILEADER: copy the BBRZ multileader's leader line in as one with the same vertices
    for ml in src.modelspace().query("MULTILEADER"):
        if not keep(ml):
            continue
        for leader in ml.context.leaders:
            for line in leader.lines:
                pts = [v.vec2 for v in line.vertices] + [leader.last_leader_point.vec2]
                blk.add_leader(pts, dxfattribs={"layer": ml.dxf.layer})


# the surface symbol as it comes, and a copy cut down to the V, the removal bar and the attributes
block_from("Oberflächenzeichen_BBRZ.dxf", "Oberflächenzeichen_BBRZ")
block_from(
    "Oberflächenzeichen_BBRZ.dxf",
    "Oberflächenzeichen_abtragend",
    lambda e: e.dxftype() in ("LWPOLYLINE", "ATTDEF"),
)
block_from("Kegel-Keil-Verhältnis_BBRZ.dxf", "Kegel-Keil-Verhältnis_BBRZ")

msp.add_line((0, 0), (100, 0), dxfattribs={"layer": "0"})
msp.add_line((100, 0), (100, 40), dxfattribs={"layer": "0"})

ref = msp.add_blockref("Oberflächenzeichen_abtragend", (30, 0))
ref.add_auto_attribs({"RAUHEIT": "Ra 3,2", "Oberflächenbehandlung optional": "geschliffen", "FERTIGUNGSRIEFEN": "="})

ref = msp.add_blockref("Oberflächenzeichen_BBRZ", (100, 20), dxfattribs={"rotation": 90})
ref.add_auto_attribs({"RAUHEIT": "Rz 25"})

ref = msp.add_blockref("Kegel-Keil-Verhältnis_BBRZ", (60, 0))
ref.add_auto_attribs({"KKV": "1:5"})

doc.saveas(OUT)
print("wrote", OUT)

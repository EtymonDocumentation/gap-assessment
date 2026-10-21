"""Makes the website pictures in apps/web/public/art/ from the review copies (1600 px webp) kept outside the repository.

Usage: python scripts/make-site-art.py <folder with <key>.webp files>

Two widths per picture (1600 and 800, quality 75) for srcset. Saving through a fresh image without exif/icc/xmp keeps every
metadata chunk out of the files; the check at the end fails if any marker is still found (provenance data such as C2PA
must not ship with a GMP-adjacent proof of concept, and the pictures are fictional AI output).
"""
import os, sys
from PIL import Image

KEYS = """page-home-hero-alt1 page-signin page-interview page-compare-v2 page-register page-validation page-document page-templates
page-guidance page-builder page-sources page-changes page-mapping uo-ds-receipt-thaw uo-buffer-prep uo-compounding uo-bbr-filtration
uo-sterile-filtration uo-aseptic-filling uo-stoppering-lyo uo-capping uo-visual-inspection uo-labeling-packaging uo-bulk-packaging
uo-storage-shipping uo-buffer-thaw uo-dilution uo-mixing-bag uo-mixing-bag-closeup uo-mixing-tank uo-filtration-assembly
uo-filter-housing uo-pupsit""".split()

src = sys.argv[1]
out = os.path.join(os.path.dirname(__file__), "..", "apps", "web", "public", "art")
os.makedirs(out, exist_ok=True)
total = 0
for key in KEYS:
    im = Image.open(os.path.join(src, key + ".webp")).convert("RGB")
    for w in (1600, 800):
        h = round(im.height * w / im.width)
        r = im.resize((w, h), Image.LANCZOS) if w != im.width else im
        clean = Image.new("RGB", r.size)
        clean.putdata(list(r.getdata()))
        # The file name drops the "-alt1" / "-v2" suffix: the site refers to a picture by what it shows, not by its draft number.
        name = key.replace("-alt1", "").replace("-v2", "")
        path = os.path.join(out, f"{name}-{w}.webp")
        clean.save(path, "WEBP", quality=75, method=6)
        total += os.path.getsize(path)
bad = 0
for f in os.listdir(out):
    if not f.endswith(".webp"):
        continue
    b = open(os.path.join(out, f), "rb").read()
    for m in (b"Exif", b"EXIF", b"XMP", b"c2pa", b"jumb", b"ICCP"):
        if m in b:
            bad += 1
            print("MARKER", m, f)
print(len(KEYS) * 2, "files,", total, "bytes,", bad, "marker hits")
sys.exit(1 if bad else 0)

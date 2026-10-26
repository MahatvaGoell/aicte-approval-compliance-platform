"""Offline fixture authoring/QA only; deliberately contains no expiry-date parser or OCR."""
import argparse
import hashlib
import importlib.metadata
import io
import json
import math
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

from PIL import Image, ImageDraw, ImageEnhance
from pypdf import PdfReader
import pdfplumber
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfgen import canvas

from definitions import FIXTURES, TEMPLATES

ROOT = Path(__file__).resolve().parents[3]
DATASET = ROOT / "server/fixtures/extraction"
QA = ROOT / "var/extraction-qa"
SIZE = (600, 840)  # PDF points; exact 1200 x 1680 pixels at 144 dpi.
FONT_SIZE = 12
NOTICE = "SYNTHETIC TEST DOCUMENT - NOT AN OFFICIAL CERTIFICATE"


def owned_directory(path, expected):
    """Only fixed repository-owned directories; never recursively delete/move anything."""
    if path.is_symlink() or path.resolve() != expected:
        raise ValueError(f"Unsafe output directory: {path}")
    for parent in path.parents:
        if parent == ROOT:
            break
        if parent.is_symlink():
            raise ValueError(f"Symlink output ancestor: {parent}")
    path.mkdir(parents=True, exist_ok=True)


def poppler():
    command = shutil.which("pdftoppm")
    if not command:
        raise RuntimeError("pdftoppm (Poppler) must be on PATH; see docs/EXTRACTION_DATASET.md")
    return command


def rasterize(pdf, prefix, dpi=144):
    subprocess.run([poppler(), "-r", str(dpi), "-png", str(pdf), str(prefix)], check=True, capture_output=True)
    return sorted(prefix.parent.glob(prefix.name + "-*.png"), key=lambda p: int(p.stem.rsplit("-", 1)[1]))


def text_box(text, font, x, baseline_top):
    ascent, descent = pdfmetrics.getAscentDescent(font, FONT_SIZE)
    return [x, baseline_top - ascent, x + pdfmetrics.stringWidth(text, font, FONT_SIZE), baseline_top - descent]


def rotate_box(box, degrees):
    # Pillow rotate(+angle) is counter-clockwise. Coordinates here have a top-left origin.
    angle = math.radians(degrees)
    points = []
    for x, y in [(box[0], box[1]), (box[2], box[1]), (box[2], box[3]), (box[0], box[3])]:
        dx, dy = x - SIZE[0] / 2, y - SIZE[1] / 2
        points.append((SIZE[0] / 2 + math.cos(angle) * dx + math.sin(angle) * dy,
                       SIZE[1] / 2 - math.sin(angle) * dx + math.cos(angle) * dy))
    return [min(p[0] for p in points), min(p[1] for p in points), max(p[0] for p in points), max(p[1] for p in points)]


def author_pdf(spec):
    buffer = io.BytesIO()
    c = canvas.Canvas(buffer, pagesize=SIZE, pageCompression=1, invariant=1)
    title, font, top, leading, style = TEMPLATES[spec["templateFamily"]]
    c.setTitle(f"Synthetic {spec['id']} - {title}")
    c.setAuthor("Team Infera synthetic dataset")
    c.setSubject("Fictional local test document; no regulatory authority")
    candidates = []
    for page_number, lines in enumerate(spec["pages"], 1):
        c.setFillColorRGB(.08, .14, .21)
        if style == "band":
            c.rect(0, 700, 600, 140, fill=1, stroke=0)
            c.setFillColorRGB(1, 1, 1)
        c.setFont("Helvetica-Bold", 10)
        c.drawString(42, 806, "TEAM INFERA / FICTIONAL RECORDS OFFICE")
        c.setFont("Helvetica-Bold", 18)
        c.drawString(42, 768, title)
        c.setFont("Helvetica", 9)
        c.drawString(42, 741, NOTICE)
        c.setFillColorRGB(.08, .14, .21)
        c.setFont("Helvetica", 10)
        c.drawString(42, 674, f"Document ID: DEMO-{spec['id'].upper()}  |  Page {page_number} of {len(spec['pages'])}")
        if style == "box":
            c.setStrokeColorRGB(.35, .45, .55)
            box_top, box_bottom = top - 20, top + max(6, len(lines)) * leading + 20
            c.rect(40, SIZE[1] - box_bottom, 520, box_bottom - box_top, fill=0)
        if style == "letter":
            c.setLineWidth(1.2)
            c.line(42, 704, 558, 704)
        for index, entry in enumerate(lines):
            line = entry if isinstance(entry, str) else entry["text"]
            baseline_top = top + leading * index
            if pdfmetrics.stringWidth(line, font, FONT_SIZE) > 480 or baseline_top > 690:
                raise ValueError(f"Source line does not fit {spec['id']}: {line}")
            if style == "grid":
                c.setStrokeColorRGB(.8, .83, .86)
                c.line(48, SIZE[1] - baseline_top - 10, 552, SIZE[1] - baseline_top - 10)
            c.setFont(font, FONT_SIZE)
            c.drawString(58, SIZE[1] - baseline_top, line)
            for label in entry.get("dates", []) if isinstance(entry, dict) else []:
                if line.count(label["text"]) != 1:
                    raise ValueError("Date anchors must be exact and unique in their source line")
                offset = line.index(label["text"])
                x = 58 + pdfmetrics.stringWidth(line[:offset], font, FONT_SIZE)
                degrees = spec["scan"]["rotationDegrees"] if spec["kind"] == "scan" else 0
                candidates.append({**label, "page": page_number, "excerpt": line,
                                   "bbox": [round(v, 3) for v in rotate_box(text_box(label["text"], font, x, baseline_top), degrees)],
                                   "excerptBbox": [round(v, 3) for v in rotate_box(text_box(line, font, 58, baseline_top), degrees)]})
        c.setFont("Helvetica", 9)
        c.drawString(42, 88, "Fictional issuer signature: DEMO RECORDS DESK")
        c.drawString(42, 64, "Synthetic data only. This document grants no approval or entitlement.")
        c.drawRightString(558, 38, f"{spec['id']} / {page_number}")
        c.showPage()
    c.save()
    return buffer.getvalue(), candidates


def build_fixture(spec, scratch):
    text_bytes, candidates = author_pdf(spec)
    if spec["kind"] == "text":
        return text_bytes, candidates
    original = scratch / (spec["id"] + "-source.pdf")
    original.write_bytes(text_bytes)
    images = rasterize(original, scratch / spec["id"])
    output = io.BytesIO()
    c = canvas.Canvas(output, pagesize=SIZE, invariant=1, pageCompression=1)
    c.setTitle(f"Synthetic {spec['id']} image-only scan")
    c.setAuthor("Team Infera synthetic dataset")
    for path in images:
        with Image.open(path) as source:
            image = source.convert("RGB")
        image = ImageEnhance.Contrast(image).enhance(spec["scan"]["contrast"])
        image = image.rotate(spec["scan"]["rotationDegrees"], resample=Image.Resampling.BICUBIC, fillcolor="white")
        # Only raster XObjects are painted; no invisible text, OCR layer or source PDF is embedded.
        c.drawImage(ImageReader(image), 0, 0, width=SIZE[0], height=SIZE[1])
        c.showPage()
    c.save()
    return output.getvalue(), candidates


def generate():
    owned_directory(DATASET, ROOT / "server/fixtures/extraction")
    owned_directory(DATASET / "pdfs", ROOT / "server/fixtures/extraction/pdfs")
    owned_directory(ROOT / "var", ROOT / "var")
    fixtures, outputs = [], {}
    with tempfile.TemporaryDirectory(prefix="extraction-generate-", dir=ROOT / "var") as temp:
        for spec in FIXTURES:
            pdf, candidates = build_fixture(spec, Path(temp))
            relative = "pdfs/" + spec["id"] + ".pdf"
            outputs[relative] = pdf
            fixtures.append({"id": spec["id"], "file": relative, "kind": spec["kind"],
                             "templateFamily": spec["templateFamily"], "split": spec["split"], "tags": spec["tags"],
                             "pageCount": len(spec["pages"]), "pageSize": list(SIZE), "expected": spec["expected"],
                             "candidates": candidates, "scan": spec["scan"] if spec["kind"] == "scan" else None,
                             "sha256": hashlib.sha256(pdf).hexdigest(), "bytes": len(pdf)})
    manifest = {"schemaVersion": 1, "synthetic": True, "provenance": "DEMO_ASSUMPTION",
                "coordinateSystem": {"origin": "TOP_LEFT", "unit": "PDF_POINT", "bbox": "x0,y0,x1,y1", "pageIndexBase": 1},
                "generation": {"fixedDates": True, "pdfInvariant": True, "scanDpi": 144,
                               "packages": {p: importlib.metadata.version(p) for p in ["reportlab", "Pillow", "pypdf", "pdfplumber"]}},
                "fixtures": fixtures}
    outputs["expected.json"] = (json.dumps(manifest, indent=2, ensure_ascii=True) + "\n").encode()
    return outputs


def check():
    manifest = json.loads((DATASET / "expected.json").read_text())
    expected_files = {f["file"] for f in manifest["fixtures"]}
    actual_files = {p.relative_to(DATASET).as_posix() for p in (DATASET / "pdfs").glob("*")}
    if actual_files != expected_files:
        raise ValueError("Dataset files do not match manifest exactly")
    pages = 0
    for fixture in manifest["fixtures"]:
        path = DATASET / fixture["file"]
        data = path.read_bytes()
        assert hashlib.sha256(data).hexdigest() == fixture["sha256"], path
        assert len(data) == fixture["bytes"], path
        reader = PdfReader(path, strict=True)
        assert not reader.is_encrypted and len(reader.pages) == fixture["pageCount"], path
        assert not reader.get_fields() and not reader.attachments, path
        with pdfplumber.open(path) as doc:
            for number, page in enumerate(reader.pages, 1):
                pages += 1
                assert not page.get("/Annots") and not page.get("/AA"), path
                assert [float(page.mediabox.width), float(page.mediabox.height)] == list(SIZE), path
                text = page.extract_text().strip()
                if fixture["kind"] == "scan":
                    assert not text and len(page.images) == 1, f"Scan must have one image and zero text: {path}"
                else:
                    assert NOTICE in text and fixture["id"] in text, path
                    for label in [d for d in fixture["candidates"] if d["page"] == number]:
                        assert label["excerpt"] in text, path
                        hits = doc.pages[number - 1].search(re.escape(label["text"]))
                        assert any(abs(hit["x0"] - label["bbox"][0]) < 1 and abs(hit["x1"] - label["bbox"][2]) < 1
                                   and abs(hit["top"] - label["bbox"][1]) < 4 for hit in hits), f"Bad date rectangle: {path} {label}"
    return {"pdfs": len(manifest["fixtures"]), "pages": pages,
            "text": sum(f["kind"] == "text" for f in manifest["fixtures"]),
            "scan": sum(f["kind"] == "scan" for f in manifest["fixtures"])}


def visual_qa():
    owned_directory(QA, ROOT / "var/extraction-qa")
    manifest = json.loads((DATASET / "expected.json").read_text())
    thumbs = []
    for fixture in manifest["fixtures"]:
        paths = rasterize(DATASET / fixture["file"], QA / fixture["id"], dpi=144)
        assert len(paths) == fixture["pageCount"], "Stale QA pages; use a clean, verified var/extraction-qa directory"
        for number, path in enumerate(paths, 1):
            with Image.open(path) as source:
                image = source.convert("RGB")
            # Check labelled scan regions still contain ink after contrast/rotation and embedding.
            for label in [d for d in fixture["candidates"] if d["page"] == number]:
                box = [int(v * 2) for v in label["bbox"]]
                assert image.crop(box).convert("L").getextrema()[0] < 230, f"Blank labelled region: {path}"
            image.thumbnail((400, 560))
            thumb = Image.new("RGB", (400, 592), "#e5e7eb")
            thumb.paste(image, (0, 26))
            ImageDraw.Draw(thumb).text((8, 5), f"{fixture['id']} / page {number} / {fixture['kind']}", fill="black")
            thumbs.append(thumb)
    for start in range(0, len(thumbs), 6):
        sheet = Image.new("RGB", (1200, 1184), "#e5e7eb")
        for index, thumb in enumerate(thumbs[start:start + 6]):
            sheet.paste(thumb, ((index % 3) * 400, (index // 3) * 592))
        sheet.save(QA / f"contact-{start // 6 + 1:02}.png")
    print(f"Rendered {len(thumbs)} pages. Inspect contact sheets and full pages in {QA}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["generate", "check", "verify", "qa"], default="check", nargs="?")
    command = parser.parse_args().command
    if command in {"generate", "verify"}:
        outputs = generate()
        for relative, data in outputs.items():
            target = DATASET / relative
            if target.is_symlink() or target.resolve().parent not in {DATASET, DATASET / "pdfs"}:
                raise ValueError(f"Unsafe fixture target: {target}")
            if command == "generate":
                target.write_bytes(data)
            elif not target.exists() or target.read_bytes() != data:
                raise ValueError(f"Reproduction mismatch: {relative}; check documented toolchain versions")
    summary = check()
    if command == "qa":
        visual_qa()
    print(json.dumps({"command": command, **summary, "status": "PASS", "extractionAccuracy": "NOT_MEASURED"}))


if __name__ == "__main__":
    main()

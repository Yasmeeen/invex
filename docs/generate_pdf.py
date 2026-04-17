#!/usr/bin/env python3
"""Build docs/PLATFORM_DOCUMENTATION.pdf from PLATFORM_DOCUMENTATION_COMPLETE.md (requires fpdf2 + Arial Unicode)."""
from pathlib import Path

from fpdf import FPDF

FONT = "/Library/Fonts/Arial Unicode.ttf"


def simplify(line: str) -> str:
    line = line.rstrip()
    if "|" in line and set(line.strip()) <= {"|", "-", " ", "\t"}:
        return ""
    if line.startswith("#"):
        line = line.lstrip("#").strip()
    line = line.replace("**", "")
    if line.startswith("|"):
        line = line.replace("|", " · ")
    return line


def main() -> None:
    root = Path(__file__).resolve().parent
    src = root / "PLATFORM_DOCUMENTATION_COMPLETE.md"
    out = root / "PLATFORM_DOCUMENTATION.pdf"
    text = src.read_text(encoding="utf-8")

    pdf = FPDF(format="A4")
    pdf.set_margins(12, 14, 12)
    pdf.set_auto_page_break(auto=True, margin=14)
    pdf.add_page()
    pdf.add_font("uni", fname=FONT)
    pdf.set_font("uni", size=9)
    col_w = pdf.w - pdf.l_margin - pdf.r_margin

    for line in text.splitlines():
        s = simplify(line)
        # Normalize narrow/special hyphens that can break line breaking
        s = s.replace("\u2011", "-").replace("\u2013", "-").replace("\u2014", "-")
        if s.strip() == "---":
            pdf.ln(2)
            continue
        if not s.strip():
            pdf.ln(2)
            continue
        pdf.multi_cell(col_w, 4.2, s)
    pdf.output(str(out))
    print(f"Wrote {out}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Build docs/PROFIT_REPORT_GUIDE.pdf from PROFIT_REPORT_GUIDE.md (Arabic, RTL)."""
from pathlib import Path

import arabic_reshaper
from bidi.algorithm import get_display
from fpdf import FPDF

FONT = "/Library/Fonts/Arial Unicode.ttf"


def is_arabic(text: str) -> bool:
    return any("\u0600" <= ch <= "\u06FF" for ch in text)


def shape(text: str) -> str:
    text = (
        text.replace("\u2011", "-")
        .replace("\u2013", "-")
        .replace("\u2014", "-")
        .replace("→", "->")
        .replace("×", "x")
        .replace("÷", "/")
        .replace("≈", "~")
        .replace("−", "-")
        .replace("–", "-")
    )
    if not is_arabic(text):
        return text
    return get_display(arabic_reshaper.reshape(text))


def simplify(line: str) -> tuple[str, str]:
    """Return (kind, text) where kind in title1|title2|title3|body|blank|rule|code."""
    raw = line.rstrip()
    if not raw.strip():
        return "blank", ""
    if raw.strip() == "---":
        return "rule", ""
    if raw.startswith("```"):
        return "codefence", ""
    if raw.startswith("# "):
        return "title1", raw[2:].strip()
    if raw.startswith("## "):
        return "title2", raw[3:].strip()
    if raw.startswith("### "):
        return "title3", raw[4:].strip()
    if raw.startswith("- "):
        return "bullet", "• " + raw[2:].strip()
    if raw[:2].isdigit() and raw[1:3] in (") ", ". "):
        return "body", raw.strip()
    return "body", raw.strip().replace("**", "")


def main() -> None:
    root = Path(__file__).resolve().parent
    src = root / "PROFIT_REPORT_GUIDE.md"
    out = root / "PROFIT_REPORT_GUIDE.pdf"
    lines = src.read_text(encoding="utf-8").splitlines()

    pdf = FPDF(format="A4")
    pdf.set_margins(16, 16, 16)
    pdf.set_auto_page_break(auto=True, margin=16)
    pdf.add_page()
    pdf.add_font("uni", fname=FONT)
    col_w = pdf.w - pdf.l_margin - pdf.r_margin

    in_code = False
    for line in lines:
        kind, text = simplify(line)
        if kind == "codefence":
            in_code = not in_code
            pdf.ln(2)
            continue
        if kind == "blank":
            pdf.ln(3)
            continue
        if kind == "rule":
            y = pdf.get_y()
            pdf.set_draw_color(180, 180, 180)
            pdf.line(pdf.l_margin, y, pdf.l_margin + col_w, y)
            pdf.ln(4)
            continue

        if in_code or kind == "body" and text.startswith("`"):
            # keep code-ish lines LTR-ish but still shape Arabic words inside
            pass

        sized = {
            "title1": 18,
            "title2": 14,
            "title3": 12,
            "bullet": 11,
            "body": 11,
        }.get(kind, 11)
        leading = {
            "title1": 10,
            "title2": 8,
            "title3": 7,
            "bullet": 6.2,
            "body": 6.2,
        }.get(kind, 6.2)

        pdf.set_font("uni", size=sized)
        if kind == "title1":
            pdf.ln(2)
        elif kind == "title2":
            pdf.ln(4)

        display = shape(text)
        # RTL multi_cell: align right for Arabic lines
        align = "R" if is_arabic(text) else "L"
        if in_code:
            pdf.set_fill_color(245, 245, 245)
            pdf.multi_cell(col_w, leading, display, align="L", fill=True)
        else:
            pdf.multi_cell(col_w, leading, display, align=align)

        if kind == "title1":
            pdf.ln(2)

    pdf.output(str(out))
    print(f"Wrote {out}")


if __name__ == "__main__":
    main()

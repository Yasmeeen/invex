# Exporting Markdown (`.md`) to PDF — better options

The auto-generated `PLATFORM_DOCUMENTATION.pdf` (from `generate_pdf.py`) is **plain and basic**. For **nicer typography, tables, and headings**, use one of the methods below.

---

## Option A — Typora (easiest for a polished PDF)

1. Install [Typora](https://typora.io/) (paid on some platforms; trial available).
2. Open any `.md` file from `docs/` (e.g. `PLATFORM_DOCUMENTATION_COMPLETE.md` or individual guides).
3. **File → Export → PDF** (or **Print** and choose **Save as PDF** on macOS).

**Pros:** WYSIWYG, good tables and code blocks.  
**Cons:** Paid/licence on some OS versions.

---

## Option B — Visual Studio Code / Cursor + “Markdown PDF” extension

1. Install the extension **“Markdown PDF”** (author: yzane) in VS Code or Cursor.
2. Open a `.md` file.
3. `Cmd+Shift+P` (Mac) or `Ctrl+Shift+P` (Windows) → run **“Markdown PDF: Export (pdf)”**.

**Pros:** Free, stays in your editor.  
**Cons:** Styling is template-based; tweak settings if needed.

---

## Option C — Pandoc (best control, developer-friendly)

Install [Pandoc](https://pandoc.org/installing.html), then from the repo root:

```bash
# Single file → PDF (needs a LaTeX engine for best results, e.g. MacTeX / MiKTeX)
pandoc docs/CLIENT_USER_GUIDE.md -o CLIENT_USER_GUIDE.pdf

# Or HTML first (no LaTeX), then open HTML in browser → Print → Save as PDF
pandoc docs/PLATFORM_DOCUMENTATION_COMPLETE.md -s -o docs/preview.html
```

For PDF without installing LaTeX, use **HTML intermediate** + browser print (Option D).

---

## Option D — Browser “Print to PDF” (good enough, no extra apps)

1. Put the repo on **GitHub** (or paste the `.md` into a **GitHub Gist**). GitHub renders Markdown nicely.
2. Open the file in the browser → **Print** → **Save as PDF**.

Or use an online Markdown preview (e.g. [StackEdit](https://stackedit.io/), [Dillinger](https://dillinger.io/)), paste content, then **Print → Save as PDF**.

**Pros:** Free, looks like a normal web page.  
**Cons:** Manual copy/paste if not using GitHub.

---

## Option E — Microsoft Word

1. Open **Word** (Microsoft 365).
2. **File → Open** and choose a `.md` file (supported in newer Word versions), **or** copy/paste from a text editor.
3. Adjust headings/styles.
4. **File → Save As → PDF**.

**Pros:** Easy to share `.docx` with non-technical readers.  
**Cons:** Markdown import quality varies; tables may need fixes.

---

## Option F — Merge several `.md` files into one PDF

1. Concatenate files in order (manually or with a small script), **or** use `PLATFORM_DOCUMENTATION_COMPLETE.md` as the single merged source.
2. Export with **Typora**, **Markdown PDF**, or **Pandoc** as above.

---

## Which file to export?

| Goal | Suggested source |
|------|------------------|
| One PDF with everything | `PLATFORM_DOCUMENTATION_COMPLETE.md` |
| Separate PDFs per audience | `CLIENT_USER_GUIDE.md`, `QA_TESTING_GUIDE.md`, `ROLES_AND_PERMISSIONS.md`, `README.md` |

---

## Repo script (optional, basic output only)

`docs/generate_pdf.py` remains available for a **quick** PDF without extra tools; quality is limited. Prefer Options A–E for sharing with clients or QA.

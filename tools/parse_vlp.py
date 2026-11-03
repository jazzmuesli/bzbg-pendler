#!/usr/bin/env python3
"""
parse_vlp.py — Parse VLP (Verkehrsgesellschaft Ludwigslust-Parchim) bus
timetable PDFs into structured JSON.

Input:  data/timetables/FPL_<line>*.pdf   (downloaded from vlp-lup.de)
Output: data/lines.json

The VLP PDFs come in two layouts, both handled here:

  * The line-500 "Stadtverkehr" ring: a single wide table, every column is one
    trip, the "Verkehrstage" header row carries the day type (Mo-Fr / Sa / So /
    Sa+So) and every stop row carries that trip's time (or "|" = passes without
    stopping, "-" = not served, "!" / "#" / "€" = request/school markers).

  * The regional lines (510, 520, 525 …): a "Tag" header row spans a block of
    columns with one day type (Montag-Freitag / Samstag / Sonntag), then
    Fahrtnummer / Bemerkungen rows, then stop rows.

We only need, per line, the set of **Boizenburg Bahnhof arc timings** — when a
bus leaves the Bahnhof and (for the ring) when it returns — plus, for line 500,
the full ordered stop list with inter-stop travel times so the engine can model
walkable-express skips. Everything is parsed defensively: anything we cannot
read becomes a warning, never a crash.

This is a best-effort parser for human-formatted PDFs. It emits plausibility
warnings (see tools/plausibility.py-style checks inline) so a human can see
exactly what was and was not understood.
"""
import os
import re
import json
import glob
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
TT_DIR = os.path.join(ROOT, "data", "timetables")
OUT = os.path.join(ROOT, "data", "lines.json")

TIME_RE = re.compile(r"\b(\d{1,2}):(\d{2})\b")
# A cell can be a time, "|" (through), "-" (no service) or empty.
BAHNHOF_RE = re.compile(r"Boiz(?:enburg|bg)\.?\s+(Bhf|Bahnhof)", re.IGNORECASE)


def to_min(h, m):
    return int(h) * 60 + int(m)


def hhmm(x):
    if x is None:
        return "--:--"
    return f"{x // 60:02d}:{x % 60:02d}"


def pdftotext_layout(pdf_path):
    """Return the -layout text of a PDF, or None on failure."""
    txt_path = pdf_path[:-4] + ".txt"
    try:
        subprocess.run(
            ["pdftotext", "-layout", pdf_path, txt_path],
            capture_output=True, check=False,
        )
        with open(txt_path, encoding="utf-8", errors="replace") as f:
            return f.read()
    except Exception:
        return None


def column_spans(header_line):
    """Find the character columns where tokens start, from a header row.

    VLP tables are fixed-width; a stop row's times line up under the trip
    columns of the header. We detect column start positions from the row that
    has the most time-like / token-like entries.
    """
    spans = []
    for m in re.finditer(r"\S+", header_line):
        spans.append(m.start())
    return spans


def extract_times_by_column(line, col_starts, tol=3):
    """Given a stop row and the column start positions, return a list the same
    length as col_starts, each entry a time-in-minutes, '|', '-' or None."""
    out = [None] * len(col_starts)
    for m in re.finditer(r"\S+", line):
        tok = m.group(0)
        pos = m.start()
        # map token to the nearest column start
        best_i, best_d = None, 10 ** 9
        for i, c in enumerate(col_starts):
            d = abs(pos - c)
            if d < best_d:
                best_d, best_i = d, i
        if best_i is None or best_d > 6:
            continue
        tm = TIME_RE.search(tok)
        if tm:
            out[best_i] = to_min(tm.group(1), tm.group(2))
        elif tok in ("|", "!"):
            out[best_i] = "|"
        elif tok == "-":
            out[best_i] = "-"
    return out


def parse_ring_500(text):
    """Parse the line-500 ring into an ordered stop list and per-trip times.

    Returns dict:
      stops: [stop names in order]  (Bahnhof appears twice: outbound & return)
      trips: [ {day_type, times: [per-stop minutes|None]} ]
    """
    lines = text.split("\n")
    # Find the Verkehrstage header (day types) and Fahrtnummer header to anchor columns.
    vt_idx = next((i for i, l in enumerate(lines) if "Verkehrstage" in l), None)
    fn_idx = next((i for i, l in enumerate(lines) if "Fahrtnummer" in l), None)
    if fn_idx is None:
        return None
    # The day-type tokens live on the line(s) above "Verkehrstage" and the
    # Sa+So overrides on the line below. Use the Fahrtnummer row to set columns.
    col_starts = column_spans(lines[fn_idx])
    # drop the label token ("Fahrtnummer") — it's the first span
    col_starts = col_starts[1:]

    # Build day types per column: default from the "Mo-Fr" header line, then
    # override with the Sa/So line beneath Verkehrstage.
    daytype_line = lines[vt_idx - 1] if vt_idx else ""
    override_line = lines[vt_idx + 1] if vt_idx is not None and vt_idx + 1 < len(lines) else ""

    # Besonderheiten row carries per-trip service restrictions (S=school days,
    # F=holidays only, w/W=not on 24/31 Dec, b/c=Ringstraße variants). Needed so
    # we don't double-count mutually exclusive trips (e.g. a school-only 06:55
    # and a holiday-only 07:00 never run on the same day).
    bz_idx = next((i for i, l in enumerate(lines) if "Besonderheiten" in l), None)
    bez_line = lines[bz_idx] if bz_idx is not None else ""

    def tokens_by_col(line, skip_label=True):
        res = [None] * len(col_starts)
        spans = list(re.finditer(r"\S+", line))
        if skip_label and spans:
            spans = spans[1:]  # drop the row label word
        for m in spans:
            pos = m.start()
            best_i, best_d = None, 10 ** 9
            for i, c in enumerate(col_starts):
                d = abs(pos - c)
                if d < best_d:
                    best_d, best_i = d, i
            if best_i is not None and best_d <= 6:
                res[best_i] = m.group(0)
        return res

    besonderheiten = tokens_by_col(bez_line)

    def daytypes_from(line):
        res = [None] * len(col_starts)
        for m in re.finditer(r"Mo-Fr|Sa\+So|Sa|So", line):
            pos = m.start()
            best_i, best_d = None, 10 ** 9
            for i, c in enumerate(col_starts):
                d = abs(pos - c)
                if d < best_d:
                    best_d, best_i = d, i
            if best_i is not None and best_d <= 8:
                res[best_i] = m.group(0)
        return res

    base = daytypes_from(daytype_line)
    override = daytypes_from(override_line)
    # The base "Verkehrstage" row marks every trip as Mo-Fr; the line below ADDS
    # weekend service to specific columns (Sa / Sa+So / So). So a column's day
    # set is the UNION of base and override, expanded to concrete {wd,sa,so}.
    def expand(tag):
        return {
            "Mo-Fr": {"wd"}, "Sa": {"sa"}, "So": {"so"}, "Sa+So": {"sa", "so"},
        }.get(tag, set())

    day_sets = []
    for i in range(len(col_starts)):
        s = set()
        s |= expand(base[i] or "Mo-Fr")   # base is Mo-Fr across the row
        s |= expand(override[i])          # weekend additions
        if not s:
            s = {"wd"}
        day_sets.append(sorted(s))

    # Parse stop rows: a stop row starts with a name then times.
    stops = []
    rows = []
    for l in lines[fn_idx + 1:]:
        if not l.strip():
            continue
        if l.lstrip().startswith("Erläuterungen") or "Haltestelle" in l and "entfällt" in l:
            # explanatory / closure note — skip but remember
            continue
        # A stop row: leading non-time label (stop name), then time cells.
        mlabel = re.match(r"^(.*?)\s{2,}", l)
        if not mlabel:
            continue
        name = mlabel.group(1).strip().strip('"').strip()
        # skip the direction marker rows and separators
        if not name or name in ('"', "!"):
            continue
        # Only treat as a stop row if there's at least one time on it.
        if not TIME_RE.search(l):
            continue
        times = extract_times_by_column(l, col_starts)
        stops.append(name)
        rows.append(times)

    # Transpose rows → trips
    trips = []
    for ci in range(len(col_starts)):
        tcol = []
        for ri in range(len(rows)):
            v = rows[ri][ci] if ci < len(rows[ri]) else None
            tcol.append(v)
        # a real trip has at least 2 actual times
        ntimes = sum(1 for v in tcol if isinstance(v, int))
        if ntimes >= 2:
            trips.append({"days": day_sets[ci], "times": tcol,
                          "besonderheit": besonderheiten[ci]})

    return {"stops": stops, "trips": trips}


def parse_bahnhof_times(text):
    """Line-agnostic: pull every Boizenburg Bhf/Bahnhof time out of a PDF text,
    tagged with the best-guess day type from the nearest Tag/Verkehrstage header.

    Robust fallback used for the 14 regional lines where we only need the
    Bahnhof departure/arrival minutes (route-duration anchors), not every stop.
    """
    lines = text.split("\n")
    # crude day-type segmentation: scan for Tag / Verkehrstage headers
    seg_daytype = "Mo-Fr"
    results = []  # (day_type, minute, raw_line_idx)
    for i, l in enumerate(lines):
        low = l.lower()
        if "montag" in low and "freitag" in low:
            seg_daytype = "Mo-Fr"
        elif re.search(r"\bsamstag\b", low):
            seg_daytype = "Sa"
        elif re.search(r"\bsonntag\b", low):
            seg_daytype = "So"
        if BAHNHOF_RE.search(l):
            for tm in TIME_RE.finditer(l):
                results.append((seg_daytype, to_min(tm.group(1), tm.group(2))))
    return results


def line_number_from_name(path):
    m = re.search(r"FPL_(\d+)", os.path.basename(path))
    return m.group(1) if m else os.path.basename(path)


def main():
    pdfs = sorted(glob.glob(os.path.join(TT_DIR, "FPL_*.pdf")))
    out = {"generated_from": "vlp-lup.de VLP timetable PDFs", "lines": {}}
    warnings = []

    for pdf in pdfs:
        num = line_number_from_name(pdf)
        text = pdftotext_layout(pdf)
        if text is None:
            warnings.append(f"line {num}: could not read PDF")
            continue

        entry = {"line": num, "source_pdf": os.path.basename(pdf)}

        if num.startswith("500"):
            ring = parse_ring_500(text)
            if ring and ring["trips"]:
                entry["type"] = "ring"
                entry["stops"] = ring["stops"]
                entry["trips"] = ring["trips"]
                # derive Bahnhof outbound departures + return arrivals per trip
                bhf_idx = [i for i, s in enumerate(ring["stops"])
                           if BAHNHOF_RE.search(s)]
                entry["bahnhof_stop_indices"] = bhf_idx
            else:
                warnings.append(f"line {num}: ring parse produced no trips")
        else:
            bhf = parse_bahnhof_times(text)
            entry["type"] = "regional"
            # group minutes by day type, dedupe + sort
            by_dt = {}
            for dt, mn in bhf:
                by_dt.setdefault(dt, set()).add(mn)
            entry["bahnhof_times"] = {k: sorted(v) for k, v in by_dt.items()}
            if not bhf:
                warnings.append(f"line {num}: no Bahnhof times found")

        out["lines"][num] = entry

    out["warnings"] = warnings
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)

    print(f"Parsed {len(out['lines'])} lines → {OUT}")
    for w in warnings:
        print("  ⚠", w)
    # quick summary
    for num, e in sorted(out["lines"].items()):
        if e.get("type") == "ring":
            print(f"  line {num}: ring, {len(e['stops'])} stops, {len(e['trips'])} trips")
        else:
            tot = sum(len(v) for v in e.get("bahnhof_times", {}).values())
            print(f"  line {num}: regional, {tot} Bahnhof times "
                  f"{{{', '.join(f'{k}:{len(v)}' for k,v in e.get('bahnhof_times',{}).items())}}}")


if __name__ == "__main__":
    main()

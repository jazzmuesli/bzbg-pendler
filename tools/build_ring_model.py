#!/usr/bin/env python3
"""
build_ring_model.py — Derive a canonical line-500 ring model from the parsed
timetable, enriched with stop coordinates and walking times.

Produces data/ring_model.json:
  stops: [ {name, lat, lon, is_bahnhof, median_ride_from_prev, walk_from_prev_min} ]
  cycle_min:  median full Bahnhof->Bahnhof ride time (through town)
  walkable_segments: consecutive stops reachable on foot within WALK_LIMIT min
                     (these are the express-skip candidates)

"Express" = skip a run of stops whose total walking distance is small enough
that a passenger can walk it in <= WALK_LIMIT minutes; the bus saves the dwell
+ detour time while nobody is stranded more than a short walk.
"""
import os
import json
import math
import statistics

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
LINES = os.path.join(ROOT, "data", "lines.json")
OUT = os.path.join(ROOT, "data", "ring_model.json")

WALK_LIMIT = 15          # minutes: a segment walkable within this is express-skippable
WALK_SPEED_KMH = 4.8     # average walking speed

# Stop coordinates (from the existing STOPS table in build_simulation.py).
# Keyed by the name as it appears in the parsed line-500 ring.
COORDS = {
    "Ringstraße": (53.378266, 10.764826),
    "Gülzer Straße": (53.3795, 10.7680),
    "Industriegebiet": (53.381016, 10.771065),
    "Boizenburg Lindhorst": (53.384955, 10.773574),
    "Boizenburg Bahnhof": (53.377607, 10.753858),
    "Weg der Jugend": (53.376622, 10.741151),
    "Boizenburg Markt": (53.374904, 10.723617),
    "Schwartower Str.": (53.379295, 10.725350),
    "Stiftstraße": (53.375577, 10.724527),
    "Schulzentrum": (53.382973, 10.730846),
    "Metlitzer Weg": (53.385825, 10.731288),
    "R. Markmann Str.": (53.383308, 10.729840),
    "Breitscheidstr.": (53.382194, 10.723278),
    "H.-J.-P. Lemm Str.": (53.382857, 10.719083),
    "Schiller Str.": (53.382528, 10.716176),
    "Buchenweg": (53.382555, 10.710479),
}


def haversine_km(a, b):
    R = 6371.0
    lat1, lon1 = map(math.radians, a)
    lat2, lon2 = map(math.radians, b)
    dlat, dlon = lat2 - lat1, lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def walk_min(a, b):
    km = haversine_km(a, b)
    return km / WALK_SPEED_KMH * 60.0


def main():
    d = json.load(open(LINES, encoding="utf-8"))
    ring = d["lines"]["500"]
    stops = ring["stops"]
    trips = ring["trips"]
    n = len(stops)

    # Median ride time from previous stop, across all trips that have both times.
    ride_from_prev = [None] * n
    for i in range(1, n):
        deltas = []
        for t in trips:
            a, b = t["times"][i - 1], t["times"][i]
            if isinstance(a, int) and isinstance(b, int) and b >= a and b - a <= 20:
                deltas.append(b - a)
        ride_from_prev[i] = int(round(statistics.median(deltas))) if deltas else None

    model_stops = []
    for i, name in enumerate(stops):
        coord = COORDS.get(name)
        walk_prev = None
        if i > 0 and coord and COORDS.get(stops[i - 1]):
            walk_prev = round(walk_min(COORDS[stops[i - 1]], coord), 1)
        model_stops.append({
            "name": name,
            "lat": coord[0] if coord else None,
            "lon": coord[1] if coord else None,
            "is_bahnhof": "Bahnhof" in name,
            "ride_from_prev": ride_from_prev[i],
            "walk_from_prev_min": walk_prev,
        })

    # Full Bahnhof -> Bahnhof ride time (through town), median across trips.
    bhf_idx = [i for i, s in enumerate(stops) if "Bahnhof" in s]
    cycle = []
    if len(bhf_idx) >= 2:
        a_idx, b_idx = bhf_idx[0], bhf_idx[1]
        for t in trips:
            a, b = t["times"][a_idx], t["times"][b_idx]
            if isinstance(a, int) and isinstance(b, int) and 10 <= b - a <= 90:
                cycle.append(b - a)
    cycle_min = int(round(statistics.median(cycle))) if cycle else None

    # Walkable segments: maximal runs of non-Bahnhof stops whose cumulative walk
    # (from the stop before the run to the stop after it, along the run) is small.
    # We express this per-stop: a stop is "skippable" if the walk from its
    # neighbours is <= WALK_LIMIT.
    for i, s in enumerate(model_stops):
        skippable = False
        if not s["is_bahnhof"] and 0 < i < n - 1:
            w = s["walk_from_prev_min"]
            wn = model_stops[i + 1]["walk_from_prev_min"]
            if w is not None and wn is not None and (w + wn) <= WALK_LIMIT:
                skippable = True
        s["express_skippable"] = skippable

    out = {
        "walk_limit_min": WALK_LIMIT,
        "walk_speed_kmh": WALK_SPEED_KMH,
        "cycle_min": cycle_min,
        "bahnhof_stop_indices": bhf_idx,
        "stops": model_stops,
    }
    json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

    print(f"Ring model → {OUT}")
    print(f"  cycle (Bahnhof->Bahnhof through town): {cycle_min} min")
    print(f"  stops: {n}, with coords: {sum(1 for s in model_stops if s['lat'])}")
    nskip = sum(1 for s in model_stops if s["express_skippable"])
    print(f"  express-skippable (walkable within {WALK_LIMIT} min): {nskip}")
    for s in model_stops:
        flag = " [SKIP]" if s.get("express_skippable") else (" [BHF]" if s["is_bahnhof"] else "")
        print(f"    {s['name']:24s} ride+{str(s['ride_from_prev']):>4} walk+{str(s['walk_from_prev_min']):>5}{flag}")


if __name__ == "__main__":
    main()

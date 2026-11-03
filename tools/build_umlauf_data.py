#!/usr/bin/env python3
"""
build_umlauf_data.py — Build the per-run ("Umlauf") model for the simpler,
honest simulation.

The reality (confirmed against the parsed line-500 PDF and RE1 data): line 500
is ONE bus doing ONE ring run per hour, pendling between two RE1 waves:
  RE1 arrives  ->  bus departs Bahnhof (a few min later)  ->  ring through town
  ->  bus returns ~31 min later  ->  feeds the next RE1 departure  ->  short
  pause  ->  next hour's run.

So we do not "optimise" a free schedule. We take each REAL ring run and attach:
  - the RE1 arrival it connects FROM (nearest arrival up to 30 min before dep),
    with its p90 delay (robustness target),
  - the RE1 departure it feeds INTO (nearest departure up to 30 min after
    return),
  - the ring duration (and the express-shortened duration).

Express skips the walkable-within-15-min stops, cutting ring time; the freed
minutes become extra buffer, not extra runs.

Writes data/umlauf_data.json keyed by day type.
"""
import os
import json

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

BOARD = 2   # min to walk+board after arrival
WALK = 1    # min from bus to platform on return
MAX_LINK = 35  # max min between train and bus to count as the same connection


def load(p):
    with open(os.path.join(ROOT, p), encoding="utf-8") as f:
        return json.load(f)


def main():
    lines = load("data/lines.json")
    ring = load("data/ring_model.json")
    sim = load("sim_data.json")

    r = lines["lines"]["500"]
    bi = r["bahnhof_stop_indices"]  # [outbound idx, return idx]

    # express saving: sum of ride_from_prev over skippable stops
    express_saving = 0
    skip_names = []
    for i, s in enumerate(ring["stops"]):
        if s.get("express_skippable") and not s["is_bahnhof"]:
            express_saving += s.get("ride_from_prev") or 0
            skip_names.append(s["name"])

    def load_days(rr):
        return rr["days"]

    # Classify a trip's service restriction from its Besonderheiten marker.
    #   S  -> only on school days ("schule")
    #   F  -> only during holidays ("ferien")
    #   otherwise regular (runs every day of its day_set)
    # S and F trips are MUTUALLY EXCLUSIVE and must not be counted together.
    def service_of(bez):
        if not bez:
            return "regular"
        b = bez.replace("c", "").replace("b", "")  # strip Ringstraße-variant flags
        if "S" in b:
            return "schule"
        if "F" in b:
            return "ferien"
        return "regular"

    # collect real runs with their day set + service class
    raw_runs = []
    for t in r["trips"]:
        ab = t["times"][bi[0]]
        zu = t["times"][bi[1]]
        days = t.get("days") or ["wd"]
        svc = service_of(t.get("besonderheit"))
        if isinstance(ab, int) and isinstance(zu, int) and zu > ab:
            raw_runs.append({"ab": ab, "zu": zu, "days": days,
                             "ring": zu - ab, "service": svc,
                             "besonderheit": t.get("besonderheit")})

    out = {"express_saving": express_saving, "express_skipped_stops": skip_names,
           "board": BOARD, "walk": WALK, "days": {}}

    # ham_groups = trains ARRIVING FROM Hamburg -> they continue toward Schwerin.
    # sch_groups = trains ARRIVING FROM Schwerin/Rostock -> they continue toward
    # Hamburg. Verified against the real RE1 timetable (nimmbus.de):
    #   RE1 "Hin"  (Hamburg->Schwerin) passes Boizenburg at 06:12, 07:09, 08:12…
    #     -> matches ham_groups (06:11, 07:08, 08:11…)
    #   RE1 "Rück" (Schwerin->Hamburg) passes Boizenburg at 05:48, 06:51, 07:48…
    #     -> matches sch_groups (06:50/51, 07:48…)
    # So the useful label for a passenger is the ONWARD direction.
    def mk_arr(g, origin, onward):
        return {"min": g["planned"], "from": origin, "to": onward,
                "p90": g["p90"], "n": g["n"]}

    for dt in ("wd", "sa", "so"):
        arrivals = sorted(
            [mk_arr(g, "Hamburg", "Schwerin") for g in sim["ham_groups"].get(dt, [])] +
            [mk_arr(g, "Schwerin", "Hamburg") for g in sim["sch_groups"].get(dt, [])],
            key=lambda x: x["min"])
        departures = sorted(
            [{"min": g["planned"], "p90": g["p90"],
              "n": g.get("n_ham", 0) + g.get("n_sch", 0)}
             for g in sim["dep_groups"].get(dt, [])],
            key=lambda x: x["min"])

        runs = []
        for rr in raw_runs:
            if dt not in rr["days"]:
                continue
            # RE1 arrival this run connects from: nearest arrival <= dep, within MAX_LINK
            cand_a = [a for a in arrivals if 0 <= rr["ab"] - a["min"] <= MAX_LINK]
            arr = max(cand_a, key=lambda a: a["min"]) if cand_a else None
            # RE1 departure the return feeds: nearest departure >= return, within MAX_LINK
            cand_d = [d for d in departures if 0 <= d["min"] - rr["zu"] <= MAX_LINK]
            dep = min(cand_d, key=lambda d: d["min"]) if cand_d else None
            runs.append({
                "dep": rr["ab"],
                "ret": rr["zu"],
                "ring": rr["ring"],
                "service": rr["service"],
                "besonderheit": rr["besonderheit"],
                "arr": arr,          # {min,from,to,p90,n} or null
                "depTrain": dep,     # {min,p90,n} or null
            })
        runs.sort(key=lambda x: x["dep"])
        out["days"][dt] = {"runs": runs,
                           "arrivals": arrivals, "departures": departures}

    path = os.path.join(ROOT, "data", "umlauf_data.json")
    json.dump(out, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"express saving = {express_saving} min, skips {len(skip_names)} stops")
    for dt in ("wd", "sa", "so"):
        print(f"  {dt}: {len(out['days'][dt]['runs'])} Umläufe")
    print(f"Wrote {path}")


if __name__ == "__main__":
    main()

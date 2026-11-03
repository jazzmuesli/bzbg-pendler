#!/usr/bin/env python3
"""
build_engine_data.py — Bundle everything the browser UI needs into one JSON.

Combines:
  - data/ring_model.json         (line-500 ring: stops, walk/ride times, express)
  - sim_data.json ham/sch/dep    (RE1 constraints per day type, with p90 delays)

Writes data/engine_data.json consumed by the simulation.html build.
"""
import os
import json

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


def load(name):
    with open(os.path.join(ROOT, name), encoding="utf-8") as f:
        return json.load(f)


def main():
    ring = load(os.path.join("data", "ring_model.json"))
    sim = load("sim_data.json")

    def trains_for(dt):
        ham = [{"min": g["planned"], "dir": "hamburg", "p90": g["p90"],
                "median": g["median"], "n": g["n"]} for g in sim["ham_groups"].get(dt, [])]
        sch = [{"min": g["planned"], "dir": "schwerin", "p90": g["p90"],
                "median": g["median"], "n": g["n"]} for g in sim["sch_groups"].get(dt, [])]
        dep = [{"min": g["planned"], "p90": g["p90"], "median": g["median"],
                "n": (g.get("n_ham", 0) + g.get("n_sch", 0))} for g in sim["dep_groups"].get(dt, [])]
        arr = sorted(ham + sch, key=lambda x: x["min"])
        dep = sorted(dep, key=lambda x: x["min"])
        return {"arrivals": arr, "departures": dep}

    out = {
        "generated": sim.get("generated"),
        "ring": ring,
        "trains": {dt: trains_for(dt) for dt in ("wd", "sa", "so")},
    }
    path = os.path.join(ROOT, "data", "engine_data.json")
    json.dump(out, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

    for dt in ("wd", "sa", "so"):
        t = out["trains"][dt]
        print(f"  {dt}: {len(t['arrivals'])} arrivals, {len(t['departures'])} departures")
    print(f"Wrote {path}")


if __name__ == "__main__":
    main()

/**
 * umlauf.js — The honest, simple line-500 model.
 *
 * Line 500 is ONE bus doing ONE ring run per hour, pendling between two RE1
 * waves. We do NOT optimise a free schedule; we take each REAL ring run and
 * evaluate its two connections:
 *
 *   arrival side:  RE1 arrives -> passenger needs `board` min -> bus departs.
 *       buffer   = busDep - trainArr - board   (slack before the bus leaves)
 *       robust   = buffer >= trainP90          (a typical-late train still makes it)
 *   return side:   bus returns -> passenger needs `walk` min -> RE1 departs.
 *       reserve  = trainDep - busRet - walk     (slack to still catch the train)
 *
 * The only real levers:
 *   - shift: move a run's Bahnhof departure by a few minutes (same for all runs
 *            via a global slider, like today's real "+5 min" planning question).
 *   - express[runIndex]: this run skips the walkable-within-15-min stops, which
 *            shortens the ring by `expressSaving` min. The saved time becomes
 *            EXTRA RETURN RESERVE (the bus is back sooner), not more runs.
 *
 * Pure. No DOM, no I/O.
 */

function evalRun(run, params) {
  const { board, walk, expressSaving, shift = 0, express = false,
          arriveBufferMin = 0, departReserveMin = 0 } = params;

  const ring = express ? Math.max(10, run.ring - expressSaving) : run.ring;
  const dep = run.dep + shift;
  const ret = dep + ring;

  let arrival = null;
  if (run.arr) {
    const buffer = dep - run.arr.min - board;
    const p90 = run.arr.p90 == null ? null : run.arr.p90;
    arrival = {
      train: run.arr.min,
      from: run.arr.from,
      to: run.arr.to,
      p90,
      n: run.arr.n,
      buffer,
      reachable: buffer >= 0 && buffer >= arriveBufferMin,
      // robust = even a p90-late train still has >= 0 slack to board
      robust: p90 == null ? buffer >= 0 : buffer - p90 >= 0,
    };
  }

  let departure = null;
  if (run.depTrain) {
    const reserve = run.depTrain.min - ret - walk;
    departure = {
      train: run.depTrain.min,
      p90: run.depTrain.p90,
      n: run.depTrain.n,
      reserve,
      reachable: reserve >= departReserveMin && reserve >= 0,
    };
  }

  return { dep, ret, ring, express, arrival, departure };
}

/**
 * Evaluate a whole day's worth of runs under the sliders.
 * @param dayData  { runs, arrivals, departures } from umlauf_data.json
 * @param cfg      { board, walk, expressSaving, shift, expressSet:Set|Array,
 *                   arriveBufferMin, departReserveMin,
 *                   schoolMode: "schule"|"ferien" }
 *
 * On any given day a line runs its "regular" trips plus EITHER the school-day
 * ("schule") OR the holiday ("ferien") trips — never both, since S and F trips
 * are mutually exclusive. schoolMode selects which exclusive set is active.
 * The returned runs keep their ORIGINAL index (for stable express toggles).
 */
function evalDay(dayData, cfg) {
  const expressSet = new Set(cfg.expressSet || []);
  const schoolMode = cfg.schoolMode || "schule";

  const runs = dayData.runs
    .map((run, i) => ({ run, i }))
    .filter(({ run }) => {
      const svc = run.service || "regular";
      if (svc === "regular") return true;
      return svc === schoolMode;
    })
    .map(({ run, i }) => {
      const r = evalRun(run, {
        board: cfg.board,
        walk: cfg.walk,
        expressSaving: cfg.expressSaving,
        shift: cfg.shift || 0,
        express: expressSet.has(i),
        arriveBufferMin: cfg.arriveBufferMin || 0,
        departReserveMin: cfg.departReserveMin || 0,
      });
      r.index = i;
      r.service = run.service || "regular";
      r.besonderheit = run.besonderheit || null;
      return r;
    });

  // KPIs weighted by observed passenger counts n.
  let arrN = 0, arrOk = 0, arrRobust = 0, arrWaitWeighted = 0;
  let depN = 0, depOk = 0;
  for (const r of runs) {
    if (r.arrival) {
      const n = r.arrival.n || 1;
      arrN += n;
      if (r.arrival.reachable) arrOk += n;
      if (r.arrival.robust) arrRobust += n;
      if (r.arrival.buffer >= 0) arrWaitWeighted += r.arrival.buffer * n;
    }
    if (r.departure) {
      const n = r.departure.n || 1;
      depN += n;
      if (r.departure.reachable) depOk += n;
    }
  }

  return {
    runs,
    kpis: {
      arrReachRate: arrN ? (arrOk / arrN) * 100 : 0,
      arrRobustRate: arrN ? (arrRobust / arrN) * 100 : 0,
      depReachRate: depN ? (depOk / depN) * 100 : 0,
      meanArrBuffer: arrN ? arrWaitWeighted / arrN : 0,
      expressCount: expressSet.size,
      runCount: runs.length,
    },
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { evalRun, evalDay };
}

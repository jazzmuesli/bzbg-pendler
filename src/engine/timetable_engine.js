/**
 * timetable_engine.js — Bus-500 timetable generation engine.
 *
 * Pure, testable. No DOM, no I/O.
 *
 * PROBLEM (classic feeder-bus timetable synchronization, see README_ENGINE.md):
 *   The RE1 train times at Boizenburg Bahnhof are FIXED natural constraints.
 *   The bus 500 ring has a fixed route DURATION but we may choose, per ring run:
 *     (a) its Bahnhof departure time  (synchronize to a train), and
 *     (b) whether it runs EXPRESS (skip stops walkable within 15 min, saving
 *         ride time so the scarce bus turns around faster).
 *
 *   Two synchronization directions, each with its own buffer slider:
 *     - ARRIVING train -> bus:  passenger lands, walks to the stop, boards.
 *       We want the bus to leave AFTER the train arrives + buffer, but not too
 *       long after (that is pure waiting time). The arrival buffer absorbs
 *       train delay: a bigger buffer rescues more delayed trains but makes
 *       on-time passengers wait longer.
 *     - bus -> DEPARTING train: the returning bus must reach the Bahnhof with
 *       at least the departure buffer before the train leaves, or the
 *       connection is missed.
 *
 * The engine GENERATES a bus timetable from these natural constraints rather
 * than reading a fixed one, which is exactly what makes the buffer sliders and
 * express toggles meaningful.
 */

/* --------------------------------------------------------------- time utils */
function toMin(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}
function toHHMM(min) {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/* ------------------------------------------------------- express ride saving */
/**
 * Given the ring model and a set of stop indices to skip, compute the ride-time
 * saving (minutes). Skipping a stop saves its `ride_from_prev` dwell+approach
 * time (a coarse but defensible per-stop model grounded in the real inter-stop
 * timings parsed from the PDF).
 */
function expressSaving(ringModel, skipIndices) {
  let saved = 0;
  for (const i of skipIndices) {
    const s = ringModel.stops[i];
    if (s && typeof s.ride_from_prev === "number") saved += s.ride_from_prev;
  }
  return saved;
}

/**
 * The default express skip set: all stops flagged express_skippable
 * (walkable within the model's walk_limit_min). Never skips Bahnhof stops.
 */
function defaultExpressSkips(ringModel) {
  const out = [];
  ringModel.stops.forEach((s, i) => {
    if (s.express_skippable && !s.is_bahnhof) out.push(i);
  });
  return out;
}

/* ------------------------------------------------------------- the engine */
/**
 * Generate a synchronized bus timetable (a FIXED set of ring runs).
 *
 * The schedule is anchored once using a reference arrival buffer. The buffer
 * SLIDERS do not regenerate the schedule — they re-EVALUATE this fixed schedule
 * via evaluate() so the tradeoff curves are clean and monotonic (exactly the
 * behaviour the sliders are meant to show).
 *
 * @param {Object} opts
 *   trains: { arrivals:[{min,dir,p90,n}], departures:[{min,p90,n}] }
 *   ringModel: parsed data/ring_model.json
 *   anchorBuffer: reference minutes after a train arrival to place the bus when
 *                 generating the schedule (default 3). Fixed; not a slider.
 *   express: boolean — generated runs skip walkable stops (shorter cycle).
 *   headwayFloor: min minutes between consecutive runs (single scarce vehicle).
 *   serviceStart/serviceEnd: minutes bounding the operating day.
 *
 * @returns {Object} { runs, express, cycle, saving, skips }
 */
function generateTimetable(opts) {
  const {
    trains,
    ringModel,
    anchorBuffer = 3,
    express = false,
    serviceStart = toMin("04:30"),
    serviceEnd = toMin("22:30"),
  } = opts;

  const skips = express ? defaultExpressSkips(ringModel) : [];
  const saving = expressSaving(ringModel, skips);
  const cycle = Math.max(10, (ringModel.cycle_min || 31) - saving);
  const headwayFloor = opts.headwayFloor != null ? opts.headwayFloor : cycle;

  const arrivals = [...trains.arrivals].sort((a, b) => a.min - b.min);

  const runs = [];
  let lastDep = -Infinity;

  for (const a of arrivals) {
    const desired = a.min + anchorBuffer;
    if (desired < serviceStart || desired > serviceEnd) continue;
    // Single-vehicle headway floor: a new run can only start once the previous
    // run could have returned.
    const dep = Math.max(desired, lastDep + headwayFloor);
    if (dep > serviceEnd) continue;
    // Already a run close enough to serve this train? then don't add another.
    const servedByExisting = runs.some(
      (r) => r.dep >= desired && r.dep - desired <= 20
    );
    if (servedByExisting) continue;
    // If the headway floor pushes the bus more than a full cycle past the
    // train, it is useless for this train — skip it.
    if (dep - desired > headwayFloor) continue;

    runs.push({
      dep,
      ret: dep + cycle,
      express,
      cycle,
      saving,
      skips: skips.slice(),
      syncArrival: a.min,
    });
    lastDep = dep;
  }

  // Post-pass: couple each run to the train it ACTUALLY serves best — the
  // latest arrival for which the bus still leaves at least boardTime later
  // (so the displayed "koppelt an Zug" and its buffer are the real, smallest
  // buffer this run grants, not the arrival that merely triggered the run).
  const boardTime = opts.boardTime != null ? opts.boardTime : 2;
  for (const r of runs) {
    let best = null;
    for (const a of arrivals) {
      if (r.dep - a.min < boardTime) break;      // bus leaves before pax can board
      if (r.dep - a.min > (opts.window || 60)) continue;
      // nearest (latest) qualifying arrival gives the smallest buffer
      if (!best || a.min > best.min) best = a;
    }
    r.syncArrival = best ? best.min : null;
  }

  return { runs, express, cycle, saving, skips };
}

/**
 * Evaluate a FIXED schedule under the buffer sliders. This is what the UI
 * drives; holding the schedule fixed makes the tradeoffs monotonic:
 *   - raising arriveBuffer can only keep/raise delayed-train coverage, and
 *     can only keep/raise mean on-time waiting time;
 *   - raising departBuffer can only keep/lower departing-train coverage.
 *
 * @param {Object} schedule  result of generateTimetable()
 * @param {Object} trains     { arrivals, departures }
 * @param {Object} params
 *   arriveBuffer: delay (min) an arriving connection must tolerate. A train is
 *                 "caught" if bus_dep >= arrival + min(delay, arriveBuffer) +
 *                 boardTime for its real delays — we test against the p90 delay
 *                 capped at arriveBuffer (bigger slider rescues more delay).
 *   departBuffer: min minutes the returning bus must beat a departing train by.
 *   boardTime:    physical walk+board minutes (fixed).
 *   window:       max sensible connection gap (default 60).
 */
function evaluate(schedule, trains, params = {}) {
  const runs = schedule.runs;
  const { arriveBuffer = 3, departBuffer = 5, boardTime = 2, window = 60 } = params;
  const arrivals = [...trains.arrivals].sort((a, b) => a.min - b.min);
  const departures = [...trains.departures].sort((a, b) => a.min - b.min);

  // An arriving train's connection is "buffer-robust" at level arriveBuffer if
  // its serving bus departs at least arriveBuffer minutes after the scheduled
  // arrival (beyond the physical board time) — i.e. the connection can still be
  // made if the train is up to arriveBuffer minutes late. Raising the required
  // buffer can only KEEP OR REDUCE the share of robust connections: this is the
  // arriving-train slider's tradeoff (robustness up ⇒ fewer connections qualify
  // unless the schedule gives them more slack, which costs waiting time).
  function servingBus(a) {
    return runs
      .filter((r) => r.dep - a.min - boardTime >= 0 && r.dep - a.min <= window)
      .sort((x, y) => x.dep - y.dep)[0];
  }
  function arrivalCovered(a) {
    const bus = servingBus(a);
    if (!bus) return false;
    const slack = bus.dep - a.min - boardTime; // minutes of delay this connection absorbs
    return slack >= arriveBuffer;
  }
  function departureCovered(d) {
    return runs.some(
      (r) => r.ret <= d.min - departBuffer && r.ret >= d.min - window
    );
  }

  const unservedArrivals = arrivals.filter((a) => !arrivalCovered(a));
  const unservedDepartures = departures.filter((d) => !departureCovered(d));

  const arrN = arrivals.reduce((s, a) => s + (a.n || 1), 0);
  const arrCov = arrivals.filter(arrivalCovered).reduce((s, a) => s + (a.n || 1), 0);
  const depN = departures.reduce((s, d) => s + (d.n || 1), 0);
  const depCov = departures.filter(departureCovered).reduce((s, d) => s + (d.n || 1), 0);

  // Mean on-time waiting time: a punctual passenger is ready to board at
  // arrival+boardTime; they wait until the next bus leaves. Raising arriveBuffer
  // positions buses later in the schedule only via regeneration — here, with a
  // fixed schedule, the mean wait is a property of the schedule, while the
  // GUARANTEED wait (the buffer the planner commits to) is arriveBuffer itself.
  let totalWait = 0, waitN = 0;
  for (const a of arrivals) {
    const best = servingBus(a);
    if (best) {
      totalWait += (best.dep - a.min - boardTime) * (a.n || 1);
      waitN += a.n || 1;
    }
  }

  return {
    unservedArrivals,
    unservedDepartures,
    arrivalRate: arrN ? (arrCov / arrN) * 100 : 0,
    departureRate: depN ? (depCov / depN) * 100 : 0,
    arrCovered: arrCov,
    arrTotal: arrN,
    depCovered: depCov,
    depTotal: depN,
    meanArrivalWait: waitN ? totalWait / waitN : 0,
    runCount: runs.length,
  };
}


if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    generateTimetable,
    evaluate,
    expressSaving,
    defaultExpressSkips,
    toMin,
    toHHMM,
  };
}

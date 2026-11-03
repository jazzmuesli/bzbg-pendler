/**
 * plausibility.js — Sanity / plausibility checks for generated and parsed
 * timetables. Pure functions returning a list of problems (empty = all good).
 *
 * These guard against silently-wrong data: non-monotonic ring times, implausible
 * cycle durations, buses that cannot physically turn around, etc.
 */

/**
 * Check a parsed/derived ring model.
 * @returns {string[]} list of problems
 */
function checkRingModel(ringModel) {
  const problems = [];
  if (!ringModel || !Array.isArray(ringModel.stops) || ringModel.stops.length < 4) {
    problems.push("ring model has too few stops");
    return problems;
  }
  const bhf = ringModel.stops.filter((s) => s.is_bahnhof).length;
  if (bhf !== 2) {
    problems.push(`expected Bahnhof to appear exactly twice on the ring, found ${bhf}`);
  }
  if (!(ringModel.cycle_min > 0 && ringModel.cycle_min < 90)) {
    problems.push(`implausible cycle time: ${ringModel.cycle_min} min (expected 10..90)`);
  }
  // ride_from_prev must be small and non-negative where present
  ringModel.stops.forEach((s, i) => {
    if (s.ride_from_prev != null && (s.ride_from_prev < 0 || s.ride_from_prev > 20)) {
      problems.push(`stop ${i} (${s.name}) has implausible ride_from_prev=${s.ride_from_prev}`);
    }
    if (s.walk_from_prev_min != null && s.walk_from_prev_min < 0) {
      problems.push(`stop ${i} (${s.name}) has negative walk time`);
    }
  });
  return problems;
}

/**
 * Check a generated timetable from generateTimetable().
 * @returns {string[]} list of problems
 */
function checkGeneratedTimetable(result, opts = {}) {
  const problems = [];
  const runs = result.runs || [];

  // 1. Every run returns after it departs, by exactly its cycle time.
  for (const r of runs) {
    if (r.ret <= r.dep) problems.push(`run at ${r.dep} returns before/at departure`);
    if (r.ret - r.dep !== r.cycle) {
      problems.push(`run at ${r.dep}: ret-dep (${r.ret - r.dep}) != cycle (${r.cycle})`);
    }
  }

  // 2. A single vehicle cannot overlap itself: runs must not start before the
  //    previous one returns (unless a fleet size > 1 was declared).
  const fleet = opts.fleet || 1;
  const sorted = [...runs].sort((a, b) => a.dep - b.dep);
  if (fleet === 1) {
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].dep < sorted[i - 1].ret) {
        problems.push(
          `single-vehicle overlap: run at ${sorted[i].dep} starts before previous returns at ${sorted[i - 1].ret}`
        );
      }
    }
  }

  // 3. Express runs must save a non-negative, bounded amount.
  for (const r of runs) {
    if (r.express && !(r.saving >= 0 && r.saving < (opts.maxSaving || 25))) {
      problems.push(`express run at ${r.dep} has implausible saving ${r.saving}`);
    }
  }

  // 4. Departure times within the service day.
  const start = opts.serviceStart != null ? opts.serviceStart : 0;
  const end = opts.serviceEnd != null ? opts.serviceEnd : 1440;
  for (const r of runs) {
    if (r.dep < start - 1 || r.dep > end + 1) {
      problems.push(`run at ${r.dep} is outside the service day [${start},${end}]`);
    }
  }

  // 5. Coverage rates are percentages (if an evaluation was supplied).
  const k = opts.evaluation || {};
  for (const key of ["arrivalRate", "departureRate"]) {
    if (k[key] != null && (k[key] < -0.001 || k[key] > 100.001)) {
      problems.push(`${key} out of [0,100]: ${k[key]}`);
    }
  }

  return problems;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { checkRingModel, checkGeneratedTimetable };
}

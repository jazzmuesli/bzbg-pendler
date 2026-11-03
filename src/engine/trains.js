/**
 * trains.js — Load RE1 train constraints (the fixed natural constraints) from
 * the empirical sim_data.json into the shape the timetable engine expects.
 *
 * sim_data.json groups each physical train by scheduled time with an empirical
 * delay distribution. We expose, per day type:
 *   arrivals:   [ {min, dir: "hamburg"|"schwerin", p90, median, n} ]
 *   departures: [ {min, p90, n} ]
 *
 * p90 is the delay (minutes) that 90% of observed runs stayed within — the
 * robustness target: a buffer >= p90 rescues 90% of real-world delayed trains.
 */

function loadTrains(simData, dayType) {
  const ham = (simData.ham_groups[dayType] || []).map((g) => ({
    min: g.planned,
    dir: "hamburg",
    p90: g.p90,
    median: g.median,
    n: g.n,
  }));
  const sch = (simData.sch_groups[dayType] || []).map((g) => ({
    min: g.planned,
    dir: "schwerin",
    p90: g.p90,
    median: g.median,
    n: g.n,
  }));
  const dep = (simData.dep_groups[dayType] || []).map((g) => ({
    min: g.planned,
    p90: g.p90,
    median: g.median,
    n: (g.n_ham || 0) + (g.n_sch || 0),
  }));
  return {
    arrivals: [...ham, ...sch].sort((a, b) => a.min - b.min),
    departures: dep.sort((a, b) => a.min - b.min),
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { loadTrains };
}

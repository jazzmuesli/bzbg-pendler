/**
 * simulation.js - Core simulation logic for the Bus 500 simulation.
 *
 * Pure, testable functions. No DOM, no I/O.
 *
 * Core question: for every train run, which bus brings people to the station,
 * and for every departing train, which bus sends them to town?
 *
 * Metrics:
 *  - Buffer = bus_dep - train_planned_arrival - walk - board
 *    (delay the connection can absorb; a train is covered if its delay <= buffer)
 *  - Waiting time = train_planned_departure - bus_arrival - walk
 *    (time passengers wait at Bahnhof for their departing train)
 */

const { loadData } = require("./data");

// A train only counts as a real connection if it is within this many minutes
// of the bus. A train arriving >60 min before the bus departs is not a
// connection anyone would wait for.
const CONNECT_WINDOW = 60;

/**
 * Run the full simulation for a given day type and set of bus adjustments.
 *
 * @param {Object} data - Data accessor from loadData()
 * @param {Object[]} adjustments - Array of { shift: number, express: boolean }
 *   per bus run index
 * @param {string} dayType - "wd", "sa", or "so"
 * @param {boolean} useP90 - Use p90 delay as buffer criterion
 * @returns {Object} Simulation results with KPIs and per-run details
 */
function simulate(data, adjustments, dayType, useP90 = true) {
  const { walkTime, boardTime, minBufferForDepartingTrain } = data;
  const busRuns = [];

  // Build adjusted timetable
  for (let i = 0; i < data.busDepartures.length; i++) {
    const adj = adjustments[i] || { shift: 0, express: false };
    const shift = adj.shift;
    const express = adj.express;
    const expressSavings = express ? Math.min(6 * 2, 10) : 0; // 6 stops * 2 min, capped at 10
    const dep = data.busDepartures[i] + shift;
    const routeTime = Math.max(15, (data.busArrivals[i] - data.busDepartures[i]) - expressSavings);
    const ret = dep + routeTime;
    busRuns.push({ index: i, dep, ret, shift, express, expressSavings, routeTime });
  }

  // Per-bus-run analysis: which trains does each bus pick up / bring to departure
  const runAnalysis = busRuns.map((run) => {
    const incoming = data.incomingConnections(dayType, run.dep);
    const outgoing = data.outgoingConnections(dayType, run.ret);

    return { run, incoming, outgoing };
  });

  // Overall coverage KPIs: for each arrival train, is there ANY bus that catches it?
  let hamTotal = 0, hamCovered = 0;
  let schTotal = 0, schCovered = 0;

  const hamArrivals = data.hamGroups[dayType] || [];
  const schArrivals = data.schGroups[dayType] || [];

  for (const g of hamArrivals) {
    hamTotal += g.n;
    const need = g.planned + walkTime + boardTime;
    for (const run of busRuns) {
      if (run.dep >= need && run.dep - g.planned <= CONNECT_WINDOW) {
        const buffer = run.dep - g.planned - walkTime - boardTime;
        const ok = g.p90 !== null && g.p90 <= buffer;
        if (ok) { hamCovered += g.n; break; }
      }
    }
  }

  for (const g of schArrivals) {
    schTotal += g.n;
    const need = g.planned + walkTime + boardTime;
    for (const run of busRuns) {
      if (run.dep >= need && run.dep - g.planned <= CONNECT_WINDOW) {
        const buffer = run.dep - g.planned - walkTime - boardTime;
        const ok = g.p90 !== null && g.p90 <= buffer;
        if (ok) { schCovered += g.n; break; }
      }
    }
  }

  // Departing train constraints: can the bus arrive early enough?
  const depGroups = data.depGroups[dayType] || [];
  const eveDeparting = depGroups
    .map((g) => g.planned)
    .filter((t) => t >= 5 * 60 && t < 24 * 60);
  const missedTrains = [];
  for (const depTime of eveDeparting) {
    const ok = busRuns.some((t) => t.ret <= depTime - minBufferForDepartingTrain && t.ret >= depTime - 120);
    if (!ok) missedTrains.push(depTime);
  }

  return {
    busRuns,
    hamRate: hamTotal ? (hamCovered / hamTotal) * 100 : 0,
    schRate: schTotal ? (schCovered / schTotal) * 100 : 0,
    hamTotal,
    hamCovered,
    schTotal,
    schCovered,
    missedTrains,
    runAnalysis,
  };
}

/**
 * Score a simulation result for the optimizer.
 * Higher is better.
 */
function scoreState(result) {
  let score = result.hamRate + result.schRate;
  score -= result.missedTrains.length * 15;
  if (result.hamRate >= 90 && result.schRate >= 90) score += 60;
  return score;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { simulate, scoreState };
}

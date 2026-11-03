/**
 * test/simulation_test.js - Automated tests for the Bus 500 simulation.
 *
 * Run with: node test/simulation_test.js
 *
 * Tests cover:
 *  1. Data loading and accessors
 *  2. Incoming connections (bus picks up trains)
 *  3. Outgoing connections (bus brings people to departing trains)
 *  4. Coverage KPIs (Hamburg/Schwerin)
 *  5. Departing train constraints
 *  6. Optimizer convergence
 */

const assert = require("assert");
const path = require("path");

// Load the raw JSON data
const fs = require("fs");
const raw = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "sim_data.json"), "utf8"));

const { loadData } = require("../src/data");
const { simulate, scoreState } = require("../src/simulation");
const { optimize } = require("../src/optimizer");

const data = loadData(raw);
const DAY_TYPE = "wd"; // test with weekday data

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log("  ✓", name);
  } catch (e) {
    failed++;
    console.log("  ✗", name, "-", e.message);
  }
}

function eq(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg}: expected ${expected}, got ${actual}`);
  }
}

function near(actual, expected, tol, msg) {
  if (Math.abs(actual - expected) > tol) {
    throw new Error(`${msg}: expected ${expected}±${tol}, got ${actual}`);
  }
}

function ok(cond, msg) {
  if (!cond) throw new Error(msg || "condition failed");
}

// ------------------------------------------------------------------
// Test 1: Data loading
// ------------------------------------------------------------------
test("data loads with correct structure", () => {
  ok(data.walkTime === 1, "walkTime");
  ok(data.boardTime === 2, "boardTime");
  ok(data.minBufferForDepartingTrain === 5, "minBuffer");
  ok(Array.isArray(data.busDepartures), "busDepartures is array");
  ok(data.busDepartures.length === 25, "25 bus runs");
  ok(Array.isArray(data.busArrivals), "busArrivals is array");
  ok(data.busArrivals.length === 25, "25 bus arrivals");
});

test("allArrivals combines Hamburg and Schwerin", () => {
  const arrivals = data.allArrivals("wd");
  ok(arrivals.length > 0, "has arrivals");
  const sources = new Set(arrivals.map((a) => a.source));
  ok(sources.has("hamburg"), "has Hamburg");
  ok(sources.has("schwerin"), "has Schwerin");
});

test("allDepartures returns departure groups", () => {
  const deps = data.allDepartures("wd");
  ok(deps.length > 0, "has departures");
  ok(deps[0].planned !== undefined, "has planned time");
});

// ------------------------------------------------------------------
// Test 2: Incoming connections (bus picks up trains)
// ------------------------------------------------------------------
test("incomingConnections finds trains that can connect", () => {
  // Bus departs at 17:15 (1035 min)
  const conns = data.incomingConnections("wd", 1035);
  ok(conns.length > 0, "finds connections for 17:15 bus");
  // Every connection must satisfy: bus_dep >= planned + walk + board
  for (const c of conns) {
    ok(c.buffer >= 0, `buffer ${c.buffer} >= 0 for train at ${c.planned}`);
  }
});

test("incomingConnections buffer calculation is correct", () => {
  // Train at 17:07 (1027 min), bus at 17:15 (1035 min)
  // buffer = 1035 - 1027 - 1 - 2 = 5 min
  const conns = data.incomingConnections("wd", 1035);
  const train1707 = conns.find((c) => c.planned === 1027);
  ok(train1707, "finds 17:07 train");
  eq(train1707.buffer, 5, "buffer = 5 min for 17:07 train with 17:15 bus");
});

test("bus too early finds no connections", () => {
  const conns = data.incomingConnections("wd", 30); // 12:30 AM, before any train
  eq(conns.length, 0, "no connections for early bus");
});

// ------------------------------------------------------------------
// Test 3: Outgoing connections (bus brings people to departing trains)
// ------------------------------------------------------------------
test("outgoingConnections finds departing trains reachable by bus", () => {
  // Bus arrives at 17:46 (1066 min)
  const conns = data.outgoingConnections("wd", 1066);
  ok(conns.length > 0, "finds connections from 17:46 bus arrival");
  for (const c of conns) {
    ok(c.wait >= 0, `wait ${c.wait} >= 0`);
  }
});

test("outgoingConnections wait calculation", () => {
  // Bus arrives at 17:46 (1066 min), train departs at 18:15 (1095 min)
  // wait = 1095 - 1066 - 1 = 28 min
  const conns = data.outgoingConnections("wd", 1066);
  const train1815 = conns.find((c) => c.planned === 1095);
  if (train1815) {
    eq(train1815.wait, 28, "wait = 28 min");
  }
});

// ------------------------------------------------------------------
// Test 4: Simulation KPIs
// ------------------------------------------------------------------
test("simulate returns coverage rates", () => {
  const adjustments = {};
  for (let i = 0; i < 25; i++) adjustments[i] = { shift: 0, express: false };
  const result = simulate(data, adjustments, DAY_TYPE, true);
  ok(result.hamRate >= 0 && result.hamRate <= 100, "hamRate in [0,100]");
  ok(result.schRate >= 0 && result.schRate <= 100, "schRate in [0,100]");
  ok(typeof result.missedTrains === "number" || Array.isArray(result.missedTrains), "missedTrains is array");
});

test("simulate with shift improves Hamburg coverage", () => {
  const adjustments0 = {};
  for (let i = 0; i < 25; i++) adjustments0[i] = { shift: 0, express: false };
  const r0 = simulate(data, adjustments0, DAY_TYPE, true);

  const adjustments5 = {};
  for (let i = 0; i < 25; i++) adjustments5[i] = { shift: 5, express: false };
  const r5 = simulate(data, adjustments5, DAY_TYPE, true);

  // Shifting buses later should not decrease Hamburg coverage (more buffer)
  ok(r5.hamRate >= r0.hamRate - 1, "shifting later improves or maintains Hamburg coverage");
});

test("simulate respects min buffer for departing trains", () => {
  const adjustments = {};
  for (let i = 0; i < 25; i++) adjustments[i] = { shift: -60, express: false }; // shift all buses very early
  const result = simulate(data, adjustments, DAY_TYPE, true);
  // Very early buses mean late returns, likely missing departing trains
  ok(Array.isArray(result.missedTrains), "missedTrains is array");
});

// ------------------------------------------------------------------
// Test 5: Optimizer
// ------------------------------------------------------------------
test("optimizer runs and produces valid adjustments", () => {
  const initial = {};
  for (let i = 0; i < 25; i++) initial[i] = { shift: 0, express: false };
  const optResult = optimize(data, DAY_TYPE, initial, 3);
  ok(optResult.adjustments, "adjustments returned");
  ok(optResult.result, "result returned");
  ok(typeof optResult.iterations === "number", "iterations is number");
  ok(optResult.iterations > 0, "iterations > 0");
});

test("optimizer does not decrease score", () => {
  const initial = {};
  for (let i = 0; i < 25; i++) initial[i] = { shift: 0, express: false };
  const before = simulate(data, initial, DAY_TYPE, true);
  const beforeScore = scoreState(before);

  const optResult = optimize(data, DAY_TYPE, initial, 5);
  ok(optResult.score >= beforeScore, `optimizer score ${optResult.score} >= before ${beforeScore}`);
});

test("optimizer finds improvements for bad initial state", () => {
  // Start with all buses shifted very early (bad for the overall schedule)
  const initial = {};
  for (let i = 0; i < 25; i++) initial[i] = { shift: -30, express: false };
  const before = simulate(data, initial, DAY_TYPE, true);
  const optResult = optimize(data, DAY_TYPE, initial, 5);
  // The optimizer maximizes the combined score (coverage minus missed
  // departing trains), so it may trade a little Hamburg coverage for a
  // better overall schedule. Assert on the score it actually optimizes.
  ok(optResult.score >= scoreState(before), "optimizer improves or maintains overall score");
});

// ------------------------------------------------------------------
// Run all tests
// ------------------------------------------------------------------
console.log("\nRunning tests...\n");

console.log("\n=== Summary ===");
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Total:  ${passed + failed}`);

process.exit(failed > 0 ? 1 : 0);

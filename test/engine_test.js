/**
 * engine_test.js — Automated tests for the timetable generation engine,
 * including plausibility checks on the parsed data and generated schedules.
 *
 * Run: node test/engine_test.js
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const { generateTimetable, evaluate, expressSaving, defaultExpressSkips, toMin, toHHMM } =
  require("../src/engine/timetable_engine");
const { checkRingModel, checkGeneratedTimetable } =
  require("../src/engine/plausibility");
const { loadTrains } = require("../src/engine/trains");

const ROOT = path.join(__dirname, "..");
const simData = JSON.parse(fs.readFileSync(path.join(ROOT, "sim_data.json"), "utf8"));
const ringModel = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "ring_model.json"), "utf8"));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  \u2713", name); }
  catch (e) { failed++; console.log("  \u2717", name, "-", e.message); }
}
function ok(c, m) { if (!c) throw new Error(m || "condition failed"); }
function eq(a, b, m) { if (a !== b) throw new Error(`${m}: expected ${b}, got ${a}`); }

console.log("\nRunning engine tests...\n");

/* ---------------------------------------------------------- time utilities */
test("toMin / toHHMM round-trip", () => {
  eq(toMin("17:15"), 1035, "17:15");
  eq(toHHMM(1035), "17:15", "1035");
  eq(toHHMM(toMin("00:00")), "00:00", "midnight");
});

/* ------------------------------------------------------- ring model sanity */
test("ring model passes plausibility checks", () => {
  const problems = checkRingModel(ringModel);
  ok(problems.length === 0, "problems: " + problems.join("; "));
});

test("ring model: Bahnhof appears exactly twice", () => {
  eq(ringModel.stops.filter((s) => s.is_bahnhof).length, 2, "bahnhof count");
});

test("ring model: cycle time is plausible for a small-town ring", () => {
  ok(ringModel.cycle_min >= 20 && ringModel.cycle_min <= 45,
    `cycle ${ringModel.cycle_min} min`);
});

test("ring model: there are walkable express-skippable stops", () => {
  const n = ringModel.stops.filter((s) => s.express_skippable).length;
  ok(n > 0, "no skippable stops");
});

/* ---------------------------------------------------------- express saving */
test("express saves a bounded, positive amount of ride time", () => {
  const skips = defaultExpressSkips(ringModel);
  const saving = expressSaving(ringModel, skips);
  ok(saving > 0, "express should save time");
  ok(saving < 25, "express saving should be bounded");
});

test("express never skips Bahnhof stops", () => {
  const skips = defaultExpressSkips(ringModel);
  for (const i of skips) ok(!ringModel.stops[i].is_bahnhof, `skip ${i} is Bahnhof`);
});

/* ------------------------------------------------------------ generation */
test("loadTrains returns sorted arrivals & departures for wd", () => {
  const t = loadTrains(simData, "wd");
  ok(t.arrivals.length > 0, "has arrivals");
  ok(t.departures.length > 0, "has departures");
  for (let i = 1; i < t.arrivals.length; i++)
    ok(t.arrivals[i].min >= t.arrivals[i - 1].min, "arrivals sorted");
});

test("generateTimetable produces a plausible schedule (wd, normal)", () => {
  const trains = loadTrains(simData, "wd");
  const sched = generateTimetable({ trains, ringModel, anchorBuffer: 3 });
  ok(sched.runs.length > 0, "has runs");
  const problems = checkGeneratedTimetable(sched, {
    serviceStart: toMin("04:30"), serviceEnd: toMin("22:30"),
  });
  ok(problems.length === 0, "plausibility: " + problems.join("; "));
});

test("single vehicle never overlaps itself", () => {
  const trains = loadTrains(simData, "wd");
  const sched = generateTimetable({ trains, ringModel, anchorBuffer: 3 });
  const sorted = [...sched.runs].sort((a, b) => a.dep - b.dep);
  for (let i = 1; i < sorted.length; i++)
    ok(sorted[i].dep >= sorted[i - 1].ret, `overlap at ${sorted[i].dep}`);
});

test("express mode shortens the cycle vs normal mode", () => {
  const trains = loadTrains(simData, "wd");
  const normal = generateTimetable({ trains, ringModel, express: false });
  const expr = generateTimetable({ trains, ringModel, express: true });
  ok(expr.cycle < normal.cycle, `express cycle ${expr.cycle} !< normal ${normal.cycle}`);
});

test("arrival buffer tradeoff: required buffer up ⇒ robust share down (monotonic)", () => {
  const trains = loadTrains(simData, "wd");
  const sched = generateTimetable({ trains, ringModel, anchorBuffer: 3 });
  let prev = 101;
  for (const b of [0, 2, 4, 6, 8, 10]) {
    const r = evaluate(sched, trains, { arriveBuffer: b });
    ok(r.arrivalRate <= prev + 0.001, `rate rose at buffer ${b} (${r.arrivalRate} > ${prev})`);
    prev = r.arrivalRate;
  }
});

test("on a fixed schedule, the guaranteed wait to reach robustness b grows with b", () => {
  // For the trains that ARE robust at level b, the connection necessarily makes
  // their passengers wait >= b minutes (beyond board time). So the minimum wait
  // among robust connections is non-decreasing in b — the concrete cost the
  // arriving-train slider trades against robustness.
  const trains = loadTrains(simData, "wd");
  const sched = generateTimetable({ trains, ringModel, anchorBuffer: 3 });
  const boardTime = 2;
  function minWaitAmongRobust(b) {
    let m = Infinity;
    for (const a of trains.arrivals) {
      const bus = sched.runs
        .filter((r) => r.dep - a.min - boardTime >= 0 && r.dep - a.min <= 60)
        .sort((x, y) => x.dep - y.dep)[0];
      if (!bus) continue;
      const slack = bus.dep - a.min - boardTime;
      if (slack >= b) m = Math.min(m, slack);
    }
    return m;
  }
  let prev = -1;
  for (const b of [0, 2, 4, 6]) {
    const w = minWaitAmongRobust(b);
    if (w === Infinity) continue;
    ok(w >= b, `robust-at-${b} connections must wait >= ${b}, got ${w}`);
    ok(w >= prev - 0.001, `min guaranteed wait dropped at ${b}`);
    prev = w;
  }
});

test("departure buffer: tighter buffer never covers fewer (fixed schedule)", () => {
  const trains = loadTrains(simData, "wd");
  const sched = generateTimetable({ trains, ringModel });
  const a = evaluate(sched, trains, { departBuffer: 3 });
  const b = evaluate(sched, trains, { departBuffer: 15 });
  ok(b.departureRate <= a.departureRate + 0.001,
    `b ${b.departureRate} should be <= a ${a.departureRate}`);
});

test("express frees the vehicle: >= as many runs within the service day", () => {
  const trains = loadTrains(simData, "wd");
  const normal = generateTimetable({ trains, ringModel, express: false });
  const expr = generateTimetable({ trains, ringModel, express: true });
  ok(expr.runs.length >= normal.runs.length,
    `express runs ${expr.runs.length} should be >= normal ${normal.runs.length}`);
});

test("all three day types generate & evaluate without plausibility errors", () => {
  for (const dt of ["wd", "sa", "so"]) {
    const trains = loadTrains(simData, dt);
    const sched = generateTimetable({ trains, ringModel });
    const evalr = evaluate(sched, trains, { arriveBuffer: 3, departBuffer: 5 });
    const problems = checkGeneratedTimetable(sched, {
      serviceStart: toMin("04:30"), serviceEnd: toMin("22:30"), evaluation: evalr,
    });
    ok(problems.length === 0, `${dt}: ` + problems.join("; "));
  }
});

console.log("\n=== Summary ===");
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Total:  ${passed + failed}`);
process.exit(failed > 0 ? 1 : 0);

/**
 * umlauf_test.js — Tests + plausibility checks for the honest line-500 model.
 * Run: node test/umlauf_test.js
 */
const fs = require("fs");
const path = require("path");
const { evalRun, evalDay } = require("../src/engine/umlauf");

const ROOT = path.join(__dirname, "..");
const data = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "umlauf_data.json"), "utf8"));

let passed = 0, failed = 0;
function test(n, fn) {
  try { fn(); passed++; console.log("  \u2713", n); }
  catch (e) { failed++; console.log("  \u2717", n, "-", e.message); }
}
function ok(c, m) { if (!c) throw new Error(m || "failed"); }
function eq(a, b, m) { if (a !== b) throw new Error(`${m}: expected ${b} got ${a}`); }

const CFG = {
  board: data.board, walk: data.walk, expressSaving: data.express_saving,
  shift: 0, expressSet: [], arriveBufferMin: 0, departReserveMin: 0,
  schoolMode: "schule",
};

console.log("\nRunning umlauf tests...\n");

test("data parsed: express saving is plausible", () => {
  ok(data.express_saving > 0 && data.express_saving < 25,
    `saving ${data.express_saving}`);
  ok(data.express_skipped_stops.length > 0, "no skipped stops");
});

test("each day type has runs", () => {
  for (const dt of ["wd", "sa", "so"]) ok(data.days[dt].runs.length > 0, dt);
});

test("the 17:15 evening run matches the real pendling picture (wd)", () => {
  const runs = data.days.wd.runs;
  const r1715 = runs.find((r) => r.dep === 17 * 60 + 15);
  ok(r1715, "17:15 run exists");
  // couples from RE1 ~17:08, returns 17:46, feeds a departure ~17:48
  ok(r1715.arr && r1715.arr.min === 17 * 60 + 8, "arr 17:08");
  eq(r1715.ret, 17 * 60 + 46, "returns 17:46");
  ok(r1715.depTrain && r1715.depTrain.min === 17 * 60 + 48, "feeds 17:48");
});

test("direction labels follow the real RE1 timetable (from Hamburg -> toward Schwerin)", () => {
  // The 06:11 arrival comes FROM Hamburg and continues TOWARD Schwerin.
  const r = data.days.wd.runs.find((x) => x.dep === 6 * 60 + 15);
  ok(r && r.arr, "06:15 run has an arrival");
  eq(r.arr.from, "Hamburg", "from Hamburg");
  eq(r.arr.to, "Schwerin", "toward Schwerin");
  // A Schwerin-origin train (06:51) heads toward Hamburg.
  const s = data.days.wd.runs.find((x) => x.arr && x.arr.min === 6 * 60 + 51);
  ok(s, "found a 06:51-coupled run");
  eq(s.arr.from, "Schwerin", "from Schwerin");
  eq(s.arr.to, "Hamburg", "toward Hamburg");
});

test("the 06:55 and 07:00 buses are mutually exclusive (school vs holiday)", () => {
  const b0655 = data.days.wd.runs.find((r) => r.dep === 6 * 60 + 55);
  const b0700 = data.days.wd.runs.find((r) => r.dep === 7 * 60 + 0);
  ok(b0655 && b0655.service === "schule", "06:55 is school-only");
  ok(b0700 && b0700.service === "ferien", "07:00 is holiday-only");
});

test("evalDay never shows both school and holiday trips at once", () => {
  for (const mode of ["schule", "ferien"]) {
    const res = evalDay(data.days.wd, { ...CFG, schoolMode: mode });
    const other = mode === "schule" ? "ferien" : "schule";
    for (const r of res.runs) ok(r.service !== other, `leaked ${other} trip in ${mode} mode`);
    // the active exclusive type's trips ARE present when they exist
  }
});

test("school mode shows 06:55, holiday mode shows 07:00", () => {
  const school = evalDay(data.days.wd, { ...CFG, schoolMode: "schule" });
  const holiday = evalDay(data.days.wd, { ...CFG, schoolMode: "ferien" });
  ok(school.runs.some((r) => r.dep === 6 * 60 + 55), "school has 06:55");
  ok(!school.runs.some((r) => r.dep === 7 * 60 + 0), "school lacks 07:00");
  ok(holiday.runs.some((r) => r.dep === 7 * 60 + 0), "holiday has 07:00");
  ok(!holiday.runs.some((r) => r.dep === 6 * 60 + 55), "holiday lacks 06:55");
});

test("evalRun: arrival buffer = busDep - trainArr - board", () => {
  const run = { dep: 1035, ret: 1066, ring: 31,
    arr: { min: 1028, dir: "hamburg", p90: 8, n: 100 }, depTrain: null };
  const r = evalRun(run, { board: 2, walk: 1, expressSaving: 22 });
  eq(r.arrival.buffer, 1035 - 1028 - 2, "buffer");  // = 5
});

test("evalRun: express shortens ring and increases return reserve", () => {
  const run = { dep: 1035, ret: 1066, ring: 31,
    arr: null, depTrain: { min: 1110, p90: 5, n: 50 } };
  const normal = evalRun(run, { board: 2, walk: 1, expressSaving: 22, express: false });
  const expr = evalRun(run, { board: 2, walk: 1, expressSaving: 22, express: true });
  ok(expr.ring < normal.ring, "express ring shorter");
  ok(expr.departure.reserve > normal.departure.reserve, "express reserve larger");
});

test("robustness: a p90-late train needs buffer >= p90", () => {
  // buffer 5, p90 8 -> not robust; buffer 10, p90 8 -> robust
  const base = { dep: 0, ret: 31, ring: 31, depTrain: null };
  const tight = evalRun({ ...base, dep: 1035, arr: { min: 1028, p90: 8, n: 1 } },
    { board: 2, walk: 1, expressSaving: 22 });
  ok(tight.arrival.buffer === 5 && !tight.arrival.robust, "buffer 5 < p90 8 not robust");
  const loose = evalRun({ ...base, dep: 1040, arr: { min: 1028, p90: 8, n: 1 } },
    { board: 2, walk: 1, expressSaving: 22 });
  ok(loose.arrival.buffer === 10 && loose.arrival.robust, "buffer 10 >= p90 8 robust");
});

test("evalDay produces sane KPIs for wd", () => {
  const res = evalDay(data.days.wd, CFG);
  const k = res.kpis;
  for (const key of ["arrReachRate", "arrRobustRate", "depReachRate"])
    ok(k[key] >= 0 && k[key] <= 100, `${key}=${k[key]}`);
  // evalDay filters mutually-exclusive trips, so visible runs <= total runs
  ok(res.runs.length > 0 && res.runs.length <= data.days.wd.runs.length, "runCount sane");
});

test("positive shift increases arrival buffers (bus leaves later)", () => {
  const a = evalDay(data.days.wd, { ...CFG, shift: 0 });
  const b = evalDay(data.days.wd, { ...CFG, shift: 5 });
  ok(b.kpis.meanArrBuffer >= a.kpis.meanArrBuffer - 0.001,
    `shift+5 buffer ${b.kpis.meanArrBuffer} vs ${a.kpis.meanArrBuffer}`);
});

test("positive shift reduces return reserve (bus back later) -> depart coverage down or equal", () => {
  const a = evalDay(data.days.wd, { ...CFG, shift: 0, departReserveMin: 2 });
  const b = evalDay(data.days.wd, { ...CFG, shift: 10, departReserveMin: 2 });
  ok(b.kpis.depReachRate <= a.kpis.depReachRate + 0.001,
    `shift+10 dep ${b.kpis.depReachRate} should be <= ${a.kpis.depReachRate}`);
});

test("making all runs express never reduces departure reachability", () => {
  const all = data.days.wd.runs.map((_, i) => i);
  const normal = evalDay(data.days.wd, { ...CFG, departReserveMin: 2 });
  const expr = evalDay(data.days.wd, { ...CFG, expressSet: all, departReserveMin: 2 });
  ok(expr.kpis.depReachRate >= normal.kpis.depReachRate - 0.001,
    `express dep ${expr.kpis.depReachRate} vs normal ${normal.kpis.depReachRate}`);
});

test("plausibility: every run returns after it departs", () => {
  for (const dt of ["wd", "sa", "so"]) {
    const res = evalDay(data.days[dt], CFG);
    for (const r of res.runs) ok(r.ret > r.dep, `${dt} run ${r.dep}`);
  }
});

test("plausibility: ring durations are small-town sane (15..45 min)", () => {
  for (const dt of ["wd", "sa", "so"])
    for (const r of data.days[dt].runs)
      ok(r.ring >= 15 && r.ring <= 45, `${dt} ring ${r.ring}`);
});

console.log("\n=== Summary ===");
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Total:  ${passed + failed}`);
process.exit(failed > 0 ? 1 : 0);

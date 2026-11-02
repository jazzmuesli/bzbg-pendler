/**
 * optimizer.js - Coordinate-descent optimization for bus timetable.
 *
 * Pure, testable. Adjusts shift and express per bus run to maximize
 * the simulation score.
 */

const { simulate, scoreState } = require("./simulation");

/**
 * Run coordinate-descent optimization.
 *
 * @param {Object} data - Data accessor from loadData()
 * @param {string} dayType - "wd", "sa", or "so"
 * @param {Object} initialAdjustments - { [busIndex]: { shift, express } }
 * @param {number} maxIter - Maximum iterations
 * @param {Function} onProgress - Optional callback(iteration, bestScore)
 * @returns {Object} { adjustments, result, iterations, score }
 */
function optimize(data, dayType, initialAdjustments = {}, maxIter = 10, onProgress) {
  // Deep copy initial adjustments
  const adjustments = {};
  for (const [idx, adj] of Object.entries(initialAdjustments)) {
    adjustments[idx] = { ...adj };
  }

  let bestResult = simulate(data, adjustments, dayType);
  let bestScore = scoreState(bestResult);
  let improved = true;
  let iterations = 0;

  while (improved && iterations < maxIter) {
    improved = false;
    iterations++;

    for (let i = 0; i < data.busDepartures.length; i++) {
      const idx = String(i);
      const cur = { ...adjustments[idx] };
      let best = { ...cur };
      let bestScore = scoreState(simulate(data, adjustments, dayType));

      // Try different shifts
      for (let s = -10; s <= 10; s += 3) {
        if (s === cur.shift) continue;
        adjustments[idx] = { ...cur, shift: s };
        const sc = scoreState(simulate(data, adjustments, dayType));
        if (sc > bestScore) {
          bestScore = sc;
          best = { ...adjustments[idx] };
        }
      }

      // Try express on/off
      for (const ex of [true, false]) {
        if (ex === cur.express) continue;
        adjustments[idx] = { ...cur, express: ex };
        const sc = scoreState(simulate(data, adjustments, dayType));
        if (sc > bestScore) {
          bestScore = sc;
          best = { ...adjustments[idx] };
        }
      }

      adjustments[idx] = best;
      if (best.shift !== cur.shift || best.express !== cur.express) {
        improved = true;
      }

      if (onProgress) onProgress(iterations, bestScore);
    }
  }

  const finalResult = simulate(data, adjustments, dayType);
  return {
    adjustments,
    result: finalResult,
    iterations,
    score: scoreState(finalResult),
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { optimize };
}

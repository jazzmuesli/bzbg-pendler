/**
 * data.js - Data loading and preprocessing for the Bus 500 simulation.
 *
 * Reads sim_data.json and provides clean accessors for:
 *  - arrival groups (by day type: wd/sa/so)
 *  - departure groups (by day type)
 *  - bus timetable (departures/arrivals at Bahnhof)
 *  - per-bus-run connection analysis (precomputed in sim_data.json)
 */

const WALK = 1;    // min from train to bus stop
const BOARD = 2;   // min to board bus

/**
 * Load and wrap the sim_data.json.
 * @param {Object} raw - Parsed sim_data.json
 * @returns {Object} Data accessor object
 */
function loadData(raw) {
  const dayTypes = ["wd", "sa", "so"];

  return {
    generated: raw.generated,
    walkTime: raw.walk_time,
    boardTime: raw.board_time,
    minBufferForDepartingTrain: raw.min_buffer_for_departing_train,

    busDepartures: raw.bus_departures,   // array of minutes-from-midnight
    busArrivals: raw.bus_arrivals,

    hamGroups: raw.ham_groups,   // dayType -> [{planned, n, delays, p90, median, mean}]
    schGroups: raw.sch_groups,
    depGroups: raw.dep_groups,   // dayType -> [{planned, n_ham, n_sch, delays, p90, median}]

    busRuns: raw.bus_runs,       // index -> {dep_orig, ret_orig, route_time, incoming: {dayType: [...]}, outgoing: {dayType: [...]}}

    /**
     * Get all arrival groups for a day type (Hamburg + Schwerin combined).
     */
    allArrivals(dayType) {
      return [
        ...(this.hamGroups[dayType] || []).map((g) => ({ ...g, source: "hamburg" })),
        ...(this.schGroups[dayType] || []).map((g) => ({ ...g, source: "schwerin" })),
      ];
    },

    /**
     * Get all departure groups for a day type.
     */
    allDepartures(dayType) {
      return this.depGroups[dayType] || [];
    },

    /**
     * For a given bus departure time and day type, find which arrival trains
     * can connect to this bus.
     * Connection rule: bus_dep >= planned_arrival + walk + board
     * Buffer = bus_dep - planned_arrival - walk - board (delay the bus absorbs)
     */
    incomingConnections(dayType, busDep) {
      const arrivals = this.allArrivals(dayType);
      const conns = [];
      for (const g of arrivals) {
        const need = g.planned + this.walkTime + this.boardTime;
        if (busDep < need) continue;
        const buffer = busDep - g.planned - this.walkTime - this.boardTime;
        conns.push({
          planned: g.planned,
          source: g.source,
          n: g.n,
          p90: g.p90,
          median: g.median,
          buffer,
          waitOnTime: buffer,
          coversP90: g.p90 !== null && g.p90 <= buffer,
        });
      }
      return conns;
    },

    /**
     * For a given bus arrival time and day type, find which departing trains
     * this bus can bring passengers to.
     * Rule: bus_arrival + minBuffer <= train_departure
     */
    outgoingConnections(dayType, busArr) {
      const deps = this.allDepartures(dayType);
      const conns = [];
      for (const g of deps) {
        if (busArr + this.minBufferForDepartingTrain > g.planned) continue;
        const wait = g.planned - busArr - this.walkTime;
        conns.push({
          planned: g.planned,
          n: g.n_ham + g.n_sch,
          p90: g.p90,
          wait,
        });
      }
      return conns;
    },
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { loadData, WALK, BOARD };
}

/* Roster engine: data model, automatic roster generation and rule checking.
   No DOM access, so it runs in the browser and in Node (for testing). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.RosterEngine = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  // Penalty weights. "hard" rules must never be broken; the rest are preferences.
  const W = {
    hard: 1000, cover: 600, under: 70, over: 8, anyOver: 1, extra: 3,
    nbShort: 150, nbLong: 500, nightRest: 400,
    shortRun: 300, gap: 300, single: 40, singleOff: 15, backward: 10, fair: 6
  };

  function uid() {
    return Math.random().toString(36).slice(2, 9);
  }
  function toMin(hhmm) {
    const p = String(hhmm || "0:0").split(":");
    return (+p[0] || 0) * 60 + (+p[1] || 0);
  }
  function parseDate(iso) {
    const p = iso.split("-").map(Number);
    return new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  }
  function fmtISO(dt) {
    return dt.toISOString().slice(0, 10);
  }
  function addDays(iso, n) {
    const d = parseDate(iso);
    d.setUTCDate(d.getUTCDate() + n);
    return fmtISO(d);
  }
  function mondayOf(iso) {
    const d = parseDate(iso);
    return addDays(iso, -((d.getUTCDay() + 6) % 7));
  }
  function dayDiff(a, b) {
    return Math.round((parseDate(b) - parseDate(a)) / 86400000);
  }
  function todayISO() {
    const n = new Date();
    return fmtISO(new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate())));
  }

  /* Default period: Monday of the week holding the 1st of next month, to the Sunday of the week holding the last day of the third month. */
  function endOfThreeMonths(y, m) {
    return addDays(mondayOf(fmtISO(new Date(Date.UTC(y, m + 3, 0)))), 6);
  }
  function defaultRange(fromISO) {
    const d = parseDate(fromISO), y = d.getUTCFullYear(), m = d.getUTCMonth() + 1;
    return { start: mondayOf(fmtISO(new Date(Date.UTC(y, m, 1)))), end: endOfThreeMonths(y, m) };
  }
  /* For a period starting on the given Monday: the end date three months on. */
  function rangeFromStart(startISO) {
    const d = parseDate(addDays(mondayOf(startISO), 6));
    return { start: mondayOf(startISO), end: endOfThreeMonths(d.getUTCFullYear(), d.getUTCMonth()) };
  }

  function week(mon, tue, wed, thu, fri, sat, sun) {
    return [mon, tue, wed, thu, fri, sat, sun];
  }

  function defaultState() {
    const wkdays = week(1, 1, 1, 1, 1, 0, 0);
    const wkend = week(0, 0, 0, 0, 0, 1, 1);
    const none = week(0, 0, 0, 0, 0, 0, 0);
    const shiftTypes = [
      { id: "day", code: "D", name: "Day", start: "08:00", end: "16:30", hours: 8, color: "#bdd7ee", need: wkdays.concat(wkdays), extra: 2 },
      { id: "eve", code: "E", name: "Evening", start: "14:00", end: "22:00", hours: 8, color: "#a9d08e", need: wkdays.concat(wkdays), extra: 0 },
      { id: "leve", code: "L/E", name: "Letters / Evening", start: "12:00", end: "22:00", hours: 10, color: "#c6e0b4", need: none.concat(none), extra: 0 },
      { id: "night", code: "N", name: "Night", start: "21:30", end: "08:30", hours: 11, color: "#f8cbad", need: wkdays.concat(wkdays), extra: 0 },
      { id: "wday", code: "WD", name: "Weekend Day", start: "08:00", end: "20:30", hours: 12.5, color: "#9dc3e6", need: wkend.concat(wkend), extra: 0 },
      { id: "wnight", code: "WN", name: "Weekend Night", start: "20:00", end: "08:30", hours: 12.5, color: "#f4b183", need: wkend.concat(wkend), extra: 0 },
      { id: "clinic", code: "C", name: "Clinic", start: "08:00", end: "16:30", hours: 8, color: "#ffe699", need: week(1, 0, 1, 1, 0, 0, 0).concat(week(1, 0, 1, 1, 0, 0, 0)), extra: 0 },
      { id: "clinic2", code: "C2", name: "Clinic 2", start: "08:00", end: "16:30", hours: 8, color: "#ffd966", need: week(0, 1, 0, 0, 1, 0, 0).concat(week(0, 0, 0, 0, 1, 0, 0)), extra: 0 }
    ];
    const all = function () { return week(true, true, true, true, true, true, true); };
    const no = function () { return week(false, false, false, false, false, false, false); };
    function mk(name, group, fte, allowed) {
      const avail = {};
      shiftTypes.forEach(function (t) {
        avail[t.id] = allowed.indexOf(t.id) >= 0 ? all() : no();
      });
      return {
        id: uid(), name: name, group: group, fte: fte, weeks: "all", avail: avail,
        maxRun: null, clump: false, minRun: 5, minOff: 3, noNightStart: false
      };
    }
    const ward = ["day", "eve", "leve", "night", "wday", "wnight"];
    const staff = [
      mk("AT-1", "AT", 1, ward.concat(["clinic2"])),
      mk("AT-2", "AT", 1, ward.concat(["clinic2"])),
      mk("AT-3", "AT", 1, ward.concat(["clinic2"])),
      mk("AT-C", "AT", 1, ["day", "wday", "clinic"]),
      mk("BT-1", "BT", 1, ward),
      mk("BT-2", "BT", 0.5, ward),
      mk("BT-3", "BT", 0.5, ward)
    ];
    return normalise({
      version: 1,
      settings: {
        title: "Roster", startDate: defaultRange(todayISO()).start, endDate: defaultRange(todayISO()).end,
        fullTimeHours: 80, overTolerance: 8, minRestHours: 10, maxRun: 6,
        nightBlockMin: 3, nightBlockMax: 4, restAfterNights: 2
      },
      shiftTypes: shiftTypes,
      leaveTypes: [
        { id: "al", code: "AL", name: "Annual Leave", hours: 8, color: "#d98cf0" },
        { id: "ado", code: "ADO", name: "Accrued Day Off", hours: 8, color: "#ff9a3c" },
        { id: "sl", code: "SL", name: "Sick Leave", hours: 8, color: "#f2a0c8" }
      ],
      staff: staff,
      requests: [],
      roster: null
    });
  }

  function num(v, def) {
    const n = parseFloat(v);
    return isFinite(n) ? n : def;
  }

  /* Fill in anything missing so older or hand-edited files still load. */
  function normalise(st) {
    st = st || {};
    st.version = 1;
    const s = st.settings = st.settings || {};
    s.title = s.title || "Roster";
    const isDate = function (v) { return /^\d{4}-\d{2}-\d{2}$/.test(v || ""); };
    if (!isDate(s.startDate) || !isDate(s.endDate)) {
      const def = defaultRange(todayISO());
      s.startDate = def.start;
      s.endDate = def.end;
      st.roster = null;
    }
    s.startDate = mondayOf(s.startDate);
    s.weeks = Math.max(1, Math.min(53, Math.ceil((dayDiff(s.startDate, s.endDate) + 1) / 7)));
    s.endDate = addDays(s.startDate, s.weeks * 7 - 1);
    delete s.fortnights;
    s.fullTimeHours = num(s.fullTimeHours, 80);
    s.overTolerance = num(s.overTolerance, 8);
    s.minRestHours = num(s.minRestHours, 10);
    s.maxRun = Math.max(1, Math.round(num(s.maxRun, 6)));
    s.nightBlockMin = Math.max(1, Math.round(num(s.nightBlockMin, 3)));
    s.nightBlockMax = Math.max(s.nightBlockMin, Math.round(num(s.nightBlockMax, 4)));
    s.restAfterNights = Math.max(0, Math.round(num(s.restAfterNights, 2)));
    s.maxAttempts = Math.max(1, Math.min(50, Math.round(num(s.maxAttempts, 10))));
    st.shiftTypes = Array.isArray(st.shiftTypes) ? st.shiftTypes : [];
    st.shiftTypes.forEach(function (t) {
      t.id = t.id || uid();
      t.code = t.code || "?";
      t.name = t.name || t.code;
      t.start = t.start || "08:00";
      t.end = t.end || "16:30";
      t.hours = num(t.hours, 8);
      t.color = t.color || "#dddddd";
      t.extra = Math.max(0, Math.round(num(t.extra, 0)));
      const need = Array.isArray(t.need) ? t.need : [];
      t.need = [];
      for (let i = 0; i < 14; i++) {
        t.need.push(Math.max(0, Math.round(num(need[i], 0))));
      }
    });
    st.leaveTypes = Array.isArray(st.leaveTypes) ? st.leaveTypes : [];
    st.leaveTypes.forEach(function (l) {
      l.id = l.id || uid();
      l.code = l.code || "?";
      l.name = l.name || l.code;
      l.hours = num(l.hours, 0);
      l.color = l.color || "#dddddd";
    });
    st.staff = Array.isArray(st.staff) ? st.staff : [];
    st.staff.forEach(function (p) {
      p.id = p.id || uid();
      p.name = p.name || "Staff";
      p.group = p.group || "";
      p.fte = num(p.fte, 1);
      p.weeks = p.weeks === "odd" || p.weeks === "even" ? p.weeks : "all";
      p.maxRun = p.maxRun === null || p.maxRun === "" || p.maxRun === undefined ? null : Math.max(1, Math.round(num(p.maxRun, 6)));
      p.clump = !!p.clump;
      p.minRun = Math.max(1, Math.round(num(p.minRun, 5)));
      p.minOff = Math.max(1, Math.round(num(p.minOff, 3)));
      p.noNightStart = !!p.noNightStart;
      p.avail = p.avail || {};
      st.shiftTypes.forEach(function (t) {
        const a = Array.isArray(p.avail[t.id]) ? p.avail[t.id] : [];
        p.avail[t.id] = DAYS.map(function (_, i) { return !!a[i]; });
      });
    });
    st.requests = Array.isArray(st.requests) ? st.requests : [];
    st.requests.forEach(function (r) { r.id = r.id || uid(); });
    const D = s.weeks * 7;
    if (st.roster && st.roster.cells) {
      const cells = {}, locks = {};
      st.staff.forEach(function (p) {
        const c = st.roster.cells[p.id] || [], l = (st.roster.locks || {})[p.id] || [];
        cells[p.id] = [];
        locks[p.id] = [];
        for (let d = 0; d < D; d++) {
          cells[p.id].push(c[d] || "");
          locks[p.id].push(!!l[d]);
        }
      });
      st.roster = { cells: cells, locks: locks };
    } else {
      st.roster = null;
    }
    return st;
  }

  /* Compile the state into typed arrays and return the scoring functions.
     mode: "solve" (requests fixed), "keep" (requests + locked cells fixed), "analyse" (score the saved roster). */
  function build(state, mode) {
    const S = state.settings, D = S.weeks * 7, F = Math.ceil(S.weeks / 2);
    const types = state.shiftTypes.map(function (t) {
      const st = toMin(t.start), e0 = toMin(t.end), en = e0 <= st ? e0 + 1440 : e0;
      return { id: t.id, name: t.name, code: t.code, hours: t.hours, st: st, en: en, night: en > 1440, need: t.need, extra: t.extra };
    });
    const T = types.length, L = state.leaveTypes.length;
    const leaves = state.leaveTypes;
    const idToVal = {};
    types.forEach(function (t, i) { idToVal[t.id] = i; });
    leaves.forEach(function (l, i) { idToVal[l.id] = T + i; });
    const restOK = [], backward = [];
    for (let a = 0; a < T; a++) {
      restOK.push([]);
      backward.push([]);
      for (let b = 0; b < T; b++) {
        restOK[a].push(1440 + types[b].st - types[a].en >= S.minRestHours * 60);
        backward[a].push(types[b].st < types[a].st - 60);
      }
    }
    const staff = state.staff.map(function (p) {
      return {
        id: p.id, name: p.name, fte: p.fte, target: p.fte * S.fullTimeHours, maxRun: p.maxRun || S.maxRun,
        clump: p.clump, minRun: p.minRun, minOff: p.minOff, noNightStart: p.noNightStart, weeks: p.weeks,
        canNight: types.some(function (t) { return t.night && p.avail[t.id].some(Boolean); }),
        canWeekend: types.some(function (t) { return p.avail[t.id][5] || p.avail[t.id][6]; })
      };
    });
    const N = staff.length;
    const grid = [], fixed = [], dom = [], mask = [];
    const cnt = new Int16Array(D * Math.max(1, T));
    function cap(t, d) {
      const n = types[t].need[d % 14];
      return n > 0 ? n + types[t].extra : 0;
    }
    for (let s = 0; s < N; s++) {
      grid.push(new Int8Array(D).fill(-1));
      fixed.push(new Uint8Array(D));
    }
    const sIdx = {};
    staff.forEach(function (p, i) { sIdx[p.id] = i; });
    const reqMiss = [];
    state.requests.forEach(function (r) {
      const s = sIdx[r.staffId];
      if (s === undefined || !r.from) { return; }
      const v = r.kind === "off" ? -1 : idToVal[r.refId];
      if (v === undefined) { return; }
      const a = Math.max(0, dayDiff(S.startDate, r.from)), b = Math.min(D - 1, dayDiff(S.startDate, r.to || r.from));
      for (let d = a; d <= b; d++) {
        if (mode === "analyse") {
          reqMiss.push([s, d, v]);
        } else {
          grid[s][d] = v;
          fixed[s][d] = 1;
        }
      }
    });
    if (state.roster && mode !== "solve") {
      for (let s = 0; s < N; s++) {
        const c = state.roster.cells[staff[s].id] || [], l = state.roster.locks[staff[s].id] || [];
        for (let d = 0; d < D; d++) {
          if (mode === "analyse" || l[d]) {
            const v = idToVal[c[d]];
            grid[s][d] = v === undefined ? -1 : v;
            fixed[s][d] = 1;
          }
        }
      }
    }
    for (let s = 0; s < N; s++) {
      const p = state.staff[s];
      dom.push([]);
      mask.push(new Int32Array(D));
      for (let d = 0; d < D; d++) {
        let list;
        if (fixed[s][d]) {
          list = [grid[s][d]];
        } else {
          list = [-1];
          const wk = (d / 7) | 0, wd = d % 7;
          const weekOK = p.weeks === "all" || (p.weeks === "odd" ? wk % 2 === 0 : wk % 2 === 1);
          if (weekOK) {
            for (let t = 0; t < T; t++) {
              if (p.avail[types[t].id][wd] && cap(t, d) > 0) { list.push(t); }
            }
          }
        }
        dom[s].push(list);
        let m = 0;
        list.forEach(function (v) { m |= 1 << (v + 1); });
        mask[s][d] = m;
      }
    }
    function recount() {
      cnt.fill(0);
      for (let s = 0; s < N; s++) {
        for (let d = 0; d < D; d++) {
          const v = grid[s][d];
          if (v >= 0 && v < T) { cnt[d * T + v]++; }
        }
      }
    }
    const hrs = new Float64Array(F);
    const nightsCnt = new Float64Array(N), wkCnt = new Float64Array(N);
    const hoursOut = [];

    function rowCost(s, issues) {
      const st = staff[s], row = grid[s];
      const nbMin = S.nightBlockMin, nbMax = S.nightBlockMax, restAfter = S.restAfterNights;
      let cost = 0, run = 0, runStart = 0, nb = 0, nbStart = 0, lastNight = -99, off = 0, hadRun = false, nights = 0, wk = 0;
      hrs.fill(0);
      for (let d = 0; d <= D; d++) {
        const v = d < D ? row[d] : -1;
        if (v >= 0 && v < T) {
          const t = types[v];
          hrs[(d / 14) | 0] += t.hours;
          if (d % 7 >= 5) { wk++; }
          if (nb > 0 && !t.night) {
            if (nb < nbMin && nbStart > 0) { cost += W.nbShort * (nbMin - nb); }
            lastNight = d - 1;
            nb = 0;
          }
          if (run === 0) {
            runStart = d;
            if (hadRun) {
              if (st.clump) {
                if (off < st.minOff) {
                  cost += W.gap * (st.minOff - off);
                  if (issues) { issues.push({ s: s, d: d, text: "only " + off + " day(s) off between groups of shifts (wants " + st.minOff + ")" }); }
                }
              } else if (off === 1) {
                cost += W.singleOff;
              }
            }
            if (st.noNightStart && t.night) {
              cost += W.hard;
              if (issues) { issues.push({ s: s, d: d, text: "group of shifts starts with a night" }); }
            }
          } else {
            const p = row[d - 1];
            if (!restOK[p][v]) {
              cost += W.hard;
              if (issues) { issues.push({ s: s, d: d, text: "less than " + S.minRestHours + "h rest after " + types[p].name }); }
            } else if (backward[p][v]) {
              cost += W.backward;
            }
          }
          run++;
          if (nb === 0) {
            const g = d - lastNight - 1;
            if (g < restAfter) {
              cost += W.nightRest * (restAfter - g);
              if (issues && g > 0) { issues.push({ s: s, d: d, text: "only " + g + " day(s) off after nights (wants " + restAfter + ")" }); }
            }
          }
          if (t.night) {
            if (nb === 0) { nbStart = d; }
            nb++;
            nights++;
            if (nb > nbMax) {
              cost += W.nbLong;
              if (issues && nb === nbMax + 1) { issues.push({ s: s, d: d, text: "more than " + nbMax + " nights in a row" }); }
            }
          }
        } else {
          if (v >= T) { hrs[(d / 14) | 0] += leaves[v - T].hours; }
          if (nb > 0) {
            if (nb < nbMin && nbStart > 0 && d < D) {
              cost += W.nbShort * (nbMin - nb);
              if (issues) { issues.push({ s: s, d: nbStart, text: "only " + nb + " night(s) together (wants " + nbMin + "-" + nbMax + ")", soft: true }); }
            }
            lastNight = d - 1;
            nb = 0;
          }
          if (run > 0) {
            const edge = runStart === 0 || d >= D;
            if (run > st.maxRun) {
              cost += W.hard * (run - st.maxRun);
              if (issues) { issues.push({ s: s, d: runStart, text: run + " days in a row (max " + st.maxRun + ")" }); }
            }
            if (st.clump) {
              if (run < st.minRun && !edge) {
                cost += W.shortRun * (st.minRun - run);
                if (issues) { issues.push({ s: s, d: runStart, text: "only " + run + " shift(s) together (wants at least " + st.minRun + ")" }); }
              }
            } else if (run === 1 && !edge) {
              cost += W.single;
            }
            run = 0;
            off = 0;
            hadRun = true;
          }
          off++;
        }
      }
      for (let f = 0; f < F; f++) {
        const part = f === F - 1 && D % 14 !== 0 ? 0.5 : 1, target = st.target * part;
        const diff = hrs[f] - target;
        if (diff < 0) {
          cost -= W.under * diff;
          if (issues) { issues.push({ s: s, d: f * 14, text: "fortnight " + (f + 1) + ": " + hrs[f] + "h, " + (-diff) + "h under the " + target + "h minimum", hours: true }); }
        } else {
          cost += W.anyOver * diff;
          if (diff > S.overTolerance * part) { cost += W.over * (diff - S.overTolerance * part); }
        }
      }
      nightsCnt[s] = nights;
      wkCnt[s] = wk;
      if (issues) { hoursOut[s] = Array.from(hrs); }
      return cost;
    }

    function covDay(d, unfilled) {
      let c = 0;
      for (let t = 0; t < T; t++) {
        const need = types[t].need[d % 14], n = cnt[d * T + t];
        if (n < need) {
          c += W.cover * (need - n);
          if (unfilled) { unfilled.push({ d: d, typeId: types[t].id, missing: need - n }); }
        } else if (n > need) {
          const over = n - (need > 0 ? need + types[t].extra : 0);
          c += over > 0 ? W.hard * over + W.extra * (n - need - over) : W.extra * (n - need);
        }
      }
      return c;
    }

    function fairCost() {
      let c = 0;
      [[nightsCnt, "canNight"], [wkCnt, "canWeekend"]].forEach(function (pair) {
        let tot = 0, w = 0;
        for (let s = 0; s < N; s++) {
          if (staff[s][pair[1]]) { tot += pair[0][s]; w += staff[s].fte; }
        }
        if (w <= 0) { return; }
        for (let s = 0; s < N; s++) {
          if (staff[s][pair[1]]) {
            const x = pair[0][s] - tot * staff[s].fte / w;
            c += W.fair * x * x;
          }
        }
      });
      return c;
    }

    return {
      S: S, D: D, F: F, T: T, N: N, types: types, leaves: leaves, staff: staff, grid: grid, fixed: fixed, dom: dom, mask: mask,
      cnt: cnt, restOK: restOK, recount: recount, rowCost: rowCost, covDay: covDay, fairCost: fairCost,
      nightsCnt: nightsCnt, wkCnt: wkCnt, hoursOut: hoursOut, reqMiss: reqMiss, idToVal: idToVal
    };
  }

  function valToId(c, v) {
    return v < 0 ? "" : v < c.T ? c.types[v].id : c.leaves[v - c.T].id;
  }

  /* Simulated annealing solver. Call step(n) repeatedly until it returns true, then result(). */
  function createSolver(state, opts) {
    opts = opts || {};
    const c = build(state, opts.keepLocks ? "keep" : "solve");
    const D = c.D, T = c.T, N = c.N, grid = c.grid, fixed = c.fixed, dom = c.dom, mask = c.mask, cnt = c.cnt, types = c.types;
    c.recount();

    // Greedy start: fill each required shift with the person furthest below their hours.
    const used = [];
    for (let s = 0; s < N; s++) { used.push(new Float64Array(c.F)); }
    for (let d = 0; d < D; d++) {
      for (let t = 0; t < T; t++) {
        while (cnt[d * T + t] < types[t].need[d % 14]) {
          let best = -1, bestScore = Infinity;
          for (let s = 0; s < N; s++) {
            if (fixed[s][d] || grid[s][d] !== -1 || !(mask[s][d] & (1 << (t + 1)))) { continue; }
            const p = d > 0 ? grid[s][d - 1] : -1;
            if (p >= 0 && p < T && !c.restOK[p][t]) { continue; }
            const score = used[s][(d / 14) | 0] / Math.max(1, c.staff[s].target) + Math.random() * 0.05;
            if (score < bestScore) { bestScore = score; best = s; }
          }
          if (best < 0) { break; }
          grid[best][d] = t;
          cnt[d * T + t]++;
          used[best][(d / 14) | 0] += types[t].hours;
        }
      }
    }

    const rowC = new Float64Array(N), covC = new Float64Array(D);
    let cur = 0;
    for (let s = 0; s < N; s++) { rowC[s] = c.rowCost(s); cur += rowC[s]; }
    for (let d = 0; d < D; d++) { covC[d] = c.covDay(d); cur += covC[d]; }
    let fairC = c.fairCost();
    cur += fairC;
    let best = cur;
    let bestGrid = grid.map(function (r) { return Int8Array.from(r); });

    const total = N === 0 || T === 0 ? 0 : Math.min(1500000, Math.max(300000, N * D * 1500));
    const T0 = 80, T1 = 0.3;
    let it = 0;
    const chS = new Int32Array(64), chD = new Int32Array(64), chOld = new Int8Array(64);
    let nCh = 0;
    const stamp = new Int32Array(D);
    let stampNo = 0;
    const days = new Int32Array(64);

    function change(s, d, v) {
      const o = grid[s][d];
      if (o === v) { return; }
      chS[nCh] = s; chD[nCh] = d; chOld[nCh] = o; nCh++;
      if (o >= 0 && o < T) { cnt[d * T + o]--; }
      grid[s][d] = v;
      if (v >= 0 && v < T) { cnt[d * T + v]++; }
    }
    function rnd(n) { return (Math.random() * n) | 0; }

    function step(n) {
      const end = Math.min(total, it + n);
      for (; it < end; it++) {
        const temp = T0 * Math.pow(T1 / T0, it / total);
        nCh = 0;
        const r = Math.random();
        let a = rnd(N), b = -1;
        if (r < 0.35) {
          const d = rnd(D), list = dom[a][d];
          if (list.length < 2) { continue; }
          change(a, d, list[rnd(list.length)]);
        } else if (r < 0.7) {
          const d = rnd(D);
          b = rnd(N);
          if (a === b || fixed[a][d] || fixed[b][d]) { continue; }
          const va = grid[a][d], vb = grid[b][d];
          if (va === vb || !(mask[b][d] & (1 << (va + 1))) || !(mask[a][d] & (1 << (vb + 1)))) { continue; }
          change(a, d, vb);
          change(b, d, va);
        } else if (r < 0.85) {
          const d0 = rnd(D), len = 2 + rnd(4), kind = rnd(3);
          for (let d = d0; d < Math.min(D, d0 + len); d++) {
            if (fixed[a][d]) { continue; }
            if (kind === 0) { change(a, d, -1); continue; }
            const list = dom[a][d];
            let pick = -2, seen = 0;
            for (let i = 1; i < list.length; i++) {
              if (types[list[i]].night === (kind === 1)) {
                seen++;
                if (rnd(seen) === 0) { pick = list[i]; }
              }
            }
            if (pick !== -2) { change(a, d, pick); }
          }
        } else {
          b = rnd(N);
          if (a === b) { continue; }
          const d0 = rnd(D), len = 2 + rnd(4);
          for (let d = d0; d < Math.min(D, d0 + len); d++) {
            if (fixed[a][d] || fixed[b][d]) { continue; }
            const va = grid[a][d], vb = grid[b][d];
            if (va === vb || !(mask[b][d] & (1 << (va + 1))) || !(mask[a][d] & (1 << (vb + 1)))) { continue; }
            change(a, d, vb);
            change(b, d, va);
          }
        }
        if (nCh === 0) { continue; }
        stampNo++;
        let nDays = 0, oldCov = 0, newCov = 0;
        for (let i = 0; i < nCh; i++) {
          if (stamp[chD[i]] !== stampNo) {
            stamp[chD[i]] = stampNo;
            days[nDays++] = chD[i];
            oldCov += covC[chD[i]];
          }
        }
        const oa = rowC[a], ob = b >= 0 ? rowC[b] : 0;
        const na0 = c.nightsCnt[a], wa0 = c.wkCnt[a], nb0 = b >= 0 ? c.nightsCnt[b] : 0, wb0 = b >= 0 ? c.wkCnt[b] : 0;
        const ra = c.rowCost(a), rb = b >= 0 ? c.rowCost(b) : 0;
        const nc = [];
        for (let i = 0; i < nDays; i++) { const x = c.covDay(days[i]); nc.push(x); newCov += x; }
        const nf = c.fairCost();
        const delta = ra + rb + newCov + nf - oa - ob - oldCov - fairC;
        if (delta <= 0 || Math.random() < Math.exp(-delta / temp)) {
          rowC[a] = ra;
          if (b >= 0) { rowC[b] = rb; }
          for (let i = 0; i < nDays; i++) { covC[days[i]] = nc[i]; }
          fairC = nf;
          cur += delta;
          if (cur < best - 1e-9) {
            best = cur;
            for (let s = 0; s < N; s++) { bestGrid[s].set(grid[s]); }
          }
        } else {
          for (let i = nCh - 1; i >= 0; i--) {
            const s = chS[i], d = chD[i], v = grid[s][d], o = chOld[i];
            if (v >= 0 && v < T) { cnt[d * T + v]--; }
            grid[s][d] = o;
            if (o >= 0 && o < T) { cnt[d * T + o]++; }
          }
          c.nightsCnt[a] = na0; c.wkCnt[a] = wa0;
          if (b >= 0) { c.nightsCnt[b] = nb0; c.wkCnt[b] = wb0; }
        }
      }
      return it >= total;
    }

    function result() {
      const cells = {}, locks = {};
      c.staff.forEach(function (p, s) {
        cells[p.id] = Array.from(bestGrid[s], function (v) { return valToId(c, v); });
        const old = opts.keepLocks && state.roster ? state.roster.locks[p.id] || [] : [];
        locks[p.id] = cells[p.id].map(function (_, d) { return !!old[d]; });
      });
      return { cells: cells, locks: locks };
    }

    return {
      total: total, step: step, result: result,
      progress: function () { return total ? it / total : 1; },
      cost: function () { return best; }
    };
  }

  /* Check the saved roster against every rule. Returns hours, unfilled shifts and a list of issues. */
  function analyse(state) {
    const c = build(state, "analyse");
    c.recount();
    const issues = [], unfilled = [], hours = {};
    let cost = 0;
    for (let s = 0; s < c.N; s++) {
      cost += c.rowCost(s, issues);
      hours[c.staff[s].id] = c.hoursOut[s];
    }
    for (let d = 0; d < c.D; d++) { cost += c.covDay(d, unfilled); }
    c.reqMiss.forEach(function (m) {
      if (c.grid[m[0]][m[1]] !== m[2]) {
        issues.push({ s: m[0], d: m[1], text: "request not met (" + (m[2] < 0 ? "day off" : valToId(c, m[2])) + ")" });
      }
    });
    issues.forEach(function (i) {
      i.staffId = c.staff[i.s].id;
      i.name = c.staff[i.s].name;
    });
    return { issues: issues, unfilled: unfilled, hours: hours, cost: cost + c.fairCost() };
  }

  return {
    DAYS: DAYS, uid: uid, addDays: addDays, mondayOf: mondayOf, parseDate: parseDate, dayDiff: dayDiff,
    defaultRange: defaultRange, rangeFromStart: rangeFromStart, defaultState: defaultState, normalise: normalise, createSolver: createSolver, analyse: analyse
  };
});

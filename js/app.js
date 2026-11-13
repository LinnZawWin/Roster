/* Roster app UI. All data lives in the browser (localStorage) and in exported JSON files. */
(function () {
  "use strict";
  const E = window.RosterEngine;
  const KEY = "roster.state.v1";
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const $ = function (id) { return document.getElementById(id); };

  let state = load() || E.defaultState();
  let tab = "roster";
  let busy = false;
  const openStaff = {};

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? E.normalise(JSON.parse(raw)) : null;
    } catch (e) {
      return null;
    }
  }
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      /* storage unavailable: the export file is the backup */
    }
  }
  function esc(s) {
    return String(s === null || s === undefined ? "" : s).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[ch];
    });
  }
  function dObj(d) { return E.parseDate(E.addDays(state.settings.startDate, d)); }
  function ord(n) {
    const s = ["th", "st", "nd", "rd"], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }
  function monLabel(d) {
    const x = dObj(d);
    return MONTHS[x.getUTCMonth()] + "-" + String(x.getUTCFullYear()).slice(2);
  }
  function longDate(d) {
    const x = dObj(d);
    return E.DAYS[d % 7] + " " + x.getUTCDate() + " " + MONTHS[x.getUTCMonth()];
  }
  function isoLabel(iso) {
    const x = E.parseDate(iso);
    return x.getUTCDate() + " " + MONTHS[x.getUTCMonth()] + " " + x.getUTCFullYear();
  }
  function typeMap() {
    const m = {};
    state.shiftTypes.forEach(function (t) { m[t.id] = { code: t.code, name: t.name, hours: t.hours, color: t.color, shift: true, time: t.start + "-" + t.end }; });
    state.leaveTypes.forEach(function (l) { m[l.id] = { code: l.code, name: l.name, hours: l.hours, color: l.color, shift: false }; });
    return m;
  }
  function cellText(info) {
    if (!info) { return ""; }
    return info.shift && !$("showCodes").checked ? String(info.hours) : info.code;
  }
  function ensureRoster() {
    if (!state.roster) {
      state.roster = { cells: {}, locks: {} };
      E.normalise(state);
    }
  }

  /* ---------- Roster tab ---------- */
  function renderRoster() {
    const S = state.settings, map = typeMap();
    const an = state.roster ? E.analyse(state) : null;
    let html = "";
    const unf = {};
    if (an) {
      an.unfilled.forEach(function (u) {
        (unf[u.d] = unf[u.d] || []).push(cellText(map[u.typeId]) + (u.missing > 1 ? "×" + u.missing : ""));
      });
    }
    for (let f = 0; f < Math.ceil(S.weeks / 2); f++) {
      const base = f * 14, nW = Math.min(2, S.weeks - f * 2);
      html += "<div class=\"fnwrap\"><table class=\"fn\"><thead><tr>";
      for (let w = 0; w < nW; w++) {
        html += "<th class=\"name\">" + monLabel(base + w * 7) + "</th>";
        E.DAYS.forEach(function (n) { html += "<th>" + n + "</th>"; });
        html += w < nW - 1 ? "<th class=\"gap\"></th>" : "<th class=\"hrs\">Hours</th>";
      }
      html += "</tr><tr>";
      for (let w = 0; w < nW; w++) {
        html += "<th class=\"name\">Week " + (f * 2 + w + 1) + "</th>";
        for (let i = 0; i < 7; i++) { html += "<th>" + ord(dObj(base + w * 7 + i).getUTCDate()) + "</th>"; }
        html += w < nW - 1 ? "<th class=\"gap\"></th>" : "<th class=\"hrs\">" + (nW === 2 ? "2 weeks" : "1 week") + "</th>";
      }
      html += "</tr></thead><tbody>";
      state.staff.forEach(function (p) {
        html += "<tr>";
        for (let w = 0; w < nW; w++) {
          html += "<th class=\"name\" title=\"" + esc(p.name) + "\">" + esc(p.name) + (p.fte !== 1 ? " (" + p.fte + ")" : "") + "</th>";
          for (let i = 0; i < 7; i++) {
            const d = base + w * 7 + i;
            const id = state.roster ? state.roster.cells[p.id][d] : "";
            const info = map[id], lock = state.roster && state.roster.locks[p.id][d];
            html += "<td class=\"c" + (info ? "" : " empty") + (i >= 5 ? " we" : "") + (lock ? " lock" : "") + "\" data-s=\"" + p.id + "\" data-d=\"" + d + "\"" +
              (info ? " style=\"background:" + esc(info.color) + "\" title=\"" + esc(info.name + (info.time ? " " + info.time : "")) + "\"" : "") + ">" + esc(cellText(info)) + "</td>";
          }
          if (w < nW - 1) {
            html += "<td class=\"gap\"></td>";
          } else {
            const h = an ? an.hours[p.id][f] : 0, target = p.fte * S.fullTimeHours * nW / 2;
            html += "<td class=\"hrs" + (an && h < target ? " under" : "") + "\" title=\"Minimum " + target + "h\">" + (an ? h : "") + "</td>";
          }
        }
        html += "</tr>";
      });
      if (an) {
        let any = false, row = "<tr class=\"unf\">";
        for (let w = 0; w < nW; w++) {
          row += "<th class=\"name\">Unfilled</th>";
          for (let i = 0; i < 7; i++) {
            const u = unf[base + w * 7 + i];
            if (u) { any = true; }
            row += u ? "<td class=\"u\" title=\"Needs cover\">" + esc(u.join(", ")) + "</td>" : "<td></td>";
          }
          row += w < nW - 1 ? "<td class=\"gap\"></td>" : "<td></td>";
        }
        if (any) { html += row + "</tr>"; }
      }
      html += "</tbody></table></div>";
    }
    $("roster").innerHTML = html;

    let ih = "";
    if (!state.roster) {
      ih = "<p class=\"hint\">No roster yet. Press <b>Generate roster</b>, or click any cell to fill it in by hand.</p>";
    } else {
      const hard = an.issues.filter(function (i) { return !i.soft; });
      const n = hard.length + an.unfilled.length;
      if (n === 0 && an.issues.length === 0) {
        ih = "<p class=\"ok\">All shifts covered and all rules met.</p>";
      } else {
        ih = "<details class=\"issues" + (n ? " bad" : "") + "\"" + (n ? " open" : "") + "><summary>" +
          (n ? n + " thing" + (n > 1 ? "s" : "") + " to check" : "All rules met, " + an.issues.length + " minor note(s)") + "</summary><ul>";
        an.unfilled.forEach(function (u) {
          ih += "<li><b>Unfilled</b> · " + longDate(u.d) + " — " + esc(map[u.typeId].name) + (u.missing > 1 ? " ×" + u.missing : "") + "</li>";
        });
        an.issues.forEach(function (i) {
          ih += "<li" + (i.soft ? " class=\"soft\"" : "") + "><b>" + esc(i.name) + "</b>" + (i.hours ? "" : " · " + longDate(i.d)) + " — " + esc(i.text) + "</li>";
        });
        ih += "</ul></details>";
      }
    }
    $("issues").innerHTML = ih;

    let lg = "";
    state.shiftTypes.forEach(function (t) {
      lg += "<span><span class=\"sw\" style=\"background:" + esc(t.color) + "\">" + esc(t.code) + "</span>" + esc(t.name) + " " + t.start + "-" + t.end + " (" + t.hours + "h)</span>";
    });
    state.leaveTypes.forEach(function (l) {
      lg += "<span><span class=\"sw\" style=\"background:" + esc(l.color) + "\">" + esc(l.code) + "</span>" + esc(l.name) + " (" + l.hours + "h)</span>";
    });
    $("legend").innerHTML = lg + "<span>◥ = set by hand (kept when you regenerate)</span>";
  }

  function openPop(td) {
    const pid = td.dataset.s, d = +td.dataset.d, p = state.staff.find(function (x) { return x.id === pid; });
    const locked = state.roster && state.roster.locks[pid][d];
    let h = "<h4>" + esc(p.name) + " · " + longDate(d) + "</h4><button data-v=\"\"><span class=\"sw\">&nbsp;</span>Off</button><hr>";
    state.shiftTypes.forEach(function (t) {
      h += "<button data-v=\"" + t.id + "\"><span class=\"sw\" style=\"background:" + esc(t.color) + "\">" + esc(t.code) + "</span>" + esc(t.name) + "<small>" + t.hours + "h</small></button>";
    });
    h += "<hr>";
    state.leaveTypes.forEach(function (l) {
      h += "<button data-v=\"" + l.id + "\"><span class=\"sw\" style=\"background:" + esc(l.color) + "\">" + esc(l.code) + "</span>" + esc(l.name) + "</button>";
    });
    if (locked) { h += "<hr><button data-unlock=\"1\">Release (let Generate change it)</button>"; }
    const pop = $("pop");
    pop.innerHTML = h;
    pop.hidden = false;
    const r = td.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(window.innerWidth - 250, r.left)) + "px";
    pop.style.top = Math.max(8, Math.min(window.innerHeight - pop.offsetHeight - 8, r.bottom + 4)) + "px";
    pop.onclick = function (ev) {
      const b = ev.target.closest("button");
      if (!b) { return; }
      ensureRoster();
      if (b.dataset.unlock) {
        state.roster.locks[pid][d] = false;
      } else {
        state.roster.cells[pid][d] = b.dataset.v;
        state.roster.locks[pid][d] = true;
      }
      pop.hidden = true;
      save();
      renderRoster();
    };
  }

  function generate() {
    if (busy) { return; }
    if (!state.staff.length || !state.shiftTypes.length) {
      window.alert("Add at least one staff member and one shift first.");
      return;
    }
    busy = true;
    $("btnGenerate").disabled = true;
    $("progress").hidden = false;
    // Try again (up to the limit in Settings) while any rule is broken, and keep the best attempt.
    const opts = { keepLocks: $("keepLocks").checked }, max = state.settings.maxAttempts;
    let attempt = 1, best = null, solver = E.createSolver(state, opts);
    $("attempt").textContent = "";
    (function tick() {
      const done = solver.step(25000);
      $("progressBar").style.width = Math.round(solver.progress() * 100) + "%";
      if (!done) {
        setTimeout(tick, 0);
        return;
      }
      const roster = solver.result();
      const an = E.analyse(Object.assign({}, state, { roster: roster }));
      const broken = an.unfilled.length + an.issues.filter(function (i) { return !i.soft; }).length;
      if (!best || broken < best.broken || (broken === best.broken && an.cost < best.cost)) {
        best = { roster: roster, broken: broken, cost: an.cost };
      }
      if (broken > 0 && attempt < max) {
        attempt++;
        $("attempt").textContent = "Attempt " + attempt + " of " + max + " (best so far: " + best.broken + " to check)";
        solver = E.createSolver(state, opts);
        setTimeout(tick, 0);
        return;
      }
      state.roster = best.roster;
      save();
      busy = false;
      $("btnGenerate").disabled = false;
      $("progress").hidden = true;
      $("progressBar").style.width = "0";
      $("attempt").textContent = attempt > 1 ? "Best of " + attempt + " attempts" : "";
      renderRoster();
    })();
  }

  /* ---------- Staff tab ---------- */
  function renderStaff() {
    let h = "<div class=\"toolbar\"><button class=\"primary\" data-act=\"addStaff\">Add staff</button>" +
      "<span class=\"hint\">Tick which shifts each person can work on which days. Untick a whole day to make them unavailable that day.</span></div>";
    state.staff.forEach(function (p, i) {
      const b = "staff." + i + ".";
      h += "<details class=\"card\" data-staff=\"" + p.id + "\"" + (openStaff[p.id] ? " open" : "") + "><summary>" + esc(p.name) +
        "<small>" + esc(p.group) + " · " + p.fte + " FTE (min " + (p.fte * state.settings.fullTimeHours) + "h / fortnight)" +
        (p.weeks !== "all" ? " · " + p.weeks + " weeks only" : "") + (p.clump ? " · shifts grouped" : "") + "</small></summary>" +
        "<div class=\"row\">" +
        "<label>Name<input type=\"text\" data-bind=\"" + b + "name\" data-rr value=\"" + esc(p.name) + "\"></label>" +
        "<label>Group / role<input type=\"text\" data-bind=\"" + b + "group\" data-rr value=\"" + esc(p.group) + "\" size=\"8\"></label>" +
        "<label>FTE<input type=\"number\" step=\"0.1\" min=\"0\" max=\"1.5\" data-bind=\"" + b + "fte\" data-rr value=\"" + p.fte + "\"></label>" +
        "<label>Works<select data-bind=\"" + b + "weeks\" data-rr>" +
        "<option value=\"all\"" + (p.weeks === "all" ? " selected" : "") + ">Every week</option>" +
        "<option value=\"odd\"" + (p.weeks === "odd" ? " selected" : "") + ">Alternate weeks: 1st, 3rd, 5th…</option>" +
        "<option value=\"even\"" + (p.weeks === "even" ? " selected" : "") + ">Alternate weeks: 2nd, 4th, 6th…</option></select></label>" +
        "<label>Max days in a row<input type=\"number\" min=\"1\" max=\"14\" data-bind=\"" + b + "maxRun\" placeholder=\"" + state.settings.maxRun + "\" value=\"" + (p.maxRun || "") + "\"></label>" +
        "</div><div class=\"row\">" +
        "<label class=\"chk\"><input type=\"checkbox\" data-bind=\"" + b + "clump\" data-rr" + (p.clump ? " checked" : "") + "> Group shifts together (e.g. travels in for a block of shifts)</label>";
      if (p.clump) {
        h += "<label>At least this many shifts in a row<input type=\"number\" min=\"1\" max=\"14\" data-bind=\"" + b + "minRun\" value=\"" + p.minRun + "\"></label>" +
          "<label>Days off between groups (min)<input type=\"number\" min=\"1\" max=\"14\" data-bind=\"" + b + "minOff\" value=\"" + p.minOff + "\"></label>" +
          "<label class=\"chk\"><input type=\"checkbox\" data-bind=\"" + b + "noNightStart\"" + (p.noNightStart ? " checked" : "") + "> Never start a group with a night (nights go at the end)</label>";
      }
      h += "</div><h3>Availability</h3><div class=\"scroll\"><table class=\"grid\"><tr><th>Shift</th>";
      E.DAYS.forEach(function (n) { h += "<th>" + n + "</th>"; });
      h += "<th></th></tr>";
      state.shiftTypes.forEach(function (t) {
        h += "<tr><td>" + esc(t.name) + "</td>";
        for (let wd = 0; wd < 7; wd++) {
          const used = t.need[wd] > 0 || t.need[wd + 7] > 0;
          h += "<td><input type=\"checkbox\" data-av=\"" + i + "|" + t.id + "|" + wd + "\"" + (p.avail[t.id][wd] ? " checked" : "") + (used ? "" : " title=\"Not rostered on this day\" style=\"opacity:.35\"") + "></td>";
        }
        h += "<td><button class=\"small\" data-act=\"rowAll\" data-i=\"" + i + "\" data-t=\"" + t.id + "\">all / none</button></td></tr>";
      });
      h += "</table></div><div class=\"row\">" +
        "<button class=\"small\" data-act=\"upStaff\" data-i=\"" + i + "\">Move up</button>" +
        "<button class=\"small\" data-act=\"dupStaff\" data-i=\"" + i + "\">Duplicate</button>" +
        "<button class=\"small danger\" data-act=\"delStaff\" data-i=\"" + i + "\">Delete</button></div></details>";
    });
    $("tab-staff").innerHTML = h;
  }

  /* ---------- Shifts tab ---------- */
  function renderShifts() {
    let h = "<div class=\"toolbar\"><button class=\"primary\" data-act=\"addShift\">Add shift</button>" +
      "<span class=\"hint\">\"Staff needed\" is how many people each day needs on that shift. Week 2 can differ for fortnightly duties.</span></div>";
    state.shiftTypes.forEach(function (t, i) {
      const b = "shiftTypes." + i + ".";
      h += "<div class=\"card\"><div class=\"row\">" +
        "<label>Colour<input type=\"color\" data-bind=\"" + b + "color\" value=\"" + esc(t.color) + "\"></label>" +
        "<label>Code<input type=\"text\" size=\"4\" data-bind=\"" + b + "code\" value=\"" + esc(t.code) + "\"></label>" +
        "<label>Name<input type=\"text\" data-bind=\"" + b + "name\" value=\"" + esc(t.name) + "\"></label>" +
        "<label>Start<input type=\"time\" data-bind=\"" + b + "start\" value=\"" + esc(t.start) + "\"></label>" +
        "<label>End<input type=\"time\" data-bind=\"" + b + "end\" value=\"" + esc(t.end) + "\"></label>" +
        "<label>Paid hours<input type=\"number\" step=\"0.5\" min=\"0\" data-bind=\"" + b + "hours\" value=\"" + t.hours + "\"></label>" +
        "<label title=\"Extra people allowed on this shift when staff need more hours\">Extra staff allowed<input type=\"number\" min=\"0\" data-bind=\"" + b + "extra\" value=\"" + t.extra + "\"></label>" +
        "<button class=\"small danger\" data-act=\"delShift\" data-i=\"" + i + "\">Delete</button></div>" +
        "<div class=\"scroll\"><table class=\"grid\"><tr><th>Staff needed</th>";
      E.DAYS.forEach(function (n) { h += "<th>" + n + "</th>"; });
      h += "</tr>";
      for (let w = 0; w < 2; w++) {
        h += "<tr><td>Week " + (w + 1) + "</td>";
        for (let wd = 0; wd < 7; wd++) {
          h += "<td><input type=\"number\" min=\"0\" max=\"20\" data-bind=\"" + b + "need." + (w * 7 + wd) + "\" value=\"" + t.need[w * 7 + wd] + "\"></td>";
        }
        h += "</tr>";
      }
      h += "</table></div></div>";
    });
    h += "<h2>Leave types</h2><div class=\"card\"><div class=\"scroll\"><table class=\"list\"><tr><th>Colour</th><th>Code</th><th>Name</th><th>Paid hours / day</th><th></th></tr>";
    state.leaveTypes.forEach(function (l, i) {
      const b = "leaveTypes." + i + ".";
      h += "<tr><td><input type=\"color\" data-bind=\"" + b + "color\" value=\"" + esc(l.color) + "\"></td>" +
        "<td><input type=\"text\" size=\"5\" data-bind=\"" + b + "code\" value=\"" + esc(l.code) + "\"></td>" +
        "<td><input type=\"text\" data-bind=\"" + b + "name\" value=\"" + esc(l.name) + "\"></td>" +
        "<td><input type=\"number\" step=\"0.5\" min=\"0\" data-bind=\"" + b + "hours\" value=\"" + l.hours + "\"></td>" +
        "<td><button class=\"small danger\" data-act=\"delLeave\" data-i=\"" + i + "\">Delete</button></td></tr>";
    });
    h += "</table></div><div class=\"row\"><button data-act=\"addLeave\">Add leave type</button></div></div>";
    $("tab-shifts").innerHTML = h;
  }

  /* ---------- Requests tab ---------- */
  function renderRequests() {
    const S = state.settings, last = S.endDate, map = typeMap();
    let h = "<p class=\"hint\">Days off, leave, or a set shift for one person. Generate always respects these.</p><div class=\"card\"><div class=\"row\">" +
      "<label>Staff<select id=\"rqStaff\">" + state.staff.map(function (p) { return "<option value=\"" + p.id + "\">" + esc(p.name) + "</option>"; }).join("") + "</select></label>" +
      "<label>Request<select id=\"rqKind\"><option value=\"off|\">Day off</option><optgroup label=\"Leave\">" +
      state.leaveTypes.map(function (l) { return "<option value=\"leave|" + l.id + "\">" + esc(l.name) + "</option>"; }).join("") + "</optgroup><optgroup label=\"Must work\">" +
      state.shiftTypes.map(function (t) { return "<option value=\"shift|" + t.id + "\">" + esc(t.name) + "</option>"; }).join("") + "</optgroup></select></label>" +
      "<label>From<input type=\"date\" id=\"rqFrom\" min=\"" + S.startDate + "\" max=\"" + last + "\" value=\"" + S.startDate + "\"></label>" +
      "<label>To<input type=\"date\" id=\"rqTo\" min=\"" + S.startDate + "\" max=\"" + last + "\"></label>" +
      "<label>Note<input type=\"text\" id=\"rqNote\"></label>" +
      "<button class=\"primary\" data-act=\"addReq\">Add request</button></div></div>";
    if (state.requests.length) {
      h += "<div class=\"card\"><div class=\"scroll\"><table class=\"list\"><tr><th>Staff</th><th>Request</th><th>Dates</th><th>Note</th><th></th></tr>";
      state.requests.forEach(function (r, i) {
        const p = state.staff.find(function (x) { return x.id === r.staffId; });
        const what = r.kind === "off" ? "Day off" : (map[r.refId] ? map[r.refId].name : "(deleted)");
        h += "<tr><td>" + esc(p ? p.name : "(deleted)") + "</td><td>" + esc(what) + "</td><td>" + isoLabel(r.from) +
          (r.to && r.to !== r.from ? " – " + isoLabel(r.to) : "") + "</td><td>" + esc(r.note) + "</td>" +
          "<td><button class=\"small danger\" data-act=\"delReq\" data-i=\"" + i + "\">Delete</button></td></tr>";
      });
      h += "</table></div></div>";
    }
    $("tab-requests").innerHTML = h;
  }

  /* ---------- Settings tab ---------- */
  function renderSettings() {
    const S = state.settings;
    function numIn(label, key, extra) {
      return "<label>" + label + "<input type=\"number\" data-bind=\"settings." + key + "\" data-rr value=\"" + S[key] + "\" " + (extra || "") + "></label>";
    }
    $("tab-settings").innerHTML =
      "<h2>Roster period</h2><div class=\"card\"><div class=\"row\">" +
      "<label>Title<input type=\"text\" data-bind=\"settings.title\" data-rr value=\"" + esc(S.title) + "\"></label>" +
      "<label>From (moves to the Monday)<input type=\"date\" id=\"setStart\" value=\"" + S.startDate + "\"></label>" +
      "<label>To (moves to the Sunday)<input type=\"date\" id=\"setEnd\" min=\"" + S.startDate + "\" value=\"" + S.endDate + "\"></label>" +
      "<span class=\"hint\">" + isoLabel(S.startDate) + " – " + isoLabel(S.endDate) + " · " + S.weeks + " weeks</span>" +
      "</div><div class=\"row\"><button data-act=\"nextPeriod\">Start the next period</button>" +
      "<button data-act=\"defaultPeriod\">Use the next 3 months</button>" +
      "<span class=\"hint\">The next period starts the day after this one ends and runs 3 months. Staff and shifts are kept; the roster and past requests are cleared.</span></div></div>" +
      "<h2>Rules</h2><div class=\"card\"><div class=\"row\">" +
      numIn("Full-time hours per fortnight (1 FTE)", "fullTimeHours", "min=\"0\" step=\"0.5\"") +
      numIn("Hours over the minimum before it counts as too many", "overTolerance", "min=\"0\" step=\"0.5\"") +
      numIn("Minimum rest between shifts (hours)", "minRestHours", "min=\"0\" step=\"0.5\"") +
      numIn("Max days in a row (default)", "maxRun", "min=\"1\" max=\"14\"") +
      "</div><div class=\"row\">" +
      numIn("Nights grouped together: at least", "nightBlockMin", "min=\"1\" max=\"7\"") +
      numIn("and at most", "nightBlockMax", "min=\"1\" max=\"7\"") +
      numIn("Days off after a group of nights (min)", "restAfterNights", "min=\"0\" max=\"7\"") +
      "</div><div class=\"row\">" +
      numIn("Generate attempts while any rule is broken (e.g. hours under the minimum)", "maxAttempts", "min=\"1\" max=\"50\"") +
      "</div></div>" +
      "<h2>Save and load</h2><div class=\"card\"><p class=\"hint\">Everything stays in this browser. Export a file to keep a backup, move to another device, or reuse the setup next round.</p>" +
      "<div class=\"row\"><button class=\"primary\" data-act=\"export\">Export data file</button>" +
      "<button data-act=\"import\">Import data file</button>" +
      "<button class=\"danger\" data-act=\"reset\">Reset to sample data</button></div></div>";
  }

  function render() {
    $("title").textContent = state.settings.title;
    document.title = state.settings.title;
    if (tab === "roster") { renderRoster(); }
    if (tab === "staff") { renderStaff(); }
    if (tab === "shifts") { renderShifts(); }
    if (tab === "requests") { renderRequests(); }
    if (tab === "settings") { renderSettings(); }
  }
  function commit(rerender) {
    E.normalise(state);
    save();
    if (rerender) { render(); }
  }

  /* ---------- Export / import ---------- */
  function download(name, blob) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }
  function fileStem() {
    return (state.settings.title || "roster").replace(/[^\w-]+/g, "-").toLowerCase() + "-" + state.settings.startDate;
  }
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = function () { reject(new Error("Could not load the Excel library. Check your internet connection.")); };
      document.head.appendChild(s);
    });
  }
  async function exportExcel() {
    try {
      if (!window.ExcelJS) {
        await loadScript("https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js");
      }
      const S = state.settings, map = typeMap(), an = state.roster ? E.analyse(state) : null;
      const wb = new window.ExcelJS.Workbook(), ws = wb.addWorksheet("Roster");
      const widths = [16, 7, 7, 7, 7, 7, 7, 7, 3, 16, 7, 7, 7, 7, 7, 7, 7, 9];
      ws.columns = widths.map(function (w) { return { width: w }; });
      const thin = { style: "thin", color: { argb: "FF999999" } }, border = { top: thin, left: thin, bottom: thin, right: thin };
      const fill = function (hex) { return { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + hex.replace("#", "").toUpperCase() } }; };
      const unf = {};
      if (an) {
        an.unfilled.forEach(function (u) { (unf[u.d] = unf[u.d] || []).push(cellText(map[u.typeId])); });
      }
      for (let f = 0; f < Math.ceil(S.weeks / 2); f++) {
        const base = f * 14, nW = Math.min(2, S.weeks - f * 2);
        const skip = function (col) { return col === 9 || (nW === 1 && col >= 10 && col <= 17); };
        const pad = function (arr, lastVal) {
          if (nW === 1) {
            for (let i = 0; i < 8; i++) { arr.push(""); }
            arr.push(lastVal);
          }
        };
        const h1 = [], h2 = [];
        for (let w = 0; w < nW; w++) {
          h1.push(monLabel(base + w * 7));
          h2.push("");
          for (let i = 0; i < 7; i++) {
            h1.push(E.DAYS[i]);
            h2.push(ord(dObj(base + w * 7 + i).getUTCDate()));
          }
          h1.push(w === 0 ? "" : "Hours");
          h2.push("");
        }
        pad(h1, "Hours");
        pad(h2, "");
        [h1, h2].forEach(function (vals) {
          const row = ws.addRow(vals);
          row.eachCell({ includeEmpty: true }, function (c, col) {
            if (skip(col)) { return; }
            c.fill = fill("#3b434d");
            c.font = { bold: true, color: { argb: "FFFFFFFF" } };
            c.alignment = { horizontal: col === 1 || col === 10 ? "left" : "center" };
            c.border = border;
          });
        });
        state.staff.forEach(function (p) {
          const vals = [], cols = [];
          for (let w = 0; w < nW; w++) {
            vals.push(p.name + (p.fte !== 1 ? " (" + p.fte + ")" : ""));
            cols.push(null);
            for (let i = 0; i < 7; i++) {
              const info = map[state.roster ? state.roster.cells[p.id][base + w * 7 + i] : ""];
              const txt = cellText(info);
              vals.push(txt !== "" && isFinite(+txt) ? +txt : txt);
              cols.push(info ? info.color : null);
            }
            vals.push(w === 0 ? "" : (an ? an.hours[p.id][f] : ""));
            cols.push(null);
          }
          pad(vals, an ? an.hours[p.id][f] : "");
          pad(cols, null);
          const row = ws.addRow(vals);
          row.eachCell({ includeEmpty: true }, function (c, col) {
            if (skip(col)) { return; }
            c.border = border;
            c.alignment = { horizontal: col === 1 || col === 10 ? "left" : "center" };
            if (col === 1 || col === 10 || col === 18) { c.font = { bold: true }; }
            if (cols[col - 1]) { c.fill = fill(cols[col - 1]); }
            if (col === 18 && an && an.hours[p.id][f] < p.fte * S.fullTimeHours * nW / 2) { c.font = { bold: true, color: { argb: "FFCF222E" } }; }
          });
        });
        const u = [];
        let any = false;
        for (let w = 0; w < nW; w++) {
          u.push("Unfilled");
          for (let i = 0; i < 7; i++) {
            const x = unf[base + w * 7 + i];
            if (x) { any = true; }
            u.push(x ? x.join(", ") : "");
          }
          u.push("");
        }
        if (any) {
          const row = ws.addRow(u);
          row.eachCell({ includeEmpty: true }, function (c, col) {
            if (skip(col) || col === 18) { return; }
            c.border = border;
            c.fill = fill("#ffc7ce");
            c.font = { bold: true, color: { argb: "FF9C0006" } };
            c.alignment = { horizontal: col === 1 || col === 10 ? "left" : "center" };
          });
        }
        ws.addRow([]);
      }
      ws.addRow(["Key"]).font = { bold: true };
      state.shiftTypes.forEach(function (t) {
        const row = ws.addRow([t.name, cellText(map[t.id]), t.start + "-" + t.end, "", t.hours + "h"]);
        row.getCell(2).fill = fill(t.color);
      });
      state.leaveTypes.forEach(function (l) {
        const row = ws.addRow([l.name, l.code, "", "", l.hours + "h"]);
        row.getCell(2).fill = fill(l.color);
      });
      const buf = await wb.xlsx.writeBuffer();
      download(fileStem() + ".xlsx", new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    } catch (e) {
      window.alert(e.message || String(e));
    }
  }
  function importFile(file) {
    const rd = new FileReader();
    rd.onload = function () {
      try {
        const data = JSON.parse(rd.result);
        if (!data || !Array.isArray(data.staff) || !Array.isArray(data.shiftTypes)) {
          throw new Error("not a roster file");
        }
        state = E.normalise(data);
        save();
        render();
        window.alert("Data imported.");
      } catch (e) {
        window.alert("That file could not be read as roster data.");
      }
    };
    rd.readAsText(file);
  }

  /* ---------- Events ---------- */
  function setPath(path, val) {
    const parts = path.split(".");
    let o = state;
    for (let i = 0; i < parts.length - 1; i++) { o = o[parts[i]]; }
    o[parts[parts.length - 1]] = val;
  }
  const actions = {
    addStaff: function () {
      const p = { id: E.uid(), name: "New staff", group: "", fte: 1, avail: {} };
      state.shiftTypes.forEach(function (t) { p.avail[t.id] = [true, true, true, true, true, true, true]; });
      state.staff.push(p);
      openStaff[p.id] = true;
    },
    delStaff: function (i) {
      if (!window.confirm("Delete " + state.staff[i].name + "?")) { return false; }
      state.staff.splice(i, 1);
    },
    dupStaff: function (i) {
      const p = JSON.parse(JSON.stringify(state.staff[i]));
      p.id = E.uid();
      p.name += " (copy)";
      state.staff.splice(i + 1, 0, p);
      openStaff[p.id] = true;
    },
    upStaff: function (i) {
      if (i > 0) { state.staff.splice(i - 1, 0, state.staff.splice(i, 1)[0]); }
    },
    rowAll: function (i, el) {
      const a = state.staff[i].avail[el.dataset.t], on = !a.every(Boolean);
      for (let d = 0; d < 7; d++) { a[d] = on; }
    },
    addShift: function () {
      state.shiftTypes.push({ id: E.uid(), code: "NEW", name: "New shift", start: "08:00", end: "16:30", hours: 8, color: "#d9d9d9", need: [], extra: 0 });
    },
    delShift: function (i) {
      if (!window.confirm("Delete the shift \"" + state.shiftTypes[i].name + "\"? It is also removed from the roster.")) { return false; }
      const id = state.shiftTypes.splice(i, 1)[0].id;
      if (state.roster) {
        Object.keys(state.roster.cells).forEach(function (k) {
          state.roster.cells[k] = state.roster.cells[k].map(function (c) { return c === id ? "" : c; });
        });
      }
    },
    addLeave: function () {
      state.leaveTypes.push({ id: E.uid(), code: "LV", name: "Leave", hours: 8, color: "#d9d9d9" });
    },
    delLeave: function (i) {
      state.leaveTypes.splice(i, 1);
    },
    addReq: function () {
      const kind = $("rqKind").value.split("|"), from = $("rqFrom").value, to = $("rqTo").value || from;
      if (!from || !$("rqStaff").value) {
        window.alert("Choose a staff member and a date.");
        return false;
      }
      state.requests.push({ id: E.uid(), staffId: $("rqStaff").value, kind: kind[0], refId: kind[1], from: from < to ? from : to, to: from < to ? to : from, note: $("rqNote").value });
    },
    delReq: function (i) {
      state.requests.splice(i, 1);
    },
    nextPeriod: function () {
      const S = state.settings, r = E.rangeFromStart(E.addDays(S.endDate, 1)), next = r.start;
      if (!window.confirm("Start the next period, " + isoLabel(r.start) + " – " + isoLabel(r.end) + "? The current roster is cleared. Export it first if you want to keep it.")) { return false; }
      S.startDate = r.start;
      S.endDate = r.end;
      state.roster = null;
      state.requests = state.requests.filter(function (r) { return (r.to || r.from) >= next; });
    },
    defaultPeriod: function () {
      const now = new Date(), r = E.defaultRange(now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-01");
      if (state.roster && !window.confirm("Change the period to " + isoLabel(r.start) + " – " + isoLabel(r.end) + "? The current roster is cleared.")) { return false; }
      state.settings.startDate = r.start;
      state.settings.endDate = r.end;
      state.roster = null;
    },
    export: function () {
      download(fileStem() + ".json", new Blob([JSON.stringify(state, null, 1)], { type: "application/json" }));
      return false;
    },
    import: function () {
      $("importFile").click();
      return false;
    },
    reset: function () {
      if (!window.confirm("Replace everything with the sample data?")) { return false; }
      state = E.defaultState();
    }
  };

  document.addEventListener("click", function (ev) {
    const t = ev.target;
    const tb = t.closest("#tabs button");
    if (tb) {
      tab = tb.dataset.tab;
      document.querySelectorAll("#tabs button").forEach(function (b) { b.classList.toggle("on", b === tb); });
      document.querySelectorAll(".tab").forEach(function (s) { s.classList.toggle("on", s.id === "tab-" + tab); });
      render();
      return;
    }
    const pop = $("pop");
    if (!pop.hidden && !t.closest("#pop")) { pop.hidden = true; }
    const cell = t.closest("td.c");
    if (cell && !busy) {
      openPop(cell);
      return;
    }
    const act = t.closest("[data-act]");
    if (act && actions[act.dataset.act]) {
      if (actions[act.dataset.act](+act.dataset.i, act) !== false) { commit(true); }
    }
  });
  document.addEventListener("toggle", function (ev) {
    const d = ev.target;
    if (d.dataset && d.dataset.staff) { openStaff[d.dataset.staff] = d.open; }
  }, true);
  document.addEventListener("change", function (ev) {
    const el = ev.target;
    if (el.dataset.av) {
      const p = el.dataset.av.split("|");
      state.staff[+p[0]].avail[p[1]][+p[2]] = el.checked;
      commit(false);
    } else if (el.dataset.bind) {
      let v = el.type === "checkbox" ? el.checked : el.value;
      if (el.type === "number") { v = el.value === "" ? null : parseFloat(el.value); }
      setPath(el.dataset.bind, v);
      commit(el.hasAttribute("data-rr"));
    } else if (el.id === "setStart" && el.value) {
      const m = E.mondayOf(el.value);
      if (m !== state.settings.startDate) {
        if (state.roster && !window.confirm("Changing the start date clears the current roster. Continue?")) {
          el.value = state.settings.startDate;
          return;
        }
        state.settings.startDate = m;
        if (state.settings.endDate < m) { state.settings.endDate = E.rangeFromStart(m).end; }
        state.roster = null;
        commit(true);
      }
    } else if (el.id === "setEnd" && el.value) {
      if (el.value < state.settings.startDate) {
        window.alert("The end date must be after the start date.");
        el.value = state.settings.endDate;
        return;
      }
      state.settings.endDate = el.value;
      commit(true);
    } else if (el.id === "importFile" && el.files[0]) {
      importFile(el.files[0]);
      el.value = "";
    } else if (el.id === "showCodes") {
      renderRoster();
    }
  });
  $("btnGenerate").onclick = generate;
  $("btnClear").onclick = function () {
    if (state.roster && window.confirm("Clear the whole roster, including manual changes?")) {
      state.roster = null;
      commit(true);
    }
  };
  $("btnExcel").onclick = exportExcel;
  $("btnPrint").onclick = function () { window.print(); };
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape") { $("pop").hidden = true; }
  });

  render();
})();

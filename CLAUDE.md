# Roster app: project context

This file carries the full context from the session that built the app, so a new session can continue without the original conversation.

## What this is

A static rostering web app with no database and no build step. It is hosted on GitHub Pages from the root of `main`:

- Live site: https://linnzawwin.github.io/Roster/
- Repo: `LinnZawWin/Roster` (public)

Every push to `main` redeploys the site in about a minute. Work done on a branch is not live until merged to `main`.

The owner is not asking for a framework. Keep it plain HTML, CSS and JavaScript with no dependencies to install. The only external library is ExcelJS, loaded from cdnjs on demand when the user exports to Excel.

## Privacy rules

- The repo and site are public. Never commit real staff names, exported data files or screenshots of real rosters.
- `.gitignore` blocks `*.json` and `exports/` so an exported data file cannot be committed by accident. If the app ever needs its own JSON file in the repo, add an explicit exception.
- Roster data lives only in the user's browser (`localStorage`, key `roster.state.v1`) and in the JSON files they export.
- Use generic wording in the UI and code: "staff", "shift", "group". The original use case is a hospital registrar roster, but the owner asked for wording that suits any industry.

## Files

| File | Purpose |
|---|---|
| `index.html` | Page shell: tabs, roster toolbar, empty containers |
| `css/app.css` | All styling, light and dark themes, print rules |
| `js/engine.js` | Data model, defaults, roster generator, rule checker. No DOM access, so it also runs in Node |
| `js/app.js` | All UI: rendering the five tabs, cell editing, export and import, Excel export |

## The requirements, as the owner gave them

Shifts (taken from the owner's spreadsheet key, which wins over the typed message where they differ):

| Shift | Hours | Time |
|---|---|---|
| Regular day | 8 | 0800-1630 |
| Evening | 8 | 1400-2200 |
| Letters / evening | 10 | 1200-1600 letters, then 1600-2200 evening |
| Night | 11 | 2130-0830 |
| Weekend day | 12.5 | 0800-2030 |
| Weekend night | 12.5 | 2000-0830 |
| Clinic | 8 | 0800-1630 |

Plus leave markers ADO and AL. In the owner's spreadsheet these count as 8 paid hours a day.

Staff and rules:

- Seven staff in total: AT-1, AT-2, AT-3, AT-C, BT-1, BT-2 (0.5 FTE), BT-3 (0.5 FTE).
- 1 FTE must get at least 80 hours a fortnight; 0.5 FTE at least 40. The pay cycle is fortnightly.
- AT-C mainly does clinic: fixed clinic every Monday, Wednesday and Thursday, plus a few ward day shifts. AT-C cannot do nights.
- Other clinics (fortnightly Tuesday, every Friday) go to AT-1, AT-2 and AT-3. AT-C does not do these.
- BT staff cannot do clinics.
- Ignore meal breaks.
- Nights are normally kept in groups of 3 to 4, followed by 2 to 4 days off.
- Individual requests must be possible: a given day off for one person, or 5 to 6 days or nights in a row for one person.
- One staff member travels in from another city and stays for a block of shifts, then goes home for several days (fly-in fly-out style). Their shifts must be grouped: roughly 7 to 8 in a row, mixed day, clinic, evening and night, with the nights at the end of the block. A block must never start with a night.
- One trainee works alternate weeks only (1st, 3rd, 5th week and so on). They can work Thursday to Sunday for day or evening shifts, or Wednesday to Saturday for nights.
- Feedback on an earlier attempt elsewhere: "It didn't generate many shifts in a row. All shifts need to be clumped for some staff." Grouping must be strong, not a weak preference.

Output and data:

- The roster must look like the owner's Excel sheet: one block per fortnight, two weeks side by side, staff down the left, Monday to Sunday across, cells coloured by shift type and showing the hours, and a fortnight hours total at the right of the second week.
- Unfilled shifts are shown in a red row under each fortnight (the spreadsheet used "Locum" rows for this).
- Staff and their availability must be configurable in the app.
- Export and import of settings and data, so the next rostering round does not start from scratch.
- Rosters are usually made three months at a time. The date range defaults to the Monday of the week holding the 1st of next month, through the Sunday of the week holding the last day of the third month. This rule reproduces the owner's real sheet (28 Apr to 3 Aug 2025 for May to July).
- Generate should retry automatically while any rule is broken, up to a number of attempts set in Settings (default 10).

## How the app models this

State shape (also the export file format), built and repaired by `normalise()` in `js/engine.js`:

- `settings`: `title`, `startDate` (always a Monday), `endDate` (always a Sunday), `weeks` (derived), `fullTimeHours` (80), `overTolerance` (8), `minRestHours` (10), `maxRun` (6), `nightBlockMin` (3), `nightBlockMax` (4), `restAfterNights` (2), `maxAttempts` (10).
- `shiftTypes[]`: `id`, `code`, `name`, `start`, `end`, `hours`, `color`, `need` (14 numbers: staff needed per day for week 1 then week 2), `extra` (extra staff allowed on that shift so people can reach their hours).
- `leaveTypes[]`: `id`, `code`, `name`, `hours` (paid hours per day), `color`.
- `staff[]`: `id`, `name`, `group`, `fte`, `weeks` (`all`, `odd`, `even`), `avail` (per shift type, seven booleans Monday to Sunday), `maxRun` (null uses the default), `clump`, `minRun`, `minOff`, `noNightStart`.
- `requests[]`: `staffId`, `kind` (`off`, `leave`, `shift`), `refId`, `from`, `to`, `note`.
- `roster`: `cells[staffId][dayIndex]` holds a shift or leave id (empty string is off); `locks[staffId][dayIndex]` marks cells set by hand.

How the owner's rules map onto that:

- AT-C's fixed clinic is the shift "Clinic" needing one person on Monday, Wednesday and Thursday, with only AT-C available for it.
- The other clinics are a second shift, "Clinic 2", needing one person on Tuesday of week 1 and on Friday of both weeks, available to AT-1 to AT-3 only.
- "Letters / Evening" has zero need, so the generator never assigns it. It is added by hand.
- Day has `extra: 2`, which is how staff are topped up to their minimum hours.
- A shift counts as a night if it crosses midnight.
- The fly-in staff member, the alternate-week trainee and anyone wanting 5 to 6 in a row are NOT pre-configured in the sample data, because the owner did not say which of the seven they are. They are set up on the Staff tab: "Group shifts together" with a minimum run, max days in a row, "Never start a group with a night", the "Works" alternate-weeks choice, and the availability grid.
- A period with an odd number of weeks ends with a single week on its own. Its hours minimum is halved.

## The generator (`createSolver` in `js/engine.js`)

Greedy first fill, then simulated annealing over the staff by day grid. Moves: change one cell, swap two staff on a day, set a block of 2 to 5 days, swap a block between two staff. Requests and (optionally) hand-locked cells are fixed. The best grid seen is returned.

Scoring weights are in the `W` object at the top of the file:

- Treated as hard (1000 each): too little rest between shifts, more than the maximum days in a row, a grouped block starting with a night, more staff on a shift than need plus extra.
- Unfilled shift: 600 each.
- Hours under the minimum: 70 per hour. Hours over: 1 per hour, plus 8 per hour beyond the tolerance.
- Night group shorter than the minimum 150 per missing night; longer than the maximum 500 per extra night; too few days off after nights 400 per missing day.
- Grouped staff: 300 per shift short of their minimum run, 300 per day short of their days off between blocks.
- Other staff: 40 for an isolated single working day, 15 for a single day off between shifts, 10 for rotating backwards (later start to earlier start).
- Fairness of nights and weekends, in proportion to FTE.

`analyse(state)` scores a saved roster with the same code and returns `issues`, `unfilled`, `hours` per staff per fortnight, and `cost`. Issues flagged `soft` (short night groups) are shown as minor notes and do not trigger a retry.

The retry loop is in `generate()` in `js/app.js`: it re-runs the solver while unfilled shifts or non-soft issues remain, up to `settings.maxAttempts`, and keeps the attempt with the fewest problems.

## The UI

Five tabs: Roster, Staff, Shifts, Requests, Settings.

- Roster: Generate, "Keep my manual changes", Clear, "Show shift codes" (hours are shown by default, like the spreadsheet), Export to Excel, Print. Clicking a cell opens a menu to set a shift, leave or off; that cell is then locked and marked with a corner triangle.
- Settings holds the From / To date range, "Start the next period" (starts the day after the current end and runs three months), "Use the next 3 months", the rules, and export / import / reset.

Inputs use `data-bind="path.to.field"`; the `change` handler in `js/app.js` writes the value into `state`, calls `normalise`, saves, and re-renders if the input has `data-rr`. Buttons use `data-act` and the `actions` table.

## Testing

There is no test suite. What has been done so far:

- The engine has been run in Node on several scenarios (4 weeks, 12, 13 and 14 weeks, a grouped fly-in person, an alternate-week person, leave and day-off requests). All shifts were covered each time.
- Generate, hand-editing a cell, the Staff tab toggle and the Excel export were exercised once in a browser, on the first version.

To test the engine in Node:

```js
const E = require("./js/engine.js");
const st = E.defaultState();
const sv = E.createSolver(st, {});
while (!sv.step(50000)) {}
st.roster = sv.result();
console.log(E.analyse(st));
```

To test the UI, serve the folder over HTTP (browsers used for automation may block `file:` URLs) and open `index.html`.

## Known gaps and unverified work

- Not yet checked in a browser: the From / To date range on the Settings tab, the single-week final fortnight in the roster view and in the Excel export, the retry loop and its "Attempt N of M" text, importing a data file, and printing.
- The opened Excel file has not been inspected; only the download was confirmed.
- On a full three-month run, single attempts sometimes leave one or two fortnights 0.5 to 1 hour under the minimum. The retry loop was added for this, but it has not been measured how often ten attempts produce a clean result.
- Each roster starts fresh. It does not look at the last days of the previous period, so rest and run rules are not checked across the boundary.
- The evening shift uses 1400-2200 from the spreadsheet key; the owner's typed message said 2:30 to 10:00. Not confirmed which is right.
- There is no cap on nights per person per fortnight, and no preference for working both days of a weekend.
- Staff who are on leave still have the full hours minimum; leave days count as paid hours toward it.

## Working conventions

- Commit messages end with a `Co-Authored-By` line for the Claude model that made the change.
- Plain language in the UI: the people using it are roster managers, not developers.
- Keep `js/engine.js` free of DOM access so it stays testable in Node.

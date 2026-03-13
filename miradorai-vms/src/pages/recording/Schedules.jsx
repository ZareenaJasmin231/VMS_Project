import { useState, useRef, useCallback } from "react";
import Button from "../../components/shared/Button";
import "./Schedules.css";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const TOTAL_SLOTS = 24 * 12; // 5-min intervals
const HOUR_LABELS = ["00:00", "03:00", "06:00", "09:00", "12:00", "15:00", "18:00", "21:00", "00:00"];
const HOUR_LABEL_POSITIONS = [0, 3, 6, 9, 12, 15, 18, 21, 24];

function makeEmptyWeek() {
  return Object.fromEntries(DAYS.map((d) => [d, new Array(TOTAL_SLOTS).fill(false)]));
}

const INITIAL_SCHEDULES = [
  { id: 1, name: "Office Hours", week: makeEmptyWeek(), exceptions: [] },
  {
    id: 2,
    name: "Weekends",
    week: (() => {
      const w = makeEmptyWeek();
      for (let s = 12; s < 84; s++) w["Monday"][s] = true;
      return w;
    })(),
    exceptions: [],
  },
];

// ── Week Grid ────────────────────────────────────────────────────
function WeekGrid({ week, onChange }) {
  const dragging  = useRef(false);
  const dragValue = useRef(true);

  const toggle = useCallback(
    (day, slot, val) => {
      const next = { ...week, [day]: [...week[day]] };
      next[day][slot] = val;
      onChange(next);
    },
    [week, onChange]
  );

  const handleMouseDown  = (day, slot) => { dragging.current = true; dragValue.current = !week[day][slot]; toggle(day, slot, dragValue.current); };
  const handleMouseEnter = (day, slot) => { if (dragging.current) toggle(day, slot, dragValue.current); };
  const handleMouseUp    = () => { dragging.current = false; };

  return (
    <div className="week-grid" onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}>
      {/* Hour label row */}
      <div className="wg-label-row">
        <div className="wg-day-label" />
        <div className="wg-hours-track">
          {HOUR_LABEL_POSITIONS.map((h, i) => (
            <span key={i} className="wg-hour-label" style={{ left: `${(h / 24) * 100}%` }}>
              {HOUR_LABELS[i]}
            </span>
          ))}
        </div>
      </div>

      {/* Day rows */}
      {DAYS.map((day) => (
        <div className="wg-row" key={day}>
          <div className="wg-day-label">{day}</div>
          <div className="wg-track">
            {week[day].map((on, s) => (
              <div
                key={s}
                className={`wg-slot${on ? " on" : ""}`}
                onMouseDown={() => handleMouseDown(day, s)}
                onMouseEnter={() => handleMouseEnter(day, s)}
              />
            ))}
            {Array.from({ length: 25 }, (_, h) => (
              <div
                key={h}
                className={`wg-tick${h % 3 === 0 ? " major" : ""}`}
                style={{ left: `${(h / 24) * 100}%` }}
              />
            ))}
          </div>
        </div>
      ))}

      <p className="wg-hint">
        Hold Ctrl to select 5 minute intervals. To copy and paste day schedules, use right click.
      </p>
    </div>
  );
}

// ── Exception Calendar ───────────────────────────────────────────
function getDaysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }
function getFirstDayOfMonth(y, m) { return (new Date(y, m, 1).getDay() + 6) % 7; }

function ExceptionCalendar({ exceptions, onChange }) {
  const today = new Date();
  const [viewYear,  setViewYear]  = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());

  const prevMonth = () => { if (viewMonth === 0) { setViewMonth(11); setViewYear((y) => y - 1); } else setViewMonth((m) => m - 1); };
  const nextMonth = () => { if (viewMonth === 11) { setViewMonth(0);  setViewYear((y) => y + 1); } else setViewMonth((m) => m + 1); };

  const monthLabel  = new Date(viewYear, viewMonth, 1).toLocaleString("default", { month: "long", year: "numeric" });
  const daysInMonth = getDaysInMonth(viewYear, viewMonth);
  const firstDay    = getFirstDayOfMonth(viewYear, viewMonth);

  const isException = (d) => exceptions.some((e) => e.getFullYear() === viewYear && e.getMonth() === viewMonth && e.getDate() === d);
  const isToday     = (d) => today.getFullYear() === viewYear && today.getMonth() === viewMonth && today.getDate() === d;

  const toggleDay = (d) => {
    const date = new Date(viewYear, viewMonth, d);
    if (isException(d)) onChange(exceptions.filter((e) => !(e.getFullYear() === viewYear && e.getMonth() === viewMonth && e.getDate() === d)));
    else onChange([...exceptions, date]);
  };

  const cells = [];
  const prevDays = getDaysInMonth(viewYear, viewMonth === 0 ? 11 : viewMonth - 1);
  for (let i = 0; i < firstDay; i++)
    cells.push(<div key={`p${i}`} className="cal-cell other">{prevDays - firstDay + i + 1}</div>);
  for (let d = 1; d <= daysInMonth; d++)
    cells.push(
      <div key={d} className={`cal-cell${isException(d) ? " exception" : ""}${isToday(d) ? " today" : ""}`} onClick={() => toggleDay(d)}>{d}</div>
    );
  for (let d = 1; cells.length < 42; d++)
    cells.push(<div key={`n${d}`} className="cal-cell other">{d}</div>);

  return (
    <div className="cal-wrap">
      <div className="cal-header">
        <button className="cal-nav" onClick={prevMonth}>&#8249;</button>
        <span className="cal-month-label">{monthLabel}</span>
        <button className="cal-nav" onClick={nextMonth}>&#8250;</button>
      </div>
      <div className="cal-grid">
        {["Mo","Tu","We","Th","Fr","Sa","Su"].map((d) => <div key={d} className="cal-dow">{d}</div>)}
        {cells}
      </div>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────
export default function Schedules() {
  const [schedules,      setSchedules]      = useState(INITIAL_SCHEDULES);
  const [selectedId,     setSelectedId]     = useState(null);
  const [filter,         setFilter]         = useState("");
  const [showExceptions, setShowExceptions] = useState(false);
  const nextId = useRef(10);

  const selected = schedules.find((s) => s.id === selectedId) || null;
  const filtered = schedules.filter((s) => s.name.toLowerCase().includes(filter.toLowerCase()));

  const addNew = () => {
    const s = { id: nextId.current++, name: "New schedule", week: makeEmptyWeek(), exceptions: [] };
    setSchedules((prev) => [...prev, s]);
    setSelectedId(s.id);
  };

  const remove = () => {
    if (!selectedId) return;
    setSchedules((prev) => prev.filter((s) => s.id !== selectedId));
    setSelectedId(null);
  };

  const updateSelected = (patch) =>
    setSchedules((prev) => prev.map((s) => (s.id === selectedId ? { ...s, ...patch } : s)));

  return (
    <div className="schedules-page">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Schedules</h1>
          <p className="page-desc">Define weekly schedules and exceptions for recording and event triggers.</p>
        </div>
        <input
          className="sch-filter"
          placeholder="Type to filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      {/* Schedule list table */}
      <div className="sch-table-wrap">
        <table className="sch-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Used</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => (
              <tr
                key={s.id}
                className={s.id === selectedId ? "selected" : ""}
                onClick={() => { setSelectedId(s.id); setShowExceptions(false); }}
              >
                <td>{s.name}</td>
                <td></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* New / Remove */}
      <div className="sch-actions">
        <Button label="New"    variant="outline" onClick={addNew} />
        <Button label="Remove" variant="outline" onClick={remove} disabled={!selectedId} />
      </div>

      {/* Resize handle */}
      <div className="sch-divider"><div className="divider-handle" /></div>

      {/* Detail panel */}
      {selected && (
        <div className="sch-detail">
          {/* Tabs */}
          <div className="sch-tabs">
            <button className={`sch-tab${!showExceptions ? " active" : ""}`} onClick={() => setShowExceptions(false)}>
              Week schedule
            </button>
            <button className={`sch-tab${showExceptions ? " active" : ""}`} onClick={() => setShowExceptions(true)}>
              Schedule exceptions
            </button>
          </div>

          {!showExceptions ? (
            <>
              {/* Name + mode */}
              <div className="sch-name-row">
                <label className="sch-name-label">Name:</label>
                <input
                  className="sch-name-input"
                  value={selected.name}
                  onChange={(e) => updateSelected({ name: e.target.value })}
                />
                <div className="sch-mode-row">
                  <label className="mode-check">
                    <span className="mode-box on" />
                    Schedule on
                  </label>
                  <label className="mode-check">
                    <input type="checkbox" />
                    Schedule off
                  </label>
                </div>
              </div>

              <h3 className="week-title">Week schedule</h3>
              <WeekGrid week={selected.week} onChange={(week) => updateSelected({ week })} />
            </>
          ) : (
            <>
              <div className="exc-header">
                <h3 className="exc-title">Schedule exceptions</h3>
                <div className="exc-btns">
                  <Button label="Add..."    variant="outline" onClick={() => {}} />
                  <Button label="Remove..." variant="outline" disabled />
                </div>
              </div>
              <ExceptionCalendar
                exceptions={selected.exceptions}
                onChange={(exceptions) => updateSelected({ exceptions })}
              />
              <p className="wg-hint">
                Hold Ctrl to select 5 minute intervals. To copy and paste day schedules, use right click.
              </p>
            </>
          )}

          {/* Apply */}
          <div className="sch-apply-row">
            <Button label="Apply" variant="primary" onClick={() => alert(`Saved: ${selected.name}`)} />
          </div>
        </div>
      )}
    </div>
  );
}
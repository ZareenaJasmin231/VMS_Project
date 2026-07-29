import React, { useState, useEffect, useRef, useId } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Clock } from 'lucide-react';
import './DatePicker.css';

const DAYS_OF_WEEK = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

function isSameDay(d1, d2) {
  if (!d1 || !d2) return false;
  const date1 = new Date(d1);
  const date2 = new Date(d2);
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  );
}

function formatDateString(date, includeTime = false, hoursStr = '00', minsStr = '00') {
  if (!date) return '';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  if (includeTime) {
    return `${yyyy}-${mm}-${dd}T${hoursStr}:${minsStr}`;
  }
  return `${yyyy}-${mm}-${dd}`;
}

export default function DatePicker({
  value,
  onChange,
  mode = 'single', // 'single' | 'range' | 'multiple'
  includeTime = false,
  isPopover = true,
  placeholder = 'Select date...',
  minDate = null,
  maxDate = null,
  className = '',
  style = {}
}) {
  const parseInitialDate = () => {
    if (mode === 'single') {
      return value ? new Date(value) : new Date();
    } else if (mode === 'range') {
      return value?.startDate ? new Date(value.startDate) : new Date();
    } else if (mode === 'multiple') {
      return Array.isArray(value) && value.length > 0 ? new Date(value[0]) : new Date();
    }
    return new Date();
  };

  const initialDate = parseInitialDate();
  const [viewDate, setViewDate] = useState(initialDate);
  const [direction, setDirection] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [hoveredDay, setHoveredDay] = useState(null);
  const [focusedDay, setFocusedDay] = useState(null);
  const [shakingDay, setShakingDay] = useState(null);

  const extractHoursAndMins = (val) => {
    if (typeof val === 'string' && val.includes('T')) {
      const timePart = val.split('T')[1].slice(0, 5);
      const [h, m] = timePart.split(':');
      return { hours: h ? h.padStart(2, '0') : '00', minutes: m ? m.padStart(2, '0') : '00' };
    }
    return { hours: '00', minutes: '00' };
  };

  const initialTime = extractHoursAndMins(value);
  const [selectedHours, setSelectedHours] = useState(initialTime.hours);
  const [selectedMinutes, setSelectedMinutes] = useState(initialTime.minutes);

  const wrapperRef = useRef(null);
  const hoursBoxRef = useRef(null);
  const minsBoxRef = useRef(null);
  const focusRingId = useId();

  useEffect(() => {
    if (!isPopover) return;
    const handleClickOutside = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isPopover]);

  useEffect(() => {
    if (value) {
      if (mode === 'single' && value) setViewDate(new Date(value));
      if (mode === 'range' && value?.startDate) setViewDate(new Date(value.startDate));
      if (includeTime) {
        const { hours, minutes } = extractHoursAndMins(value);
        setSelectedHours(hours);
        setSelectedMinutes(minutes);
      }
    }
  }, [value, mode, includeTime]);

  useEffect(() => {
    if (includeTime && isOpen) {
      setTimeout(() => {
        if (hoursBoxRef.current) {
          const activeH = hoursBoxRef.current.querySelector('.dp-time-item.active');
          if (activeH) activeH.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
        if (minsBoxRef.current) {
          const activeM = minsBoxRef.current.querySelector('.dp-time-item.active');
          if (activeM) activeM.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
      }, 50);
    }
  }, [isOpen, includeTime, selectedHours, selectedMinutes]);

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();

  const handlePrevMonth = (e) => {
    e?.stopPropagation();
    setDirection(-1);
    setViewDate(new Date(year, month - 1, 1));
  };

  const handleNextMonth = (e) => {
    e?.stopPropagation();
    setDirection(1);
    setViewDate(new Date(year, month + 1, 1));
  };

  const firstDayOfMonth = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  const gridCells = [];

  for (let i = firstDayOfMonth - 1; i >= 0; i--) {
    const d = daysInPrevMonth - i;
    gridCells.push({
      date: new Date(year, month - 1, d),
      dayNum: d,
      isCurrentMonth: false,
      key: `prev-${d}`
    });
  }

  for (let d = 1; d <= daysInMonth; d++) {
    gridCells.push({
      date: new Date(year, month, d),
      dayNum: d,
      isCurrentMonth: true,
      key: `curr-${d}`
    });
  }

  const remainingCells = (7 - (gridCells.length % 7)) % 7;
  for (let d = 1; d <= remainingCells; d++) {
    gridCells.push({
      date: new Date(year, month + 1, d),
      dayNum: d,
      isCurrentMonth: false,
      key: `next-${d}`
    });
  }

  const today = new Date();

  const isSelected = (date) => {
    if (!date) return false;
    if (mode === 'single') {
      return isSameDay(date, value);
    } else if (mode === 'range') {
      return isSameDay(date, value?.startDate) || isSameDay(date, value?.endDate);
    } else if (mode === 'multiple') {
      return Array.isArray(value) && value.some((v) => isSameDay(date, v));
    }
    return false;
  };

  const isInRange = (date) => {
    if (mode !== 'range' || !value?.startDate) return false;
    const start = new Date(value.startDate).getTime();
    const end = value?.endDate ? new Date(value.endDate).getTime() : (hoveredDay ? hoveredDay.getTime() : null);
    if (!end) return false;
    const current = date.getTime();
    const min = Math.min(start, end);
    const max = Math.max(start, end);
    return current >= min && current <= max;
  };

  const isDateDisabled = (date) => {
    if (minDate && date < new Date(minDate)) return true;
    if (maxDate && date > new Date(maxDate)) return true;
    return false;
  };

  const handleDayClick = (cell) => {
    if (isDateDisabled(cell.date)) {
      setShakingDay(cell.key);
      setTimeout(() => setShakingDay(null), 250);
      return;
    }

    let newValue;
    if (mode === 'single') {
      newValue = formatDateString(cell.date, includeTime, selectedHours, selectedMinutes);
      onChange?.(newValue);
    } else if (mode === 'range') {
      if (!value?.startDate || (value.startDate && value.endDate)) {
        newValue = { startDate: formatDateString(cell.date), endDate: null };
      } else {
        const start = new Date(value.startDate);
        if (cell.date < start) {
          newValue = { startDate: formatDateString(cell.date), endDate: value.startDate };
        } else {
          newValue = { startDate: value.startDate, endDate: formatDateString(cell.date) };
        }
      }
      onChange?.(newValue);
    } else if (mode === 'multiple') {
      const arr = Array.isArray(value) ? [...value] : [];
      const index = arr.findIndex((v) => isSameDay(v, cell.date));
      if (index >= 0) {
        arr.splice(index, 1);
      } else {
        arr.push(formatDateString(cell.date));
      }
      onChange?.(arr);
    }
  };

  const handleSelectHour = (h) => {
    const newH = String(h).padStart(2, '0');
    setSelectedHours(newH);
    if (mode === 'single' && value) {
      onChange?.(formatDateString(value, true, newH, selectedMinutes));
    }
  };

  const handleSelectMinute = (m) => {
    const newM = String(m).padStart(2, '0');
    setSelectedMinutes(newM);
    if (mode === 'single' && value) {
      onChange?.(formatDateString(value, true, selectedHours, newM));
    }
  };

  const handleClear = (e) => {
    e.stopPropagation();
    if (mode === 'single') onChange?.('');
    if (mode === 'range') onChange?.({ startDate: null, endDate: null });
    if (mode === 'multiple') onChange?.([]);
  };

  const handleToday = (e) => {
    e.stopPropagation();
    const now = new Date();
    setViewDate(now);
    if (mode === 'single') {
      onChange?.(formatDateString(now, includeTime, selectedHours, selectedMinutes));
    }
  };

  const handleKeyDown = (e) => {
    if (!focusedDay) return;
    let newDate = new Date(focusedDay);

    if (e.key === 'ArrowLeft') newDate.setDate(newDate.getDate() - 1);
    else if (e.key === 'ArrowRight') newDate.setDate(newDate.getDate() + 1);
    else if (e.key === 'ArrowUp') newDate.setDate(newDate.getDate() - 7);
    else if (e.key === 'ArrowDown') newDate.setDate(newDate.getDate() + 7);
    else if (e.key === 'Enter') {
      const cell = gridCells.find((c) => isSameDay(c.date, focusedDay));
      if (cell) handleDayClick(cell);
      return;
    } else return;

    e.preventDefault();
    setFocusedDay(newDate);
    if (newDate.getMonth() !== month) {
      setViewDate(newDate);
    }
  };

  const renderTriggerText = () => {
    if (mode === 'single') {
      if (!value) return placeholder;
      const strVal = String(value);
      if (strVal.includes('T')) return strVal.split('T')[0];
      return strVal;
    } else if (mode === 'range') {
      if (value?.startDate && value?.endDate) return `${value.startDate} ~ ${value.endDate}`;
      if (value?.startDate) return `${value.startDate} ~ ...`;
      return placeholder;
    } else if (mode === 'multiple') {
      const count = Array.isArray(value) ? value.length : 0;
      return count > 0 ? `${count} date(s) selected` : placeholder;
    }
    return placeholder;
  };

  const hoursList = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
  const minutesList = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));

  const calendarContent = (
    <div
      className={`dp-container ${includeTime ? 'with-time' : ''} ${className}`}
      style={style}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      {/* Header Row */}
      <div className="dp-header">
        <div className="dp-month-year">
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={`${year}-${month}`}
              initial={{ opacity: 0, y: direction * 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -direction * 4 }}
              transition={{ duration: 0.16, ease: 'easeOut' }}
            >
              {MONTH_NAMES[month]} {year}
            </motion.span>
          </AnimatePresence>
        </div>
        <div className="dp-nav-btns">
          <button className="dp-nav-btn" onClick={handlePrevMonth} title="Previous Month" type="button">
            <ChevronLeft size={14} />
          </button>
          <button className="dp-nav-btn" onClick={handleNextMonth} title="Next Month" type="button">
            <ChevronRight size={14} />
          </button>
        </div>
      </div>

      <div className="dp-body-layout">
        {/* Left Side: Calendar Grid */}
        <div className="dp-calendar-side">
          <div className="dp-weekdays">
            {DAYS_OF_WEEK.map((w) => (
              <span key={w} className="dp-weekday">
                {w}
              </span>
            ))}
          </div>

          <div className="dp-grid-wrapper">
            <AnimatePresence mode="wait" initial={false} custom={direction}>
              <motion.div
                key={`${year}-${month}`}
                custom={direction}
                initial={{ opacity: 0, x: direction * 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -direction * 10 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
                className="dp-grid"
              >
                {gridCells.map((cell) => {
                  const selected = isSelected(cell.date);
                  const inRange = isInRange(cell.date);
                  const isTodaysDate = isSameDay(cell.date, today);
                  const isFocused = isSameDay(cell.date, focusedDay);
                  const isShaking = shakingDay === cell.key;

                  let cellClasses = ['dp-day-cell'];
                  if (!cell.isCurrentMonth) cellClasses.push('out-month');
                  if (selected) cellClasses.push('selected');
                  if (inRange) cellClasses.push('in-range');

                  return (
                    <motion.button
                      key={cell.key}
                      type="button"
                      className={cellClasses.join(' ')}
                      onClick={() => handleDayClick(cell)}
                      onMouseEnter={() => setHoveredDay(cell.date)}
                      onFocus={() => setFocusedDay(cell.date)}
                      whileHover={!selected ? { scale: 1.08, backgroundColor: '#1e2026' } : {}}
                      whileTap={{ scale: 0.85 }}
                      animate={
                        isShaking
                          ? { x: [0, -4, 4, -4, 4, 0] }
                          : { scale: 1, backgroundColor: selected ? '#1fd8a4' : undefined }
                      }
                      transition={{ duration: 0.12, ease: 'easeOut' }}
                    >
                      {cell.dayNum}

                      {isTodaysDate && !selected && <span className="dp-today-dot" />}

                      {isFocused && (
                        <motion.span
                          layoutId={`focus-ring-${focusRingId}`}
                          className="dp-focus-ring"
                          transition={{ duration: 0.12, ease: 'easeOut' }}
                        />
                      )}
                    </motion.button>
                  );
                })}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        {/* Right Side: Time Columns if includeTime is true */}
        {includeTime && (
          <div className="dp-time-side">
            <div className="dp-time-header">
              <span>Time</span>
              <span className="dp-time-display-badge">
                {selectedHours}:{selectedMinutes}
              </span>
            </div>

            <div className="dp-time-columns">
              <div>
                <div className="dp-time-col-title">HH</div>
                <div className="dp-time-scroll-box" ref={hoursBoxRef}>
                  {hoursList.map((h) => (
                    <button
                      key={h}
                      type="button"
                      className={`dp-time-item ${selectedHours === h ? 'active' : ''}`}
                      onClick={() => handleSelectHour(h)}
                    >
                      {h}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="dp-time-col-title">MM</div>
                <div className="dp-time-scroll-box" ref={minsBoxRef}>
                  {minutesList.map((m) => (
                    <button
                      key={m}
                      type="button"
                      className={`dp-time-item ${selectedMinutes === m ? 'active' : ''}`}
                      onClick={() => handleSelectMinute(m)}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="dp-footer">
        <button className="dp-footer-btn" onClick={handleClear} type="button">
          Clear
        </button>
        <button className="dp-footer-btn" onClick={handleToday} type="button">
          Today
        </button>
      </div>
    </div>
  );

  if (!isPopover) {
    return calendarContent;
  }

  return (
    <div className="dp-popover-wrapper" ref={wrapperRef}>
      <button
        type="button"
        className={`dp-input-trigger ${isOpen ? 'open' : ''}`}
        onClick={() => setIsOpen((prev) => !prev)}
      >
        <CalendarIcon size={14} style={{ color: '#7c9eff' }} />
        <span className="dp-trigger-text">{renderTriggerText()}</span>
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            className="dp-popover-dropdown"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
          >
            {calendarContent}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

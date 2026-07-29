import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Calendar as CalendarIcon, Clock } from 'lucide-react';
import DatePicker from './DatePicker';
import TimePicker from './TimePicker';
import './DateTimePicker.css';

export default function DateTimePicker({
  value = '',
  onChange,
  className = '',
  style = {}
}) {
  const [activeTab, setActiveTab] = useState(null); // 'date' | 'time' | null
  const containerRef = useRef(null);

  // Parse date and time
  const parseVal = (val) => {
    if (!val) {
      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      return {
        dateStr: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
        timeStr: `${pad(now.getHours())}:${pad(now.getMinutes())}`
      };
    }
    if (val.includes('T')) {
      const [d, t] = val.split('T');
      return { dateStr: d, timeStr: t.slice(0, 5) };
    }
    return { dateStr: val, timeStr: '00:00' };
  };

  const { dateStr, timeStr } = parseVal(value);

  // Close popover on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setActiveTab(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleDateChange = (newDateStr) => {
    onChange?.(`${newDateStr}T${timeStr}`);
    setActiveTab(null);
  };

  const handleTimeChange = (newTimeStr) => {
    onChange?.(`${dateStr}T${newTimeStr}`);
  };

  return (
    <div className={`dtp-container-box ${activeTab ? 'active' : ''} ${className}`} style={style} ref={containerRef}>
      {/* Date Segment */}
      <button
        type="button"
        className={`dtp-segment ${activeTab === 'date' ? 'active' : ''}`}
        onClick={() => setActiveTab((prev) => (prev === 'date' ? null : 'date'))}
      >
        <CalendarIcon size={14} style={{ color: '#7c9eff' }} />
        <span className="dtp-segment-text">{dateStr}</span>
      </button>

      {/* Divider */}
      <div className="dtp-divider" />

      {/* Time Segment */}
      <button
        type="button"
        className={`dtp-segment ${activeTab === 'time' ? 'active' : ''}`}
        onClick={() => setActiveTab((prev) => (prev === 'time' ? null : 'time'))}
      >
        <Clock size={14} style={{ color: '#7c9eff' }} />
        <span className="dtp-segment-text">{timeStr}</span>
      </button>

      {/* Date Popover */}
      <AnimatePresence>
        {activeTab === 'date' && (
          <motion.div
            className="dtp-popover-dropdown date-pos"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
          >
            <DatePicker
              value={dateStr}
              onChange={handleDateChange}
              isPopover={false}
              includeTime={false}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Time Popover */}
      <AnimatePresence>
        {activeTab === 'time' && (
          <motion.div
            className="dtp-popover-dropdown time-pos"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
          >
            <TimePicker
              value={timeStr}
              onChange={handleTimeChange}
              isPopover={false}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

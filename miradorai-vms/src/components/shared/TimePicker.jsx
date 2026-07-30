import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Clock } from 'lucide-react';
import './TimePicker.css';

export default function TimePicker({
  value = '00:00',
  onChange,
  isPopover = true,
  placeholder = 'Select time...',
  className = '',
  style = {}
}) {
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef(null);
  const hoursBoxRef = useRef(null);
  const minsBoxRef = useRef(null);

  const parseTime = (val) => {
    if (!val) return { hours: '00', minutes: '00' };
    let timeStr = val;
    if (val.includes('T')) timeStr = val.split('T')[1];
    const [h, m] = timeStr.split(':');
    return {
      hours: (h || '00').slice(0, 2).padStart(2, '0'),
      minutes: (m || '00').slice(0, 2).padStart(2, '0')
    };
  };

  const { hours: initialHours, minutes: initialMinutes } = parseTime(value);
  const [selectedHours, setSelectedHours] = useState(initialHours);
  const [selectedMinutes, setSelectedMinutes] = useState(initialMinutes);

  useEffect(() => {
    const { hours, minutes } = parseTime(value);
    setSelectedHours(hours);
    setSelectedMinutes(minutes);
  }, [value]);

  useEffect(() => {
    if (!isPopover || !isOpen) return;
    const handleClickOutside = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isPopover, isOpen]);

  useEffect(() => {
    if (isOpen || !isPopover) {
      setTimeout(() => {
        if (hoursBoxRef.current) {
          const activeH = hoursBoxRef.current.querySelector('.tp-item.active');
          if (activeH) activeH.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
        if (minsBoxRef.current) {
          const activeM = minsBoxRef.current.querySelector('.tp-item.active');
          if (activeM) activeM.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
      }, 40);
    }
  }, [isOpen, isPopover, selectedHours, selectedMinutes]);

  const handleSelectHour = (h) => {
    const newH = String(h).padStart(2, '0');
    setSelectedHours(newH);
    onChange?.(`${newH}:${selectedMinutes}`);
  };

  const handleSelectMinute = (m) => {
    const newM = String(m).padStart(2, '0');
    setSelectedMinutes(newM);
    onChange?.(`${selectedHours}:${newM}`);
  };

  const hoursList = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
  const minutesList = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));

  const displayTime = `${selectedHours}:${selectedMinutes}`;

  const timeContent = (
    <div className="tp-dropdown-content">
      <div className="tp-header">
        <span>Time</span>
        <span className="tp-display-badge">{displayTime}</span>
      </div>

      <div className="tp-columns">
        <div>
          <div className="tp-col-title">HOURS</div>
          <div className="tp-scroll-box" ref={hoursBoxRef}>
            {hoursList.map((h) => (
              <button
                key={h}
                type="button"
                className={`tp-item ${selectedHours === h ? 'active' : ''}`}
                onClick={() => handleSelectHour(h)}
              >
                {h}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="tp-col-title">MINUTES</div>
          <div className="tp-scroll-box" ref={minsBoxRef}>
            {minutesList.map((m) => (
              <button
                key={m}
                type="button"
                className={`tp-item ${selectedMinutes === m ? 'active' : ''}`}
                onClick={() => handleSelectMinute(m)}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  if (!isPopover) {
    return <div className={`tp-dropdown ${className}`} style={{ position: 'relative', top: 0, ...style }}>{timeContent}</div>;
  }

  return (
    <div className={`tp-popover-wrapper ${className}`} style={style} ref={wrapperRef}>
      <button
        type="button"
        className={`tp-input-trigger ${isOpen ? 'open' : ''}`}
        onClick={() => setIsOpen((prev) => !prev)}
      >
        <Clock size={14} style={{ color: 'var(--blue)' }} />
        <span className="tp-trigger-text">{displayTime || placeholder}</span>
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            className="tp-dropdown"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
          >
            {timeContent}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

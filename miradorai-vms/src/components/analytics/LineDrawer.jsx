/**
 * Line Drawer Component
 * Allows users to draw lines on a canvas for line crossing detection
 */

import React, { useRef, useState, useEffect, useCallback } from 'react';
import './LineDrawer.css';

const LineDrawer = ({ onComplete, existingPoints, width = 640, height = 360 }) => {
  const canvasRef = useRef(null);
  const [points, setPoints] = useState(existingPoints || []);
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentPoint, setCurrentPoint] = useState(null);
  const [hoverPoint, setHoverPoint] = useState(null);

  useEffect(() => {
    drawCanvas();
  }, [points, currentPoint, hoverPoint]);

  const drawCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, width, height);

    // Draw background grid
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 10; i++) {
      const x = (i / 10) * width;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();

      const y = (i / 10) * height;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // Draw existing line
    if (points.length >= 2) {
      ctx.beginPath();
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 3;
      
      const start = points[0];
      ctx.moveTo(start.x * width, start.y * height);
      
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x * width, points[i].y * height);
      }
      ctx.stroke();

      // Draw points
      points.forEach((point, idx) => {
        ctx.beginPath();
        ctx.fillStyle = '#ef4444';
        ctx.arc(point.x * width, point.y * height, 6, 0, 2 * Math.PI);
        ctx.fill();
        
        ctx.fillStyle = 'white';
        ctx.font = '12px Arial';
        ctx.fillText(idx + 1, point.x * width - 3, point.y * height - 5);
      });
    }

    // Draw current drawing line
    if (points.length >= 1 && currentPoint) {
      ctx.beginPath();
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      
      const lastPoint = points[points.length - 1];
      ctx.moveTo(lastPoint.x * width, lastPoint.y * height);
      ctx.lineTo(currentPoint.x * width, currentPoint.y * height);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Draw hover point
    if (hoverPoint && !isDrawing) {
      ctx.beginPath();
      ctx.fillStyle = '#3b82f6';
      ctx.arc(hoverPoint.x * width, hoverPoint.y * height, 8, 0, 2 * Math.PI);
      ctx.fill();
      ctx.fillStyle = 'white';
      ctx.fillText('+', hoverPoint.x * width - 3, hoverPoint.y * height + 4);
    }
  };

  const handleCanvasClick = useCallback((e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    const mouseX = (e.clientX - rect.left) * scaleX;
    const mouseY = (e.clientY - rect.top) * scaleY;
    
    const normalizedX = mouseX / width;
    const normalizedY = mouseY / height;
    
    // Constrain to 0-1 range
    const x = Math.min(1, Math.max(0, normalizedX));
    const y = Math.min(1, Math.max(0, normalizedY));
    
    setPoints([...points, { x, y }]);
  }, [points, width, height]);

  const handleMouseMove = useCallback((e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    const mouseX = (e.clientX - rect.left) * scaleX;
    const mouseY = (e.clientY - rect.top) * scaleY;
    
    const normalizedX = Math.min(1, Math.max(0, mouseX / width));
    const normalizedY = Math.min(1, Math.max(0, mouseY / height));
    
    if (isDrawing && points.length >= 1) {
      setCurrentPoint({ x: normalizedX, y: normalizedY });
    } else {
      setHoverPoint({ x: normalizedX, y: normalizedY });
    }
  }, [isDrawing, points, width, height]);

  const handleMouseEnter = () => {
    setIsDrawing(true);
  };

  const handleMouseLeave = () => {
    setIsDrawing(false);
    setCurrentPoint(null);
    setHoverPoint(null);
  };

  const handleUndo = () => {
    if (points.length > 0) {
      setPoints(points.slice(0, -1));
    }
  };

  const handleClear = () => {
    setPoints([]);
  };

  const handleComplete = () => {
    if (points.length >= 2) {
      onComplete(points);
    } else {
      alert('Please draw at least 2 points to create a line');
    }
  };

  const handleReset = () => {
    setPoints([]);
  };

  return (
    <div className="line-drawer">
      <div className="drawer-instructions">
        <p>📏 Click on the canvas to add points for your detection line</p>
        <p className="instruction-hint">Points will be connected in order. Minimum 2 points required.</p>
      </div>
      
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className="drawer-canvas"
        onClick={handleCanvasClick}
        onMouseMove={handleMouseMove}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        style={{ width: '100%', height: 'auto', cursor: 'crosshair' }}
      />
      
      <div className="drawer-controls">
        <div className="points-count">
          Points: {points.length}
        </div>
        <div className="drawer-buttons">
          <button onClick={handleUndo} disabled={points.length === 0}>
            ↺ Undo
          </button>
          <button onClick={handleClear} disabled={points.length === 0}>
            ✖ Clear
          </button>
          <button onClick={handleReset} disabled={points.length === 0}>
            Reset All
          </button>
          <button onClick={handleComplete} className="complete-btn">
            ✓ Complete Line
          </button>
        </div>
      </div>
      
      {points.length >= 2 && (
        <div className="line-preview">
          <strong>Line points:</strong>
          <ul>
            {points.map((point, idx) => (
              <li key={idx}>Point {idx + 1}: ({point.x.toFixed(3)}, {point.y.toFixed(3)})</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default LineDrawer;
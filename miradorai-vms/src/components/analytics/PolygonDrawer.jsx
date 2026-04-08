/**
 * Polygon Drawer Component
 * Allows users to draw polygons on a canvas for field/area detection
 */

import React, { useRef, useState, useEffect, useCallback } from 'react';
import './PolygonDrawer.css';

const PolygonDrawer = ({ onComplete, existingPoints, width = 640, height = 360 }) => {
  const canvasRef = useRef(null);
  const [points, setPoints] = useState(existingPoints || []);
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentPoint, setCurrentPoint] = useState(null);
  const [hoverPoint, setHoverPoint] = useState(null);
  const [isComplete, setIsComplete] = useState(false);

  useEffect(() => {
    drawCanvas();
  }, [points, currentPoint, hoverPoint, isComplete]);

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

    // Draw polygon if we have points
    if (points.length >= 3) {
      ctx.beginPath();
      const start = points[0];
      ctx.moveTo(start.x * width, start.y * height);
      
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x * width, points[i].y * height);
      }
      
      if (isComplete) {
        ctx.closePath();
        ctx.fillStyle = 'rgba(59, 130, 246, 0.2)';
        ctx.fill();
      }
      
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Draw points
      points.forEach((point, idx) => {
        ctx.beginPath();
        ctx.fillStyle = '#3b82f6';
        ctx.arc(point.x * width, point.y * height, 6, 0, 2 * Math.PI);
        ctx.fill();
        
        ctx.fillStyle = 'white';
        ctx.font = '12px Arial';
        ctx.fillText(idx + 1, point.x * width - 3, point.y * height - 5);
      });
    } else if (points.length > 0) {
      // Draw incomplete polygon
      ctx.beginPath();
      const start = points[0];
      ctx.moveTo(start.x * width, start.y * height);
      
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x * width, points[i].y * height);
      }
      
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Draw points
      points.forEach((point, idx) => {
        ctx.beginPath();
        ctx.fillStyle = '#f59e0b';
        ctx.arc(point.x * width, point.y * height, 6, 0, 2 * Math.PI);
        ctx.fill();
        
        ctx.fillStyle = 'white';
        ctx.font = '12px Arial';
        ctx.fillText(idx + 1, point.x * width - 3, point.y * height - 5);
      });
    }

    // Draw current drawing line
    if (points.length >= 1 && currentPoint && !isComplete) {
      ctx.beginPath();
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      
      const lastPoint = points[points.length - 1];
      ctx.moveTo(lastPoint.x * width, lastPoint.y * height);
      ctx.lineTo(currentPoint.x * width, currentPoint.y * height);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Draw hover point
    if (hoverPoint && !isDrawing && !isComplete) {
      ctx.beginPath();
      ctx.fillStyle = '#10b981';
      ctx.arc(hoverPoint.x * width, hoverPoint.y * height, 8, 0, 2 * Math.PI);
      ctx.fill();
      ctx.fillStyle = 'white';
      ctx.fillText('+', hoverPoint.x * width - 3, hoverPoint.y * height + 4);
    }
  };

  const handleCanvasClick = useCallback((e) => {
    if (isComplete) return;
    
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    const mouseX = (e.clientX - rect.left) * scaleX;
    const mouseY = (e.clientY - rect.top) * scaleY;
    
    const normalizedX = Math.min(1, Math.max(0, mouseX / width));
    const normalizedY = Math.min(1, Math.max(0, mouseY / height));
    
    const newPoint = { x: normalizedX, y: normalizedY };
    
    // Check if clicking near the first point to complete polygon
    if (points.length >= 3) {
      const firstPoint = points[0];
      const distance = Math.hypot(newPoint.x - firstPoint.x, newPoint.y - firstPoint.y);
      if (distance < 0.05) {
        // Complete the polygon
        setIsComplete(true);
        onComplete(points);
        return;
      }
    }
    
    setPoints([...points, newPoint]);
  }, [points, isComplete, width, height, onComplete]);

  const handleMouseMove = useCallback((e) => {
    if (isComplete) return;
    
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
  }, [isDrawing, points, isComplete, width, height]);

  const handleMouseEnter = () => {
    if (!isComplete) {
      setIsDrawing(true);
    }
  };

  const handleMouseLeave = () => {
    setIsDrawing(false);
    setCurrentPoint(null);
    setHoverPoint(null);
  };

  const handleUndo = () => {
    if (points.length > 0 && !isComplete) {
      setPoints(points.slice(0, -1));
    }
  };

  const handleClear = () => {
    setPoints([]);
    setIsComplete(false);
  };

  const handleComplete = () => {
    if (points.length >= 3) {
      setIsComplete(true);
      onComplete(points);
    } else {
      alert('Please draw at least 3 points to create a polygon area');
    }
  };

  const handleEdit = () => {
    setIsComplete(false);
  };

  const getAreaInfo = () => {
    if (points.length < 3) return null;
    
    // Calculate approximate area (simplified)
    let area = 0;
    for (let i = 0; i < points.length; i++) {
      const p1 = points[i];
      const p2 = points[(i + 1) % points.length];
      area += p1.x * p2.y - p2.x * p1.y;
    }
    area = Math.abs(area) / 2;
    
    return area.toFixed(4);
  };

  return (
    <div className="polygon-drawer">
      <div className="drawer-instructions">
        <p>🔲 Click on the canvas to add points for your detection area</p>
        <p className="instruction-hint">
          Draw at least 3 points. Click near the first point to close the polygon.
        </p>
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
          {isComplete && getAreaInfo() && (
            <span className="area-info"> | Area: {getAreaInfo()}</span>
          )}
        </div>
        <div className="drawer-buttons">
          {!isComplete ? (
            <>
              <button onClick={handleUndo} disabled={points.length === 0}>
                ↺ Undo
              </button>
              <button onClick={handleClear} disabled={points.length === 0}>
                ✖ Clear
              </button>
              <button onClick={handleComplete} disabled={points.length < 3} className="complete-btn">
                ✓ Complete Area
              </button>
            </>
          ) : (
            <>
              <button onClick={handleEdit} className="edit-btn">
                ✎ Edit
              </button>
              <button onClick={handleClear}>
                Reset All
              </button>
            </>
          )}
        </div>
      </div>
      
      {!isComplete && points.length > 0 && (
        <div className="polygon-preview">
          <strong>Area points:</strong>
          <ul>
            {points.map((point, idx) => (
              <li key={idx}>
                Point {idx + 1}: ({point.x.toFixed(3)}, {point.y.toFixed(3)})
                {idx === points.length - 1 && points.length >= 3 && (
                  <span className="close-hint"> → Click near point 1 to close</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      
      {isComplete && (
        <div className="complete-status">
          ✓ Polygon area completed! {points.length} points defined.
        </div>
      )}
    </div>
  );
};

export default PolygonDrawer;
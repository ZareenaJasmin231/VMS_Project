import React, { useEffect, useRef, useState, forwardRef, useImperativeHandle } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { analyzeGltfParts } from "./GltfPartAnalyzer.js";

/**
 * Creates a simple canvas texture for the camera sprite.
 */
function getCamType(name) {
  if (!name) return "dome";
  const n = name.toLowerCase();
  if (n.includes("bullet") || n.includes("bllt")) return "bullet";
  if (n.includes("ptz")) return "ptz";
  if (n.includes("fish")) return "fisheye";
  if (n.includes("box")) return "box";
  if (n.includes("turret")) return "turret";
  return "dome";
}

function createEyeTexture(color = "#ffffff") {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");

  ctx.translate(32, 32);
  ctx.scale(1.5, 1.5);

  ctx.shadowColor = color;
  ctx.shadowBlur = 8;

  // Almond shape
  ctx.beginPath();
  ctx.moveTo(-12, 0);
  ctx.quadraticCurveTo(0, -10, 12, 0);
  ctx.quadraticCurveTo(0, 10, -12, 0);
  ctx.closePath();

  ctx.fillStyle = "#1a1a1a";
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = color;
  ctx.stroke();

  // Iris
  ctx.beginPath();
  ctx.arc(0, 0, 4.5, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();

  // Pupil (glint)
  ctx.beginPath();
  ctx.arc(1, -1, 1.5, 0, Math.PI * 2);
  ctx.fillStyle = "#1a1a1a";
  ctx.fill();
  
  ctx.shadowBlur = 0;

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createCameraTexture(type, color = "#1D9E75", number = "") {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  
  ctx.translate(64, 64);
  const S = 1.6;

  ctx.shadowColor = color;
  ctx.shadowBlur = 10;

  if (type === "bullet") {
    const bS = S * 0.9;
    ctx.save();
    ctx.beginPath(); ctx.moveTo(5*bS, 10*bS); ctx.lineTo(10*bS, 8*bS); ctx.lineTo(10*bS, 18*bS); ctx.lineTo(5*bS, 20*bS); ctx.closePath();
    ctx.fillStyle = "#ffffff"; ctx.fill(); ctx.strokeStyle = "#000000"; ctx.lineWidth = 1; ctx.stroke();
    
    ctx.beginPath(); ctx.moveTo(5*bS, 10*bS); ctx.lineTo(2*bS, 11*bS); ctx.lineTo(2*bS, 21*bS); ctx.lineTo(5*bS, 20*bS); ctx.closePath();
    ctx.fillStyle = "#f5f5f5"; ctx.fill(); ctx.strokeStyle = "#000000"; ctx.stroke();

    ctx.beginPath(); ctx.moveTo(-2*bS, 14*bS); ctx.lineTo(5*bS, 12*bS); ctx.lineTo(5*bS, 15*bS); ctx.lineTo(-2*bS, 17*bS); ctx.closePath();
    ctx.fillStyle = "#ffffff"; ctx.fill(); ctx.strokeStyle = "#000000"; ctx.stroke();
    
    ctx.beginPath(); ctx.moveTo(-4*bS, 0); ctx.lineTo(0*bS, -1*bS); ctx.lineTo(0*bS, 14*bS); ctx.lineTo(-4*bS, 15*bS); ctx.closePath();
    ctx.fillStyle = "#ffffff"; ctx.fill(); ctx.strokeStyle = "#000000"; ctx.stroke();
    ctx.restore();

    ctx.beginPath(); ctx.moveTo(-12*bS, -7*bS); ctx.lineTo(8*bS, -7*bS); ctx.bezierCurveTo(12*bS, -7*bS, 12*bS, 7*bS, 8*bS, 7*bS); ctx.lineTo(-12*bS, 7*bS); ctx.bezierCurveTo(-8*bS, 7*bS, -8*bS, -7*bS, -12*bS, -7*bS); ctx.closePath();
    ctx.fillStyle = "#ffffff"; ctx.fill(); ctx.strokeStyle = "#000000"; ctx.lineWidth = 1; ctx.stroke();

    ctx.beginPath(); ctx.moveTo(-14*bS, -8*bS); ctx.lineTo(10*bS, -8*bS); ctx.bezierCurveTo(16*bS, -8*bS, 16*bS, -1*bS, 10*bS, -1*bS); ctx.lineTo(-14*bS, -1*bS); ctx.closePath();
    ctx.fillStyle = "#ffffff"; ctx.fill(); ctx.strokeStyle = "#000000"; ctx.stroke();

    ctx.beginPath(); ctx.ellipse(8*bS, 0, 2.5*bS, 6.5*bS, 0, 0, Math.PI*2); ctx.fillStyle = "#1b3039"; ctx.fill(); ctx.strokeStyle = "#000000"; ctx.stroke();
    ctx.beginPath(); ctx.ellipse(8*bS, 0, 1.2*bS, 3.5*bS, 0, 0, Math.PI*2); ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1; ctx.stroke();
    ctx.beginPath(); ctx.ellipse(8*bS, 0, 0.5*bS, 1.5*bS, 0, 0, Math.PI*2); ctx.fillStyle = "#000000"; ctx.fill();

  } else if (type === "ptz") {
    const pS = S * 0.9;
    ctx.save();
    ctx.beginPath(); ctx.moveTo(-10*pS, -6*pS); ctx.lineTo(-10*pS, 10*pS); ctx.lineTo(-14*pS, 12*pS); ctx.lineTo(-14*pS, -8*pS); ctx.closePath();
    ctx.fillStyle = "#ffffff"; ctx.fill(); ctx.strokeStyle = "#000000"; ctx.lineWidth = 1; ctx.stroke();

    ctx.beginPath(); ctx.moveTo(-10*pS, 0); ctx.lineTo(-4*pS, -2*pS); ctx.lineTo(-4*pS, 2*pS); ctx.lineTo(-10*pS, 4*pS); ctx.closePath();
    ctx.fillStyle = "#ffffff"; ctx.fill(); ctx.strokeStyle = "#000000"; ctx.stroke();
    ctx.restore();

    ctx.beginPath(); ctx.moveTo(-4*pS, -3*pS); ctx.lineTo(-4*pS, 3*pS); ctx.lineTo(-2*pS, 3*pS); ctx.lineTo(-2*pS, -3*pS);
    ctx.fillStyle = "#ffffff"; ctx.fill(); ctx.strokeStyle = "#000000"; ctx.lineWidth = 1; ctx.stroke();

    ctx.beginPath(); ctx.moveTo(-2*pS, -3*pS); ctx.lineTo(-2*pS, 3*pS); ctx.bezierCurveTo(4*pS, 8*pS, 6*pS, 9*pS, 8*pS, 9*pS); ctx.lineTo(8*pS, -9*pS); ctx.bezierCurveTo(6*pS, -9*pS, 4*pS, -8*pS, -2*pS, -3*pS); ctx.closePath();
    ctx.fillStyle = "#ffffff"; ctx.fill(); ctx.strokeStyle = "#000000"; ctx.stroke();

    ctx.beginPath(); ctx.moveTo(8*pS, -8*pS); ctx.lineTo(8*pS, 8*pS); ctx.bezierCurveTo(14*pS, 8*pS, 16*pS, 4*pS, 16*pS, 0); ctx.bezierCurveTo(16*pS, -4*pS, 14*pS, -8*pS, 8*pS, -8*pS); ctx.closePath();
    ctx.fillStyle = "#1a1a1a"; ctx.fill(); ctx.strokeStyle = "#000000"; ctx.stroke();

    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(8*pS, -3*pS, 4*pS, 6*pS, 1); ctx.fillStyle = "#262626"; ctx.fill(); }
    ctx.beginPath(); ctx.arc(10*pS, 0, 1.8*pS, 0, Math.PI*2); ctx.fillStyle = "#000000"; ctx.fill();

  } else {
    if (type === "dome" || type === "turret") {
      ctx.beginPath(); ctx.arc(0, 0, 11 * S, 0, Math.PI * 2); ctx.fillStyle = "#ffffff"; ctx.fill(); ctx.strokeStyle = "#000000"; ctx.lineWidth = 1; ctx.stroke();
      ctx.beginPath(); ctx.arc(3 * S, 0, 8.5 * S, 0, Math.PI * 2); ctx.fillStyle = "#222222"; ctx.fill(); ctx.strokeStyle = "#000000"; ctx.lineWidth = 1; ctx.stroke();
      ctx.beginPath(); ctx.arc(3 * S, 0, 8.5 * S, 0, Math.PI * 2); ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.beginPath(); ctx.arc(4 * S, 0, 5 * S, 0, Math.PI * 2); ctx.fillStyle = "#111111"; ctx.fill(); ctx.strokeStyle = "#000000"; ctx.lineWidth = 1; ctx.stroke();
      ctx.beginPath(); ctx.arc(4 * S, 0, 2 * S, 0, Math.PI * 2); ctx.fillStyle = "#000000"; ctx.fill();
      ctx.beginPath(); ctx.arc(4.5 * S, -0.5 * S, 0.5 * S, 0, Math.PI * 2); ctx.fillStyle = "rgba(255,255,255,0.6)"; ctx.fill();
    } else if (type === "fisheye") {
      ctx.beginPath(); ctx.arc(0, 0, 12 * S, 0, Math.PI * 2); ctx.fillStyle = "#ffffff"; ctx.fill(); ctx.strokeStyle = "#000000"; ctx.lineWidth = 1; ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, 8 * S, 0, Math.PI * 2); ctx.strokeStyle = "#000000"; ctx.lineWidth = 1; ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, 3.5 * S, 0, Math.PI * 2); ctx.fillStyle = "#0e0e0e"; ctx.fill(); ctx.strokeStyle = "#000000"; ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, 1.5 * S, 0, Math.PI * 2); ctx.strokeStyle = "rgba(255,255,255,0.2)"; ctx.stroke();
    } else {
      const shift = 14 * S; ctx.translate(-shift, 0);
      ctx.beginPath(); ctx.arc(-14 * S, 0, 5 * S, 0, Math.PI * 2); ctx.fillStyle = "#ffffff"; ctx.fill(); ctx.strokeStyle = "#000000"; ctx.lineWidth = 1; ctx.stroke();
      if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(-14 * S, -2.5 * S, 7 * S, 5 * S, 1.5); ctx.fillStyle = "#ffffff"; ctx.fill(); ctx.strokeStyle = "#000000"; ctx.lineWidth = 1; ctx.stroke(); }
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(-7 * S, -7 * S, 20 * S, 14 * S, 2) : ctx.rect(-7 * S, -7 * S, 20 * S, 14 * S); ctx.fillStyle = "#ffffff"; ctx.fill(); ctx.strokeStyle = "#000000"; ctx.lineWidth = 1; ctx.stroke();
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(13 * S, -5 * S, 6 * S, 10 * S, 1) : ctx.rect(13 * S, -5 * S, 6 * S, 10 * S); ctx.fillStyle = "#111111"; ctx.fill(); ctx.strokeStyle = "#000000"; ctx.stroke();
      ctx.translate(shift, 0);
    }
  }

  if (type === "bullet" || type === "ptz" || type === "box" || type === "thermal") {
    ctx.beginPath(); ctx.arc(-14 * S, -6 * S, 2 * S, 0, Math.PI * 2);
  } else {
    ctx.beginPath(); ctx.arc(-8 * S, -8 * S, 2 * S, 0, Math.PI * 2);
  }
  ctx.fillStyle = "#ff4d4f"; ctx.fill(); ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 0.5; ctx.stroke();
  
  ctx.shadowBlur = 0;
  if (number) {
    ctx.fillStyle = color === "#1D9E75" ? "#000000" : "#666666";
    ctx.font = "bold 16px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(number.toString(), -2 * S, 0);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createDimensionSprite(text) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  
  // Background pill
  ctx.fillStyle = "rgba(13, 17, 23, 0.75)";
  if (ctx.roundRect) {
    ctx.beginPath();
    ctx.roundRect(0, 0, 512, 128, 64);
    ctx.fill();
  } else {
    ctx.fillRect(0, 0, 512, 128);
  }

  // Border
  ctx.lineWidth = 6;
  ctx.strokeStyle = "#10b981";
  if (ctx.roundRect) {
    ctx.beginPath();
    ctx.roundRect(3, 3, 506, 122, 60);
    ctx.stroke();
  }

  // Text
  ctx.font = "bold 56px Inter, sans-serif";
  ctx.fillStyle = "#10b981";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "#000";
  ctx.shadowBlur = 8;
  ctx.fillText(text, 256, 64);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: texture, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(6, 1.5, 1);
  return sprite;
}

function createCameraLabelSprite(label, borderColor = "#a855f7") {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  // High-DPI measurement
  ctx.font = "bold 32px 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
  const metrics = ctx.measureText(label);
  const textWidth = Math.max(metrics.width, 80);

  const padX = 24;
  const padY = 14;
  const w = Math.ceil(textWidth + padX * 2);
  const h = 64;

  canvas.width = w;
  canvas.height = h;

  // Background pill / box
  ctx.fillStyle = "rgba(15, 23, 42, 0.94)";
  const cornerR = 12;
  if (ctx.roundRect) {
    ctx.beginPath();
    ctx.roundRect(3, 3, w - 6, h - 6, cornerR);
    ctx.fill();
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = borderColor;
    ctx.stroke();
  } else {
    ctx.fillRect(3, 3, w - 6, h - 6);
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = borderColor;
    ctx.strokeRect(3, 3, w - 6, h - 6);
  }

  // Label text
  ctx.font = "bold 32px 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 4;
  ctx.fillText(label, w / 2, h / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: texture, depthTest: false });
  const sprite = new THREE.Sprite(mat);

  const aspect = w / h;
  return { sprite, aspect };
}

function exportReportAsJSON(report, filename = 'parts_report.json') {
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportReportAsCSV(report, filename = 'parts_report.csv') {
  const headers = ['name', 'width_m', 'height_m', 'depth_m'];
  const rows = report.parts.map(p => [
    p.name || p.groupId,
    p.dimensions.width.toFixed(4),
    p.dimensions.height.toFixed(4),
    p.dimensions.depth.toFixed(4),
  ]);

  const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function PartsMeasurementPanel({ report }) {
  const [showUnits, setShowUnits] = useState(false);

  return (
    <div style={{
      position: 'absolute', bottom: 10, right: 10,
      background: 'rgba(20,20,20,0.9)', color: '#fff',
      padding: '10px', borderRadius: '6px', fontSize: '12px',
      maxHeight: '300px', overflowY: 'auto', zIndex: 1000,
      fontFamily: 'monospace'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
        <strong>Parts: {report.parts.length} ({report.strategy})</strong>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button onClick={() => exportReportAsJSON(report)} style={{ fontSize: '10px', cursor: 'pointer', padding: '2px 4px' }}>JSON</button>
          <button onClick={() => exportReportAsCSV(report)} style={{ fontSize: '10px', cursor: 'pointer', padding: '2px 4px' }}>CSV</button>
          <button onClick={() => setShowUnits(!showUnits)} style={{ fontSize: '11px', cursor: 'pointer', marginLeft: '6px' }}>
            Units: meters
          </button>
        </div>
      </div>

      {report.warning && (
        <div style={{
          marginTop: '6px', padding: '4px 6px',
          background: '#5a3d00', color: '#ffd166',
          borderRadius: '4px', fontSize: '11px'
        }}>
          ⚠ {report.warning}
        </div>
      )}

      {showUnits && (
        <table style={{ marginTop: '8px', width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', paddingRight: '8px' }}>Name</th>
              <th style={{ paddingRight: '6px' }}>W (m)</th>
              <th style={{ paddingRight: '6px' }}>H (m)</th>
              <th>D (m)</th>
            </tr>
          </thead>
          <tbody>
            {report.parts.map((p, i) => (
              <tr key={i}>
                <td style={{ paddingRight: '8px', maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name || p.groupId}</td>
                <td style={{ paddingRight: '6px', textAlign: 'right' }}>{p.dimensions.width.toFixed(3)}</td>
                <td style={{ paddingRight: '6px', textAlign: 'right' }}>{p.dimensions.height.toFixed(3)}</td>
                <td style={{ textAlign: 'right' }}>{p.dimensions.depth.toFixed(3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const Gltf3DViewer = forwardRef(function Gltf3DViewer({ modelUrl, markers = [], cameras = [], imageSize = { width: 0, height: 0 }, updateMarkers, showHeatmap = false }, ref) {
  const containerRef = useRef(null);
  const [report, setReport] = useState(null);
  
    // Persist Three.js core objects so we can attach events to them
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
  const controlsRef = useRef(null);
  const modelDataRef = useRef(null);
  const ambientLightRef = useRef(null);
  const dirLightRef = useRef(null);
  const fillLightRef = useRef(null);
  
  // Groups
  const camerasGroupRef = useRef(null);
  
  // State for internal marker updates while dragging
  const [localMarkers, setLocalMarkers] = useState([]);
  const [hoverTooltip, setHoverTooltip] = useState(null);
  const localMarkersRef = useRef([]);
  localMarkersRef.current = localMarkers;
  const isDraggingRef = useRef(false);
  const draggingIdxRef = useRef(-1);
  const rotatingIdxRef = useRef(-1);

  // Sync external markers to local state initially
  useEffect(() => {
    if (!isDraggingRef.current) {
      setLocalMarkers(JSON.parse(JSON.stringify(markers)));
    }
  }, [markers]);

  // ── Export full 3D GLB model with cameras and volumetric FOV beams ──
  const exportGLB = (floorName = "Floor") => {
    if (!modelDataRef.current?.currentModel) {
      alert("No 3D model loaded to export.");
      return;
    }

    const { currentModel, upAxis, spanW, boxMaxY, boxMaxZ } = modelDataRef.current;
    const imgW = imageSize?.width || 2048;
    const imgH = imageSize?.height || 2048;
    const scaleX = (spanW * 1.05) / imgW;
    const spriteSize = spanW * 1.2 * 0.05;

    const exportScene = new THREE.Scene();
    exportScene.name = `Mirador_${(floorName || "Floor").replace(/\s+/g, "_")}`;

    // 1. Clone architectural base model with clean materials
    const baseModelClone = currentModel.clone(true);
    baseModelClone.traverse((node) => {
      if (node.isMesh) {
        if (node.userData.originalMaterial) {
          node.material = node.userData.originalMaterial;
        }
        if (node.userData?.isMiradorCamera || node.userData?.isMiradorFovBeam || node.name?.startsWith("MiradorCamera_") || node.name?.startsWith("FOV_Beam_")) {
          node.visible = false;
        }
      }
    });
    exportScene.add(baseModelClone);

    const raycaster = new THREE.Raycaster();

    // 2. Add each camera as a 3D camera body + 3D Volumetric FOV Mesh
    localMarkersRef.current.forEach((marker, idx) => {
      const cam = cameras.find(c => c.id === marker.camId);
      const isOnline = cam?.status === "online";
      const colorHex = isOnline ? 0x1D9E75 : 0x666666;

      const dx = marker.x - imgW / 2;
      const dy = marker.y - imgH / 2;
      const mapX = dx * scaleX;
      let mapY, mapZ;
      if (upAxis === "y") {
        mapZ = dy * scaleX;
        mapY = boxMaxY * 0.95;
      } else {
        mapY = -dy * scaleX;
        mapZ = boxMaxZ * 0.95;
      }

      const camGroup = new THREE.Group();
      camGroup.name = `MiradorCamera_${marker.camId || idx + 1}`;
      camGroup.position.set(mapX, mapY, mapZ);
      camGroup.userData = {
        isMiradorCamera: true,
        camId: marker.camId,
        camName: cam?.name || marker.camName || `Camera ${idx + 1}`,
        x: marker.x,
        y: marker.y,
        direction: marker.direction || 0,
        fovAngle: marker.fovAngle || cam?.specs?.hfov || 60,
        status: cam?.status || "online"
      };

      // ── Physical 3D Camera Body ──
      const bodyMat = new THREE.MeshStandardMaterial({ color: 0xf3f4f6, roughness: 0.3, metalness: 0.1 });
      const darkMat = new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.2, metalness: 0.8 });
      const lensMat = new THREE.MeshStandardMaterial({ color: colorHex, emissive: colorHex, emissiveIntensity: 0.4, roughness: 0.1 });

      const baseR = spriteSize * 0.35;
      const baseH = spriteSize * 0.15;
      
      const baseMesh = new THREE.Mesh(new THREE.CylinderGeometry(baseR * 0.85, baseR, baseH, 16), bodyMat);
      const domeMesh = new THREE.Mesh(new THREE.SphereGeometry(baseR * 0.75, 16, 16, 0, Math.PI * 2, 0, Math.PI / 2), darkMat);
      domeMesh.position.y = -baseH * 0.5;
      domeMesh.rotation.x = Math.PI;

      const lensMesh = new THREE.Mesh(new THREE.SphereGeometry(baseR * 0.22, 12, 12), lensMat);
      lensMesh.position.y = -baseH * 0.75;

      const camBodyGroup = new THREE.Group();
      camBodyGroup.name = "CameraBody";
      camBodyGroup.add(baseMesh);
      camBodyGroup.add(domeMesh);
      camBodyGroup.add(lensMesh);
      camGroup.add(camBodyGroup);

      // ── 3D Volumetric FOV Beam (Collision-accurate) ──
      const fovAngle = marker.fovAngle || cam?.specs?.hfov || marker.camera?.hfov || 60;
      const direction = marker.direction || 0;
      const fovRad = fovAngle * (Math.PI / 180);
      const dirRad = direction * (Math.PI / 180);
      const vFovRad = cam?.specs?.vfov ? cam.specs.vfov * (Math.PI / 180) : 40 * (Math.PI / 180);
      const pitchRad = 35 * (Math.PI / 180);
      const rayMaxDist = Number(cam?.specs?.rangeDay || cam?.rangeDay || marker.camera?.rangeDay || marker.camera?.specs?.rangeDay || (cam?.specs?.rangeNight ? cam.specs.rangeNight : null) || 30);

      const tiltTop = pitchRad - (vFovRad / 2);
      const tiltBottom = pitchRad + (vFovRad / 2);

      const origin = new THREE.Vector3(0, 0, 0);
      const topPoints = [];
      const bottomPoints = [];
      const numRays = 24;

      for (let i = 0; i <= numRays; i++) {
        const angle = dirRad - (fovRad / 2) + (fovRad * (i / numRays));
        const getHit = (tilt) => {
          let rx, ry, rz;
          if (upAxis === "y") {
            rx = Math.cos(angle) * Math.cos(tilt);
            ry = -Math.sin(tilt);
            rz = Math.sin(angle) * Math.cos(tilt);
          } else {
            rx = Math.cos(angle) * Math.cos(tilt);
            ry = -Math.sin(angle) * Math.cos(tilt);
            rz = -Math.sin(tilt);
          }
          const rayDir = new THREE.Vector3(rx, ry, rz).normalize();
          raycaster.set(camGroup.position, rayDir);
          const hits = raycaster.intersectObject(currentModel, true);
          let dist = rayMaxDist;
          if (hits.length > 0) dist = Math.min(dist, hits[0].distance);
          return rayDir.clone().multiplyScalar(dist);
        };

        topPoints.push(getHit(tiltTop));
        bottomPoints.push(getHit(tiltBottom));
      }

      const vertices = [];
      const pushTris = (...pts) => pts.forEach(p => vertices.push(p.x, p.y, p.z));

      for (let i = 0; i < numRays; i++) {
        const t0 = topPoints[i];
        const t1 = topPoints[i + 1];
        const b0 = bottomPoints[i];
        const b1 = bottomPoints[i + 1];
        pushTris(origin, t0, t1);
        pushTris(origin, b1, b0);
        pushTris(t0, b0, b1);
        pushTris(t0, b1, t1);
      }
      pushTris(origin, bottomPoints[0], topPoints[0]);
      pushTris(origin, topPoints[numRays], bottomPoints[numRays]);

      const fovGeo = new THREE.BufferGeometry();
      fovGeo.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
      fovGeo.computeVertexNormals();

      const fovMaterial = new THREE.MeshStandardMaterial({
        color: colorHex,
        transparent: true,
        opacity: 0.35,
        roughness: 0.2,
        metalness: 0.1,
        side: THREE.DoubleSide,
        depthWrite: false
      });

      const fovMesh = new THREE.Mesh(fovGeo, fovMaterial);
      fovMesh.name = `FOV_Beam_${marker.camId || idx + 1}`;
      fovMesh.userData = { isMiradorFovBeam: true, camId: marker.camId };
      camGroup.add(fovMesh);

      exportScene.add(camGroup);
    });

    // 3. Attach full metadata to scene for seamless round-trip re-import
    exportScene.userData = {
      generator: "Mirador VMS 3D Designer",
      mirador_version: "2.0",
      exported_at: new Date().toISOString(),
      floor_name: floorName,
      markers: localMarkersRef.current.map(m => ({
        camId: m.camId,
        x: m.x,
        y: m.y,
        direction: m.direction || 0,
        fovAngle: m.fovAngle || 60,
        camName: m.camName || ""
      }))
    };

    // 4. Perform GLB Binary Export
    const exporter = new GLTFExporter();
    exporter.parse(
      exportScene,
      (glbArrayBuffer) => {
        const blob = new Blob([glbArrayBuffer], { type: "model/gltf-binary" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        const cleanName = (floorName || "Floor").replace(/\s+/g, "_");
        link.download = `${cleanName}_design.glb`;
        link.href = url;
        link.click();
        URL.revokeObjectURL(url);
      },
      (err) => {
        console.error("[GLTFExporter] Export failed:", err);
        alert("Failed to export GLB file: " + (err.message || err));
      },
      { binary: true, embedImages: true }
    );
  };

  // ── Export exact 3D viewport snapshot as PNG ──
  const exportSnapshot = (floorName = "Floor") => {
    if (!rendererRef.current || !sceneRef.current || !cameraRef.current) {
      alert("3D view is not ready for snapshot.");
      return;
    }
    // Render current scene directly to WebGL canvas buffer
    rendererRef.current.render(sceneRef.current, cameraRef.current);
    const dataUrl = rendererRef.current.domElement.toDataURL("image/png");
    const link = document.createElement("a");
    const cleanName = (floorName || "Floor").replace(/\s+/g, "_");
    link.download = `${cleanName}_snapshot.png`;
    link.href = dataUrl;
    link.click();
  };

  useImperativeHandle(ref, () => ({
    exportGLB,
    exportSnapshot
  }));

  // ── 1. Init Engine ───────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || !modelUrl) return;

    const container = containerRef.current;
    let width = container.clientWidth || 800;
    let height = container.clientHeight || 600;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#0d1117");
    sceneRef.current = scene;

    const camerasGroup = new THREE.Group();
    scene.add(camerasGroup);
    camerasGroupRef.current = camerasGroup;

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 10000);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); 
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controlsRef.current = controls;

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, showHeatmap ? 0.15 : 0.7);
    scene.add(ambientLight);
    ambientLightRef.current = ambientLight;

    const dirLight = new THREE.DirectionalLight(0xffffff, showHeatmap ? 0.1 : 1.0);
    dirLight.position.set(100, 200, 50);
    scene.add(dirLight);
    dirLightRef.current = dirLight;

    const fillLight = new THREE.DirectionalLight(0xffffff, showHeatmap ? 0.0 : 0.3);
    fillLight.position.set(-100, -50, -50);
    scene.add(fillLight);
    fillLightRef.current = fillLight;

    // Load Model
    const loader = new GLTFLoader();
    let currentModel = null;

    loader.load(
      modelUrl,
      (gltf) => {
        currentModel = gltf.scene;

        // Remove any previously baked static camera/beam meshes so bounding box is calculated strictly on building geometry
        const nodesToRemove = [];
        currentModel.traverse((node) => {
          if (node.userData?.isMiradorCamera || node.userData?.isMiradorFovBeam || node.name?.startsWith("MiradorCamera_") || node.name?.startsWith("FOV_Beam_")) {
            nodesToRemove.push(node);
          }
        });
        nodesToRemove.forEach((n) => {
          if (n.parent) n.parent.remove(n);
        });

        // Setup both Original (Basic) and Heatmap (Standard) materials
        currentModel.traverse((node) => {
          if (node.isMesh && node.material && node.visible !== false) {
            if (node.material.isMeshBasicMaterial || node.material.type === "MeshBasicMaterial") {
              node.userData.originalMaterial = node.material;
              node.userData.heatmapMaterial = new THREE.MeshStandardMaterial({
                color: node.material.color,
                map: node.material.map,
                transparent: node.material.transparent,
                opacity: node.material.opacity,
                roughness: 0.8,
                metalness: 0.1
              });
              node.material = showHeatmap ? node.userData.heatmapMaterial : node.userData.originalMaterial;
            }
          }
        });

        scene.add(currentModel);

        // new: analyze parts
        const gltfReport = analyzeGltfParts(gltf.scene);
        setReport(gltfReport);

        const box = new THREE.Box3().setFromObject(currentModel);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());

        currentModel.position.x -= center.x;
        currentModel.position.y -= center.y;
        currentModel.position.z -= center.z;
        box.setFromObject(currentModel);

        const ratioYZ = size.y > 0 && size.z > 0 ? Math.min(size.y, size.z) / Math.max(size.y, size.z) : 1;
        let upAxis = "y";
        if (ratioYZ > 0.8) upAxis = "y";
        else if (size.y <= size.x && size.y <= size.z) upAxis = "y";
        else if (size.z <= size.x && size.z <= size.y) upAxis = "z";

        const spanW = upAxis === "y" ? size.x : size.x;
        const maxDim = Math.max(size.x, size.y, size.z);
        
        const fovRad = camera.fov * (Math.PI / 180);
        let cameraDist = Math.abs((maxDim / 2) / Math.tan(fovRad / 2));
        camera.position.set(maxDim * 0.5, maxDim * 0.8, cameraDist * 1.5);
        camera.lookAt(0, 0, 0);
        controls.target.set(0, 0, 0);
        controls.update();

        // ── Visual Scale Overlays ──
        
        // 1. Grid
        const gridHelper = new THREE.GridHelper(Math.ceil(maxDim * 1.5), Math.ceil(maxDim * 1.5), 0x5aabf0, 0x444444);
        if (upAxis === "z") {
          gridHelper.rotation.x = Math.PI / 2;
          gridHelper.position.set(0, 0, box.min.z);
        } else {
          gridHelper.position.set(0, box.min.y, 0);
        }
        scene.add(gridHelper);

        // 2. Physical Metric Sprites
        const widthM = size.x.toFixed(1);
        const depthM = (upAxis === "y" ? size.z : size.y).toFixed(1);

        const widthLabel = createDimensionSprite(`↔ ${widthM} m`);
        const depthLabel = createDimensionSprite(`↕ ${depthM} m`);

        if (upAxis === "y") {
          widthLabel.position.set(0, box.min.y, box.max.z + maxDim * 0.05);
          depthLabel.position.set(box.max.x + maxDim * 0.05, box.min.y, 0);
        } else {
          widthLabel.position.set(0, box.max.y + maxDim * 0.05, box.min.z);
          depthLabel.position.set(box.max.x + maxDim * 0.05, 0, box.min.z);
        }
        
        scene.add(widthLabel);
        scene.add(depthLabel);

        modelDataRef.current = {
          currentModel, upAxis, spanW, maxDim, 
          boxMaxY: box.max.y, boxMaxZ: box.max.z
        };
        
        // Force a state update to trigger marker rendering now that model is loaded
        setLocalMarkers(prev => [...prev]);
      },
      undefined,
      (error) => console.error("Error loading 3D model:", error)
    );

    let animationFrameId;
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      if (!containerRef.current) return;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      if (w === 0 || h === 0) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    
    const resizeObserver = new ResizeObserver(() => handleResize());
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      cancelAnimationFrame(animationFrameId);
      controls.dispose();
      
      if (currentModel) {
        scene.remove(currentModel);
        currentModel.traverse((child) => {
          if (child.isMesh) {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
              if (Array.isArray(child.material)) child.material.forEach(m => { if(m.map)m.map.dispose(); m.dispose(); });
              else { if(child.material.map)child.material.map.dispose(); child.material.dispose(); }
            }
          }
        });
      }
      
      renderer.dispose();
      renderer.forceContextLoss();
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
    };
  }, [modelUrl]);

  // ── 2. Build Cameras Geometry ────────────────────────────────────
  useEffect(() => {
    if (!modelDataRef.current || !camerasGroupRef.current) return;
    
    // Clear old markers
    while (camerasGroupRef.current.children.length > 0) {
      camerasGroupRef.current.remove(camerasGroupRef.current.children[0]);
    }

    const imgW = imageSize?.width || 2048;
    const imgH = imageSize?.height || 2048;
    const { currentModel, upAxis, spanW, boxMaxY, boxMaxZ } = modelDataRef.current;
    const maxDim = spanW * 1.2;
    const scaleX = (spanW * 1.05) / imgW;
    const spriteSize = maxDim * 0.05; 
    
    // Invisible material for hitboxes so Raycaster can still hit them!
    const invisibleMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });

    const fovMat = new THREE.MeshBasicMaterial({ 
      color: 0x1D9E75, 
      transparent: true, 
      opacity: 0.15, // Subtle volumetric glow
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });

    const raycaster = new THREE.Raycaster();

    localMarkers.forEach((marker, idx) => {
      const cam = cameras.find(c => c.id === marker.camId);
      const type = getCamType(cam?.name);
      const isOnline = cam?.status === "online";
      const color = isOnline ? "#1D9E75" : "#666666";
      
      const tex = createCameraTexture(type, color, (idx + 1).toString());
      // We apply rotation to the sprite material so it faces the correct 2D direction!
      const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, rotation: -(marker.direction || 0) * (Math.PI / 180) });

      const dx = marker.x - imgW / 2;
      const dy = marker.y - imgH / 2;
      const mapX = dx * scaleX;
      
      let mapY, mapZ;
      if (upAxis === "y") {
        mapZ = dy * scaleX;
        mapY = boxMaxY * 0.95; // hover near ceiling
      } else {
        mapY = -dy * scaleX;
        mapZ = boxMaxZ * 0.95;
      }

      const camWrapper = new THREE.Group();
      camWrapper.position.set(mapX, mapY, mapZ);
      camerasGroupRef.current.add(camWrapper);
      
      // The camera icon
      const sprite = new THREE.Sprite(mat);
      sprite.scale.set(spriteSize, spriteSize, 1);
      sprite.renderOrder = 999; 
      camWrapper.add(sprite);

      // Invisible Raycast Hitbox
      const hitbox = new THREE.Mesh(new THREE.SphereGeometry(spriteSize * 1.2), invisibleMat);
      hitbox.userData = { isCameraHitbox: true, index: idx };
      camWrapper.add(hitbox);

      // ── Camera Model/Name Label Badge (Floating 3D pill badge matching 2D style) ──
      const labelText = marker.camName || cam?.model || cam?.name || marker.camera?.model || `Camera ${idx + 1}`;
      const borderColor = "#a855f7"; // Purple badge border matching 2D DesignerView
      const { sprite: labelSprite, aspect: labelAspect } = createCameraLabelSprite(labelText, borderColor);
      const labelH = spriteSize * 0.42;
      const labelW = labelH * labelAspect;
      labelSprite.scale.set(labelW, labelH, 1);
      labelSprite.renderOrder = 1001;

      // Position badge floating above & slightly offset
      let lx, ly, lz;
      if (upAxis === "y") {
        lx = -spriteSize * 0.45;
        ly = spriteSize * 0.75;
        lz = -spriteSize * 0.45;
      } else {
        lx = -spriteSize * 0.45;
        ly = spriteSize * 0.45;
        lz = spriteSize * 0.75;
      }
      labelSprite.position.set(lx, ly, lz);
      camWrapper.add(labelSprite);

      // Subtle dashed leader line connecting camera center to label badge
      const leaderLineGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(lx, ly, lz)
      ]);
      const leaderLineMat = new THREE.LineDashedMaterial({
        color: 0xa855f7,
        dashSize: spriteSize * 0.08,
        gapSize: spriteSize * 0.05,
        transparent: true,
        opacity: 0.75,
        depthTest: false
      });
      const leaderLine = new THREE.Line(leaderLineGeo, leaderLineMat);
      leaderLine.computeLineDistances();
      camWrapper.add(leaderLine);

      const fovAngle = marker.fovAngle || cam?.specs?.hfov || marker.camera?.hfov || 60;
      const direction = marker.direction || 0;
      const fovRad = fovAngle * (Math.PI / 180);
      const dirRad = direction * (Math.PI / 180);
      const vFovRad = cam?.specs?.vfov ? cam.specs.vfov * (Math.PI / 180) : 40 * (Math.PI / 180); 
      const pitchRad = 35 * (Math.PI / 180); // Tilted downward
      const rayMaxDist = Number(cam?.specs?.rangeDay || cam?.rangeDay || marker.camera?.rangeDay || marker.camera?.specs?.rangeDay || (cam?.specs?.rangeNight ? cam.specs.rangeNight : null) || 30);

      // --- NEW: SpotLight Heatmap Projection ---
      // Green glow for online, dim white/grey for offline
      const lightColor = isOnline ? 0x1D9E75 : 0x888888; 
      const spotLight = new THREE.SpotLight(lightColor, isOnline ? 15.0 : 5.0, rayMaxDist * 1.2, fovRad / 2, 0.5, 1);
      spotLight.visible = showHeatmap;
      spotLight.position.set(0, 0, 0); // relative to camWrapper
      const targetObj = new THREE.Object3D();
      let tx, ty, tz;
      if (upAxis === "y") {
        tx = Math.cos(dirRad) * Math.cos(pitchRad);
        ty = -Math.sin(pitchRad);
        tz = Math.sin(dirRad) * Math.cos(pitchRad);
      } else {
        tx = Math.cos(dirRad) * Math.cos(pitchRad);
        ty = -Math.sin(dirRad) * Math.cos(pitchRad);
        tz = -Math.sin(pitchRad);
      }
      targetObj.position.set(tx * rayMaxDist, ty * rayMaxDist, tz * rayMaxDist);
      camWrapper.add(spotLight);
      camWrapper.add(targetObj);
      spotLight.target = targetObj;
      // -----------------------------------------

      // Raycast TRUE Volumetric FOV Beam (3D Pyramid)
      const tiltTop = pitchRad - (vFovRad / 2);
      const tiltBottom = pitchRad + (vFovRad / 2);
      
      const origin = new THREE.Vector3(0, 0, 0); 
      const topPoints = [];
      const bottomPoints = [];
      const numRays = 30;

      for (let i = 0; i <= numRays; i++) {
        const angle = dirRad - (fovRad / 2) + (fovRad * (i / numRays));
        
        const getHit = (tilt) => {
          let rx, ry, rz;
          if (upAxis === "y") {
            rx = Math.cos(angle) * Math.cos(tilt);
            ry = -Math.sin(tilt);
            rz = Math.sin(angle) * Math.cos(tilt);
          } else {
            rx = Math.cos(angle) * Math.cos(tilt);
            ry = -Math.sin(angle) * Math.cos(tilt);
            rz = -Math.sin(tilt);
          }
          const rayDir = new THREE.Vector3(rx, ry, rz).normalize();
          
          // Raycast from world origin
          const worldOrigin = camWrapper.position.clone();
          raycaster.set(worldOrigin, rayDir);
          const hits = raycaster.intersectObject(currentModel, true);
          
          let dist = rayMaxDist;
          if (hits.length > 0) dist = Math.min(dist, hits[0].distance);
          return rayDir.clone().multiplyScalar(dist);
        };

        topPoints.push(getHit(tiltTop));
        bottomPoints.push(getHit(tiltBottom));
      }

      // Build Solid Volumetric Triangle Fan
      const vertices = [];
      const pushTris = (...pts) => pts.forEach(p => vertices.push(p.x, p.y, p.z));

      for (let i = 0; i < numRays; i++) {
        const t0 = topPoints[i];
        const t1 = topPoints[i+1];
        const b0 = bottomPoints[i];
        const b1 = bottomPoints[i+1];

        // Top face
        pushTris(origin, t0, t1);
        // Bottom face
        pushTris(origin, b1, b0);
        // Front face quad
        pushTris(t0, b0, b1);
        pushTris(t0, b1, t1);
      }
      // Side faces
      pushTris(origin, bottomPoints[0], topPoints[0]);
      pushTris(origin, topPoints[numRays], bottomPoints[numRays]);

      const fovGeo = new THREE.BufferGeometry();
      fovGeo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      const fovMesh = new THREE.Mesh(fovGeo, fovMat);
      camWrapper.add(fovMesh);

      // Rotation Handle
      const handleDist = spriteSize * 1.2;
      let hx, hy, hz;
      if (upAxis === "y") {
        hx = Math.cos(dirRad) * handleDist;
        hy = 0;
        hz = Math.sin(dirRad) * handleDist;
      } else {
        hx = Math.cos(dirRad) * handleDist;
        hy = -Math.sin(dirRad) * handleDist;
        hz = 0;
      }
      
      // Eye Icon Handle
      const eyeTex = createEyeTexture(isOnline ? "#1D9E75" : "#666666");
      const eyeMat = new THREE.SpriteMaterial({ map: eyeTex, depthTest: false });
      const handleMesh = new THREE.Sprite(eyeMat);
      handleMesh.scale.set(spriteSize * 0.5, spriteSize * 0.5, 1);

      handleMesh.position.set(hx, hy, hz);
      handleMesh.renderOrder = 1000;
      handleMesh.userData = { isRotationHandle: true, index: idx };
      camWrapper.add(handleMesh);
      
      // Subtle line connecting camera to handle
      const lineGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(hx, hy, hz)
      ]);
      const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25, depthTest: false });
      const handleLine = new THREE.Line(lineGeo, lineMat);
      camWrapper.add(handleLine);
      
      // Invisible larger hitbox for the handle so it's still easy to click/drag
      const handleHitbox = new THREE.Mesh(new THREE.SphereGeometry(spriteSize * 0.8), invisibleMat);
      handleHitbox.position.set(hx, hy, hz);
      handleHitbox.userData = { isRotationHandle: true, index: idx };
      camWrapper.add(handleHitbox);
    });
      }, [localMarkers, imageSize, showHeatmap]);

  // ── 3. Drag and Rotate Interactivity ─────────────────────────────
  useEffect(() => {
    if (!rendererRef.current || !cameraRef.current) return;
    const canvas = rendererRef.current.domElement;
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    let plane = new THREE.Plane(); 

    const getIntersects = (e) => {
      const rect = canvas.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, cameraRef.current);
      if (!camerasGroupRef.current) return [];
      return raycaster.intersectObjects(camerasGroupRef.current.children, true);
    };

    const onPointerDown = (e) => {
      const hits = getIntersects(e);
      if (hits.length > 0) {
        const hit = hits.find(h => h.object.userData.isCameraHitbox || h.object.userData.isRotationHandle);
        if (hit) {
          e.preventDefault();
          controlsRef.current.enabled = false;
          isDraggingRef.current = true;
          
          if (hit.object.userData.isRotationHandle) {
            rotatingIdxRef.current = hit.object.userData.index;
          } else {
            draggingIdxRef.current = hit.object.userData.index;
          }

          const upAxis = modelDataRef.current?.upAxis || "y";
          const normal = upAxis === "y" ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
          plane.setFromNormalAndCoplanarPoint(normal, hit.object.parent.position);
        }
      }
    };

    const onPointerMove = (e) => {
      const hits = getIntersects(e);
      const hitBoxHit = hits.find(h => h.object.userData.isCameraHitbox);
      
      if (!isDraggingRef.current) {
        const interactive = hits.find(h => h.object.userData.isCameraHitbox || h.object.userData.isRotationHandle);
        canvas.style.cursor = interactive ? "pointer" : "default";

        if (hitBoxHit) {
          const idx = hitBoxHit.object.userData.index;
          const marker = localMarkersRef.current[idx];
          if (marker) {
             setHoverTooltip({ camId: marker.camId, x: e.clientX, y: e.clientY });
          }
        } else {
          setHoverTooltip(null);
        }
        return;
      }
      
      // Update tooltip if dragging
      if (draggingIdxRef.current !== -1) {
        const marker = localMarkersRef.current[draggingIdxRef.current];
        if (marker) {
          setHoverTooltip({ camId: marker.camId, x: e.clientX, y: e.clientY });
        }
      }
      
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, cameraRef.current);
      
      const targetPoint = new THREE.Vector3();
      raycaster.ray.intersectPlane(plane, targetPoint);
      
      if (!targetPoint || !modelDataRef.current) return;
      
      const { upAxis, spanW } = modelDataRef.current;
      const scaleX = (spanW * 1.05) / imageSize.width;

      if (draggingIdxRef.current !== -1) {
        // Update Position
        setLocalMarkers(prev => {
          const next = [...prev];
          const m = { ...next[draggingIdxRef.current] };
          
          let dx, dy;
          if (upAxis === "y") {
            dx = targetPoint.x / scaleX;
            dy = targetPoint.z / scaleX;
          } else {
            dx = targetPoint.x / scaleX;
            dy = -targetPoint.y / scaleX;
          }
          
          m.x = dx + imageSize.width / 2;
          m.y = dy + imageSize.height / 2;
          next[draggingIdxRef.current] = m;
          return next;
        });
      } else if (rotatingIdxRef.current !== -1) {
        // Update Rotation
        setLocalMarkers(prev => {
          const next = [...prev];
          const m = { ...next[rotatingIdxRef.current] };
          
          const dx = m.x - imageSize.width / 2;
          const dy = m.y - imageSize.height / 2;
          const mapX = dx * scaleX;
          const mapZ = (upAxis === "y") ? dy * scaleX : -dy * scaleX;

          let angleRad;
          if (upAxis === "y") {
            angleRad = Math.atan2(targetPoint.z - mapZ, targetPoint.x - mapX);
          } else {
            angleRad = Math.atan2(-(targetPoint.y - mapZ), targetPoint.x - mapX); 
          }
          
          let angleDeg = angleRad * (180 / Math.PI);
          if (angleDeg < 0) angleDeg += 360;
          
          m.direction = angleDeg;
          next[rotatingIdxRef.current] = m;
          return next;
        });
      }
    };

    const onPointerUp = (e) => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false;
        draggingIdxRef.current = -1;
        rotatingIdxRef.current = -1;
        controlsRef.current.enabled = true;
        
        if (updateMarkers) {
           setLocalMarkers(current => {
             updateMarkers(current);
             return current;
           });
        }
      }
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);

    return () => {
      canvas.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [imageSize, updateMarkers, cameras]);

  // Dynamically toggle lighting and materials when showHeatmap changes
  useEffect(() => {
    if (ambientLightRef.current) ambientLightRef.current.intensity = showHeatmap ? 0.15 : 0.7;
    if (dirLightRef.current) dirLightRef.current.intensity = showHeatmap ? 0.1 : 1.0;
    if (fillLightRef.current) fillLightRef.current.intensity = showHeatmap ? 0.0 : 0.3;

    if (camerasGroupRef.current) {
      camerasGroupRef.current.children.forEach(camWrapper => {
        camWrapper.children.forEach(child => {
          if (child.isSpotLight) {
            child.visible = showHeatmap;
          }
        });
      });
    }

    if (modelDataRef.current?.currentModel) {
      modelDataRef.current.currentModel.traverse((node) => {
        if (node.isMesh && node.userData.originalMaterial && node.userData.heatmapMaterial) {
          node.material = showHeatmap ? node.userData.heatmapMaterial : node.userData.originalMaterial;
        }
      });
    }
  }, [showHeatmap]);

  return (
    <>
      <div 
        ref={containerRef} 
        style={{ width: "100%", height: "100%", position: "absolute", top: 0, left: 0, zIndex: 1, overflow: "hidden" }} 
      />
      {hoverTooltip && (() => {
        const cam = cameras?.find(c => c.id === hoverTooltip.camId);
        if (!cam) return null;
        return (
          <div style={{
            position: "fixed",
            left: hoverTooltip.x + 15,
            top: hoverTooltip.y + 15,
            background: "#0d1117f2",
            color: "#e8edf5",
            padding: "8px 12px",
            borderRadius: "4px",
            fontSize: "12px",
            fontFamily: "Inter, sans-serif",
            pointerEvents: "none",
            zIndex: 9999,
            display: "flex",
            flexDirection: "column",
            gap: "4px",
            boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
            border: "1px solid rgba(255,255,255,0.1)"
          }}>
            <div style={{ fontWeight: "bold" }}>{cam.name}</div>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "10px", color: cam.status === "online" ? "#10b981" : "#a0aec0", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: cam.status === "online" ? "#10b981" : "#a0aec0" }} />
              {cam.status}
            </div>
          </div>
          );
        })()}
      {report && <PartsMeasurementPanel report={report} />}
    </>
  );
});

export default Gltf3DViewer;

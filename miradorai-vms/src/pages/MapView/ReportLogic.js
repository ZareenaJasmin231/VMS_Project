/**
 * ReportLogic.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Renders a professional infographic report for CCTV storage calculations.
 */

export function drawStorageReport(data) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  // High resolution for printing
  const W = 1200;
  const H = 1700;
  canvas.width = W;
  canvas.height = H;

  // ── Colors ──
  const C_BG = "#f8fafc";
  const C_HEADER_BG = "#ffffff";
  const C_TEXT = "#1e293b";
  const C_ACCENT = "#3b82f6";
  const C_ACCENT_LIGHT = "#eff6ff";
  const C_BORDER = "#cbd5e1";
  const C_BOX_BG = "#e2e8f0";
  const C_FOOTER_BG = "#f59e0b";

  // ── Background ──
  ctx.fillStyle = C_BG;
  ctx.fillRect(0, 0, W, H);

  // Decorative grid background
  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 40) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  for (let y = 0; y < H; y += 40) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }

  // ── Header ──
  ctx.fillStyle = "#fff";
  ctx.shadowColor = "rgba(0,0,0,0.1)"; ctx.shadowBlur = 10;
  ctx.fillRect(60, 40, W - 120, 120);
  ctx.shadowBlur = 0;
  ctx.strokeStyle = C_ACCENT; ctx.lineWidth = 4;
  ctx.strokeRect(60, 40, W - 120, 120);

  // ── MIRADOR VMS LOGO (Top Left) ──
  if (data.logoImg) {
    ctx.drawImage(data.logoImg, 80, 60, 80, 80);
  } else {
    // 1. Fallback Logo Mark (Camera Lens / Eye vector drawing)
    ctx.save();
    ctx.beginPath();
    ctx.arc(120, 100, 30, 0, Math.PI * 2);
    ctx.fillStyle = "#0f172a";
    ctx.fill();

    ctx.beginPath();
    ctx.arc(120, 100, 20, 0, Math.PI * 2);
    ctx.strokeStyle = "#3b82f6";
    ctx.lineWidth = 3.5;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(120, 100, 9, 0, Math.PI * 2);
    ctx.fillStyle = "#1d9e75";
    ctx.fill();

    // Status indicator glint
    ctx.beginPath();
    ctx.arc(126, 94, 3, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.restore();
  }

  // 2. Logo Text (MIRADOR VMS)
  ctx.save();
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#0f172a";
  
  const companyTitle = data.companyName || "MIRADOR VMS";
  if (companyTitle.length > 20) {
      ctx.font = "bold 22px sans-serif";
  } else {
      ctx.font = "bold 34px sans-serif";
  }
  ctx.fillText(companyTitle, 175, 100);
  ctx.restore();

  // ── REPORT TITLE (Top Right Aligned) ──
  ctx.save();
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#1e293b";
  ctx.font = "bold 30px sans-serif";
  ctx.fillText("CCTV STORAGE REPORT", W - 90, 82);

  ctx.fillStyle = "#3b82f6";
  ctx.font = "bold 15px sans-serif";
  ctx.fillText("SYSTEM DESIGN & STORAGE ESTIMATE", W - 90, 118);
  ctx.restore();

  // ── Main Content Area ──
  const topY = 200;

  // 1. DESIGN INPUTS (Left)
  const leftX = 80;
  const boxW = 460;
  drawSectionHeader(ctx, "DESIGN INPUTS", leftX, topY, boxW);
  
  const inputs = [
    { label: "Number of Cameras:", val: data.cameraCount },
    { label: "Codec / Resolution:", val: data.codec + " / 1080p (Avg)" },
    { label: "Frame Rate:", val: data.avgFPS.toFixed(0) + " fps" },
    { label: "Avg Bitrate:", val: data.avgBitrate.toFixed(1) + " Mbps" },
    { label: "Recording Mode:", val: "24/7 Continuous" },
    { label: "Retention Period:", val: data.retentionDays + " Days" },
  ];

  ctx.textAlign = "left";
  ctx.font = "bold 24px sans-serif";
  ctx.fillStyle = C_TEXT;
  inputs.forEach((item, i) => {
    const py = topY + 70 + i * 45;
    ctx.font = "20px sans-serif";
    ctx.fillText(item.label, leftX + 10, py);
    ctx.font = "bold 22px sans-serif";
    ctx.fillText(item.val.toString(), leftX + 260, py);
  });

  // 2. CALCULATION SUMMARY (Right)
  const rightX = 640;
  drawSectionHeader(ctx, "CALCULATION SUMMARY", rightX, topY, 480);
  
  // Table constants
  const tableY = topY + 50;
  const tableW = 480;
  const ROW_H = 52;
  const COL_ITEM = 0;
  const COL_FORMULA = 160;
  const COL_RESULT = 350;

  // Header row background
  ctx.fillStyle = C_BOX_BG;
  ctx.fillRect(rightX, tableY, tableW, ROW_H);
  // Header row border
  ctx.strokeStyle = C_BORDER;
  ctx.lineWidth = 1;
  ctx.strokeRect(rightX, tableY, tableW, ROW_H);
  // Vertical dividers in header
  ctx.beginPath();
  ctx.moveTo(rightX + COL_FORMULA, tableY);
  ctx.lineTo(rightX + COL_FORMULA, tableY + ROW_H);
  ctx.moveTo(rightX + COL_RESULT, tableY);
  ctx.lineTo(rightX + COL_RESULT, tableY + ROW_H);
  ctx.stroke();

  // Header text — vertically centered
  ctx.font = "bold 18px sans-serif";
  ctx.fillStyle = C_TEXT;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("Item",    rightX + COL_ITEM    + 10, tableY + ROW_H / 2);
  ctx.fillText("Formula", rightX + COL_FORMULA + 10, tableY + ROW_H / 2);
  ctx.fillText("Result",  rightX + COL_RESULT  + 10, tableY + ROW_H / 2);

  const rows = [
    { 
      item: "Daily (Cam):", 
      formula: "Total / Qty", 
      res: (data.dailyStorageTotalGB / (data.cameraCount || 1)).toFixed(2) + " GB" 
    },
    { 
      item: "Daily (Total):", 
      formula: "Bandwidth × Sec", 
      res: data.dailyStorageTotalGB.toFixed(1) + " GB" 
    },
    { 
      item: "Total Retention:", 
      formula: "Daily × Days", 
      res: (data.totalStorageTB >= 1 ? data.totalStorageTB.toFixed(2) + " TB" : data.totalStorageGB.toFixed(1) + " GB") 
    },
  ];

  rows.forEach((r, i) => {
    const rowY = tableY + ROW_H + i * ROW_H;
    const midY = rowY + ROW_H / 2;

    // Alternating row background
    ctx.fillStyle = i % 2 === 0 ? "#ffffff" : C_ACCENT_LIGHT;
    ctx.fillRect(rightX, rowY, tableW, ROW_H);

    // Row border
    ctx.strokeStyle = C_BORDER;
    ctx.lineWidth = 1;
    ctx.strokeRect(rightX, rowY, tableW, ROW_H);

    // Vertical column dividers
    ctx.beginPath();
    ctx.moveTo(rightX + COL_FORMULA, rowY);
    ctx.lineTo(rightX + COL_FORMULA, rowY + ROW_H);
    ctx.moveTo(rightX + COL_RESULT, rowY);
    ctx.lineTo(rightX + COL_RESULT, rowY + ROW_H);
    ctx.stroke();

    // Item text
    ctx.font = "600 18px sans-serif";
    ctx.fillStyle = C_TEXT;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(r.item, rightX + COL_ITEM + 10, midY);

    // Formula text (italic)
    ctx.font = "italic 16px sans-serif";
    ctx.fillStyle = "#475569";
    ctx.fillText(r.formula, rightX + COL_FORMULA + 10, midY);

    // Result text (bold, accent color)
    ctx.font = "bold 18px sans-serif";
    ctx.fillStyle = i === rows.length - 1 ? "#16a34a" : C_ACCENT;
    ctx.fillText(r.res, rightX + COL_RESULT + 10, midY);
  });

  // Reset textBaseline
  ctx.textBaseline = "alphabetic";


  // ── STEP 1: CALCULATE UNIT STORAGE ──
  const step1Y = 550;
  drawStepBanner(ctx, "STEP 1: CALCULATE UNIT STORAGE", step1Y);
  
  const circleX = W / 2;
  const circleY = step1Y + 160;
  // Circular diagram
  ctx.beginPath();
  ctx.arc(circleX, circleY, 110, 0, Math.PI * 2);
  ctx.fillStyle = "#fff"; ctx.fill();
  ctx.strokeStyle = C_ACCENT; ctx.lineWidth = 3; ctx.stroke();

  // Cross lines in circle
  ctx.beginPath();
  ctx.moveTo(circleX - 110, circleY); ctx.lineTo(circleX + 110, circleY);
  ctx.moveTo(circleX, circleY - 110); ctx.lineTo(circleX, circleY + 110);
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.fillStyle = C_TEXT;
  ctx.font = "bold 16px sans-serif";
  ctx.fillText("x 60", circleX, circleY - 60); ctx.font = "12px sans-serif"; ctx.fillText("(Secs)", circleX, circleY - 45);
  ctx.font = "bold 16px sans-serif";
  ctx.fillText("x 60", circleX + 60, circleY); ctx.font = "12px sans-serif"; ctx.fillText("(Mins)", circleX + 60, circleY + 15);
  ctx.font = "bold 16px sans-serif";
  ctx.fillText("x 24", circleX, circleY + 60); ctx.font = "12px sans-serif"; ctx.fillText("(Hrs)", circleX, circleY + 75);
  ctx.font = "bold 16px sans-serif";
  ctx.fillText("/ 8", circleX - 60, circleY); ctx.font = "12px sans-serif"; ctx.fillText("(Bits to Bytes)", circleX - 60, circleY + 15);

  // Storage per day box
  const step1ResGB = data.dailyStorageTotalGB / (data.cameraCount || 1);
  ctx.fillStyle = C_ACCENT_LIGHT;
  ctx.fillRect(circleX - 250, circleY + 130, 500, 50);
  ctx.strokeStyle = C_ACCENT; ctx.strokeRect(circleX - 250, circleY + 130, 500, 50);
  ctx.fillStyle = C_ACCENT; ctx.font = "bold 20px sans-serif";
  ctx.fillText(`Storage per day = ${(step1ResGB * 1024).toFixed(0)} MB/day = ${step1ResGB.toFixed(2)} GB/day`, circleX, circleY + 162);

  // ── STEP 2: TOTAL SYSTEM STORAGE ──
  const step2Y = 950;
  drawStepBanner(ctx, "STEP 2: TOTAL SYSTEM STORAGE", step2Y);
  
  const flowY = step2Y + 100;
  drawFlowBox(ctx, "Step 1 Result:", step1ResGB.toFixed(2) + " GB", 200, flowY);
  drawArrow(ctx, 350, flowY + 40, 420, flowY + 40);
  drawFlowBox(ctx, "x " + data.cameraCount, "(Cameras)", 450, flowY);
  drawArrow(ctx, 600, flowY + 40, 670, flowY + 40);
  drawFlowBox(ctx, "Result:", data.dailyStorageTotalGB.toFixed(1) + " GB/day", 700, flowY, true);

  // ── STEP 3: TOTAL RETENTION STORAGE ──
  const step3Y = 1180;
  drawStepBanner(ctx, "STEP 3: TOTAL RETENTION STORAGE", step3Y);
  
  const flowY3 = step3Y + 100;
  drawFlowBox(ctx, "Step 2 Result:", data.dailyStorageTotalGB.toFixed(1) + " GB", 200, flowY3);
  drawArrow(ctx, 350, flowY3 + 40, 420, flowY3 + 40);
  drawFlowBox(ctx, "x " + data.retentionDays, "(Days)", 450, flowY3);
  drawArrow(ctx, 600, flowY3 + 40, 670, flowY3 + 40);
  drawFlowBox(ctx, "Result:", (data.totalStorageTB >= 1 ? data.totalStorageTB.toFixed(2) + " TB" : data.totalStorageGB.toFixed(1) + " GB"), 700, flowY3, true);

  // ── KEY CONVERSIONS ──
  const convX = 800;
  const convY = 1380;
  ctx.fillStyle = C_TEXT; ctx.textAlign = "center";
  ctx.font = "bold 22px sans-serif";
  ctx.fillText("Key Conversions", convX + 150, convY);
  
  const convs = [
    { l: "1 Byte", r: "8 Bits" },
    { l: "1 GB", r: "1024 MB" },
    { l: "1 TB", r: "1024 GB" },
  ];
  convs.forEach((c, i) => {
    ctx.strokeStyle = C_BORDER;
    ctx.strokeRect(convX, convY + 20 + i * 50, 300, 40);
    ctx.fillStyle = C_TEXT; ctx.font = "18px sans-serif"; ctx.textAlign = "left";
    ctx.fillText(c.l, convX + 15, convY + 47 + i * 50);
    ctx.textAlign = "right";
    ctx.fillText(c.r, convX + 285, convY + 47 + i * 50);
  });

  // ── RECOMMENDED STORAGE CAPACITY ──
  const footerY = 1580;
  ctx.fillStyle = C_FOOTER_BG;
  ctx.beginPath();
  ctx.roundRect(100, footerY, W - 200, 80, 40); ctx.fill();
  
  ctx.fillStyle = C_TEXT; ctx.textAlign = "center";
  ctx.font = "bold 32px sans-serif";
  const rec = Math.ceil(data.totalStorageTB * 1.2) || 1; 
  ctx.fillText(`RECOMMENDED STORAGE CAPACITY: ≥ ${rec} TB`, W / 2, footerY + 52);
  
  ctx.font = "italic 18px sans-serif";
  ctx.fillStyle = "#64748b";
  ctx.fillText("(For safety, system overhead, and future growth)", W / 2, footerY + 110);
  ctx.font = "16px sans-serif";
  ctx.fillText("Designed for efficient system planning and maximum uptime with MiradorAI.", W / 2, footerY + 140);

  return canvas.toDataURL("image/png");
}

function drawSectionHeader(ctx, text, x, y, w) {
  ctx.fillStyle = "#1e293b";
  ctx.fillRect(x, y, w, 40);
  ctx.fillStyle = "#fff";
  ctx.font = "bold 20px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + w / 2, y + 20);
  ctx.textBaseline = "alphabetic";
}

function drawStepBanner(ctx, text, y) {
  ctx.fillStyle = "#334155";
  ctx.fillRect(80, y, 1040, 45);
  ctx.fillStyle = "#fff";
  ctx.font = "bold 22px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(text, 100, y + 31);
}

function drawFlowBox(ctx, top, bot, x, y, highlight = false) {
  ctx.fillStyle = highlight ? "#dcfce7" : "#fff";
  ctx.strokeStyle = highlight ? "#22c55e" : "#cbd5e1";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(x, y, 150, 80, 8);
  ctx.fill(); ctx.stroke();
  
  ctx.fillStyle = "#1e293b";
  ctx.font = "bold 18px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(top, x + 75, y + 35);
  ctx.font = "16px sans-serif";
  ctx.fillText(bot, x + 75, y + 60);
}

function drawArrow(ctx, x1, y1, x2, y2) {
  ctx.strokeStyle = "#94a3b8"; ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x1, y1); ctx.lineTo(x2, y1);
  ctx.stroke();
  // Head
  ctx.beginPath();
  ctx.moveTo(x2 - 10, y1 - 10); ctx.lineTo(x2, y1); ctx.lineTo(x2 - 10, y1 + 10);
  ctx.stroke();
}

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

  ctx.fillStyle = C_ACCENT;
  ctx.font = "bold 44px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("CCTV STORAGE CALCULATION:", W / 2, 95);
  ctx.font = "32px sans-serif";
  ctx.fillText("A STRATEGIC GUIDE", W / 2, 135);

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
  
  // Table
  const tableY = topY + 50;
  const colW = [160, 180, 120];
  ctx.fillStyle = C_BOX_BG;
  ctx.fillRect(rightX, tableY, 480, 45);
  ctx.font = "bold 18px sans-serif";
  ctx.fillStyle = C_TEXT;
  ctx.fillText("Item", rightX + 10, tableY + 30);
  ctx.fillText("Formula", rightX + 170, tableY + 30);
  ctx.fillText("Result", rightX + 350, tableY + 30);

  const rows = [
    { 
      item: "Daily (Cam):", 
      formula: "Total / Qty", 
      res: (data.dailyStorageTotalGB / (data.cameraCount || 1)).toFixed(2) + " GB" 
    },
    { 
      item: "Daily (Total):", 
      formula: "Bandwidth x Sec", 
      res: data.dailyStorageTotalGB.toFixed(1) + " GB" 
    },
    { 
      item: "Total Retention:", 
      formula: "Daily x Days", 
      res: (data.totalStorageTB >= 1 ? data.totalStorageTB.toFixed(2) + " TB" : data.totalStorageGB.toFixed(1) + " GB") 
    },
  ];

  rows.forEach((r, i) => {
    const py = tableY + 45 + (i + 1) * 55;
    ctx.strokeStyle = C_BORDER;
    ctx.strokeRect(rightX, tableY + 45 + i * 55, 480, 55);
    ctx.font = "18px sans-serif";
    ctx.fillText(r.item, rightX + 10, py - 20);
    ctx.font = "italic 16px sans-serif";
    ctx.fillText(r.formula, rightX + 170, py - 20);
    ctx.font = "bold 18px sans-serif";
    ctx.fillText(r.res, rightX + 350, py - 20);
  });

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
  ctx.fillText(text, x + w / 2, y + 28);
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

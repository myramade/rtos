/**
 * scheduler-ui.js — RMS / EDF Scheduling Timeline page
 *
 * Depends on: core.js  (must be loaded first)
 */

'use strict';

// ── Task colour palette ──────────────────────────────────────
const TASK_COLORS = [
  '#00d4ff','#00e57a','#ff9f0a','#bf5af2',
  '#ff6b6b','#ffd60a','#4ecdc4','#ff8cc8',
];

// ── State ────────────────────────────────────────────────────
let tasks = [
  { id: 't1', name: 'τ₁', period: 4,  wcet: 1 },
  { id: 't2', name: 'τ₂', period: 6,  wcet: 2 },
  { id: 't3', name: 'τ₃', period: 12, wcet: 3 },
];
let taskIdCounter = 4;
let algorithm = 'RMS';

// ── DOM references ───────────────────────────────────────────
const $ = id => document.getElementById(id);

function init() {
  renderTaskList();
  $('btn-add-task').addEventListener('click', addTask);
  $('btn-run').addEventListener('click', run);
  $('btn-rms').addEventListener('click', () => setAlgorithm('RMS'));
  $('btn-edf').addEventListener('click', () => setAlgorithm('EDF'));
  $('btn-load-demo').addEventListener('click', loadDemo);

  // Allow Enter key in inputs
  ['inp-name','inp-period','inp-wcet'].forEach(id => {
    $(id).addEventListener('keydown', e => { if (e.key === 'Enter') addTask(); });
  });

  run(); // auto-run on page load
}

function setAlgorithm(alg) {
  algorithm = alg;
  $('btn-rms').classList.toggle('active', alg === 'RMS');
  $('btn-edf').classList.toggle('active', alg === 'EDF');
  run();
}

// ── Add task ─────────────────────────────────────────────────
function addTask() {
  const name   = $('inp-name').value.trim()   || `τ${taskIdCounter}`;
  const period = parseInt($('inp-period').value, 10);
  const wcet   = parseInt($('inp-wcet').value, 10);

  if (!period || !wcet || period < 1 || wcet < 1 || wcet > period) {
    showError('Period and WCET must be positive integers, and WCET ≤ Period.');
    return;
  }
  if (tasks.length >= 8) {
    showError('Maximum 8 tasks supported.');
    return;
  }

  tasks.push({ id: `t${taskIdCounter++}`, name, period, wcet });
  $('inp-name').value   = '';
  $('inp-period').value = '';
  $('inp-wcet').value   = '';
  renderTaskList();
  run();
}

function removeTask(id) {
  tasks = tasks.filter(t => t.id !== id);
  renderTaskList();
  run();
}

function loadDemo() {
  tasks = [
    { id: 't1', name: 'τ₁', period: 4,  wcet: 1 },
    { id: 't2', name: 'τ₂', period: 6,  wcet: 2 },
    { id: 't3', name: 'τ₃', period: 12, wcet: 3 },
  ];
  taskIdCounter = 4;
  renderTaskList();
  run();
}

// ── Render task list ─────────────────────────────────────────
function renderTaskList() {
  const list = $('task-list');
  list.innerHTML = '';
  tasks.forEach((task, i) => {
    const div = document.createElement('div');
    div.className = 'task-item';
    div.innerHTML = `
      <span class="task-dot" style="background:${TASK_COLORS[i % 8]}"></span>
      <span class="task-label">
        <strong>${escHtml(task.name)}</strong>
        <span class="task-detail"> &nbsp;T=${task.period} &nbsp;C=${task.wcet}</span>
      </span>
      <button class="task-remove" title="Remove task" onclick="removeTask('${task.id}')">✕</button>
    `;
    list.appendChild(div);
  });
}

// ── Run scheduler ────────────────────────────────────────────
function run() {
  if (tasks.length === 0) {
    clearCanvas();
    clearStats();
    return;
  }

  const hyperperiod = RTOSCore.computeHyperperiod(tasks);
  const result = algorithm === 'RMS'
    ? RTOSCore.simulateRMS(tasks, hyperperiod)
    : RTOSCore.simulateEDF(tasks, hyperperiod);

  drawTimeline(result, tasks, hyperperiod);
  renderStats(result, tasks, hyperperiod);
  renderResponseTable(tasks);
}

// ── Canvas drawing ────────────────────────────────────────────
function drawTimeline(result, tasks, hyperperiod) {
  const canvas  = $('timeline-canvas');
  const dpr     = window.devicePixelRatio || 1;
  const PAD     = { top: 28, left: 108, right: 24, bottom: 44 };
  const ROW_H   = 50;
  const ROW_GAP = 6;
  const n       = tasks.length;

  const totalH  = PAD.top + n * (ROW_H + ROW_GAP) + PAD.bottom;
  const totalW  = Math.max(800, canvas.parentElement.clientWidth - 2);

  canvas.style.width  = totalW + 'px';
  canvas.style.height = totalH + 'px';
  canvas.width  = totalW * dpr;
  canvas.height = totalH * dpr;

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const chartW = totalW - PAD.left - PAD.right;
  const unitW  = chartW / hyperperiod;

  // Background
  ctx.fillStyle = '#080d18';
  ctx.fillRect(0, 0, totalW, totalH);

  // Task id → colour index map
  const colorOf = {};
  tasks.forEach((t, i) => { colorOf[t.id] = i % 8; });

  // Build a map: taskId → sorted task index in result.taskOrder
  const orderOf = {};
  (result.taskOrder || tasks).forEach((t, i) => { orderOf[t.id] = i; });

  // Draw each task row
  tasks.forEach((task, rowIdx) => {
    const y = PAD.top + rowIdx * (ROW_H + ROW_GAP);
    const color = TASK_COLORS[colorOf[task.id]];
    const prio  = orderOf[task.id] + 1; // priority in scheduling order

    // Label panel
    ctx.fillStyle = '#0c1223';
    ctx.fillRect(0, y, PAD.left - 4, ROW_H);

    ctx.fillStyle = color;
    ctx.font      = 'bold 13px "Courier New", monospace';
    ctx.fillText(task.name || task.id, 6, y + 18);

    ctx.fillStyle = '#7a8aa4';
    ctx.font      = '10px "Courier New", monospace';
    ctx.fillText(`T=${task.period} C=${task.wcet}`, 6, y + 32);
    ctx.fillText(`P${prio}`, 6, y + 44);

    // Row background (alternating)
    ctx.fillStyle = rowIdx % 2 === 0 ? '#0a0e1a' : '#0d1220';
    ctx.fillRect(PAD.left, y, chartW, ROW_H);

    // Grid lines
    ctx.strokeStyle = '#1e2d4a';
    ctx.lineWidth   = 0.5;
    for (let t = 0; t <= hyperperiod; t++) {
      const x = PAD.left + t * unitW;
      ctx.beginPath();
      ctx.moveTo(x, PAD.top);
      ctx.lineTo(x, PAD.top + n * (ROW_H + ROW_GAP));
      ctx.stroke();
    }

    // Execution blocks
    result.timeline.forEach((runId, t) => {
      if (runId !== task.id) return;
      ctx.fillStyle   = color;
      ctx.globalAlpha = 0.88;
      roundRect(ctx, PAD.left + t * unitW + 1, y + 10, unitW - 1, ROW_H - 20, 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    });

    // Deadline missed map
    const missedAt = new Set(
      (result.deadlineMisses || [])
        .filter(d => d.taskId === task.id)
        .map(d => d.time)
    );

    // Release arrows and deadline markers
    for (let inst = 0; inst * task.period < hyperperiod; inst++) {
      const rel  = inst * task.period;
      const dead = rel + task.period;

      // ↑ Release arrow (green, upward)
      const rx = PAD.left + rel * unitW;
      ctx.strokeStyle = '#00e57a';
      ctx.lineWidth   = 1.5;
      drawUpArrow(ctx, rx, y + ROW_H - 2, y + 4);

      // ⊣ Deadline marker
      if (dead <= hyperperiod) {
        const dx     = PAD.left + dead * unitW;
        const missed = missedAt.has(dead);
        ctx.strokeStyle = missed ? '#ff453a' : '#ff9f0a';
        ctx.lineWidth   = 1.5;
        drawDownArrow(ctx, dx, y + 2, y + ROW_H - 2);

        if (missed) {
          ctx.fillStyle = '#ff453a';
          ctx.font      = 'bold 9px "Courier New", monospace';
          ctx.fillText('MISS', dx - 14, y + ROW_H + 3);
        }
      }
    }
  });

  // Time axis line
  const axisY = PAD.top + n * (ROW_H + ROW_GAP);
  ctx.strokeStyle = '#4a5568';
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.moveTo(PAD.left, axisY);
  ctx.lineTo(totalW - PAD.right, axisY);
  ctx.stroke();

  // Time ticks + labels
  const step = computeTickStep(hyperperiod);
  ctx.fillStyle = '#7a8aa4';
  ctx.font      = '10px "Courier New", monospace';
  for (let t = 0; t <= hyperperiod; t += step) {
    const x = PAD.left + t * unitW;
    ctx.strokeStyle = '#4a5568';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(x, axisY);
    ctx.lineTo(x, axisY + 5);
    ctx.stroke();
    ctx.fillText(t, x - (t >= 10 ? 5 : 3), axisY + 16);
  }

  // "time (ticks)" label
  ctx.fillStyle = '#4a5568';
  ctx.font      = '10px "Courier New", monospace';
  ctx.fillText('time (ticks)', PAD.left, axisY + 30);

  // Algorithm label top-right
  ctx.fillStyle = '#00d4ff';
  ctx.font      = 'bold 12px "Courier New", monospace';
  ctx.textAlign = 'right';
  ctx.fillText(`${algorithm} — hyperperiod = ${hyperperiod}`, totalW - PAD.right, PAD.top - 8);
  ctx.textAlign = 'left';
}

function drawUpArrow(ctx, x, yBottom, yTop) {
  ctx.beginPath();
  ctx.moveTo(x, yBottom);
  ctx.lineTo(x, yTop);
  ctx.lineTo(x - 4, yTop + 7);
  ctx.moveTo(x, yTop);
  ctx.lineTo(x + 4, yTop + 7);
  ctx.stroke();
}

function drawDownArrow(ctx, x, yTop, yBottom) {
  ctx.beginPath();
  ctx.moveTo(x, yTop);
  ctx.lineTo(x, yBottom);
  ctx.lineTo(x - 4, yBottom - 7);
  ctx.moveTo(x, yBottom);
  ctx.lineTo(x + 4, yBottom - 7);
  ctx.stroke();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function computeTickStep(hp) {
  if (hp <= 20)  return 1;
  if (hp <= 60)  return 5;
  if (hp <= 120) return 10;
  return 20;
}

function clearCanvas() {
  const canvas = $('timeline-canvas');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

// ── Stats panel ───────────────────────────────────────────────
function renderStats(result, tasks, hyperperiod) {
  const util  = RTOSCore.computeUtilization(tasks);
  const bound = RTOSCore.rmsSchedulabilityBound(tasks.length);
  const edfOk = util <= 1.0;

  const utilPct   = Math.min(util * 100, 100).toFixed(1);
  const boundPct  = (bound * 100).toFixed(1);
  const misses    = result.deadlineMisses.length;
  const idleTicks = result.timeline.filter(x => x === null).length;

  const statusClass = misses > 0 ? 'fail' : (util > bound && algorithm === 'RMS') ? 'warn' : 'ok';
  const statusText  = misses > 0
    ? '✗ INFEASIBLE'
    : (util > bound && algorithm === 'RMS')
      ? '⚠ MARGINAL'
      : '✓ FEASIBLE';

  $('stat-util').textContent  = utilPct + '%';
  $('stat-bound').textContent = algorithm === 'RMS' ? boundPct + '%' : '100%';
  $('stat-status').textContent = statusText;
  $('stat-misses').textContent = misses;

  const statStatus = $('badge-status');
  statStatus.className = 'stat-badge ' + statusClass;

  const utilBar = $('util-bar');
  utilBar.style.width = utilPct + '%';
  utilBar.className   = 'util-bar ' + (util > 1 ? 'fail' : util > bound ? 'warn' : 'ok');

  $('lbl-hyperperiod').textContent = hyperperiod;
  $('lbl-idle').textContent        = idleTicks;
}

function clearStats() {
  ['stat-util','stat-bound','stat-status','stat-misses'].forEach(id => {
    $(id).textContent = '—';
  });
}

// ── Response time table ───────────────────────────────────────
function renderResponseTable(tasks) {
  const data = RTOSCore.computeResponseTime(tasks);
  const tbody = $('rta-tbody');
  tbody.innerHTML = '';

  data.forEach((row, i) => {
    const tr = document.createElement('tr');
    const pct = Math.min((row.responseTime / row.period) * 100, 100).toFixed(0);
    tr.innerHTML = `
      <td>${row.priority}</td>
      <td style="color:${TASK_COLORS[i % 8]}">${escHtml(row.name || row.id)}</td>
      <td>${row.period}</td>
      <td>${row.wcet}</td>
      <td>${row.feasible ? row.interference : '∞'}</td>
      <td>${row.feasible ? row.responseTime : '∞'}</td>
      <td>
        <span class="pill ${row.feasible ? 'ok' : 'fail'}">
          ${row.feasible ? '✓ OK' : '✗ MISS'}
        </span>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// ── Error message ─────────────────────────────────────────────
function showError(msg) {
  const el = $('error-msg');
  el.textContent = msg;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 3500);
}

// ── Helpers ───────────────────────────────────────────────────
function escHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Boot ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);

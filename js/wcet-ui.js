/**
 * wcet-ui.js — WCET Interference Explorer page
 *
 * Depends on: core.js  (must be loaded first)
 */

'use strict';

const WCET_COLORS = [
  '#00d4ff','#00e57a','#ff9f0a','#bf5af2',
  '#ff6b6b','#ffd60a','#4ecdc4','#ff8cc8',
];

let wcetTasks = [
  { id: 'w1', name: 'τ₁', period: 20, wcet: 1 },
  { id: 'w2', name: 'τ₂', period: 10, wcet: 2 },
  { id: 'w3', name: 'τ₃', period: 5,  wcet: 1 },
];
let wcetIdCounter = 4;

const $w = id => document.getElementById(id);

function initWCET() {
  renderWCETTaskList();
  $w('btn-add-wtask').addEventListener('click', addWTask);
  $w('btn-reset-demo').addEventListener('click', resetDemo);

  ['winp-name','winp-period','winp-wcet'].forEach(id => {
    $w(id).addEventListener('keydown', e => { if (e.key === 'Enter') addWTask(); });
  });

  runWCET();
}

// ── Manage tasks ─────────────────────────────────────────────
function addWTask() {
  const name   = $w('winp-name').value.trim()   || `τ${wcetIdCounter}`;
  const period = parseInt($w('winp-period').value, 10);
  const wcet   = parseInt($w('winp-wcet').value, 10);

  if (!period || !wcet || period < 1 || wcet < 1 || wcet > period) {
    showWError('Period and WCET must be positive integers, and WCET ≤ Period.');
    return;
  }
  if (wcetTasks.length >= 8) {
    showWError('Maximum 8 tasks supported.');
    return;
  }

  wcetTasks.push({ id: `w${wcetIdCounter++}`, name, period, wcet });
  $w('winp-name').value   = '';
  $w('winp-period').value = '';
  $w('winp-wcet').value   = '';

  renderWCETTaskList();
  runWCET();
}

function removeWTask(id) {
  wcetTasks = wcetTasks.filter(t => t.id !== id);
  renderWCETTaskList();
  runWCET();
}

function resetDemo() {
  wcetTasks = [
    { id: 'w1', name: 'τ₁', period: 20, wcet: 1 },
    { id: 'w2', name: 'τ₂', period: 10, wcet: 2 },
    { id: 'w3', name: 'τ₃', period: 5,  wcet: 1 },
  ];
  wcetIdCounter = 4;
  renderWCETTaskList();
  runWCET();
}

function renderWCETTaskList() {
  const list = $w('wcet-task-list');
  list.innerHTML = '';
  wcetTasks.forEach((t, i) => {
    const div = document.createElement('div');
    div.className = 'task-item';
    div.innerHTML = `
      <span class="task-dot" style="background:${WCET_COLORS[i%8]}"></span>
      <span class="task-label">
        <strong>${esc(t.name)}</strong>
        <span class="task-detail">&nbsp; T=${t.period} &nbsp; C=${t.wcet}</span>
      </span>
      <button class="task-remove" onclick="removeWTask('${t.id}')">✕</button>
    `;
    list.appendChild(div);
  });
}

// ── Run analysis ─────────────────────────────────────────────
function runWCET() {
  if (wcetTasks.length === 0) {
    $w('wcet-results').innerHTML = '<p style="color:var(--text-muted)">Add tasks to see analysis.</p>';
    return;
  }

  const util      = RTOSCore.computeUtilization(wcetTasks);
  const bound     = RTOSCore.rmsSchedulabilityBound(wcetTasks.length);
  const rtaData   = RTOSCore.computeResponseTime(wcetTasks);
  const wcetData  = RTOSCore.computeWCETInterference(wcetTasks);

  renderWCETStats(util, bound, rtaData);
  renderWCETBars(wcetData);
  renderWCETTable(wcetData, rtaData);
  renderInterferenceBreakdown(wcetData);
}

// ── Stats row ─────────────────────────────────────────────────
function renderWCETStats(util, bound, rtaData) {
  const misses  = rtaData.filter(t => !t.feasible).length;
  const utilCls = util > 1 ? 'fail' : util > bound ? 'warn' : 'ok';

  $w('wstat-util').textContent   = (util * 100).toFixed(1) + '%';
  $w('wstat-bound').textContent  = (bound * 100).toFixed(1) + '%';
  $w('wstat-misses').textContent = misses;

  $w('wstat-util-badge').className   = 'stat-badge ' + utilCls;
  $w('wstat-bound-badge').className  = 'stat-badge ' + (util > bound ? 'warn' : 'ok');
  $w('wstat-misses-badge').className = 'stat-badge ' + (misses > 0 ? 'fail' : 'ok');

  const utilBar = $w('wutil-bar');
  utilBar.style.width = Math.min(util * 100, 100) + '%';
  utilBar.className   = 'util-bar ' + utilCls;
}

// ── WCET stacked bars ─────────────────────────────────────────
function renderWCETBars(wcetData) {
  const container = $w('wcet-bars');
  container.innerHTML = '';

  // Max period for scale
  const maxPeriod = Math.max(...wcetData.map(d => d.period));

  wcetData.forEach((d, i) => {
    const color    = WCET_COLORS[i % 8];
    const scaledTo = d.period; // bars are scaled to period width

    const selfPct  = (d.wcet / scaledTo * 100).toFixed(1);
    const interPct = (d.totalInterference / scaledTo * 100).toFixed(1);
    const blkPct   = (d.maxBlocking / scaledTo * 100).toFixed(1);
    const idlePct  = Math.max(0, 100 - parseFloat(selfPct) - parseFloat(interPct) - parseFloat(blkPct)).toFixed(1);

    const div = document.createElement('div');
    div.className = 'wcet-row';
    div.innerHTML = `
      <div class="wcet-row-header">
        <span style="color:${color};font-weight:700">${esc(d.name || d.id)}</span>
        <span style="color:var(--text-sub);font-size:.8rem">P${d.priority} &nbsp;|&nbsp; T=${d.period} &nbsp;C=${d.wcet}</span>
        <span style="margin-left:auto;font-size:.8rem;color:${d.feasible ? 'var(--green)' : 'var(--red)'}">
          ${d.feasible ? '✓ WCRT=' + d.worstCaseResponseTime : '✗ INFEASIBLE'}
        </span>
      </div>
      <div class="wcet-stack">
        <div class="wcet-seg self"   style="width:${selfPct}%;background:${color}" title="WCET (own): ${d.wcet}">
          ${parseFloat(selfPct) > 5 ? `C=${d.wcet}` : ''}
        </div>
        <div class="wcet-seg inter"  style="width:${interPct}%"  title="Interference: ${d.totalInterference}">
          ${parseFloat(interPct) > 5 ? `I=${d.totalInterference}` : ''}
        </div>
        <div class="wcet-seg block"  style="width:${blkPct}%"   title="Blocking: ${d.maxBlocking}">
          ${parseFloat(blkPct) > 5 ? `B=${d.maxBlocking}` : ''}
        </div>
        <div class="wcet-seg idle"   style="width:${idlePct}%"  title="Remaining idle budget">
          ${parseFloat(idlePct) > 10 ? `slack=${parseFloat(idlePct).toFixed(0)}%` : ''}
        </div>
      </div>
      <div style="display:flex;gap:16px;font-size:.72rem;color:var(--text-sub);margin-top:4px;font-family:var(--font-mono)">
        <span>■ Own WCET: ${d.wcet}</span>
        <span style="color:var(--orange)">■ Interference: ${d.totalInterference}</span>
        <span style="color:var(--purple)">■ Blocking: ${d.maxBlocking}</span>
        <span style="color:var(--text-muted)">■ Slack: ${Math.max(0, d.period - d.worstCaseResponseTime)}</span>
      </div>
    `;
    container.appendChild(div);
  });
}

// ── WCET analysis table ───────────────────────────────────────
function renderWCETTable(wcetData, rtaData) {
  const tbody = $w('wcet-tbody');
  tbody.innerHTML = '';

  wcetData.forEach((d, i) => {
    const rta = rtaData.find(r => r.id === d.id);
    const rtaR = rta ? (rta.feasible ? rta.responseTime : '∞') : '—';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${d.priority}</td>
      <td style="color:${WCET_COLORS[i%8]}">${esc(d.name || d.id)}</td>
      <td>${d.period}</td>
      <td>${d.wcet}</td>
      <td style="color:var(--orange)">${d.totalInterference}</td>
      <td style="color:var(--purple)">${d.maxBlocking}</td>
      <td style="font-weight:bold;color:${d.feasible?'var(--green)':'var(--red)'}">${d.worstCaseResponseTime}</td>
      <td>${rtaR}</td>
      <td><span class="pill ${d.feasible?'ok':'fail'}">${d.feasible?'✓ OK':'✗ MISS'}</span></td>
    `;
    tbody.appendChild(tr);
  });
}

// ── Per-task interference breakdown ──────────────────────────
function renderInterferenceBreakdown(wcetData) {
  const container = $w('interference-breakdown');
  container.innerHTML = '';

  wcetData.forEach((d, i) => {
    if (d.interferenceByTask.length === 0) return;

    const section = document.createElement('div');
    section.className = 'card';
    section.style.marginBottom = '12px';

    const color = WCET_COLORS[i % 8];
    let rows = d.interferenceByTask.map((intf, j) => `
      <tr>
        <td style="color:${WCET_COLORS[j%8]}">${esc(intf.taskName)}</td>
        <td>${d.period} / ${intf.taskId === d.id ? '—' : wcetTasks.find(t=>t.id===intf.taskId)?.period}</td>
        <td>${intf.preemptions}</td>
        <td>${wcetTasks.find(t=>t.id===intf.taskId)?.wcet || '?'}</td>
        <td style="color:var(--orange);font-weight:bold">${intf.interferenceTime}</td>
      </tr>
    `).join('');

    section.innerHTML = `
      <div style="font-family:var(--font-mono);font-weight:700;color:${color};margin-bottom:10px">
        ${esc(d.name||d.id)} — Interference Sources
      </div>
      <table class="analysis-table">
        <thead>
          <tr>
            <th>Source Task</th>
            <th>Period Ratio (Tᵢ/Tⱼ)</th>
            <th>Preemptions ⌈Tᵢ/Tⱼ⌉</th>
            <th>Source WCET (Cⱼ)</th>
            <th>Total Interference</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr style="background:var(--bg-input)">
            <td colspan="4" style="font-weight:700;color:var(--text-sub)">Total Interference</td>
            <td style="font-weight:700;color:var(--orange)">${d.totalInterference}</td>
          </tr>
        </tfoot>
      </table>
      <div style="margin-top:12px;font-size:.83rem;color:var(--text-sub);font-family:var(--font-mono)">
        <strong style="color:var(--cyan)">Formula:</strong>
        &nbsp; I(${esc(d.name||d.id)}) = ${d.interferenceByTask.map(x=>`⌈${d.period}/${wcetTasks.find(t=>t.id===x.taskId)?.period||'?'}⌉ × ${wcetTasks.find(t=>t.id===x.taskId)?.wcet||'?'}`).join(' + ')} = ${d.totalInterference}
        <br>
        <strong style="color:var(--cyan)">WCRT:</strong>
        &nbsp; C + I + B = ${d.wcet} + ${d.totalInterference} + ${d.maxBlocking} = ${d.worstCaseResponseTime}
        &nbsp;
        <span style="color:${d.feasible?'var(--green)':'var(--red)'}">${d.feasible?'≤ T (✓)':'> T (✗ MISS)'}</span>
      </div>
    `;
    container.appendChild(section);
  });

  if (container.innerHTML === '') {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:.88rem">Add more tasks with different priorities to see interference breakdowns.</p>';
  }
}

// ── Helpers ───────────────────────────────────────────────────
function esc(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function showWError(msg) {
  const el = $w('wcet-error');
  el.textContent = msg;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 3500);
}

document.addEventListener('DOMContentLoaded', initWCET);

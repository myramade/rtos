/**
 * core.js — RTOS Simulation Core Algorithms
 *
 * Educational RTOS Simulator
 * Covers: RMS, EDF scheduling, WCET response-time analysis,
 *         and security vulnerability simulations.
 *
 * Works in both the browser (window.RTOSCore) and Node.js (module.exports).
 */

'use strict';

// ─────────────────────────────────────────────────────────────
//  MATHEMATICAL UTILITIES
// ─────────────────────────────────────────────────────────────

function gcd(a, b) {
  a = Math.abs(Math.round(a));
  b = Math.abs(Math.round(b));
  while (b !== 0) {
    const t = b;
    b = a % b;
    a = t;
  }
  return a;
}

function lcm(a, b) {
  if (a === 0 || b === 0) return 0;
  return Math.abs(a / gcd(a, b)) * Math.abs(b);
}

/**
 * Compute the hyperperiod (LCM of all task periods).
 * Capped at MAX_HYPERPERIOD to keep simulations tractable.
 */
const MAX_HYPERPERIOD = 240;

function computeHyperperiod(tasks) {
  if (!tasks || tasks.length === 0) return 0;
  let h = tasks[0].period;
  for (let i = 1; i < tasks.length; i++) {
    h = lcm(h, tasks[i].period);
    if (h > MAX_HYPERPERIOD) return MAX_HYPERPERIOD; // safety cap
  }
  return h;
}

/** CPU utilisation U = Σ Cᵢ/Tᵢ */
function computeUtilization(tasks) {
  return tasks.reduce((sum, t) => sum + t.wcet / t.period, 0);
}

/**
 * Liu & Layland RMS schedulability bound for n tasks:
 *   U_bound(n) = n × (2^(1/n) − 1)
 */
function rmsSchedulabilityBound(n) {
  if (n <= 0) return 0;
  return n * (Math.pow(2, 1 / n) - 1);
}

// ─────────────────────────────────────────────────────────────
//  RMS — Rate Monotonic Scheduling
// ─────────────────────────────────────────────────────────────
/**
 * Simulates RMS over one hyperperiod.
 *
 * Priority rule: shorter period → higher priority (static, preemptive).
 *
 * @param {object[]} tasks  Array of {id, name, period, wcet}
 * @param {number}   hyperperiod
 * @returns {{ timeline: (string|null)[], deadlineMisses: object[], taskOrder: object[] }}
 */
function simulateRMS(tasks, hyperperiod) {
  if (!tasks || tasks.length === 0 || hyperperiod <= 0) {
    return { timeline: [], deadlineMisses: [], taskOrder: [] };
  }

  // Sort ascending by period → index 0 is highest priority
  const sorted = [...tasks].sort((a, b) => a.period - b.period);
  const remaining = new Array(sorted.length).fill(0);
  const deadlineMisses = [];
  const timeline = [];

  for (let t = 0; t < hyperperiod; t++) {
    // Release new instances at each period boundary
    for (let i = 0; i < sorted.length; i++) {
      if (t % sorted[i].period === 0) {
        if (t > 0 && remaining[i] > 0) {
          deadlineMisses.push({ taskId: sorted[i].id, time: t, algorithm: 'RMS' });
        }
        remaining[i] = sorted[i].wcet;
      }
    }

    // Highest-priority ready task (first in sorted order with remaining > 0)
    let running = -1;
    for (let i = 0; i < sorted.length; i++) {
      if (remaining[i] > 0) { running = i; break; }
    }

    timeline.push(running >= 0 ? sorted[running].id : null);
    if (running >= 0) remaining[running]--;
  }

  return { timeline, deadlineMisses, taskOrder: sorted };
}

// ─────────────────────────────────────────────────────────────
//  EDF — Earliest Deadline First
// ─────────────────────────────────────────────────────────────
/**
 * Simulates EDF over one hyperperiod.
 *
 * Priority rule: task with earliest absolute deadline runs first (dynamic, preemptive).
 * Provably optimal for feasible task sets on a uniprocessor.
 *
 * @param {object[]} tasks  Array of {id, name, period, wcet}
 * @param {number}   hyperperiod
 * @returns {{ timeline: (string|null)[], deadlineMisses: object[], taskOrder: object[] }}
 */
function simulateEDF(tasks, hyperperiod) {
  if (!tasks || tasks.length === 0 || hyperperiod <= 0) {
    return { timeline: [], deadlineMisses: [], taskOrder: [] };
  }

  // Each task carries mutable simulation state
  const state = tasks.map(task => ({
    ...task,
    remaining: task.wcet,        // first instance released at t=0
    absDeadline: task.period,    // absolute deadline of current instance
  }));

  const deadlineMisses = [];
  const timeline = [];

  for (let t = 0; t < hyperperiod; t++) {
    // Release new instances at period boundaries (t > 0 to skip initial release)
    for (const s of state) {
      if (t > 0 && t % s.period === 0) {
        if (s.remaining > 0) {
          deadlineMisses.push({ taskId: s.id, time: t, algorithm: 'EDF' });
        }
        s.remaining = s.wcet;
        s.absDeadline = t + s.period;
      }
    }

    // EDF: pick the ready task with the smallest absolute deadline
    let running = null;
    for (const s of state) {
      if (s.remaining > 0) {
        if (!running || s.absDeadline < running.absDeadline) running = s;
      }
    }

    timeline.push(running ? running.id : null);
    if (running) running.remaining--;
  }

  return { timeline, deadlineMisses, taskOrder: tasks };
}

// ─────────────────────────────────────────────────────────────
//  WCET RESPONSE-TIME ANALYSIS  (Liu & Layland / Lehoczky)
// ─────────────────────────────────────────────────────────────
/**
 * Computes worst-case response times using the iterative fixed-point method.
 *
 *   Rᵢ⁽⁰⁾ = Cᵢ
 *   Rᵢ⁽ᵏ⁺¹⁾ = Cᵢ + Σⱼ∈hp(i) ⌈Rᵢ⁽ᵏ⁾/Tⱼ⌉ × Cⱼ
 *
 * Converges when Rᵢ⁽ᵏ⁺¹⁾ = Rᵢ⁽ᵏ⁾.  Task is infeasible if Rᵢ > Tᵢ.
 *
 * @param {object[]} tasks
 * @returns {object[]}  tasks augmented with responseTime, interference, feasible, priority
 */
function computeResponseTime(tasks) {
  if (!tasks || tasks.length === 0) return [];

  const sorted = [...tasks].sort((a, b) => a.period - b.period);
  const results = [];

  for (let i = 0; i < sorted.length; i++) {
    const task = sorted[i];
    const hp = sorted.slice(0, i); // higher-priority tasks

    let R = task.wcet;
    let feasible = true;

    for (let iter = 0; iter < 2000; iter++) {
      let R_new = task.wcet;
      for (const j of hp) {
        R_new += Math.ceil(R / j.period) * j.wcet;
      }
      if (R_new === R) break;        // converged
      if (R_new > task.period) { feasible = false; R = R_new; break; }
      R = R_new;
    }

    results.push({
      ...task,
      priority: i + 1,
      responseTime: R,
      interference: R - task.wcet,
      feasible: feasible && R <= task.period,
    });
  }

  return results;
}

// ─────────────────────────────────────────────────────────────
//  WCET INTERFERENCE EXPLORER
// ─────────────────────────────────────────────────────────────
/**
 * For each task, computes the interference injected by every
 * higher-priority task within one full period of the analysed task.
 *
 * Interference(τᵢ, τⱼ) = ⌈Tᵢ / Tⱼ⌉ × Cⱼ   (j has higher priority)
 *
 * Also estimates worst-case blocking from lower-priority tasks that hold
 * shared resources (single resource, ceiling = max WCET of lp tasks).
 *
 * @param {object[]} tasks
 * @returns {object[]}
 */
function computeWCETInterference(tasks) {
  if (!tasks || tasks.length === 0) return [];

  const sorted = [...tasks].sort((a, b) => a.period - b.period);

  return sorted.map((task, i) => {
    const hp = sorted.slice(0, i);
    const lp = sorted.slice(i + 1);

    const interferenceByTask = hp.map(j => {
      const preemptions = Math.ceil(task.period / j.period);
      return {
        taskId: j.id,
        taskName: j.name || j.id,
        preemptions,
        interferenceTime: preemptions * j.wcet,
      };
    });

    const totalInterference = interferenceByTask.reduce(
      (s, x) => s + x.interferenceTime, 0
    );

    // Worst-case priority-inversion blocking (one resource, unbounded)
    const maxBlocking = lp.length > 0
      ? Math.max(...lp.map(j => j.wcet))
      : 0;

    const wcrt = task.wcet + totalInterference + maxBlocking;

    return {
      ...task,
      priority: i + 1,
      interferenceByTask,
      totalInterference,
      maxBlocking,
      worstCaseResponseTime: wcrt,
      feasible: wcrt <= task.period,
      cpuShare: task.wcet / task.period,
    };
  });
}

// ─────────────────────────────────────────────────────────────
//  SECURITY — Priority Inversion Scenario
// ─────────────────────────────────────────────────────────────
/**
 * Returns an event trace illustrating either:
 *   plain priority inversion  (the Mars Pathfinder bug pattern), or
 *   the fix via Priority Inheritance Protocol (PIP).
 *
 * @param {boolean} enablePIP
 * @returns {object[]}  chronological event list
 */
function simulatePriorityInversion(enablePIP) {
  if (enablePIP) {
    return [
      { time: 0,  task: 'L', event: 'release',     severity: 'info',    note: 'Low-priority task (L) released and starts running.' },
      { time: 1,  task: 'L', event: 'lock_mutex',  severity: 'info',    note: 'L acquires shared mutex (e.g. a bus driver resource).' },
      { time: 2,  task: 'H', event: 'release',     severity: 'info',    note: 'High-priority task (H) released — preempts L immediately.' },
      { time: 3,  task: 'H', event: 'wait_mutex',  severity: 'warning', note: 'H needs the mutex held by L.  PIP: L inherits H\'s priority!' },
      { time: 4,  task: 'M', event: 'release',     severity: 'info',    note: 'Medium-priority task (M) released.  L now runs at H\'s priority — M cannot preempt L.' },
      { time: 5,  task: 'L', event: 'running',     severity: 'ok',      note: 'L continues executing with inherited priority, finishing the critical section quickly.' },
      { time: 7,  task: 'L', event: 'unlock_mutex',severity: 'ok',      note: 'L releases mutex; its priority reverts to low.' },
      { time: 8,  task: 'H', event: 'resume',      severity: 'ok',      note: 'H immediately acquires the mutex and resumes.' },
      { time: 10, task: 'H', event: 'complete',    severity: 'ok',      note: '✓ H completes within its deadline — PIP prevented the inversion.' },
      { time: 11, task: 'M', event: 'resume',      severity: 'info',    note: 'M now runs normally at its own priority.' },
    ];
  }

  // Vulnerable scenario (no PIP)
  return [
    { time: 0,  task: 'L', event: 'release',     severity: 'info',    note: 'Low-priority task (L) released and starts running.' },
    { time: 1,  task: 'L', event: 'lock_mutex',  severity: 'info',    note: 'L acquires shared mutex.' },
    { time: 2,  task: 'H', event: 'release',     severity: 'info',    note: 'High-priority task (H) released — preempts L.' },
    { time: 3,  task: 'H', event: 'wait_mutex',  severity: 'danger',  note: '⚠ H blocks on the mutex held by L.  L must run to release it.' },
    { time: 4,  task: 'M', event: 'release',     severity: 'danger',  note: '⚠ Medium-priority task (M) released — M has higher priority than L and preempts L!' },
    { time: 8,  task: 'M', event: 'complete',    severity: 'warning', note: 'M finally completes.  Only now can L resume.' },
    { time: 9,  task: 'L', event: 'resume',      severity: 'warning', note: 'L resumes and finishes the critical section.' },
    { time: 11, task: 'L', event: 'unlock_mutex',severity: 'warning', note: 'L releases mutex — far later than expected.' },
    { time: 12, task: 'H', event: 'resume',      severity: 'danger',  note: '⚠ H finally gets the mutex — delayed by M entirely!' },
    { time: 14, task: 'H', event: 'complete',    severity: 'danger',  note: '✗ H completes, but its deadline was t=12.  DEADLINE MISS due to priority inversion!' },
  ];
}

// ─────────────────────────────────────────────────────────────
//  SECURITY — Stack Overflow Scenario
// ─────────────────────────────────────────────────────────────
/**
 * Models task stack usage during a recursive call sequence.
 *
 * @param {boolean} enableCanary  Whether stack canaries are active.
 * @returns {object}
 */
function simulateStackOverflow(enableCanary) {
  const STACK_SIZE = 256;

  if (!enableCanary) {
    return {
      vulnerable: true,
      stackSize: STACK_SIZE,
      description: 'Unbounded recursion with no stack-overflow protection.',
      frames: [
        { depth: 0, used: 32,  status: 'ok',        note: 'Task starts — initial stack frame allocated.' },
        { depth: 1, used: 64,  status: 'ok',        note: 'Recursive call depth 1.' },
        { depth: 2, used: 96,  status: 'ok',        note: 'Recursive call depth 2.' },
        { depth: 4, used: 160, status: 'warning',   note: 'Stack growing — no check, no warning.' },
        { depth: 6, used: 224, status: 'warning',   note: 'Stack almost full — system unaware.' },
        { depth: 7, used: 256, status: 'overflow',  note: '✗ STACK OVERFLOW — adjacent task memory overwritten!' },
        { depth: 8, used: 288, status: 'corrupted', note: '✗ Memory corruption; other tasks crash. System in undefined state.' },
      ],
    };
  }

  return {
    vulnerable: false,
    stackSize: STACK_SIZE,
    description: 'Stack canary + high-watermark monitoring enabled.',
    frames: [
      { depth: 0, used: 32,  canary: 'OK',      status: 'ok',      note: 'Task starts — canary value written at stack base.' },
      { depth: 1, used: 64,  canary: 'OK',      status: 'ok',      note: 'Recursive call depth 1 — canary intact.' },
      { depth: 2, used: 96,  canary: 'OK',      status: 'ok',      note: 'Recursive call depth 2 — canary intact.' },
      { depth: 4, used: 160, canary: 'OK',      status: 'warning', note: 'Stack growing — RTOS watermark task logs alert.' },
      { depth: 6, used: 224, canary: 'OK',      status: 'warning', note: '88 % stack used — RTOS raises near-overflow hook.' },
      { depth: 7, used: 250, canary: 'CORRUPT', status: 'detected',note: 'Canary value overwritten — hardware exception fires!' },
      { depth: 7, used: 250, canary: 'N/A',     status: 'handled', note: '✓ Task safely terminated; event logged; system continues.' },
    ],
  };
}

// ─────────────────────────────────────────────────────────────
//  SECURITY — Race Condition / Missing Critical Section
// ─────────────────────────────────────────────────────────────
/**
 * Simulates two tasks accessing a shared counter without / with a mutex.
 *
 * @param {boolean} enableMutex
 * @returns {object[]}  event trace
 */
function simulateRaceCondition(enableMutex) {
  if (!enableMutex) {
    return [
      { time: 0,  task: 'T1', event: 'read',    value: 5,  shared: 5,  severity: 'info',    note: 'T1 reads shared counter: value = 5.' },
      { time: 1,  task: 'T2', event: 'preempt', value: 5,  shared: 5,  severity: 'warning', note: 'T2 preempts T1 — both tasks hold a stale copy of counter = 5!' },
      { time: 2,  task: 'T2', event: 'read',    value: 5,  shared: 5,  severity: 'warning', note: 'T2 reads same stale value (5).' },
      { time: 3,  task: 'T2', event: 'write',   value: 6,  shared: 6,  severity: 'warning', note: 'T2 increments and writes counter = 6.' },
      { time: 4,  task: 'T1', event: 'resume',  value: 5,  shared: 6,  severity: 'danger',  note: 'T1 resumes with its OLD read value (5).' },
      { time: 5,  task: 'T1', event: 'write',   value: 6,  shared: 6,  severity: 'danger',  note: '✗ T1 writes 5+1=6 — T2\'s increment is LOST!  Counter should be 7.' },
      { time: 6,  task: '--', event: 'result',  value: 6,  shared: 6,  severity: 'danger',  note: '✗ Data corruption: expected 7, got 6.  This is a race condition.' },
    ];
  }

  return [
    { time: 0,  task: 'T1', event: 'lock',    value: 5,  shared: 5,  severity: 'info', note: 'T1 acquires mutex before reading.' },
    { time: 1,  task: 'T1', event: 'read',    value: 5,  shared: 5,  severity: 'info', note: 'T1 reads counter = 5 (mutex held).' },
    { time: 2,  task: 'T2', event: 'preempt', value: 5,  shared: 5,  severity: 'info', note: 'T2 preempts T1 and tries to lock mutex.' },
    { time: 3,  task: 'T2', event: 'blocked', value: 5,  shared: 5,  severity: 'ok',   note: 'T2 blocks — mutex held by T1.  T1 resumes.' },
    { time: 4,  task: 'T1', event: 'write',   value: 6,  shared: 6,  severity: 'ok',   note: 'T1 increments counter to 6 and writes.' },
    { time: 5,  task: 'T1', event: 'unlock',  value: 6,  shared: 6,  severity: 'ok',   note: 'T1 releases mutex.' },
    { time: 6,  task: 'T2', event: 'lock',    value: 6,  shared: 6,  severity: 'ok',   note: 'T2 acquires mutex, reads fresh value 6.' },
    { time: 7,  task: 'T2', event: 'write',   value: 7,  shared: 7,  severity: 'ok',   note: 'T2 increments counter to 7.' },
    { time: 8,  task: 'T2', event: 'unlock',  value: 7,  shared: 7,  severity: 'ok',   note: '✓ Counter = 7.  Both increments preserved correctly.' },
  ];
}

// ─────────────────────────────────────────────────────────────
//  SECURITY — Integer Overflow in Timer/Counter
// ─────────────────────────────────────────────────────────────
/**
 * Shows how an 8-bit tick counter overflows and resets a deadline check.
 *
 * @param {boolean} useSafeType  Use uint32_t (no overflow within simulation).
 * @returns {object[]}
 */
function simulateTimerOverflow(useSafeType) {
  const MAX8 = 255;
  const steps = [];
  let tick = 245;
  const DEADLINE = 20;
  const releaseTime = 248;

  for (let i = 0; i < 18; i++) {
    const t = useSafeType ? releaseTime + i : (tick + i) & 0xff; // wrap at 255
    const elapsed = useSafeType ? i : ((tick + i) & 0xff) - tick; // may go negative

    let severity = 'ok';
    let note = '';

    if (!useSafeType && (tick + i) > MAX8 && elapsed < 0) {
      severity = 'danger';
      note = `✗ Counter wrapped to ${t}!  elapsed = ${((tick + i) & 0xff) - tick} (negative — bug!).  Deadline check resets erroneously.`;
    } else if (i === DEADLINE - 1) {
      severity = 'ok';
      note = `✓ Deadline reached correctly at elapsed = ${elapsed}.`;
    } else {
      note = `Tick = ${t}, elapsed = ${elapsed}.`;
    }

    steps.push({ iteration: i, tick: t, elapsed, severity, note });
    if (i >= 12 && !useSafeType) break; // stop after the wrap is shown
    if (i >= DEADLINE) break;
  }

  return {
    type: useSafeType ? 'uint32_t (safe)' : 'uint8_t (vulnerable)',
    vulnerable: !useSafeType,
    steps,
  };
}

// ─────────────────────────────────────────────────────────────
//  PUBLIC API
// ─────────────────────────────────────────────────────────────

const RTOSCore = {
  // Utilities
  gcd,
  lcm,
  computeHyperperiod,
  computeUtilization,
  rmsSchedulabilityBound,
  MAX_HYPERPERIOD,
  // Scheduling
  simulateRMS,
  simulateEDF,
  // WCET
  computeResponseTime,
  computeWCETInterference,
  // Security
  simulatePriorityInversion,
  simulateStackOverflow,
  simulateRaceCondition,
  simulateTimerOverflow,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = RTOSCore;
} else if (typeof window !== 'undefined') {
  window.RTOSCore = RTOSCore;
}

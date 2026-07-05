/**
 * security-ui.js — Security Vulnerabilities & Fixes page
 *
 * Depends on: core.js  (must be loaded first)
 */

'use strict';

// ── Vulnerability definitions ────────────────────────────────
const VULNERABILITIES = {
  priority_inversion: {
    title:    'Priority Inversion',
    subtitle: 'A high-priority task blocked indefinitely by a low-priority task',
    icon:     '🔄',
    severity: 'critical',
    cve:      'Mars Pathfinder 1997 — real-world incident',
    description: `
      <p>Priority inversion occurs when a <strong>high-priority task (H)</strong> is
      blocked waiting for a resource held by a <strong>low-priority task (L)</strong>.
      A <strong>medium-priority task (M)</strong> then preempts L, preventing L from
      releasing the resource — so H is effectively delayed by M, despite H having
      higher priority than M.</p>
      <p>This caused a famous watchdog reset on the Mars Pathfinder rover in 1997.</p>
      <div class="info-box warn" style="margin-top:12px">
        <span class="icon">⚠️</span>
        <div><strong>Impact:</strong> Unbounded priority inversion can cause deadline misses,
        watchdog resets, or complete task starvation in safety-critical systems.</div>
      </div>
    `,
    fix: 'Priority Inheritance Protocol (PIP): when H blocks on a mutex held by L, L temporarily inherits H\'s priority — preventing M from preempting L.',
    vulnCode: `/* ❌ VULNERABLE — no priority protocol */
Mutex_t bus_mutex;

void task_L(void) {          /* priority 1 */
    mutex_lock(&bus_mutex);  /* acquires mutex */
    bus_read();              /* critical section */
    /* H is waiting here, but M preempts us! */
    mutex_unlock(&bus_mutex);
}

void task_H(void) {          /* priority 3 */
    mutex_lock(&bus_mutex);  /* BLOCKS — held by L */
    process_data();
    mutex_unlock(&bus_mutex);
}

void task_M(void) {          /* priority 2 */
    /* Runs freely, delaying L indefinitely */
    compute();
}`,
    fixedCode: `/* ✅ FIXED — Priority Inheritance Protocol */
/* Use a PIP-aware mutex (available in most RTOSes) */
PIP_Mutex_t bus_mutex;

void task_L(void) {          /* priority 1 */
    pip_mutex_lock(&bus_mutex);
    /* If H blocks here, our priority is raised to 3 */
    bus_read();
    pip_mutex_unlock(&bus_mutex);
    /* Priority reverts to 1 after unlock */
}

void task_H(void) {          /* priority 3 */
    pip_mutex_lock(&bus_mutex);
    /* L now runs at our priority — M cannot preempt */
    process_data();
    pip_mutex_unlock(&bus_mutex);
}`,
    simulate: enableFix => RTOSCore.simulatePriorityInversion(enableFix),
    renderSim: renderPITimeline,
  },

  stack_overflow: {
    title:    'Task Stack Overflow',
    subtitle: 'Unbounded recursion corrupts adjacent task memory',
    icon:     '📚',
    severity: 'critical',
    cve:      'CWE-121: Stack-based Buffer Overflow',
    description: `
      <p>In an RTOS each task has a <strong>fixed-size stack</strong>. Unbounded
      recursion or large local arrays can silently overrun the stack, overwriting
      the adjacent task's stack or kernel data structures.</p>
      <p>Unlike heap overflows, stack overflows in bare-metal systems often have
      <em>no runtime detection</em> — the system silently corrupts memory and
      crashes later in a completely unrelated location.</p>
      <div class="info-box danger" style="margin-top:12px">
        <span class="icon">🚨</span>
        <div><strong>Impact:</strong> Memory corruption of adjacent tasks, data
        corruption, unpredictable crashes.  In safety-critical systems this
        can be life-threatening.</div>
      </div>
    `,
    fix: 'Use stack canaries, configure stack guards (MPU), and monitor high-watermarks at runtime. Most RTOSes provide uxTaskGetStackHighWaterMark().',
    vulnCode: `/* ❌ VULNERABLE — unbounded recursion, no guard */
#define TASK_STACK_SIZE  256  /* bytes */

uint32_t factorial(uint32_t n) {
    /* Each call uses ~32 bytes of stack */
    return (n == 0) ? 1 : n * factorial(n - 1);
}

void sensor_task(void *arg) {
    while (1) {
        uint32_t val = factorial(large_n); /* n=8 → OVERFLOW */
        send_result(val);
    }
}

/* Task created with fixed stack — no overflow check */
xTaskCreate(sensor_task, "Sensor",
            TASK_STACK_SIZE, NULL, 1, NULL);`,
    fixedCode: `/* ✅ FIXED — iterative + stack monitoring */
#define TASK_STACK_SIZE  256
#define STACK_WARN_MARK   64  /* warn if <64 bytes left */

uint32_t factorial_safe(uint32_t n) {
    uint32_t result = 1;
    for (uint32_t i = 2; i <= n; i++)
        result *= i;           /* O(1) stack, no recursion */
    return result;
}

void sensor_task(void *arg) {
    while (1) {
        /* Periodic stack health check */
        UBaseType_t remaining =
            uxTaskGetStackHighWaterMark(NULL);
        if (remaining < STACK_WARN_MARK)
            log_error("Stack near limit!");

        uint32_t val = factorial_safe(large_n);
        send_result(val);
    }
}

/* Enable MPU stack guard region in RTOS config */
/* configUSE_MPU_WRAPPERS = 1                  */`,
    simulate: enableFix => RTOSCore.simulateStackOverflow(enableFix),
    renderSim: renderStackSim,
  },

  race_condition: {
    title:    'Race Condition / Missing Critical Section',
    subtitle: 'Concurrent access to shared data without synchronisation',
    icon:     '⚡',
    severity: 'high',
    cve:      'CWE-362: Concurrent Execution Using Shared Resource',
    description: `
      <p>When two tasks share a global variable and at least one writes to it, the
      result depends on the relative timing of their execution — a
      <strong>race condition</strong>. Even a simple increment
      <code>counter++</code> is not atomic: it compiles to read–modify–write,
      all three of which can be preempted.</p>
      <div class="info-box warn" style="margin-top:12px">
        <span class="icon">⚠️</span>
        <div><strong>Impact:</strong> Lost updates, counter drift, corrupted data structures,
        non-deterministic behaviour — extremely hard to reproduce and debug.</div>
      </div>
    `,
    fix: 'Protect every shared resource with a mutex. Alternatively, use atomic operations (C11 _Atomic) or disable interrupts for very short critical sections.',
    vulnCode: `/* ❌ VULNERABLE — shared counter without mutex */
volatile uint32_t sensor_count = 0;

void task_producer(void *arg) {
    while (1) {
        /* Read-Modify-Write: NOT atomic! */
        sensor_count++;   /* can be preempted here */
        vTaskDelay(10);
    }
}

void task_consumer(void *arg) {
    while (1) {
        sensor_count++;   /* simultaneous write: lost! */
        uint32_t snap = sensor_count;
        process(snap);
        vTaskDelay(10);
    }
}
/* Expected: both increments apply.
   Actual:   one may be silently lost. */`,
    fixedCode: `/* ✅ FIXED — mutex-protected critical section */
volatile uint32_t sensor_count = 0;
SemaphoreHandle_t count_mutex;

void task_producer(void *arg) {
    while (1) {
        xSemaphoreTake(count_mutex, portMAX_DELAY);
        sensor_count++;          /* protected */
        xSemaphoreGive(count_mutex);
        vTaskDelay(10);
    }
}

void task_consumer(void *arg) {
    while (1) {
        xSemaphoreTake(count_mutex, portMAX_DELAY);
        sensor_count++;
        uint32_t snap = sensor_count; /* atomic snapshot */
        xSemaphoreGive(count_mutex);
        process(snap);
        vTaskDelay(10);
    }
}`,
    simulate: enableFix => RTOSCore.simulateRaceCondition(enableFix),
    renderSim: renderRaceSim,
  },

  timer_overflow: {
    title:    'Integer Overflow in Timing',
    subtitle: '8-bit tick counter wraps around, breaking deadline checks',
    icon:     '⏱️',
    severity: 'high',
    cve:      'CWE-190: Integer Overflow or Wraparound',
    description: `
      <p>Embedded systems often use small integer types for timing.
      An <code>uint8_t</code> counter overflows at 255 — if the system tick
      crosses that boundary during a deadline check, the elapsed-time
      calculation <em>goes negative</em>, silently resetting the timeout
      and missing the deadline entirely.</p>
      <div class="info-box warn" style="margin-top:12px">
        <span class="icon">⚠️</span>
        <div><strong>Impact:</strong> Missed deadlines, tasks blocked indefinitely,
        incorrect watchdog resets, silent safety-system bypasses.</div>
      </div>
    `,
    fix: 'Use uint32_t (or uint64_t) for tick counters — they wrap only after ~49 days at 1 kHz. Use subtraction with unsigned arithmetic: (uint32_t)(now - start) correctly handles wrap-around.',
    vulnCode: `/* ❌ VULNERABLE — uint8_t tick counter */
uint8_t start_tick;
uint8_t TIMEOUT = 20;

void wait_for_sensor(void) {
    start_tick = get_tick();   /* e.g. = 248 */

    while (1) {
        uint8_t now     = get_tick();
        uint8_t elapsed = now - start_tick;
        /* When now wraps past 255 → 3:
           elapsed = 3 - 248 = -245 as uint8_t = 11
           Wrong!  Deadline check fires too early. */
        if (elapsed >= TIMEOUT) {
            handle_timeout();  /* fires at wrong time */
            return;
        }
        if (sensor_ready()) return;
    }
}`,
    fixedCode: `/* ✅ FIXED — uint32_t wraps safely */
uint32_t start_tick;
uint32_t TIMEOUT = 20;

void wait_for_sensor(void) {
    start_tick = get_tick_u32();  /* 32-bit counter */

    while (1) {
        uint32_t now = get_tick_u32();
        /* Unsigned subtraction always gives correct
           elapsed time even across a wrap-around.
           Example: (3 - 4294967295) as uint32 = 4 */
        uint32_t elapsed = now - start_tick;

        if (elapsed >= TIMEOUT) {
            handle_timeout();   /* fires correctly */
            return;
        }
        if (sensor_ready()) return;
    }
}`,
    simulate: enableFix => RTOSCore.simulateTimerOverflow(enableFix),
    renderSim: renderTimerSim,
  },
};

// ── State ─────────────────────────────────────────────────────
let currentVuln = 'priority_inversion';
let fixEnabled   = false;

const $s = id => document.getElementById(id);

// ── Init ─────────────────────────────────────────────────────
function initSecurity() {
  // Build vulnerability cards
  const container = $s('vuln-cards');
  container.innerHTML = '';

  Object.entries(VULNERABILITIES).forEach(([key, vuln]) => {
    const card = document.createElement('div');
    card.className = 'vuln-card';
    card.id = `vcard-${key}`;
    card.innerHTML = `
      <div class="vuln-header" onclick="openVuln('${key}')">
        <span class="vuln-icon">${vuln.icon}</span>
        <div>
          <div class="vuln-title">${vuln.title}</div>
          <div class="vuln-sub">${vuln.subtitle}</div>
        </div>
        <span class="vuln-severity sev-${vuln.severity}">${vuln.severity}</span>
      </div>
      <div class="vuln-body" id="vbody-${key}">
        <div class="info-box info" style="margin-bottom:16px">
          <span class="icon">📖</span>
          <div>${vuln.description}</div>
        </div>

        <div style="margin-bottom:20px;padding:14px;background:var(--bg-input);border-radius:8px;border:1px solid var(--border)">
          <div style="font-family:var(--font-mono);font-size:.8rem;color:var(--text-sub);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Reference</div>
          <div style="font-size:.9rem">${vuln.cve}</div>
        </div>

        <h3 class="section-title" style="margin-bottom:12px">Vulnerable vs. Fixed Code</h3>
        <div class="code-compare">
          <div class="code-panel">
            <div class="code-panel-label vuln">❌ Vulnerable</div>
            <pre class="code-block">${escSec(vuln.vulnCode)}</pre>
          </div>
          <div class="code-panel">
            <div class="code-panel-label fixed">✅ Fixed</div>
            <pre class="code-block">${escSec(vuln.fixedCode)}</pre>
          </div>
        </div>

        <div class="info-box info" style="margin-top:16px">
          <span class="icon">🛠️</span>
          <div><strong>Fix:</strong> ${escSec(vuln.fix)}</div>
        </div>

        <h3 class="section-title" style="margin:20px 0 12px">Interactive Simulation</h3>

        <div style="display:flex;gap:12px;align-items:center;margin-bottom:16px;flex-wrap:wrap">
          <div class="tab-group" style="margin-bottom:0">
            <button class="tab-btn active"  id="btn-vuln-${key}"  onclick="setMode('${key}',false)">⚠️ Vulnerable</button>
            <button class="tab-btn"         id="btn-fixed-${key}" onclick="setMode('${key}',true)">✅ With Fix</button>
          </div>
          <button class="btn btn-outline btn-sm" onclick="replaySim('${key}')">⟳ Replay</button>
        </div>

        <div id="sim-container-${key}">
          <!-- simulation injected here -->
        </div>
      </div>
    `;
    container.appendChild(card);
  });

  // Open first vulnerability by default
  openVuln('priority_inversion');
}

// ── Open/toggle vulnerability panel ─────────────────────────
function openVuln(key) {
  // Close all
  Object.keys(VULNERABILITIES).forEach(k => {
    const body = $s(`vbody-${k}`);
    if (body) body.classList.remove('open');
  });
  // Open selected
  const body = $s(`vbody-${key}`);
  if (body) body.classList.add('open');

  currentVuln = key;
  fixEnabled  = false;
  updateTabButtons(key);
  runSimulation(key, false);

  // Scroll into view
  $s(`vcard-${key}`).scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function setMode(key, enableFix) {
  fixEnabled = enableFix;
  updateTabButtons(key);
  runSimulation(key, enableFix);
}

function replaySim(key) {
  runSimulation(key, fixEnabled);
}

function updateTabButtons(key) {
  const bv = $s(`btn-vuln-${key}`);
  const bf = $s(`btn-fixed-${key}`);
  if (!bv || !bf) return;
  bv.classList.toggle('active', !fixEnabled);
  bf.classList.toggle('active',  fixEnabled);
}

// ── Run simulation ────────────────────────────────────────────
function runSimulation(key, enableFix) {
  const vuln = VULNERABILITIES[key];
  if (!vuln) return;

  const data      = vuln.simulate(enableFix);
  const container = $s(`sim-container-${key}`);
  container.innerHTML = '';

  vuln.renderSim(container, data, enableFix);
}

// ── Priority Inversion renderer ───────────────────────────────
function renderPITimeline(container, events, isPIP) {
  const header = document.createElement('div');
  header.className = 'info-box ' + (isPIP ? 'info' : 'danger');
  header.style.marginBottom = '12px';
  header.innerHTML = `
    <span class="icon">${isPIP ? '✅' : '⚠️'}</span>
    <div>
      <strong>${isPIP ? 'Priority Inheritance Protocol (PIP) Active' : 'Vanilla mutexes — no priority protocol'}</strong><br>
      <span style="font-size:.85rem">${isPIP
        ? 'When H blocks on L\'s mutex, L temporarily inherits H\'s priority, preventing M from preempting L.'
        : 'L holds the mutex but gets preempted by M. H waits indefinitely — a priority inversion!'}</span>
    </div>
  `;
  container.appendChild(header);

  // Task legend
  const legend = document.createElement('div');
  legend.className = 'legend';
  legend.style.marginBottom = '12px';
  legend.innerHTML = `
    <div class="legend-item"><span class="legend-swatch" style="background:var(--green)"></span>L — Low priority (holds mutex)</div>
    <div class="legend-item"><span class="legend-swatch" style="background:var(--orange)"></span>M — Medium priority</div>
    <div class="legend-item"><span class="legend-swatch" style="background:var(--cyan)"></span>H — High priority (needs mutex)</div>
  `;
  container.appendChild(legend);

  const tl = document.createElement('div');
  tl.className = 'event-timeline';

  events.forEach((ev, i) => {
    const item = document.createElement('div');
    item.className = `event-item sev-${ev.severity}`;
    item.style.animationDelay = `${i * 80}ms`;

    const taskColorClass = `badge-${ev.task}`;
    item.innerHTML = `
      <span class="event-time">t=${ev.time}</span>
      <span class="event-task-badge ${taskColorClass}">${ev.task}</span>
      <span class="event-note">${escSec(ev.note)}</span>
    `;
    tl.appendChild(item);
  });

  container.appendChild(tl);
}

// ── Stack overflow renderer ───────────────────────────────────
function renderStackSim(container, data, isFixed) {
  const header = document.createElement('div');
  header.className = 'info-box ' + (isFixed ? 'info' : 'danger');
  header.style.marginBottom = '14px';
  header.innerHTML = `
    <span class="icon">${isFixed ? '✅' : '⚠️'}</span>
    <div>
      <strong>${isFixed ? 'Stack Canary + Watermark Monitoring' : 'No Stack Protection'}</strong><br>
      <span style="font-size:.85rem">${data.description}</span>
    </div>
  `;
  container.appendChild(header);

  // Stack visual + events side by side
  const flex = document.createElement('div');
  flex.style.cssText = 'display:flex;gap:20px;align-items:flex-start;flex-wrap:wrap';

  // Stack visual
  const stackWrap = document.createElement('div');
  stackWrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:8px';

  const stackVis = document.createElement('div');
  stackVis.className = 'stack-visual';

  const stackLabel = document.createElement('div');
  stackLabel.style.cssText = 'font-family:var(--font-mono);font-size:.75rem;color:var(--text-sub);text-align:center';
  stackLabel.textContent = `Stack (${data.stackSize}B)`;

  stackWrap.appendChild(stackLabel);
  stackWrap.appendChild(stackVis);
  flex.appendChild(stackWrap);

  // Event list
  const evList = document.createElement('div');
  evList.className = 'event-timeline';
  evList.style.flex = '1';

  data.frames.forEach((frame, i) => {
    const ev = document.createElement('div');
    ev.className = `event-item sev-${frame.status}`;
    ev.style.animationDelay = `${i * 100}ms`;

    const pct = Math.min((frame.used / data.stackSize) * 100, 120);
    const statusColor = {
      ok: 'var(--green)', warning: 'var(--orange)',
      overflow: 'var(--red)', corrupted: 'var(--red)',
      detected: 'var(--yellow)', handled: 'var(--green)',
    }[frame.status] || 'var(--text-main)';

    ev.innerHTML = `
      <span class="event-time">d=${frame.depth}</span>
      <span class="event-task-badge badge-T1">${frame.used}B</span>
      ${frame.canary ? `<span style="font-family:var(--font-mono);font-size:.75rem;padding:2px 6px;border-radius:4px;background:rgba(0,0,0,.3);color:${frame.canary==='OK'?'var(--green)':frame.canary==='CORRUPT'?'var(--red)':'var(--text-muted)'}">${frame.canary}</span>` : ''}
      <span class="event-note">${escSec(frame.note)}</span>
    `;
    evList.appendChild(ev);

    // Update stack visual with final frame state
    if (i === data.frames.length - 1) {
      const fillHeight = Math.min(pct, 100);
      const fill = document.createElement('div');
      fill.className = 'stack-fill ' + frame.status;
      fill.style.height = fillHeight + '%';
      fill.textContent  = frame.used + 'B';
      stackVis.innerHTML = '';
      stackVis.appendChild(fill);

      // Limit line
      const limitLine = document.createElement('div');
      limitLine.style.cssText = `
        position:absolute; top:0; left:0; right:0;
        height:2px; background:var(--red); opacity:.7;
      `;
      stackVis.appendChild(limitLine);
    }
  });

  flex.appendChild(evList);
  container.appendChild(flex);

  // Animate stack fill on load
  let frameIdx = 0;
  const animate = () => {
    if (frameIdx >= data.frames.length) return;
    const frame = data.frames[frameIdx];
    const pct   = Math.min((frame.used / data.stackSize) * 100, 120);
    const fill  = document.createElement('div');
    fill.className = 'stack-fill ' + frame.status;
    fill.style.height = Math.min(pct, 100) + '%';
    fill.textContent  = frame.used + 'B';
    stackVis.innerHTML = '';
    stackVis.appendChild(fill);
    frameIdx++;
    setTimeout(animate, 500);
  };
  animate();
}

// ── Race condition renderer ───────────────────────────────────
function renderRaceSim(container, events, isFixed) {
  const header = document.createElement('div');
  header.className = 'info-box ' + (isFixed ? 'info' : 'danger');
  header.style.marginBottom = '12px';
  header.innerHTML = `
    <span class="icon">${isFixed ? '✅' : '⚠️'}</span>
    <div>
      <strong>${isFixed ? 'Mutex-protected critical section' : 'Unprotected shared counter'}</strong><br>
      <span style="font-size:.85rem">
        ${isFixed
          ? 'Both increments are atomically applied. Final counter = 7. ✓'
          : 'T2 preempts T1 mid-increment. One increment is lost. Counter = 6 (expected 7). ✗'}
      </span>
    </div>
  `;
  container.appendChild(header);

  // Shared counter display
  const counterDisplay = document.createElement('div');
  counterDisplay.style.cssText = 'display:flex;gap:24px;margin-bottom:16px;flex-wrap:wrap';

  const counterBox = document.createElement('div');
  counterBox.className = 'stat-badge';
  counterBox.id = 'rc-counter-display';
  counterBox.innerHTML = '<div class="stat-value" id="rc-counter-val">5</div><div class="stat-label">Shared Counter</div>';
  counterDisplay.appendChild(counterBox);

  const expectedBox = document.createElement('div');
  expectedBox.className = 'stat-badge ok';
  expectedBox.innerHTML = '<div class="stat-value">7</div><div class="stat-label">Expected</div>';
  counterDisplay.appendChild(expectedBox);

  container.appendChild(counterDisplay);

  const tl = document.createElement('div');
  tl.className = 'event-timeline';

  events.forEach((ev, i) => {
    const item = document.createElement('div');
    item.className = `event-item sev-${ev.severity}`;
    item.style.animationDelay = `${i * 90}ms`;

    const taskBadge = ev.task === '--' ? '' :
      `<span class="event-task-badge badge-${ev.task}">${ev.task}</span>`;

    item.innerHTML = `
      <span class="event-time">t=${ev.time}</span>
      ${taskBadge}
      <span class="event-task-badge" style="background:rgba(255,255,255,.08);color:var(--text-sub)">
        cnt=${ev.shared}
      </span>
      <span class="event-note">${escSec(ev.note)}</span>
    `;
    tl.appendChild(item);

    // Animate counter value
    setTimeout(() => {
      const el = document.getElementById('rc-counter-val');
      if (el) {
        el.textContent = ev.shared;
        const badge = document.getElementById('rc-counter-display');
        if (badge) {
          badge.className = 'stat-badge ' +
            (ev.severity === 'danger' ? 'fail' : ev.severity === 'warning' ? 'warn' : '');
        }
      }
    }, i * 90 + 50);
  });

  container.appendChild(tl);
}

// ── Timer overflow renderer ───────────────────────────────────
function renderTimerSim(container, data, isFixed) {
  const header = document.createElement('div');
  header.className = 'info-box ' + (isFixed ? 'info' : 'danger');
  header.style.marginBottom = '12px';
  header.innerHTML = `
    <span class="icon">${isFixed ? '✅' : '⚠️'}</span>
    <div>
      <strong>${data.type}</strong><br>
      <span style="font-size:.85rem">
        ${isFixed
          ? 'uint32_t handles rollover correctly. Elapsed time is always accurate.'
          : 'uint8_t wraps at 255. Elapsed time goes negative. Deadline check fires too early!'}
      </span>
    </div>
  `;
  container.appendChild(header);

  const tl = document.createElement('div');
  tl.className = 'event-timeline';

  data.steps.forEach((step, i) => {
    const item = document.createElement('div');
    item.className = `event-item sev-${step.severity}`;
    item.style.animationDelay = `${i * 80}ms`;
    item.innerHTML = `
      <span class="event-time">i=${step.iteration}</span>
      <span class="event-task-badge badge-T1">tick=${step.tick}</span>
      <span class="event-task-badge badge-T2">Δ=${step.elapsed}</span>
      <span class="event-note">${escSec(step.note)}</span>
    `;
    tl.appendChild(item);
  });

  container.appendChild(tl);
}

// ── Helpers ───────────────────────────────────────────────────
function escSec(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;');
}

// ── Boot ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', initSecurity);

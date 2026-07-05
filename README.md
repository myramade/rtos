# RTOS Educational Simulator

An interactive, browser-based Real-Time Operating System simulator built to teach embedded-systems students how an RTOS works, demonstrate common security vulnerabilities, and let them explore worst-case timing analysis — all without installing any toolchain.

---

## Features

| Module | What you learn |
|--------|----------------|
| **RMS / EDF Scheduling Timeline** | Add tasks with period and WCET; visualise the preemptive Gantt chart; see deadline misses; compare Rate Monotonic vs. Earliest Deadline First |
| **WCET Interference Explorer** | Compute worst-case response times via fixed-point analysis; visualise how higher-priority tasks inject interference; understand blocking time |
| **Security Lab** | Four hands-on scenarios — Priority Inversion, Stack Overflow, Race Condition, Integer Overflow in timers — each with animated event traces and side-by-side vulnerable vs. fixed code |

---

## Quick Start

```bash
# Clone and open – no build step required
git clone <repo-url>
cd rtos

# Open in browser (any static file server works)
npx serve .          # or
python3 -m http.server 8080
```

Then navigate to `http://localhost:8080`.

> The pages also work when opened directly as `file://` URLs in most browsers (Chrome/Firefox).

---

## Project Structure

```
rtos/
├── index.html          ← Landing page & architecture overview
├── scheduler.html      ← RMS / EDF Scheduling Timeline
├── wcet.html           ← WCET Interference Explorer
├── security.html       ← Security Vulnerabilities & Fixes
├── css/
│   └── style.css       ← Shared dark-theme styles
├── js/
│   ├── core.js         ← Core algorithms (schedulers, WCET, security simulations)
│   ├── scheduler-ui.js ← Scheduler page UI & Canvas Gantt chart
│   ├── wcet-ui.js      ← WCET page UI & stacked bar charts
│   └── security-ui.js  ← Security page UI & event-trace animations
└── tests/
    └── core.test.js    ← Node.js unit tests for core algorithms
```

---

## Running the Tests

The core scheduling algorithms have a zero-dependency Node.js test suite:

```bash
node tests/core.test.js
# Results: 42 passed, 0 failed
```

---

## Algorithms Implemented

### Scheduling

**Rate Monotonic Scheduling (RMS)**
- Static priorities: shorter period → higher priority
- Preemptive uniprocessor scheduling
- Schedulability bound: `U ≤ n(2^(1/n) − 1)` (Liu & Layland 1973)
- Simulates one full hyperperiod, marks deadline misses

**Earliest Deadline First (EDF)**
- Dynamic priorities: task with nearest absolute deadline runs first
- Optimal for preemptive uniprocessor scheduling
- Schedulability bound: `U ≤ 1`

### WCET Response-Time Analysis

Fixed-point iterative algorithm (Lehoczky et al. 1989):

```
R⁽⁰⁾ = Cᵢ
R⁽ᵏ⁺¹⁾ = Cᵢ + Σⱼ∈hp(i) ⌈R⁽ᵏ⁾/Tⱼ⌉ × Cⱼ
```

Converges when `R⁽ᵏ⁺¹⁾ = R⁽ᵏ⁾`. Task is infeasible if `R > T`.

**Interference model:**  
`I(τᵢ, τⱼ) = ⌈Tᵢ/Tⱼ⌉ × Cⱼ`  — preemptions of τᵢ by higher-priority τⱼ within one period.

### Security Vulnerabilities

| Scenario | Root Cause | Fix |
|----------|-----------|-----|
| Priority Inversion | Low-priority task holds mutex blocking high-priority task; medium-priority task preempts | Priority Inheritance Protocol (PIP) |
| Stack Overflow | Unbounded recursion exceeds fixed task stack | Stack canaries, MPU guard pages, iterative algorithms |
| Race Condition | Shared counter read-modify-write without synchronisation | Mutex-protected critical section |
| Timer Integer Overflow | `uint8_t` tick counter wraps at 255, breaking elapsed-time checks | Use `uint32_t`; unsigned subtraction handles wrap-around correctly |

---

## Concepts Covered

- Task model: period (T), WCET (C), deadline (D)
- Hyperperiod = LCM of all task periods
- CPU utilisation and schedulability
- Preemption and context switching
- Priority levels and dynamic vs. static priority
- Worst-case response time (WCRT)
- Interference, blocking, slack
- Stack canaries and Memory Protection Units (MPU)
- Mutex vs. binary semaphore
- Priority Inheritance Protocol (PIP)
- CWE-121, CWE-190, CWE-362, CWE-833

---

## References

- Liu, C. L. & Layland, J. W. (1973). *Scheduling algorithms for multiprogramming in a hard-real-time environment.* JACM 20(1).
- Lehoczky, J., Sha, L. & Ding, Y. (1989). *The rate monotonic scheduling algorithm: exact characterization and average case behaviour.* RTSS.
- Sha, L., Rajkumar, R. & Lehoczky, J. (1990). *Priority inheritance protocols: an approach to real-time synchronization.* IEEE Trans. Computers 39(9).
- Jones, M. B. (1997). *What really happened on Mars?* — Microsoft Research (Mars Pathfinder priority inversion).

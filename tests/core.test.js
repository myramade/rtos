/**
 * core.test.js — Unit tests for RTOS core algorithms
 * Run with:  node tests/core.test.js
 */

'use strict';

const RTOSCore = require('../js/core');
const {
  gcd, lcm, computeHyperperiod, computeUtilization, rmsSchedulabilityBound,
  simulateRMS, simulateEDF, computeResponseTime, computeWCETInterference,
  simulatePriorityInversion, simulateStackOverflow, simulateRaceCondition,
} = RTOSCore;

// ─── tiny test harness ───────────────────────────────────────
let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    console.log(`  ✓  ${msg}`);
    passed++;
  } else {
    console.error(`  ✗  ${msg}`);
    failed++;
  }
}

function approxEq(a, b, tol = 0.001) {
  return Math.abs(a - b) <= tol;
}

// ─── gcd / lcm ───────────────────────────────────────────────
console.log('\n── gcd ──────────────────────────────────────────────────');
assert(gcd(12, 8) === 4,  'gcd(12, 8) = 4');
assert(gcd(7,  3) === 1,  'gcd(7,  3) = 1');
assert(gcd(10, 5) === 5,  'gcd(10, 5) = 5');
assert(gcd(0,  6) === 6,  'gcd(0,  6) = 6');

console.log('\n── lcm ──────────────────────────────────────────────────');
assert(lcm(4, 6)   === 12, 'lcm(4, 6)   = 12');
assert(lcm(3, 5)   === 15, 'lcm(3, 5)   = 15');
assert(lcm(6, 12)  === 12, 'lcm(6, 12)  = 12');

// ─── hyperperiod ─────────────────────────────────────────────
console.log('\n── computeHyperperiod ───────────────────────────────────');
const tasksHP = [
  { id: 'T1', period: 4,  wcet: 1 },
  { id: 'T2', period: 6,  wcet: 1 },
  { id: 'T3', period: 12, wcet: 1 },
];
assert(computeHyperperiod(tasksHP) === 12, 'hyperperiod of [4,6,12] = 12');
assert(computeHyperperiod([])       === 0,  'hyperperiod of [] = 0');

// ─── utilization ─────────────────────────────────────────────
console.log('\n── computeUtilization ───────────────────────────────────');
const tasksU = [
  { id: 'T1', period: 4, wcet: 1 },
  { id: 'T2', period: 6, wcet: 2 },
];
const expectedU = 1/4 + 2/6;
assert(approxEq(computeUtilization(tasksU), expectedU), `util ≈ ${expectedU.toFixed(4)}`);
assert(approxEq(computeUtilization([]), 0), 'util of [] = 0');

// ─── RMS schedulability bound ────────────────────────────────
console.log('\n── rmsSchedulabilityBound ───────────────────────────────');
assert(approxEq(rmsSchedulabilityBound(1), 1.0),    'bound(1) ≈ 1.000');
assert(approxEq(rmsSchedulabilityBound(2), 0.8284,  0.001), 'bound(2) ≈ 0.828');
assert(approxEq(rmsSchedulabilityBound(3), 0.7798,  0.001), 'bound(3) ≈ 0.780');

// ─── simulateRMS ─────────────────────────────────────────────
console.log('\n── simulateRMS ──────────────────────────────────────────');
const rmsTaskSet = [
  { id: 'T1', name: 'Task 1', period: 4, wcet: 1 },
  { id: 'T2', name: 'Task 2', period: 6, wcet: 2 },
];
const rmsHP = computeHyperperiod(rmsTaskSet); // 12

const rms = simulateRMS(rmsTaskSet, rmsHP);
assert(Array.isArray(rms.timeline),            'timeline is an array');
assert(rms.timeline.length === rmsHP,          `timeline length = ${rmsHP}`);
assert(rms.timeline[0] === 'T1',               'T1 runs at t=0 (highest priority)');
assert(rms.deadlineMisses.length === 0,        'no deadline misses (schedulable set)');

// Edge: empty tasks
const rmsEmpty = simulateRMS([], 12);
assert(rmsEmpty.timeline.length === 0,         'empty tasks → empty timeline');

// ─── simulateEDF ─────────────────────────────────────────────
console.log('\n── simulateEDF ──────────────────────────────────────────');
const edfTaskSet = [
  { id: 'T1', name: 'Task 1', period: 4, wcet: 1 },
  { id: 'T2', name: 'Task 2', period: 6, wcet: 2 },
];
const edf = simulateEDF(edfTaskSet, rmsHP);
assert(Array.isArray(edf.timeline),            'EDF timeline is an array');
assert(edf.timeline.length === rmsHP,          `EDF timeline length = ${rmsHP}`);
assert(edf.timeline[0] === 'T1',               'T1 runs at t=0 (deadline 4 < 6)');
assert(edf.deadlineMisses.length === 0,        'no EDF deadline misses');

// ─── computeResponseTime ─────────────────────────────────────
console.log('\n── computeResponseTime ──────────────────────────────────');
const rtaTasks = [
  { id: 'T1', name: 'T1', period: 20, wcet: 1 },
  { id: 'T2', name: 'T2', period: 5,  wcet: 1 },
  { id: 'T3', name: 'T3', period: 10, wcet: 2 },
];
const rta = computeResponseTime(rtaTasks);
assert(rta.length === 3,             '3 results for 3 tasks');
// T2 has shortest period → priority 1, R = 1
const rtaByPrio = rta.sort((a, b) => a.priority - b.priority);
assert(rtaByPrio[0].id === 'T2',     'T2 is highest priority (period=5)');
assert(rtaByPrio[0].responseTime === 1, 'T2 response time = 1 (no interference)');
assert(rtaByPrio[0].feasible,        'T2 is feasible');

// ─── computeWCETInterference ─────────────────────────────────
console.log('\n── computeWCETInterference ──────────────────────────────');
const wcetTasks = [
  { id: 'T1', name: 'T1', period: 20, wcet: 2 },
  { id: 'T2', name: 'T2', period: 5,  wcet: 1 },
];
const wcet = computeWCETInterference(wcetTasks);
assert(wcet.length === 2,                           '2 results');
// T2 has shortest period → priority 1 (highest)
const wcetSorted = wcet.sort((a, b) => a.priority - b.priority);
assert(wcetSorted[0].id === 'T2',                   'T2 is highest priority');
assert(wcetSorted[0].totalInterference === 0,       'highest-priority task: no interference');
assert(wcetSorted[1].totalInterference > 0,         'T1 suffers interference from T2');

// ─── Security simulations (smoke tests) ──────────────────────
console.log('\n── simulatePriorityInversion ────────────────────────────');
const piVuln  = simulatePriorityInversion(false);
const piFix   = simulatePriorityInversion(true);
assert(Array.isArray(piVuln) && piVuln.length > 0, 'vulnerable scenario returns events');
assert(Array.isArray(piFix)  && piFix.length > 0,  'PIP scenario returns events');
assert(piVuln.some(e => e.severity === 'danger'),   'vulnerable: has danger events');
assert(piFix.every(e => e.severity !== 'danger'),   'PIP fix: no danger events');

console.log('\n── simulateStackOverflow ────────────────────────────────');
const soVuln  = simulateStackOverflow(false);
const soFixed = simulateStackOverflow(true);
assert(soVuln.vulnerable  === true,  'without canary: vulnerable');
assert(soFixed.vulnerable === false, 'with canary: not vulnerable');
assert(soVuln.frames.some(f  => f.status === 'overflow'),  'vulnerable: overflow frame');
assert(soFixed.frames.some(f => f.status === 'detected'),  'canary: detected frame');
assert(!soFixed.frames.some(f => f.status === 'corrupted'),'canary: no corrupted frame');

console.log('\n── simulateRaceCondition ────────────────────────────────');
const rcVuln  = simulateRaceCondition(false);
const rcFixed = simulateRaceCondition(true);
assert(rcVuln.some(e  => e.severity === 'danger'),  'race condition: has danger events');
assert(!rcFixed.some(e => e.severity === 'danger'), 'mutex fix: no danger events');

// ─── Summary ─────────────────────────────────────────────────
console.log(`\n${'═'.repeat(54)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

import { suggestCommands, ensureCommandIntelligenceDatabase } from '../dist/command-intelligence.js';

await ensureCommandIntelligenceDatabase();
const cwd = process.cwd();

// Cold start (first call - reads from disk)
const t0 = performance.now();
const r0 = await suggestCommands('git sta', cwd, 7);
const cold = (performance.now() - t0).toFixed(1);

// Cached calls (simulating rapid typing like a user)
const queries = ['doc', 'dock', 'docke', 'docker', 'docker ', 'docker c', 'docker co', 'docker com', 'docker comp'];
const times = [];
for (const q of queries) {
  const t = performance.now();
  await suggestCommands(q, cwd, 7);
  times.push((performance.now() - t).toFixed(1));
}

// Burst test - 20 rapid calls (simulates fast typist with no debounce)
const burstStart = performance.now();
for (let i = 0; i < 20; i++) {
  await suggestCommands('npm run ' + 'build'.slice(0, i % 5 + 1), cwd, 7);
}
const burstTotal = (performance.now() - burstStart).toFixed(1);
const burstAvg = (parseFloat(burstTotal) / 20).toFixed(1);

console.log('=== YamX Suggestion Performance Benchmark ===');
console.log('');
console.log(`Cold start (first call, disk read):  ${cold}ms`);
console.log(`Cold result: ${r0[0]?.command} (${r0.length} results)`);
console.log('');
console.log('Cached keystroke simulation (typing "docker comp"):');
queries.forEach((q, i) => console.log(`  "${q.padEnd(12)}" -> ${times[i].padStart(5)}ms`));
console.log('');
console.log('Burst test (20 rapid calls, no debounce):');
console.log(`  Total:   ${burstTotal}ms`);
console.log(`  Average: ${burstAvg}ms per call`);
console.log('');

const maxCached = Math.max(...times.map(Number));
if (maxCached < 5) {
  console.log('✅ VERDICT: Suggestions are fast (< 5ms cached). No lag.');
} else if (maxCached < 15) {
  console.log('⚠️  VERDICT: Suggestions are acceptable (< 15ms cached). Minor delay possible.');
} else {
  console.log('❌ VERDICT: Suggestions may feel laggy (> 15ms cached).');
}

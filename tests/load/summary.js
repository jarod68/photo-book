// @ts-check
'use strict';
/**
 * The load test's results as a Markdown table (the CI run's summary page):
 * response times per kind of request against their budget, errors, checks,
 * throughput, and the server's peak memory against its ceiling.
 *
 *   node tests/load/summary.js <k6 --summary-export file> [peak RSS in MB] [ceiling in MB]
 *
 * In the export (k6's legacy format) a threshold `true` means crossed.
 */
const fs = require('fs');

const [file, peakMb, ceilingMb] = process.argv.slice(2);
const { metrics } = JSON.parse(fs.readFileSync(file, 'utf8'));
const ms = (v) => (v === undefined ? '—' : `${v < 10 ? v.toFixed(1) : Math.round(v)} ms`);
const verdict = (m) => (Object.values(m?.thresholds ?? {}).some(Boolean) ? '❌' : '✅');
const budget = (m) => Object.keys(m?.thresholds ?? {}).join(', ') || '—';

const rows = [['page', 'Pages (HTML, JS, CSS)'], ['api', 'API (JSON)'], ['image', 'Images'], ['write', 'Views, likes']]
  .map(([kind, label]) => {
    const m = metrics[`http_req_duration{kind:${kind}}`];
    return m && `| ${label} | ${ms(m.med)} | ${ms(m['p(95)'])} | ${ms(m['p(99)'])} | ${ms(m.max)} | ${budget(m)} | ${verdict(m)} |`;
  }).filter(Boolean);

const failed = metrics.http_req_failed, checks = metrics.checks, reqs = metrics.http_reqs;
const lines = [
  '## Load test',
  '',
  '| Requests | median | p95 | p99 | max | budget | |',
  '|---|---|---|---|---|---|---|',
  ...rows,
  '',
  `- **Errors**: ${(failed.value * 100).toFixed(2)} % (budget < 1 %) ${verdict(failed)}`,
  `- **Checks**: ${checks.passes} passed, ${checks.fails} failed ${verdict(checks)}`,
  `- **Throughput**: ${Math.round(reqs.count)} requests, ${reqs.rate.toFixed(0)} per second; up to ${metrics.vus_max?.max ?? metrics.vus_max?.value ?? '?'} visitors at once`,
];
if (peakMb) {
  const ok = !ceilingMb || Number(peakMb) < Number(ceilingMb);
  lines.push(`- **Server memory**: ${peakMb} MB at the peak${ceilingMb ? ` (ceiling ${ceilingMb} MB; prod limit 1 GiB)` : ''} ${ok ? '✅' : '❌'}`);
}
process.stdout.write(`${lines.join('\n')}\n`);

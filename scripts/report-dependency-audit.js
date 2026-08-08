#!/usr/bin/env node
/**
 * CI report step for the `dependency-audit` workflow: reads the `pnpm audit`
 * and `pnpm peers check` output already captured to disk by the workflow, and
 * when either command found issues, appends a markdown report to the GitHub
 * Actions job summary. Never exits non-zero: this script only produces
 * output, it never gates the job (that's the point of this workflow).
 *
 * Env vars (all required, set by `.github/workflows/dependency-audit.yml`):
 *   AUDIT_EXIT_CODE     exit code of `pnpm audit --json`
 *   PEERS_EXIT_CODE     exit code of `pnpm peers check`
 *   AUDIT_JSON_PATH     path to captured `pnpm audit --json` stdout
 *   AUDIT_STDERR_PATH   path to captured `pnpm audit --json` stderr
 *   PEERS_TXT_PATH      path to captured `pnpm peers check` combined output
 *   GITHUB_STEP_SUMMARY path GitHub Actions provides for the job summary
 */
import { appendFileSync, readFileSync } from 'node:fs';

const auditExitCode = Number(process.env.AUDIT_EXIT_CODE ?? '0');
const peersExitCode = Number(process.env.PEERS_EXIT_CODE ?? '0');
const auditJsonPath = process.env.AUDIT_JSON_PATH;
const auditStderrPath = process.env.AUDIT_STDERR_PATH;
const peersTxtPath = process.env.PEERS_TXT_PATH;
const summaryPath = process.env.GITHUB_STEP_SUMMARY;

if (auditExitCode === 0 && peersExitCode === 0) {
  console.log('pnpm audit and pnpm peers check found no issues.');
  process.exit(0);
}

function readSafe(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

const sections = ['## Dependency audit report', ''];

if (auditExitCode !== 0) {
  sections.push('### `pnpm audit`', '');
  const raw = readSafe(auditJsonPath);
  let parsed;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }

  if (parsed?.metadata?.vulnerabilities) {
    const counts = parsed.metadata.vulnerabilities;
    sections.push('| Severity | Count |', '| --- | --- |');
    for (const [severity, count] of Object.entries(counts)) {
      if (count > 0) sections.push(`| ${severity} | ${count} |`);
    }
    sections.push('');

    const advisories = Object.values(parsed.advisories ?? {});
    if (advisories.length > 0) {
      sections.push('| Severity | Package | Advisory | URL |', '| --- | --- | --- | --- |');
      for (const a of advisories) {
        const severity = a.severity ?? 'unknown';
        const pkg = a.module_name ?? a.name ?? 'unknown';
        const title = a.title ?? a.id ?? 'unknown';
        const url = a.url ?? '';
        sections.push(`| ${severity} | ${pkg} | ${title} | ${url} |`);
      }
      sections.push('');
    }
  } else {
    sections.push(
      `\`pnpm audit\` exited with code ${auditExitCode} and produced output that could not be parsed as JSON. Raw output:`,
      '',
      '```',
      raw || '(empty)',
      '```',
      ''
    );
    const stderr = readSafe(auditStderrPath);
    if (stderr.trim()) {
      sections.push('stderr:', '', '```', stderr, '```', '');
    }
  }
}

if (peersExitCode !== 0) {
  sections.push('### `pnpm peers check`', '', '```', readSafe(peersTxtPath) || '(empty)', '```', '');
}

if (summaryPath) {
  appendFileSync(summaryPath, sections.join('\n') + '\n');
} else {
  process.stdout.write(sections.join('\n') + '\n');
}
console.log('Dependency issues detected; report appended to the job summary.');

import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import {
  failed,
  ok,
  ScannerContext,
  ScannerFinding,
  ScannerResult,
} from './scanner-base';
import type { AutoScanCategory, AutoScanSeverity } from '@cs-platform/shared';

/**
 * Nuclei scanner — open-source CVE/misconfig template scanner from
 * ProjectDiscovery. Spawned as a subprocess; we parse the JSONL output.
 *
 * If the binary is missing (e.g. local dev without `nuclei` installed),
 * the scanner returns `outcome=failed` with a clear message — the
 * orchestrator survives.
 */
@Injectable()
export class NucleiScanner {
  private readonly logger = new Logger(NucleiScanner.name);
  private readonly SOURCE = 'nuclei' as const;

  async scan(ctx: ScannerContext): Promise<ScannerResult> {
    const started = Date.now();
    try {
      const findings: ScannerFinding[] = [];

      const lines = await runNuclei(ctx.target.url, ctx.timeoutMs);
      let parsed = 0;
      for (const line of lines) {
        const result = parseNucleiLine(line);
        if (!result) continue;
        parsed++;
        findings.push(result);
      }

      this.logger.debug(`nuclei produced ${parsed} findings (raw lines: ${lines.length})`);
      return ok(this.SOURCE, findings, started, { rawLines: lines.length });
    } catch (err) {
      return failed(this.SOURCE, err, started);
    }
  }
}

function runNuclei(url: string, timeoutMs: number): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const args = [
      '-u', url,
      '-severity', 'critical,high,medium,low',
      '-jsonl',
      '-timeout', '5',
      '-rate-limit', '50',
      '-no-color',
      '-silent',
      '-disable-update-check',
    ];
    // Templates dir if env var is present (set by Dockerfile)
    if (process.env.NUCLEI_TEMPLATES_DIR) {
      args.push('-t', process.env.NUCLEI_TEMPLATES_DIR);
    }

    let proc;
    try {
      proc = spawn('nuclei', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      reject(err);
      return;
    }

    const lines: string[] = [];
    let buf = '';
    let stderrBuf = '';
    let killed = false;

    const to = setTimeout(() => {
      killed = true;
      try {
        proc.kill('SIGTERM');
        setTimeout(() => proc.kill('SIGKILL'), 5000);
      } catch {
        // ignore
      }
    }, timeoutMs);

    proc.stdout?.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      const parts = buf.split('\n');
      buf = parts.pop() ?? '';
      for (const line of parts) {
        const trimmed = line.trim();
        if (trimmed) lines.push(trimmed);
      }
    });
    proc.stderr?.on('data', (chunk: Buffer) => {
      const s = chunk.toString('utf8');
      if (stderrBuf.length < 4000) stderrBuf += s;
    });
    proc.once('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(to);
      if (err.code === 'ENOENT') {
        reject(new Error('nuclei binary not found on PATH'));
      } else {
        reject(err);
      }
    });
    proc.once('close', () => {
      clearTimeout(to);
      if (buf.trim()) lines.push(buf.trim());
      if (killed) {
        // Treat timeout as partial success — return what we have.
        resolve(lines);
      } else {
        resolve(lines);
      }
    });
  });
}

interface NucleiOutput {
  'template-id'?: string;
  template?: string;
  type?: string;
  host?: string;
  matched_at?: string;
  'matched-at'?: string;
  info?: {
    name?: string;
    severity?: string;
    description?: string;
    remediation?: string;
    classification?: {
      'cve-id'?: string[] | string;
      'cwe-id'?: string[] | string;
      'cvss-metrics'?: string;
      'cvss-score'?: number;
    };
    reference?: string[] | string;
    tags?: string[] | string;
  };
  'curl-command'?: string;
  'extracted-results'?: string[];
}

function parseNucleiLine(line: string): ScannerFinding | null {
  let obj: NucleiOutput;
  try {
    obj = JSON.parse(line) as NucleiOutput;
  } catch {
    return null;
  }
  if (!obj || !obj.info) return null;

  const sev = mapSeverity(obj.info.severity);
  if (!sev) return null;

  const cveIds = toArray(obj.info.classification?.['cve-id']);
  const tags = toArray(obj.info.tags);
  const refs = toArray(obj.info.reference);

  const category: AutoScanCategory = cveIds.length > 0
    ? 'cve'
    : tags.includes('exposure') || tags.includes('files') || tags.includes('panel')
      ? 'exposure'
      : tags.includes('default-login')
        ? 'misconfig'
        : 'misconfig';

  const matched = obj['matched-at'] ?? obj.matched_at ?? obj.host ?? '';
  const title = obj.info.name ?? obj['template-id'] ?? 'Nuclei finding';

  return {
    source: 'nuclei',
    severity: sev,
    category,
    title: cveIds.length > 0 ? `${title} (${cveIds.join(', ')})` : title,
    description: obj.info.description ?? null,
    evidence: {
      templateId: obj['template-id'],
      matchedAt: matched,
      tags,
      cves: cveIds,
      cvssScore: obj.info.classification?.['cvss-score'],
      extracted: obj['extracted-results']?.slice(0, 5),
    },
    remediation: obj.info.remediation ?? null,
    referenceUrls: refs.slice(0, 8),
  };
}

function mapSeverity(s?: string): AutoScanSeverity | null {
  if (!s) return null;
  const v = s.toLowerCase();
  if (v === 'critical' || v === 'high' || v === 'medium' || v === 'low' || v === 'info') {
    return v;
  }
  if (v === 'unknown') return 'info';
  return null;
}

function toArray(v: string[] | string | undefined): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  return v.split(',').map((s) => s.trim()).filter(Boolean);
}

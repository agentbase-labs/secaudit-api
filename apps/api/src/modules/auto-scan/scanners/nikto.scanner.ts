import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  failed,
  ok,
  ScannerContext,
  ScannerFinding,
  ScannerResult,
} from './scanner-base';
import type { AutoScanSeverity } from '@cs-platform/shared';

/**
 * Nikto scanner — classic webserver scanner. Optional: Nuclei covers most
 * of the same ground with better template hygiene. We run it but treat
 * a missing binary or partial timeout as a soft-failure.
 */
@Injectable()
export class NiktoScanner {
  private readonly logger = new Logger(NiktoScanner.name);
  private readonly SOURCE = 'nikto' as const;

  async scan(ctx: ScannerContext): Promise<ScannerResult> {
    const started = Date.now();
    const tmpFile = path.join(
      os.tmpdir(),
      `nikto-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
    );
    try {
      await runNikto(ctx.target.url, tmpFile, ctx.timeoutMs);
      let raw: string;
      try {
        raw = await fs.readFile(tmpFile, 'utf8');
      } catch {
        return ok(this.SOURCE, [], started, { error: 'no nikto output file' });
      }
      const findings = parseNiktoOutput(raw);
      return ok(this.SOURCE, findings, started, { vulnCount: findings.length });
    } catch (err) {
      return failed(this.SOURCE, err, started);
    } finally {
      // best-effort cleanup
      fs.unlink(tmpFile).catch(() => undefined);
    }
  }
}

function runNikto(url: string, outFile: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      '-h', url,
      '-Format', 'json',
      '-output', outFile,
      '-Tuning', 'x', // exclude DOS / aggressive checks
      '-nointeractive',
      '-maxtime', String(Math.floor(timeoutMs / 1000) - 5),
    ];
    let proc;
    try {
      proc = spawn('nikto', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      reject(err);
      return;
    }
    const to = setTimeout(() => {
      try { proc.kill('SIGTERM'); } catch { /* ignore */ }
      setTimeout(() => { try { proc.kill('SIGKILL'); } catch { /* ignore */ } }, 5000);
    }, timeoutMs);
    proc.once('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(to);
      if (err.code === 'ENOENT') reject(new Error('nikto binary not found on PATH'));
      else reject(err);
    });
    proc.once('close', () => {
      clearTimeout(to);
      resolve();
    });
    // we don't pipe stdout/stderr — nikto writes JSON to outFile
  });
}

interface NiktoVuln {
  id?: string;
  msg?: string;
  url?: string;
  method?: string;
  references?: string;
  OSVDB?: string;
}

interface NiktoReport {
  vulnerabilities?: NiktoVuln[];
  // older formats nest inside `host[0].vulnerabilities`
  host?: Array<{ vulnerabilities?: NiktoVuln[] }>;
}

function parseNiktoOutput(raw: string): ScannerFinding[] {
  let parsed: NiktoReport | NiktoReport[];
  try {
    parsed = JSON.parse(raw) as NiktoReport;
  } catch {
    return [];
  }
  const reports: NiktoReport[] = Array.isArray(parsed) ? parsed : [parsed];
  const out: ScannerFinding[] = [];
  for (const report of reports) {
    const vulns = report.vulnerabilities ?? report.host?.[0]?.vulnerabilities ?? [];
    for (const v of vulns) {
      const sev = guessSeverity(v.msg ?? '');
      out.push({
        source: 'nikto',
        severity: sev,
        category: 'misconfig',
        title: (v.msg ?? 'Nikto finding').slice(0, 240),
        description: v.msg ?? null,
        evidence: { id: v.id, url: v.url, method: v.method, osvdb: v.OSVDB },
        referenceUrls: v.references
          ? v.references.split(/\s+/).filter((u) => /^https?:\/\//.test(u))
          : [],
      });
    }
  }
  return out;
}

function guessSeverity(msg: string): AutoScanSeverity {
  const low = msg.toLowerCase();
  if (/(remote code execution|sql injection|directory traversal|disclosed)/.test(low)) return 'high';
  if (/(missing|outdated|deprecated|disabled|vulnerable)/.test(low)) return 'medium';
  if (/(default page|server header|allowed http methods)/.test(low)) return 'low';
  return 'info';
}

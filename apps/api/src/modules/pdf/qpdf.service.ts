import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { AppConfigService } from '../../config/config.service';

const PDF_MAGIC = Buffer.from('%PDF-', 'ascii');

/**
 * Server-side PDF encryption via the `qpdf` system binary.
 *
 * Boot-time health check: runs `qpdf --version`. On missing binary the app
 * fails fast (per locked decision: qpdf is a runtime system dep).
 */
@Injectable()
export class QpdfService implements OnApplicationBootstrap {
  private readonly logger = new Logger(QpdfService.name);

  constructor(private readonly cfg: AppConfigService) {}

  async onApplicationBootstrap(): Promise<void> {
    const qpdf = this.cfg.get('QPDF_BINARY');
    try {
      const version = await this.runCapture(qpdf, ['--version']);
      const firstLine = version.split('\n')[0]?.trim() ?? version.trim();
      this.logger.log(`qpdf binary OK: ${firstLine}`);
    } catch (e) {
      const msg = `qpdf binary not callable at "${qpdf}": ${(e as Error).message}. Install qpdf (Debian: apt-get install qpdf, macOS: brew install qpdf).`;
      this.logger.error(msg);
      throw new Error(msg);
    }
  }

  /**
   * Returns true if the buffer starts with the PDF magic header.
   * Use as a content-type sanity check before invoking qpdf.
   */
  static isPdfBuffer(buf: Buffer): boolean {
    if (!buf || buf.length < PDF_MAGIC.length) return false;
    return buf.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC);
  }

  /**
   * Encrypt a PDF buffer with `qpdf --encrypt <pw> <pw> 256` (AES-256).
   * Owner password = user password (we don't differentiate; both lock the doc).
   *
   * Throws if qpdf is missing, the input is not a PDF, or qpdf exits non-zero
   * (exit 3 = warnings, treated as success per qpdf semantics).
   */
  async encryptPdf(input: Buffer, password: string): Promise<Buffer> {
    if (!QpdfService.isPdfBuffer(input)) {
      throw new Error('encryptPdf: input is not a PDF (missing %PDF- magic)');
    }
    if (!password || password.length === 0) {
      throw new Error('encryptPdf: password must be non-empty');
    }
    const qpdf = this.cfg.get('QPDF_BINARY');
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qpdf-'));
    const inputPath = path.join(tmpDir, `${randomUUID()}.in.pdf`);
    const outputPath = path.join(tmpDir, `${randomUUID()}.out.pdf`);
    try {
      await fs.writeFile(inputPath, input);
      await this.run(qpdf, [
        '--encrypt',
        password,
        password,
        '256',
        '--',
        inputPath,
        outputPath,
      ]);
      return await fs.readFile(outputPath);
    } finally {
      // Clean up regardless of success/failure.
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private run(cmd: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      proc.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
      proc.on('error', reject);
      proc.on('close', (code) => {
        // qpdf: exit 0 = OK, 3 = warnings (still produces a valid file)
        if (code === 0 || code === 3) {
          resolve();
        } else {
          this.logger.error(`qpdf exit=${code}: ${stderr}`);
          reject(new Error(`qpdf failed (${code}): ${stderr || 'no stderr'}`));
        }
      });
    });
  }

  private runCapture(cmd: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', (c: Buffer) => (stdout += c.toString()));
      proc.stderr.on('data', (c: Buffer) => (stderr += c.toString()));
      proc.on('error', reject);
      proc.on('close', (code) => {
        if (code === 0) resolve(stdout);
        else reject(new Error(`exit ${code}: ${stderr || stdout}`));
      });
    });
  }
}

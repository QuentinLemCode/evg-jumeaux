/**
 * Running one script at a time, and only one (spec 0012, rule 10).
 *
 * `pipeline.sh` resets the checkout to `origin/main` and works in it. Two of
 * them at once would fight over the same working tree, so the lock is not a
 * nicety — and a second request is REFUSED rather than queued, because on a
 * phone an answer that never comes is worse than a no.
 */
import { spawn } from 'node:child_process';

export type Job = { what: string; startedAt: number };

export type JobResult = { ok: boolean; output: string };

/** Enough to diagnose, bounded so a runaway script cannot exhaust memory. */
const MAX_OUTPUT = 200_000;

export class Runner {
  private current: Job | null = null;

  constructor(private readonly cwd: string) {}

  running(): Job | null {
    return this.current;
  }

  /**
   * `null` when something else is already running — the caller reports that,
   * it is not an error here.
   */
  async run(
    what: string,
    command: string,
    args: readonly string[],
    onProgress?: (tail: string) => void,
  ): Promise<JobResult | null> {
    if (this.current) return null;
    this.current = { what, startedAt: Date.now() };

    try {
      return await new Promise<JobResult>((resolve) => {
        const child = spawn(command, [...args], {
          cwd: this.cwd,
          // A job outlives the request that started it; nothing reads stdin.
          stdio: ['ignore', 'pipe', 'pipe'],
          env: process.env,
        });

        let output = '';
        let lastProgress = 0;
        const absorb = (chunk: Buffer) => {
          output += chunk.toString();
          if (output.length > MAX_OUTPUT) output = output.slice(output.length - MAX_OUTPUT);
          // Telegram rate-limits edits; one every three seconds is plenty for
          // a human watching a phone.
          const now = Date.now();
          if (onProgress && now - lastProgress > 3_000) {
            lastProgress = now;
            onProgress(output);
          }
        };

        child.stdout.on('data', absorb);
        child.stderr.on('data', absorb);

        child.on('error', (error) => {
          resolve({ ok: false, output: `${output}\n${String(error)}`.trim() });
        });
        child.on('close', (code) => {
          resolve({ ok: code === 0, output: output.trim() || `(aucune sortie, code ${code})` });
        });
      });
    } finally {
      this.current = null;
    }
  }
}

/** "depuis 4 min", for the refusal message. */
export function since(startedAt: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - startedAt) / 1000));
  if (seconds < 60) return `depuis ${seconds} s`;
  return `depuis ${Math.round(seconds / 60)} min`;
}

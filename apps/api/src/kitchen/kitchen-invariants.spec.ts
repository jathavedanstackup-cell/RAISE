import { describe, expect, it } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const SRC_ROOT = path.resolve(import.meta.dirname, '..');

async function sourceFiles(): Promise<string[]> {
  const found: string[] = [];
  async function walk(dir: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name === 'generated' || entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!entry.name.endsWith('.ts')) continue;
      if (entry.name.endsWith('.spec.ts') || entry.name.endsWith('.e2e-spec.ts')) continue;
      found.push(full);
    }
  }
  await walk(SRC_ROOT);
  return found;
}

/**
 * True only if a file WRITES the status -- it appears inside a Prisma `data:`
 * block rather than a `where:` read guard. Code that legitimately transitions
 * a visit out of a status has to name it in a WHERE clause; flagging that
 * would make the invariant fire on correct code, and an invariant that cries
 * wolf is one the next author weakens rather than heeds. (CP6's equivalent
 * test had exactly this false positive; same fix applied there.)
 */
function writesStatus(contents: string, status: string): boolean {
  const pattern = new RegExp(`status:\\s*['"]${status}['"]`, 'g');
  for (const match of contents.matchAll(pattern)) {
    const before = contents.slice(Math.max(0, match.index - 400), match.index);
    if (before.lastIndexOf('data:') > before.lastIndexOf('where:')) return true;
  }
  return new RegExp(`VisitStatus\\.${status}`).test(contents);
}

describe('CP8 kitchen display — static invariants', () => {
  /**
   * TRUST BOUNDARY, same family as CP5's `confirmed` and CP6's
   * `kitchen_started`: nothing may write `Visit.status = 'food_out'`
   * except KitchenService.markFoodOut, which is where the allergy gate
   * lives. A future checkpoint could otherwise add a second path to
   * food_out that skips the gate entirely without failing any behavioural
   * test in this suite.
   *
   * Proven red/green: temporarily adding `status: 'food_out'` to
   * visits.service.ts makes this fail, naming that file.
   */
  it("TRUST BOUNDARY: no source file other than kitchen.service.ts writes Visit.status = 'food_out'", async () => {
    const allowed = path.join(SRC_ROOT, 'kitchen', 'kitchen.service.ts');
    const offenders: string[] = [];

    for (const file of await sourceFiles()) {
      if (file === allowed) continue;
      const contents = await readFile(file, 'utf8');
      if (writesStatus(contents, 'food_out')) {
        offenders.push(path.relative(SRC_ROOT, file));
      }
    }

    expect(offenders).toEqual([]);
  });

  /**
   * THE SAFETY PROPERTY of docs/decisions.md's CP8 entry: acknowledging an
   * allergy flag records that a human looked. It must never change what is
   * displayed.
   *
   * This is static and deliberately blunt, because the failure it guards
   * against is a plausible, well-intentioned future edit: "the screen is
   * noisy during a rush, let's fade acknowledged flags." That edit passes
   * every behavioural test — the flags are still in the payload, the gate
   * still gates — and produces a ticket that looks clean at the exact
   * moment it is most dangerous.
   *
   * So: no server-side source file may make the reporting of allergy flags
   * conditional on acknowledgment state. If these two concepts appear in
   * the same expression, that is the smell.
   *
   * Proven red/green: rewriting kitchen.service.ts's `allergyFlags` mapping
   * to `visit.allergyAck ? [] : [...]` makes this fail.
   */
  it('NEVER DISMISS: no source file gates allergy-flag reporting on acknowledgment state', async () => {
    // A ternary, &&, or || whose condition mentions acknowledgment and whose
    // body mentions allergy flags (or vice versa) within the same expression.
    const suspicious = [
      /allergyAck\w*\s*\?[^;\n]*allergyFlags/i,
      /allergyFlags[^;\n]*\?[^;\n]*allergyAck/i,
      /allergyAck\w*\s*(&&|\|\|)[^;\n]*allergyFlags/i,
      /allergyFlags[^;\n]*(&&|\|\|)[^;\n]*allergyAck/i,
      /acknowledged\w*\s*\?[^;\n]*allergyFlags/i,
    ];

    const offenders: string[] = [];
    for (const file of await sourceFiles()) {
      const contents = await readFile(file, 'utf8');
      // Strip comments: this test's own prose, and the explanatory comments in
      // kitchen.service.ts, describe the forbidden pattern in order to warn
      // against it. Only real code counts.
      const code = contents.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      if (suspicious.some((pattern) => pattern.test(code))) {
        offenders.push(path.relative(SRC_ROOT, file));
      }
    }

    expect(
      offenders,
      'allergy flags must render identically before and after acknowledgment — see docs/decisions.md CP8',
    ).toEqual([]);
  });

  /**
   * The gate itself: markFoodOut must consult the acknowledgment. A future
   * refactor that drops the gate call would leave every other test passing
   * (the happy path has an acknowledgment anyway) while silently removing
   * the safety check.
   */
  it('markFoodOut consults the allergy gate before transitioning', async () => {
    const source = await readFile(path.join(SRC_ROOT, 'kitchen', 'kitchen.service.ts'), 'utf8');
    const body = /async markFoodOut\([\s\S]*?\n  \}/.exec(source);
    expect(body, 'could not locate markFoodOut — if it was renamed, update this invariant').not.toBeNull();
    expect(body![0]).toMatch(/foodOutGate\(/);
  });
});

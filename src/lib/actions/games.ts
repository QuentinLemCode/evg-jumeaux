'use server';

/**
 * Game catalog mutations (spec 0003). Admin only, re-checked here and not
 * merely hidden in the UI.
 */
import { eq, ne, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { db } from '@/db';
import { games } from '@/db/schema';
import { requireAdminAction } from '@/lib/auth/guards';
import {
  GAME_LIMITS,
  normaliseGameDefinition,
  slugify,
  validateGameDefinition,
} from '@/lib/domain/game-rules';

import { err, guarded, ok, type ActionResult } from './result';

const gameSchema = z.object({
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(280).optional(),
  icon: z.string().trim().min(1).max(8),
  mode: z.enum(['duel', 'team']),
  sidesCount: z.coerce
    .number()
    .int()
    .min(GAME_LIMITS.sidesCount.min)
    .max(GAME_LIMITS.sidesCount.max),
  playersPerSide: z.coerce
    .number()
    .int()
    .min(GAME_LIMITS.playersPerSide.min)
    .max(GAME_LIMITS.playersPerSide.max),
  pointsPerWin: z.coerce
    .number()
    .int()
    .min(GAME_LIMITS.pointsPerWin.min)
    .max(GAME_LIMITS.pointsPerWin.max),
  marginBonusEnabled: z.coerce.boolean(),
  marginBonusPerPoint: z.coerce.number().int().min(0).max(GAME_LIMITS.marginBonusPerPoint.max),
  // The form sends null for "no cap"; '' never reaches here.
  marginBonusCap: z.number().int().min(1).max(200).nullable().default(null),
  requiresScore: z.coerce.boolean(),
});

export type GameInput = z.input<typeof gameSchema>;

type ParsedGame =
  | { ok: false; message: string }
  | {
      ok: true;
      value: ReturnType<typeof normaliseGameDefinition>;
      description: string | null;
      icon: string;
    };

function parse(input: GameInput): ParsedGame {
  const parsed = gameSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'Formulaire invalide' };

  const errors = validateGameDefinition({
    name: parsed.data.name,
    mode: parsed.data.mode,
    sidesCount: parsed.data.sidesCount,
    playersPerSide: parsed.data.playersPerSide,
    pointsPerWin: parsed.data.pointsPerWin,
    marginBonusEnabled: parsed.data.marginBonusEnabled,
    marginBonusPerPoint: parsed.data.marginBonusPerPoint,
    marginBonusCap: parsed.data.marginBonusCap,
  });
  const first = errors[0];
  if (first) return { ok: false, message: first.message };

  return {
    ok: true,
    value: normaliseGameDefinition({
      name: parsed.data.name,
      mode: parsed.data.mode,
      sidesCount: parsed.data.sidesCount,
      playersPerSide: parsed.data.playersPerSide,
      pointsPerWin: parsed.data.pointsPerWin,
      marginBonusEnabled: parsed.data.marginBonusEnabled,
      marginBonusPerPoint: parsed.data.marginBonusPerPoint,
      marginBonusCap: parsed.data.marginBonusCap,
      requiresScore: parsed.data.requiresScore,
    }),
    description: parsed.data.description ?? null,
    icon: parsed.data.icon,
  };
}

export async function createGame(input: GameInput): Promise<ActionResult<{ gameId: string }>> {
  return guarded(async () => {
    const admin = await requireAdminAction();
    const parsed = parse(input);
    if (!parsed.ok) return err<{ gameId: string }>(parsed.message);

    const existing = await db
      .select({ id: games.id })
      .from(games)
      .where(sql`lower(${games.name}) = lower(${parsed.value.name})`)
      .limit(1);
    if (existing.length > 0) return err<{ gameId: string }>('Un jeu porte déjà ce nom');

    const now = Date.now();
    const id = crypto.randomUUID();
    let slug = slugify(parsed.value.name);
    if (slug.length === 0) slug = id.slice(0, 8);

    await db.insert(games).values({
      id,
      slug,
      name: parsed.value.name,
      description: parsed.description,
      icon: parsed.icon,
      mode: parsed.value.mode,
      sidesCount: parsed.value.sidesCount,
      playersPerSide: parsed.value.playersPerSide,
      pointsPerWin: parsed.value.pointsPerWin,
      marginBonusEnabled: parsed.value.marginBonusEnabled,
      marginBonusPerPoint: parsed.value.marginBonusPerPoint,
      marginBonusCap: parsed.value.marginBonusCap,
      requiresScore: parsed.value.requiresScore,
      isActive: true,
      createdBy: admin.id,
      createdAt: now,
      updatedAt: now,
    });

    revalidatePath('/games');
    revalidatePath('/admin/games');
    return ok({ gameId: id });
  });
}

export async function updateGame(
  gameId: string,
  input: GameInput,
): Promise<ActionResult> {
  return guarded(async () => {
    await requireAdminAction();
    const parsed = parse(input);
    if (!parsed.ok) return err(parsed.message);

    const clash = await db
      .select({ id: games.id })
      .from(games)
      .where(sql`lower(${games.name}) = lower(${parsed.value.name}) and ${ne(games.id, gameId)}`)
      .limit(1);
    if (clash.length > 0) return err('Un jeu porte déjà ce nom');

    // Only future matches are affected: matches already created keep the rules
    // they snapshotted (spec 0003, rule 5).
    const updated = await db
      .update(games)
      .set({
        name: parsed.value.name,
        description: parsed.description,
        icon: parsed.icon,
        mode: parsed.value.mode,
        sidesCount: parsed.value.sidesCount,
        playersPerSide: parsed.value.playersPerSide,
        pointsPerWin: parsed.value.pointsPerWin,
        marginBonusEnabled: parsed.value.marginBonusEnabled,
        marginBonusPerPoint: parsed.value.marginBonusPerPoint,
        marginBonusCap: parsed.value.marginBonusCap,
        requiresScore: parsed.value.requiresScore,
        updatedAt: Date.now(),
      })
      .where(eq(games.id, gameId))
      .returning({ id: games.id });

    if (updated.length === 0) return err('Ce jeu n’existe pas');

    revalidatePath('/games');
    revalidatePath('/admin/games');
    return ok();
  });
}

export async function setGameArchived(
  gameId: string,
  archived: boolean,
): Promise<ActionResult> {
  return guarded(async () => {
    await requireAdminAction();
    const updated = await db
      .update(games)
      .set({ isActive: !archived, updatedAt: Date.now() })
      .where(eq(games.id, gameId))
      .returning({ id: games.id });
    if (updated.length === 0) return err('Ce jeu n’existe pas');

    revalidatePath('/games');
    revalidatePath('/admin/games');
    return ok();
  });
}

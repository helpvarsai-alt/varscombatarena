import { v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";

/**
 * Anonymous, code-based matchmaking.
 *
 * Two players anywhere on the planet join the same 5-character code; each
 * pushes its own fighter snapshot ~10x/second and reads the opponent's from a
 * reactive query. Hit detection is attacker-authoritative: the attacker
 * emits compact hit events inside its snapshot, the defender applies them
 * (tracking the last applied sequence) so both screens agree without a
 * heavyweight server simulation.
 */

const ROOM_TTL_MS = 2 * 60 * 60 * 1000;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I

function makeCode(): string {
  let out = "";
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < 5; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

async function cleanupStale(ctx: MutationCtx) {
  const cutoff = Date.now() - ROOM_TTL_MS;
  const stale = await ctx.db
    .query("rooms")
    .withIndex("by_created", (q) => q.lt("createdAt", cutoff))
    .take(20);
  for (const room of stale) await ctx.db.delete(room._id);
}

export const createRoom = mutation({
  args: {
    playerId: v.string(),
    name: v.string(),
    char: v.string(),
  },
  handler: async (ctx, { playerId, name, char }) => {
    await cleanupStale(ctx);
    for (let attempt = 0; attempt < 6; attempt++) {
      const code = makeCode();
      const existing = await ctx.db
        .query("rooms")
        .withIndex("by_code", (q) => q.eq("code", code))
        .unique();
      if (existing) continue;
      const id = await ctx.db.insert("rooms", {
        code,
        hostId: playerId,
        hostName: name.slice(0, 20) || "Fighter",
        hostChar: char,
        status: "waiting",
        createdAt: Date.now(),
      });
      return { code, id };
    }
    throw new Error("Could not allocate a room code, try again.");
  },
});

async function getRoomByCode(ctx: MutationCtx, code: string) {
  const room = await ctx.db
    .query("rooms")
    .withIndex("by_code", (q) => q.eq("code", code.toUpperCase().trim()))
    .unique();
  if (!room) throw new Error("Room not found. Check the code and try again.");
  return room;
}

export const joinRoom = mutation({
  args: {
    code: v.string(),
    playerId: v.string(),
    name: v.string(),
    char: v.string(),
  },
  handler: async (ctx, { code, playerId, name, char }) => {
    const room = await getRoomByCode(ctx, code);
    if (room.hostId === playerId) return { code: room.code, role: "host" as const };
    if (room.guestId && room.guestId !== playerId) {
      if (room.status === "finished") throw new Error("This match already ended.");
      throw new Error("This room is full.");
    }
    await ctx.db.patch(room._id, {
      guestId: playerId,
      guestName: name.slice(0, 20) || "Fighter",
      guestChar: char,
    });
    return { code: room.code, role: "guest" as const };
  },
});

export const setCharacter = mutation({
  args: { code: v.string(), playerId: v.string(), char: v.string() },
  handler: async (ctx, { code, playerId, char }) => {
    const room = await getRoomByCode(ctx, code);
    if (room.status !== "waiting") return;
    if (room.hostId === playerId) await ctx.db.patch(room._id, { hostChar: char });
    else if (room.guestId === playerId) await ctx.db.patch(room._id, { guestChar: char });
  },
});

export const startMatch = mutation({
  args: { code: v.string(), playerId: v.string() },
  handler: async (ctx, { code, playerId }) => {
    const room = await getRoomByCode(ctx, code);
    if (room.hostId !== playerId) throw new Error("Only the host can start the match.");
    if (!room.guestId) throw new Error("Waiting for an opponent to join.");
    if (room.status !== "waiting") return;
    await ctx.db.patch(room._id, {
      status: "playing",
      startedAt: Date.now(),
      hostSnap: undefined,
      guestSnap: undefined,
    });
  },
});

/**
 * Publish my fighter state + any not-yet-acked hit events I generated.
 * Snap is a compact JSON string; the whole document is tiny (~200 bytes),
 * so a 10Hz stream per player stays cheap even across oceans.
 */
export const sendSnap = mutation({
  args: {
    code: v.string(),
    playerId: v.string(),
    snap: v.string(),
  },
  handler: async (ctx, { code, playerId, snap }) => {
    const room = await getRoomByCode(ctx, code);
    if (snap.length > 4000) throw new Error("Snapshot too large.");
    if (room.hostId === playerId) await ctx.db.patch(room._id, { hostSnap: snap });
    else if (room.guestId === playerId) await ctx.db.patch(room._id, { guestSnap: snap });
    else throw new Error("You are not in this room.");
  },
});

export const finishMatch = mutation({
  args: {
    code: v.string(),
    playerId: v.string(),
    winner: v.string(),
    reason: v.string(),
  },
  handler: async (ctx, { code, playerId, winner, reason }) => {
    const room = await getRoomByCode(ctx, code);
    if (room.status !== "playing") return;
    if (room.hostId !== playerId && room.guestId !== playerId)
      throw new Error("You are not in this room.");
    // Ties / timer: only the host decides, so both screens settle on one result.
    if (winner === "tie" && room.hostId !== playerId) return;
    await ctx.db.patch(room._id, {
      status: "finished",
      winner,
      endReason: reason,
      finishedAt: Date.now(),
    });
  },
});

export const leaveRoom = mutation({
  args: { code: v.string(), playerId: v.string() },
  handler: async (ctx, { code, playerId }) => {
    const room = await ctx.db
      .query("rooms")
      .withIndex("by_code", (q) => q.eq("code", code.toUpperCase().trim()))
      .unique();
    if (!room) return;
    if (room.hostId === playerId && !room.guestId) {
      await ctx.db.delete(room._id);
      return;
    }
    if (room.guestId === playerId && room.status !== "finished") {
      await ctx.db.patch(room._id, {
        status: "finished",
        winner: room.hostId,
        endReason: "opponent_left",
        finishedAt: Date.now(),
      });
      return;
    }
    if (room.hostId === playerId && room.status !== "finished") {
      await ctx.db.patch(room._id, {
        status: "finished",
        winner: room.guestId ?? "tie",
        endReason: "opponent_left",
        finishedAt: Date.now(),
      });
    }
  },
});

export const getRoom = query({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const room = await ctx.db
      .query("rooms")
      .withIndex("by_code", (q) => q.eq("code", code.toUpperCase().trim()))
      .unique();
    if (!room) return null;
    return {
      code: room.code,
      hostId: room.hostId,
      hostName: room.hostName,
      hostChar: room.hostChar,
      hostSnap: room.hostSnap,
      guestId: room.guestId,
      guestName: room.guestName,
      guestChar: room.guestChar,
      guestSnap: room.guestSnap,
      status: room.status,
      startedAt: room.startedAt,
      winner: room.winner,
      endReason: room.endReason,
    };
  },
});

import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { Infer, v } from "convex/values";

// default user roles. can add / remove based on the project as needed
export const ROLES = {
  ADMIN: "admin",
  USER: "user",
  MEMBER: "member",
} as const;

export const roleValidator = v.union(
  v.literal(ROLES.ADMIN),
  v.literal(ROLES.USER),
  v.literal(ROLES.MEMBER),
);
export type Role = Infer<typeof roleValidator>;

const schema = defineSchema(
  {
    // default auth tables using convex auth.
    ...authTables, // do not remove or modify

    // the users table is the default users table that is brought in by the authTables
    users: defineTable({
      name: v.optional(v.string()), // name of the user. do not remove
      image: v.optional(v.string()), // image of the user. do not remove
      email: v.optional(v.string()), // email of the user. do not remove
      emailVerificationTime: v.optional(v.number()), // email verification time. do not remove
      isAnonymous: v.optional(v.boolean()), // is the user anonymous. do not remove

      role: v.optional(roleValidator), // role of the user. do not remove
    }).index("email", ["email"]), // index for the email. do not remove or modify

    // add other tables here

    // tableName: defineTable({
    //   ...
    //   // table fields
    // }).index("by_field", ["field"])

    // Online match rooms. Players are anonymous (device id) — no sign-in.
    // Snapshots are compact JSON strings pushed at ~10Hz per player so the
    // reactive query streams opponent state across regions with low overhead.
    rooms: defineTable({
      code: v.string(),
      hostId: v.string(),
      hostName: v.string(),
      hostChar: v.string(),
      hostSnap: v.optional(v.string()),
      guestId: v.optional(v.string()),
      guestName: v.optional(v.string()),
      guestChar: v.optional(v.string()),
      guestSnap: v.optional(v.string()),
      status: v.union(
        v.literal("waiting"),
        v.literal("playing"),
        v.literal("finished"),
      ),
      startedAt: v.optional(v.number()),
      winner: v.optional(v.string()),
      endReason: v.optional(v.string()),
      createdAt: v.number(),
      finishedAt: v.optional(v.number()),
    })
      .index("by_code", ["code"])
      .index("by_created", ["createdAt"]),
  },
  {
    schemaValidation: false,
  },
);

export default schema;

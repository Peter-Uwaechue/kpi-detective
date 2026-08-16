import { boolean, int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const leadershipProfiles = mysqlTable("leadership_profiles", {
  id: int("id").autoincrement().primaryKey(),
  slug: varchar("slug", { length: 140 }).notNull().unique(),
  name: varchar("name", { length: 180 }).notNull(),
  title: varchar("title", { length: 220 }).notNull(),
  organisation: varchar("organisation", { length: 220 }).notNull(),
  portraitUrl: text("portraitUrl").notNull(),
  portraitKey: varchar("portraitKey", { length: 520 }),
  linkedinUrl: varchar("linkedinUrl", { length: 520 }),
  quote: text("quote"),
  biography: text("biography").notNull(),
  sectors: text("sectors").notNull(),
  expertise: text("expertise").notNull(),
  displayOrder: int("displayOrder").notNull().default(0),
  isPublished: boolean("isPublished").notNull().default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const candidateReferrals = mysqlTable("candidate_referrals", {
  id: int("id").autoincrement().primaryKey(),
  jobSlug: varchar("jobSlug", { length: 180 }).notNull(),
  jobTitle: varchar("jobTitle", { length: 260 }).notNull(),
  referrerName: varchar("referrerName", { length: 180 }).notNull(),
  referrerEmail: varchar("referrerEmail", { length: 320 }).notNull(),
  candidateName: varchar("candidateName", { length: 180 }).notNull(),
  candidateEmail: varchar("candidateEmail", { length: 320 }).notNull(),
  candidateLinkedin: varchar("candidateLinkedin", { length: 520 }),
  rationale: text("rationale").notNull(),
  cvFileName: varchar("cvFileName", { length: 255 }).notNull(),
  cvMimeType: varchar("cvMimeType", { length: 120 }).notNull(),
  cvStorageKey: varchar("cvStorageKey", { length: 520 }).notNull(),
  cvUrl: text("cvUrl").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type LeadershipProfileRow = typeof leadershipProfiles.$inferSelect;
export type InsertLeadershipProfile = typeof leadershipProfiles.$inferInsert;
export type CandidateReferralRow = typeof candidateReferrals.$inferSelect;
export type InsertCandidateReferral = typeof candidateReferrals.$inferInsert;

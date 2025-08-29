import { pgTable, text, varchar, integer, decimal, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const propertyAnalyses = pgTable("property_analyses", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  address: text("address").notNull(),
  arv: decimal("arv", { precision: 12, scale: 2 }),
  confidence: text("confidence"),
  pricePerSqFt: decimal("price_per_sq_ft", { precision: 8, scale: 2 }),
  beds: integer("beds"),
  baths: decimal("baths", { precision: 3, scale: 1 }),
  sqft: integer("sqft"),
  yearBuilt: integer("year_built"),
  comparables: jsonb("comparables"),
  isExactMatch: boolean("is_exact_match").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertPropertyAnalysisSchema = createInsertSchema(propertyAnalyses).omit({
  id: true,
  createdAt: true,
  isExactMatch: true,
});

export const addressSearchSchema = z.object({
  address: z.string().min(10, "Please enter a complete address").max(200, "Address too long"),
});

export type InsertPropertyAnalysis = z.infer<typeof insertPropertyAnalysisSchema>;
export type PropertyAnalysis = typeof propertyAnalyses.$inferSelect;
export type AddressSearch = z.infer<typeof addressSearchSchema>;

// Types for API responses
export interface PropertyARV {
  estimate: string;
  confidence: string;
  pricePerSqFt: string;
}

export interface PropertyDetails {
  beds: number;
  baths: number;
  sqft: number;
  yearBuilt: number;
}

export interface ComparableProperty {
  id: string;
  address: string;
  price: string;
  beds: number;
  baths: number;
  sqft: number;
  distance: string;
  soldDate: string;
}

export interface PropertyAnalysisResult {
  arv: PropertyARV;
  property: PropertyDetails;
  comparables: ComparableProperty[];
  // For 1-bathroom houses - dual ARV calculation
  arvWith2ndBathroom?: PropertyARV;
  comparablesWith2ndBath?: ComparableProperty[];
  isDualCalculation?: boolean;
}

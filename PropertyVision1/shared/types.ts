export interface ComparableProperty {
  address: string;
  price: number;                 // closed sale price
  sqft: number;                  // GLA
  beds?: number | null;
  baths?: number | null;         // total bath count (full bath granularity optional)
  yearBuilt?: number | null;
  soldDateISO?: string;          // ISO close date
  distanceMiles?: number;        // from subject
  source?: string;               // MLS, Redfin, etc.
  confidence?: "low" | "medium" | "high";
}

export interface PropertyDetails {
  address: string;
  sqft: number | null;
  beds: number | null;
  baths: number | null;
  yearBuilt: number | null;
  lotSize: number | null;        // assume sqft
  success: boolean;
  error?: string;
}

export interface ARVResult {
  arv: number;                                  // point estimate
  low?: number;                                 // lower bound
  high?: number;                                // upper bound
  method: string;                               // e.g., "median_of_three"
  dataPoints: number;                           // # of comps used to compute ARV
  confidence: "high" | "medium" | "low";

  // Optional diagnostics (unused in this path, keep for future)
  slope?: number;
  intercept?: number;
  r2?: number;

  // EXACT comps used to compute ARV
  coreComps: Array<{
    address: string;
    ppsf: number;
    indication: number;                         // (price/sqft)*subjectSqft after bath penalty if applied
    score: number;                              // selection score
  }>;

  version?: string;                             // ANALYZER_VERSION
}

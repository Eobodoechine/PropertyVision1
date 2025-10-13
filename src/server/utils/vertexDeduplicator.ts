// Vertex AI-Powered Intelligent Deduplication
// Replaces rule-based deduplication with AI that understands real estate data nuances
import fs from 'fs';
import { jobLog } from '../utils/jobLogger';

interface PropertyData {
  address: string;
  price?: number;
  sqft?: number;
  beds?: number;
  baths?: number;
  yearBuilt?: number | null;
  soldDate?: string;
  distance?: number;
  source?: string;
  searchId?: string;
  confidence?: 'high' | 'medium' | 'low';
  [key: string]: any;
}

interface DeduplicationResult {
  uniqueProperties: PropertyData[];
  duplicatesRemoved: number;
  mergedGroups: Array<{
    masterProperty: PropertyData;
    duplicates: PropertyData[];
    reason: string;
    confidence: number;
  }>;
}

export class VertexDeduplicator {

  /**
   * Use Vertex AI to intelligently deduplicate properties
   * Handles address variations, coordinate proximity, unit numbers, etc.
   */
  async deduplicateProperties(properties: PropertyData[]): Promise<DeduplicationResult> {
    jobLog('🚨🚨🚨 DEDUP START: deduplicateProperties called 🚨🚨🚨');
    jobLog('🔍 DEDUP LINE 0: Function entry, properties type:', typeof properties);
    jobLog('🔍 DEDUP LINE 0.1: properties is array:', Array.isArray(properties));
    jobLog('🔍 DEDUP LINE 0.2: properties length:', properties?.length);
    jobLog('🔍 DEDUP LINE 1: Function entry');
    jobLog('🔍 DEDUP LINE 1.5: About to check properties.length');

    if (properties.length <= 1) {
      jobLog('🔍 DEDUP LINE 2: Early return for <= 1 properties');
      return {
        uniqueProperties: properties,
        duplicatesRemoved: 0,
        mergedGroups: []
      };
    }

    jobLog(`🤖 Vertex Deduplication: Analyzing ${properties.length} properties`);
    jobLog('🔍 DEDUP LINE 3: About to enter try block');

    try {
      jobLog('🔍 DEDUP LINE 4: About to import vertex-freeform.js');
      const { vertexGenerate } = await import('../vertex-freeform.js');
      jobLog('🔍 DEDUP LINE 5: vertex-freeform.js imported successfully');

      jobLog('🔍 DEDUP LINE 6: About to call this.getVertexConfig()');
      const { serviceAccount, projectId, location, model } = this.getVertexConfig();
      jobLog('🔍 DEDUP LINE 7: getVertexConfig() completed successfully');

      // Prepare property data for AI analysis with required fields
      const propertyList = properties.map((prop, index) => ({
        record_id: index.toString(),
        address: prop.address,
        price: prop.price || null,
        sqft: prop.sqft || null,
        gla: prop.sqft || null, // Gross living area
        beds: prop.beds || null,
        baths: prop.baths || null,
        year_built: prop.yearBuilt || null,
        sale_date: prop.soldDate || null,
        source: prop.source || null,
        property_type: "single_family", // Default assumption, could be enhanced
        latitude: null, // We don't have coordinates in current data
        longitude: null,
        apn: null, // Assessor's Parcel Number - not available
        mls_id: null
      }));

      const prompt = `You are a data-quality assistant for U.S. real estate. Given a JSON array of property records, your job is to:
(1) detect and group duplicates, and
(2) output a de-duplicated dataset keeping a single canonical record per duplicate group, with safe field merges.

Follow these rules:

A) NORMALIZATION (USPS-style, case-insensitive)
- Strip punctuation; collapse whitespace.
- Normalize common street types: Rd→Road, St→Street, Ave→Avenue, Blvd→Boulevard, Pkwy→Parkway, Ter→Terrace, Hwy→Highway, Ln→Lane, Ct→Court, Pl→Place, Dr→Drive, Cir→Circle.
- Normalize directionals (N/S/E/W/NE/NW/SE/SW) whether prefix or suffix.
- Normalize ordinals & variants (e.g., "1st"↔"First").
- Normalize unit tokens: Apt, Unit, #, Suite, Ste, No. → "UNIT" (keep the value).
- Fuzzy match street name using Levenshtein or token-set ratio; consider ≥90/100 as a positive signal (never override APN/UNIT rules).

B) UNIT / PROPERTY-TYPE LOGIC
- If property_type ∈ {condo, townhome, apartment}: records are duplicates ONLY if UNIT matches (after normalization).
  - If one record lacks UNIT but APN/parcel_id + street + ZIP + geo point to the same building: mark AMBIGUOUS_SAME_BUILDING (not duplicate).
  - Different UNIT values ⇒ NOT_DUPLICATE.
- If property_type ∈ {single_family, duplex, triplex, fourplex}:
  - Different UNIT values may indicate separate legal dwellings. Treat as NOT_DUPLICATE unless APN and entrances clearly indicate a single dwelling (then POTENTIAL_DUPLICATE).
- Fee-simple townhomes: typically distinct APNs; different APNs ⇒ NOT_DUPLICATE even if very close.

C) GEOSPATIAL TOLERANCE (when both have lat/long)
- condos/townhomes/apartments: ≤10 m ⇒ "same building" signal ONLY (never sufficient alone).
- SFR/2–4 units: ≤20–30 m ⇒ supports duplicate if other signals also match.
- If geocoder precision is "interpolated" or "parcel centroid", downgrade geo confidence.

D) MATCHING SIGNAL PRIORITY (strongest → weakest)
1) APN/parcel_id exact match (with UNIT match if multi-unit).
2) Exact normalized full address (incl. UNIT where relevant).
3) Same building (street + number + ZIP) + UNIT match (or both lack UNIT and are not multi-unit types).
4) Fuzzy street ≥90 + same house number + ZIP + within geo tolerance.
5) MLS/listing IDs help but are not definitive across portals.

E) CANONICAL PICK & SAFE MERGE
- For each duplicate group, choose canonical_record_id as: most complete key fields (APN, precise lat/long, beds/baths, GLA, closed sale date); tie-break by most recent update.
- When merging into canonical, only fill NULL/empty fields from duplicates. Do NOT overwrite non-null fields unless the incoming value is clearly more specific/precise (e.g., rooftop lat/long vs parcel centroid). Never merge across different UNIT values.
- Preserve provenance: add "source_record_ids" array to canonical listing all merged record_ids.

F) OUTPUT — RETURN **JSON ONLY** IN THIS EXACT SHAPE:
{
  "duplicate_groups": [
    {
      "group_id": "dup-001",
      "canonical_record_id": "string",
      "record_ids": ["id1","id2","id3"],
      "match_reason": ["APN_MATCH","UNIT_MATCH","GEO_NEAR","FUZZY_STREET_>=90","DIRECTIONAL_EQUIVALENT","AMBIGUOUS_SAME_BUILDING","INTERPOLATED_DOWNGRADED"],
      "confidence": 0.0,
      "notes": "string"
    }
  ],
  "kept_records": [ { /* merged canonical records with source_record_ids */ } ],
  "dropped_record_ids": ["id2","id3"],
  "ambiguous_record_ids": ["idA","idB"],
  "changes_log": [
    {
      "canonical_record_id": "string",
      "merged_from": ["id2","id3"],
      "fields_merged": ["apn","latitude","longitude","gla","sale_date"]
    }
  ]
}

G) SAFETY & STRICTNESS
- Do not hallucinate fields; only use what's provided.
- If uncertain between DUPLICATE vs NOT_DUPLICATE for multi-unit without UNIT, use AMBIGUOUS_SAME_BUILDING and lower confidence.
- Never merge records with different UNIT values for multi-unit properties.

F) OUTPUT — Call report_duplicate_groups function with duplicate_groups only.
DO NOT include kept_records, dropped_record_ids, or changes_log - those will be computed separately.

Input data to analyze:
${JSON.stringify(propertyList, null, 2)}`;

      // Function calling mode - model returns structured duplicate_groups only
      const deduplicationFunction = {
        name: 'report_duplicate_groups',
        description: 'Report groups of duplicate property records',
        parameters: {
          type: 'OBJECT',
          properties: {
            duplicate_groups: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  group_id: { type: 'STRING' },
                  canonical_record_id: { type: 'STRING' },
                  record_ids: { type: 'ARRAY', items: { type: 'STRING' } },
                  match_reason: { type: 'ARRAY', items: { type: 'STRING' } },
                  confidence: { type: 'NUMBER' }
                },
                required: ['group_id', 'canonical_record_id', 'record_ids', 'match_reason', 'confidence']
              }
            }
          },
          required: ['duplicate_groups']
        }
      };
      jobLog('🔍 DEDUP LINE 8: About to call vertexGenerate');
      jobLog('🔍 DEDUP LINE 8.1: serviceAccount type:', typeof serviceAccount);
      jobLog('🔍 DEDUP LINE 8.2: serviceAccount keys:', serviceAccount ? Object.keys(serviceAccount) : 'null');
      jobLog('🔍 DEDUP LINE 8.3: serviceAccount.private_key exists:', !!serviceAccount?.private_key);
      jobLog('🔍 DEDUP LINE 8.4: serviceAccount.private_key length:', serviceAccount?.private_key?.length || 'NO LENGTH');
      jobLog('🔍 DEDUP LINE 8.5: serviceAccount.client_email:', serviceAccount?.client_email || 'NO EMAIL');

      jobLog('🚨🚨🚨 DEDUPLICATOR CALLING VERTEXGENERATE 🚨🚨🚨');

      const response = await vertexGenerate({
        sa: serviceAccount,
        projectId,
        location,
        model,
        prompt,
        grounded: false, // Use AI reasoning, not web search
        functionDeclaration: deduplicationFunction,
        maxOutputTokens: 1024, // Just need indices, much smaller than full records
        timeoutMs: 120000
      });

      jobLog('🔍 DEDUP LINE 9: vertexGenerate completed successfully');

      // Parse function call response (response is the args object directly)
      const result = JSON.parse(response);
      const duplicate_groups = result.duplicate_groups || [];
      jobLog(`🤖 Vertex identified ${duplicate_groups.length} duplicate groups`);

      // Build kept_records, dropped_record_ids, and changes_log locally
      const kept_records: any[] = [];
      const dropped_record_ids: string[] = [];
      const changes_log: any[] = [];

      for (const group of duplicate_groups) {
        const canonicalIdx = parseInt(group.canonical_record_id, 10);
        const canonicalProp = properties[canonicalIdx];

        if (!canonicalProp) {
          jobLog(`⚠️  Warning: canonical_record_id ${group.canonical_record_id} not found`);
          continue;
        }

        // Build kept record with source IDs
        kept_records.push({
          ...canonicalProp,
          source_record_ids: group.record_ids
        });

        // Track dropped records (all except canonical)
        const droppedIds = group.record_ids.filter(id => id !== group.canonical_record_id);
        dropped_record_ids.push(...droppedIds);

        // Build changes log entry
        if (droppedIds.length > 0) {
          changes_log.push({
            canonical_record_id: group.canonical_record_id,
            merged_from: droppedIds,
            fields_merged: ['address', 'price', 'beds', 'baths', 'sqft'] // Standard merge fields
          });
        }
      }

      jobLog(`📊 Built locally: ${kept_records.length} kept, ${dropped_record_ids.length} dropped`);

      // Build final result
      const uniqueProperties: PropertyData[] = [];
      const mergedGroups: DeduplicationResult['mergedGroups'] = [];
      let duplicatesRemoved = 0;

      // Add unique properties (not in any duplicate group)
      const allGroupedIds = new Set<string>();
      for (const group of duplicate_groups) {
        for (const id of group.record_ids) {
          allGroupedIds.add(id);
        }
      }

      // Add properties that weren't grouped as duplicates
      properties.forEach((prop, index) => {
        const indexStr = index.toString();
        if (!allGroupedIds.has(indexStr)) {
          uniqueProperties.push(prop);
        }
      });

      // Process duplicate groups and add canonical records
      for (const group of duplicate_groups) {
        const canonicalId = group.canonical_record_id;
        const canonicalProperty = properties[parseInt(canonicalId)];
        const duplicates = group.record_ids
          .filter(id => id !== canonicalId)
          .map(id => properties[parseInt(id)])
          .filter(Boolean);

        if (canonicalProperty) {
          uniqueProperties.push(canonicalProperty);
          mergedGroups.push({
            masterProperty: canonicalProperty,
            duplicates,
            reason: group.match_reason.join(', '),
            confidence: group.confidence
          });
          duplicatesRemoved += duplicates.length;

          jobLog(`   🔗 Merged ${duplicates.length} duplicates (confidence: ${group.confidence.toFixed(2)}): ${group.match_reason.join(', ')}`);
          jobLog(`      Master: ${canonicalProperty.address}`);
          duplicates.forEach(dup => jobLog(`      Duplicate: ${dup.address}`));
        }
      }

      jobLog(`✅ Vertex Deduplication complete: ${properties.length} → ${uniqueProperties.length} unique (removed ${duplicatesRemoved} duplicates)`);

      return {
        uniqueProperties,
        duplicatesRemoved,
        mergedGroups
      };

    } catch (error) {
      jobLog('🚨🚨🚨 DEDUP CATCH BLOCK ENTERED 🚨🚨🚨');
      jobLog('🔍 DEDUP LINE 10: Entered catch block');
      jobLog('🔍 DEDUP LINE 10.1: Error type:', typeof error);
      jobLog('🔍 DEDUP LINE 10.2: Error message:', (error as any)?.message);
      jobLog('🔍 DEDUP LINE 10.3: Error code:', (error as any)?.code);
      jobLog('🔍 DEDUP LINE 10.4: Error stack:', (error as any)?.stack);
      jobLog('🔍 DEDUP LINE 10.5: Error name:', (error as any)?.name);
      jobLog('🔍 DEDUP LINE 10.6: Full error object keys:', error ? Object.keys(error) : 'NO ERROR OBJECT');
      console.error('❌ Vertex deduplication failed, falling back to original properties:', error);
      return {
        uniqueProperties: properties,
        duplicatesRemoved: 0,
        mergedGroups: []
      };
    }
  }

  /**
   * Map enhanced record from Vertex back to PropertyData format
   */
  private mapBackToPropertyData(enhancedRecord: any, originalProperty: PropertyData): PropertyData {
    return {
      ...originalProperty,
      // Update with any enhanced fields from Vertex, keeping original structure
      price: enhancedRecord.price ?? originalProperty.price,
      sqft: enhancedRecord.sqft ?? enhancedRecord.gla ?? originalProperty.sqft,
      beds: enhancedRecord.beds ?? originalProperty.beds,
      baths: enhancedRecord.baths ?? originalProperty.baths,
      yearBuilt: enhancedRecord.year_built ?? originalProperty.yearBuilt,
      soldDate: enhancedRecord.sale_date ?? originalProperty.soldDate,
      source: enhancedRecord.source ?? originalProperty.source
    };
  }

  private getVertexConfig() {
    // Use EXACT same pattern as step3-find-comparables.ts
    jobLog('🚨🚨🚨 GETVERTEXCONFIG START 🚨🚨🚨');
    jobLog('🔍 DEDUPLICATOR DEBUG: getVertexConfig() called');
    jobLog('🔍 CONFIG DEBUG 1: Checking environment variables');
    jobLog('🔍 CONFIG DEBUG 1.1: GCP_SA_JSON_B64 exists:', !!process.env.GCP_SA_JSON_B64);
    jobLog('🔍 CONFIG DEBUG 1.2: GCP_SA_JSON exists:', !!process.env.GCP_SA_JSON);
    jobLog('🔍 CONFIG DEBUG 1.3: SERVICE_ACCOUNT_JSON exists:', !!process.env.SERVICE_ACCOUNT_JSON);

    let serviceAccount;
    jobLog('🔍 CONFIG DEBUG 2: About to check GCP_SA_JSON_B64 branch');
    if (process.env.GCP_SA_JSON_B64) {
      jobLog('🔍 DEDUPLICATOR DEBUG: Using GCP_SA_JSON_B64');
      jobLog('🔍 CONFIG DEBUG 3: About to decode base64');
      const saJson = Buffer.from(process.env.GCP_SA_JSON_B64, 'base64').toString('utf-8');
      jobLog('🔍 CONFIG DEBUG 4: Base64 decoded, about to parse JSON');
      serviceAccount = JSON.parse(saJson);
      jobLog('🔍 CONFIG DEBUG 5: JSON parsed successfully from base64');
    } else {
      jobLog('🔍 DEDUPLICATOR DEBUG: Using GCP_SA_JSON from file');
      jobLog('🔍 CONFIG DEBUG 6: About to get file path');
      const saPath = process.env.GCP_SA_JSON || process.env.SERVICE_ACCOUNT_JSON;
      jobLog('🔍 CONFIG DEBUG 7: File path:', saPath);
      if (!saPath) {
        jobLog('🔍 CONFIG DEBUG 8: No file path found, throwing error');
        throw new Error('GCP_SA_JSON or GCP_SA_JSON_B64 environment variable is required for Vertex AI');
      }
      jobLog('🔍 CONFIG DEBUG 9: About to read file');
      serviceAccount = JSON.parse(fs.readFileSync(saPath, 'utf-8'));
      jobLog('🔍 CONFIG DEBUG 10: File read and parsed successfully');
    }

    // Debug the service account object
    jobLog('🔍 CONFIG DEBUG 11: About to debug service account');
    jobLog('🔍 SERVICE ACCOUNT DEBUG: Keys available:', Object.keys(serviceAccount));
    jobLog('🔍 SERVICE ACCOUNT DEBUG: Has private_key:', !!serviceAccount.private_key);
    jobLog('🔍 SERVICE ACCOUNT DEBUG: Private key starts with:', serviceAccount.private_key?.substring(0, 50));
    jobLog('🔍 SERVICE ACCOUNT DEBUG: Private key type:', typeof serviceAccount.private_key);
    jobLog('🔍 SERVICE ACCOUNT DEBUG: Private key length:', serviceAccount.private_key?.length);
    jobLog('🔍 SERVICE ACCOUNT DEBUG: Client email:', serviceAccount.client_email);

    jobLog('🔍 CONFIG DEBUG 12: About to extract project_id');
    const projectId = serviceAccount.project_id;
    jobLog('🔍 CONFIG DEBUG 13: Project ID:', projectId);

    jobLog('🔍 CONFIG DEBUG 14: About to get location and model');
    const location = process.env.VERTEX_LOCATION || 'us-central1';
    const model = 'gemini-2.5-flash'; // Use Flash for deduplication (faster, more reliable with structured output)
    jobLog('🔍 CONFIG DEBUG 15: Location:', location, 'Model:', model);

    jobLog('🔍 CONFIG DEBUG 16: About to return config object');
    const config = {
      serviceAccount,
      projectId,
      location,
      model
    };
    jobLog('🔍 CONFIG DEBUG 17: Config object created, returning');
    jobLog('🚨🚨🚨 GETVERTEXCONFIG END 🚨🚨🚨');
    return config;
  }
}
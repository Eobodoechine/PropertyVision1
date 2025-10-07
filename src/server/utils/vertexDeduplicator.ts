// Vertex AI-Powered Intelligent Deduplication
// Replaces rule-based deduplication with AI that understands real estate data nuances
import fs from 'fs';

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
    console.log('🚨🚨🚨 DEDUP START: deduplicateProperties called 🚨🚨🚨');
    console.log('🔍 DEDUP LINE 0: Function entry, properties type:', typeof properties);
    console.log('🔍 DEDUP LINE 0.1: properties is array:', Array.isArray(properties));
    console.log('🔍 DEDUP LINE 0.2: properties length:', properties?.length);
    console.log('🔍 DEDUP LINE 1: Function entry');
    console.log('🔍 DEDUP LINE 1.5: About to check properties.length');

    if (properties.length <= 1) {
      console.log('🔍 DEDUP LINE 2: Early return for <= 1 properties');
      return {
        uniqueProperties: properties,
        duplicatesRemoved: 0,
        mergedGroups: []
      };
    }

    console.log(`🤖 Vertex Deduplication: Analyzing ${properties.length} properties`);
    console.log('🔍 DEDUP LINE 3: About to enter try block');

    try {
      console.log('🔍 DEDUP LINE 4: About to import vertex-freeform.js');
      const { vertexGenerate } = await import('../vertex-freeform.js');
      console.log('🔍 DEDUP LINE 5: vertex-freeform.js imported successfully');

      console.log('🔍 DEDUP LINE 6: About to call this.getVertexConfig()');
      const { serviceAccount, projectId, location, model } = this.getVertexConfig();
      console.log('🔍 DEDUP LINE 7: getVertexConfig() completed successfully');

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

Input data to analyze:
${JSON.stringify(propertyList, null, 2)}`;

      const responseSchema = {
        type: 'OBJECT',
        properties: {
          duplicate_groups: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                group_id: { type: 'STRING' },
                canonical_record_id: { type: 'STRING' },
                record_ids: {
                  type: 'ARRAY',
                  items: { type: 'STRING' }
                },
                match_reason: {
                  type: 'ARRAY',
                  items: { type: 'STRING' }
                },
                confidence: { type: 'NUMBER' },
                notes: { type: 'STRING' }
              },
              required: ['group_id', 'canonical_record_id', 'record_ids', 'match_reason', 'confidence']
            }
          },
          kept_records: {
            type: 'ARRAY',
            items: { type: 'OBJECT' }
          },
          dropped_record_ids: {
            type: 'ARRAY',
            items: { type: 'STRING' }
          },
          ambiguous_record_ids: {
            type: 'ARRAY',
            items: { type: 'STRING' }
          },
          changes_log: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                canonical_record_id: { type: 'STRING' },
                merged_from: {
                  type: 'ARRAY',
                  items: { type: 'STRING' }
                },
                fields_merged: {
                  type: 'ARRAY',
                  items: { type: 'STRING' }
                }
              }
            }
          }
        },
        required: ['duplicate_groups', 'kept_records', 'dropped_record_ids']
      };

      console.log('🔍 DEDUP LINE 8: About to call vertexGenerate');
      console.log('🔍 DEDUP LINE 8.1: serviceAccount type:', typeof serviceAccount);
      console.log('🔍 DEDUP LINE 8.2: serviceAccount keys:', serviceAccount ? Object.keys(serviceAccount) : 'null');
      console.log('🔍 DEDUP LINE 8.3: serviceAccount.private_key exists:', !!serviceAccount?.private_key);
      console.log('🔍 DEDUP LINE 8.4: serviceAccount.private_key length:', serviceAccount?.private_key?.length || 'NO LENGTH');
      console.log('🔍 DEDUP LINE 8.5: serviceAccount.client_email:', serviceAccount?.client_email || 'NO EMAIL');

      console.log('🚨🚨🚨 DEDUPLICATOR CALLING VERTEXGENERATE 🚨🚨🚨');

      const response = await vertexGenerate({
        sa: serviceAccount,
        projectId,
        location,
        model,
        prompt,
        grounded: false, // Use AI reasoning, not web search
        json: true,
        responseSchema,
        timeoutMs: 120000
      });

      console.log('🔍 DEDUP LINE 9: vertexGenerate completed successfully');

      const result = JSON.parse(response);
      console.log(`🤖 Vertex identified ${result.duplicate_groups.length} duplicate groups`);

      // Build final result
      const uniqueProperties: PropertyData[] = [];
      const mergedGroups: DeduplicationResult['mergedGroups'] = [];
      let duplicatesRemoved = 0;

      // Create a map of kept records by their original index
      const keptRecordMap = new Map<string, any>();
      for (const record of result.kept_records || []) {
        if (record.source_record_ids && record.source_record_ids.length > 0) {
          // Use the first source record ID as the canonical ID
          keptRecordMap.set(record.source_record_ids[0], record);
        }
      }

      // Add unique properties (not in any duplicate group)
      const allGroupedIds = new Set<string>();
      for (const group of result.duplicate_groups || []) {
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
      for (const group of result.duplicate_groups || []) {
        const canonicalId = group.canonical_record_id;
        const canonicalProperty = properties[parseInt(canonicalId)];
        const duplicates = group.record_ids
          .filter(id => id !== canonicalId)
          .map(id => properties[parseInt(id)])
          .filter(Boolean);

        if (canonicalProperty) {
          // Use the enhanced canonical record if available, otherwise use original
          const enhancedRecord = keptRecordMap.get(canonicalId);
          const finalProperty = enhancedRecord ? this.mapBackToPropertyData(enhancedRecord, canonicalProperty) : canonicalProperty;

          uniqueProperties.push(finalProperty);
          mergedGroups.push({
            masterProperty: finalProperty,
            duplicates,
            reason: group.match_reason.join(', '),
            confidence: group.confidence
          });
          duplicatesRemoved += duplicates.length;

          console.log(`   🔗 Merged ${duplicates.length} duplicates (confidence: ${group.confidence.toFixed(2)}): ${group.notes || group.match_reason.join(', ')}`);
          console.log(`      Master: ${canonicalProperty.address}`);
          duplicates.forEach(dup => console.log(`      Duplicate: ${dup.address}`));
        }
      }

      console.log(`✅ Vertex Deduplication complete: ${properties.length} → ${uniqueProperties.length} unique (removed ${duplicatesRemoved} duplicates)`);

      return {
        uniqueProperties,
        duplicatesRemoved,
        mergedGroups
      };

    } catch (error) {
      console.log('🚨🚨🚨 DEDUP CATCH BLOCK ENTERED 🚨🚨🚨');
      console.log('🔍 DEDUP LINE 10: Entered catch block');
      console.log('🔍 DEDUP LINE 10.1: Error type:', typeof error);
      console.log('🔍 DEDUP LINE 10.2: Error message:', (error as any)?.message);
      console.log('🔍 DEDUP LINE 10.3: Error code:', (error as any)?.code);
      console.log('🔍 DEDUP LINE 10.4: Error stack:', (error as any)?.stack);
      console.log('🔍 DEDUP LINE 10.5: Error name:', (error as any)?.name);
      console.log('🔍 DEDUP LINE 10.6: Full error object keys:', error ? Object.keys(error) : 'NO ERROR OBJECT');
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
    console.log('🚨🚨🚨 GETVERTEXCONFIG START 🚨🚨🚨');
    console.log('🔍 DEDUPLICATOR DEBUG: getVertexConfig() called');
    console.log('🔍 CONFIG DEBUG 1: Checking environment variables');
    console.log('🔍 CONFIG DEBUG 1.1: GCP_SA_JSON_B64 exists:', !!process.env.GCP_SA_JSON_B64);
    console.log('🔍 CONFIG DEBUG 1.2: GCP_SA_JSON exists:', !!process.env.GCP_SA_JSON);
    console.log('🔍 CONFIG DEBUG 1.3: SERVICE_ACCOUNT_JSON exists:', !!process.env.SERVICE_ACCOUNT_JSON);

    let serviceAccount;
    console.log('🔍 CONFIG DEBUG 2: About to check GCP_SA_JSON_B64 branch');
    if (process.env.GCP_SA_JSON_B64) {
      console.log('🔍 DEDUPLICATOR DEBUG: Using GCP_SA_JSON_B64');
      console.log('🔍 CONFIG DEBUG 3: About to decode base64');
      const saJson = Buffer.from(process.env.GCP_SA_JSON_B64, 'base64').toString('utf-8');
      console.log('🔍 CONFIG DEBUG 4: Base64 decoded, about to parse JSON');
      serviceAccount = JSON.parse(saJson);
      console.log('🔍 CONFIG DEBUG 5: JSON parsed successfully from base64');
    } else {
      console.log('🔍 DEDUPLICATOR DEBUG: Using GCP_SA_JSON from file');
      console.log('🔍 CONFIG DEBUG 6: About to get file path');
      const saPath = process.env.GCP_SA_JSON || process.env.SERVICE_ACCOUNT_JSON;
      console.log('🔍 CONFIG DEBUG 7: File path:', saPath);
      if (!saPath) {
        console.log('🔍 CONFIG DEBUG 8: No file path found, throwing error');
        throw new Error('GCP_SA_JSON or GCP_SA_JSON_B64 environment variable is required for Vertex AI');
      }
      console.log('🔍 CONFIG DEBUG 9: About to read file');
      serviceAccount = JSON.parse(fs.readFileSync(saPath, 'utf-8'));
      console.log('🔍 CONFIG DEBUG 10: File read and parsed successfully');
    }

    // Debug the service account object
    console.log('🔍 CONFIG DEBUG 11: About to debug service account');
    console.log('🔍 SERVICE ACCOUNT DEBUG: Keys available:', Object.keys(serviceAccount));
    console.log('🔍 SERVICE ACCOUNT DEBUG: Has private_key:', !!serviceAccount.private_key);
    console.log('🔍 SERVICE ACCOUNT DEBUG: Private key starts with:', serviceAccount.private_key?.substring(0, 50));
    console.log('🔍 SERVICE ACCOUNT DEBUG: Private key type:', typeof serviceAccount.private_key);
    console.log('🔍 SERVICE ACCOUNT DEBUG: Private key length:', serviceAccount.private_key?.length);
    console.log('🔍 SERVICE ACCOUNT DEBUG: Client email:', serviceAccount.client_email);

    console.log('🔍 CONFIG DEBUG 12: About to extract project_id');
    const projectId = serviceAccount.project_id;
    console.log('🔍 CONFIG DEBUG 13: Project ID:', projectId);

    console.log('🔍 CONFIG DEBUG 14: About to get location and model');
    const location = process.env.VERTEX_LOCATION || 'us-central1';
    const model = process.env.VERTEX_MODEL || 'gemini-2.5-pro';
    console.log('🔍 CONFIG DEBUG 15: Location:', location, 'Model:', model);

    console.log('🔍 CONFIG DEBUG 16: About to return config object');
    const config = {
      serviceAccount,
      projectId,
      location,
      model
    };
    console.log('🔍 CONFIG DEBUG 17: Config object created, returning');
    console.log('🚨🚨🚨 GETVERTEXCONFIG END 🚨🚨🚨');
    return config;
  }
}
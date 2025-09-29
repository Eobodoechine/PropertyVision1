// Vertex AI-Powered Intelligent Deduplication
// Replaces rule-based deduplication with AI that understands real estate data nuances

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
    if (properties.length <= 1) {
      return {
        uniqueProperties: properties,
        duplicatesRemoved: 0,
        mergedGroups: []
      };
    }

    console.log(`🤖 Vertex Deduplication: Analyzing ${properties.length} properties`);

    try {
      const { vertexGenerate } = await import('../vertex-freeform.js');
      const { serviceAccount, projectId, location, model } = this.getVertexConfig();

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
    return {
      serviceAccount: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT || '{}'),
      projectId: process.env.GOOGLE_PROJECT_ID || '',
      location: process.env.GOOGLE_LOCATION || 'us-central1',
      model: process.env.GOOGLE_MODEL || 'gemini-2.0-flash-exp'
    };
  }
}
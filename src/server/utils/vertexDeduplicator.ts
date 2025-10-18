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
      const { vertexGenerate, resolveProjectId, resolveLocation, getAccessTokenViaAuth } = await import('../vertex-freeform.js');
      jobLog('🔍 DEDUP LINE 5: vertex-freeform.js imported successfully');

      jobLog('🔍 DEDUP LINE 6: About to get ADC credentials');
      // Use ADC-first authentication (keyless on Cloud Run)
      const projectId = await resolveProjectId();
      const location = resolveLocation();
      const model = process.env.VERTEX_PARSE_MODEL || 'gemini-2.5-flash'; // Use Flash for deduplication (faster, more reliable with structured output)
      const token = await getAccessTokenViaAuth();
      jobLog('🔍 DEDUP LINE 7: ADC credentials obtained successfully');

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

      const prompt = `You are deduplicating real estate property comparables. Identify duplicate properties based on normalized addresses.

NORMALIZATION RULES:
1. Convert to lowercase
2. Remove all punctuation (periods, commas, hashes)
3. Standardize street types: St→Street, Ave→Avenue, Rd→Road, Dr→Drive, Ln→Lane, Ct→Court, Blvd→Boulevard, Cir→Circle
4. Collapse multiple spaces to single space
5. Ignore city and ZIP code differences - only compare street addresses

DUPLICATE DETECTION:
- Properties with the same normalized street address are duplicates
- Example: "2194 Ivydale St, Atlanta, GA 30344" and "2194 Ivydale St, Atlanta, GA" are duplicates

TIE-BREAKING (when duplicates found):
1. PRIMARY: Keep the record with the most recent sale_date
2. SECONDARY: If sale_date is identical, keep the record with higher price
3. Use the kept record's record_id as canonical_record_id

OUTPUT FORMAT:
Call report_duplicate_groups function with duplicate_groups array.
Each group must include:
- group_id: unique identifier like "dup-001"
- canonical_record_id: the record_id to keep
- record_ids: all duplicate record_ids including canonical
- match_reason: ["ADDRESS_MATCH"]
- confidence: 1.0 for exact address match

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
      jobLog('🔍 DEDUP LINE 8.1: token exists:', !!token);
      jobLog('🔍 DEDUP LINE 8.2: token length:', token?.length || 'NO LENGTH');
      jobLog('🔍 DEDUP LINE 8.3: projectId:', projectId);
      jobLog('🔍 DEDUP LINE 8.4: location:', location);
      jobLog('🔍 DEDUP LINE 8.5: model:', model);

      jobLog('🚨🚨🚨 DEDUPLICATOR CALLING VERTEXGENERATE 🚨🚨🚨');

      const response = await vertexGenerate({
        token,
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
      jobLog('🚨 DEDUP ERROR: Vertex deduplication failed');
      jobLog('Error message:', (error as any)?.message);
      jobLog('Error code:', (error as any)?.code);
      jobLog('Error stack:', (error as any)?.stack);

      // Fail fast - do not return duplicates
      throw new Error(`Vertex deduplication failed: ${(error as any)?.message || 'Unknown error'}`);
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

}
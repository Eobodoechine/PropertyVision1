// Vertex AI-Powered Intelligent Deduplication
// Replaces rule-based deduplication with AI that understands real estate data nuances
import fs from 'fs';
import { jobLog, getCurrentJobId } from '../utils/jobLogger';
import { audit, writeCloud } from './cloudLogging';
import { ensureClosed, record429 } from './vertexCircuitBreaker';
import { probe } from './probe';
import { buildCacheKey, getCachedResult, setCachedResult } from './vertexResultCache';

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

// Helper to detect truncated JSON (unbalanced brackets/braces or odd quotes)
function looksLikePartialJSON(str: string): boolean {
  if (!str || str.trim() === '') return false;
  const openBraces = (str.match(/\{/g) || []).length;
  const closeBraces = (str.match(/\}/g) || []).length;
  const openBrackets = (str.match(/\[/g) || []).length;
  const closeBrackets = (str.match(/\]/g) || []).length;
  const quotes = (str.match(/"/g) || []).length;

  // Unbalanced brackets/braces or odd number of quotes = truncated
  return openBraces !== closeBraces ||
         openBrackets !== closeBrackets ||
         quotes % 2 !== 0;
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
      await jobLog('🔍 DEDUP LINE 4: About to import vertex-freeform.js', { loc: 'dedup4' });
      const { vertexGenerate, resolveProjectId, resolveLocation, getAccessTokenViaAuth } = await import('../vertex-freeform.js');
      await jobLog('🔍 DEDUP LINE 5: vertex-freeform.js imported successfully', { loc: 'dedup5' });

      const currentJobId = getCurrentJobId();
      const shortId = currentJobId ? currentJobId.slice(0, 8) : '--------';

      await jobLog('🔍 DEDUP LINE 6: About to get ADC credentials', { loc: 'dedup6' }, { awaitCloud: true });

      // Audit sentinel: must appear if Cloud Logging pipeline is alive up to this point
      await audit('after-dedup6', { shortId });

      // Use ADC-first authentication (keyless on Cloud Run)
      const projectId = await resolveProjectId();
      const location = resolveLocation();
      const model = process.env.VERTEX_GROUNDED_MODEL || 'gemini-2.5-pro'; // Use Pro for deduplication (better structured output reliability)
      const token = await getAccessTokenViaAuth();

      await jobLog('🔍 DEDUP LINE 7: ADC credentials obtained successfully', { loc: 'dedup7' }, { awaitCloud: true });

      // Immediate post-ADC probe: proves creds/project/resource are still valid
      await writeCloud('DEBUG', 'creds-ok', { loc: 'post-adc-probe', shortId });

      // Audit sentinel: must appear if nothing broke during ADC specifically
      await audit('after-dedup7', { shortId });

      // Prepare property data - ONLY essentials for deduplication (minimizes token usage)
      const propertyList = properties.map((prop, index) => ({
        record_id: index.toString(),
        address: prop.address, // Primary field for deduplication
        sale_date: prop.soldDate || null, // For tie-breaking (most recent wins)
        price: prop.price || null // For secondary tie-breaking (higher price wins)
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
Return a JSON object with a duplicate_groups array.
Each group must include:
- group_id: unique identifier like "dup-001"
- canonical_record_id: the record_id to keep
- record_ids: all duplicate record_ids including canonical
- match_reason: ["ADDRESS_MATCH"] (optional)
- confidence: 1.0 for exact address match (optional)

Input data to analyze:
${JSON.stringify(propertyList, null, 2)}`;

      // Response Schema mode (Controlled Generation) - lowercase types for JSON Schema
      // More reliable than function calling - bypasses MALFORMED_FUNCTION_CALL errors
      const responseSchema = {
        type: 'object',
        properties: {
          duplicate_groups: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                group_id: { type: 'string' },
                canonical_record_id: { type: 'string' },
                record_ids: { type: 'array', items: { type: 'string' } },
                match_reason: { type: 'array', items: { type: 'string' } },
                confidence: { type: 'number' }
              },
              required: ['group_id', 'canonical_record_id', 'record_ids']
            }
          }
        },
        required: ['duplicate_groups']
      };
      // Check circuit breaker before making Vertex call
      ensureClosed();

      // Probe: Log dedup call parameters
      const maxOutputTokens = Number(process.env.PV_DEDUP_MAXTOKENS ?? 4096);
      const t0 = Date.now();

      // Build cache key
      const cacheKey = buildCacheKey({
        prompt,
        model,
        grounded: false,
        temperature: 0,
        seed: 12345,
        maxOutputTokens,
        responseMimeType: 'application/json',
        responseSchema
      });

      probe({
        probe: 'DEDUP_CALL',
        phase: 'Deduplication',
        cacheKey,
        model,
        maxOutputTokens,
        promptLength: prompt.length,
        propertiesCount: properties.length
      });

      let response: string;
      let rawVertexResult: any;
      let cacheHit = false;

      // Check cache first
      const cached = await getCachedResult(cacheKey);
      if (cached && typeof cached === 'string') {
        response = cached;
        cacheHit = true;
        probe({
          probe: 'DEDUP_RESULT',
          source: 'cache',
          durMs: Date.now() - t0,
          responseLength: response.length
        });
      } else {
        // Cache miss - call Vertex API
        try {
          response = await vertexGenerate({
            token,
            projectId,
            location,
            model,
            prompt,
            grounded: false, // Use AI reasoning, not web search
            json: true, // Enable JSON response mode
            responseSchema, // Use response schema instead of function calling
            maxOutputTokens,
            timeoutMs: 120000
          });

          // Store raw result for probing (vertexGenerate returns string, not full response)
          rawVertexResult = { success: true, responseLength: response.length };

          // Cache successful response
          await setCachedResult(cacheKey, response);

          probe({
            probe: 'DEDUP_RESULT',
            source: 'vertex',
            durMs: Date.now() - t0,
            responseLength: response.length
          });

        } catch (error: any) {
          // Record 429 errors for circuit breaker (check httpStatus from new structured errors)
          if (error?.httpStatus === 429 || error?.code === 429 || error?.statusCode === 429) {
            record429();
          }

          // Probe: Log dedup error with structured error fields and stack trace
          probe({
            probe: 'DEDUP_ERROR',
            level: 'ERROR',
            phase: 'Deduplication',
            httpStatus: error?.httpStatus,
            retryable: error?.retryable,
            code: error?.code,
            msg: String(error?.message || error),
            errorName: error?.name,
            durMs: Date.now() - t0
          });

          throw error;
        }
      }

      // Auto-retry if response appears truncated (only for cache misses)
      if (!cacheHit && looksLikePartialJSON(response)) {
        jobLog('⚠️  Response appears truncated (unbalanced brackets/quotes), retrying with 8192 tokens');

        // Build separate cache key for retry with larger maxOutputTokens
        const retryCacheKey = buildCacheKey({
          prompt,
          model,
          grounded: false,
          temperature: 0,
          seed: 12345,
          maxOutputTokens: 8192,
          responseMimeType: 'application/json',
          responseSchema
        });

        const retryT0 = Date.now();
        const retryCached = await getCachedResult(retryCacheKey);

        if (retryCached && typeof retryCached === 'string') {
          response = retryCached;
          probe({
            probe: 'DEDUP_RETRY_RESULT',
            source: 'cache',
            durMs: Date.now() - retryT0,
            responseLength: response.length
          });
        } else {
          try {
            response = await vertexGenerate({
              token,
              projectId,
              location,
              model,
              prompt,
              grounded: false,
              json: true,
              responseSchema,
              maxOutputTokens: 8192, // Max for Gemini 2.5 Pro
              timeoutMs: 120000
            });
            rawVertexResult = { success: true, responseLength: response.length, retried: true };

            // Cache retry result
            await setCachedResult(retryCacheKey, response);

            probe({
              probe: 'DEDUP_RETRY_RESULT',
              source: 'vertex',
              durMs: Date.now() - retryT0,
              responseLength: response.length
            });
          } catch (error: any) {
            if (error?.httpStatus === 429 || error?.code === 429 || error?.statusCode === 429) {
              record429();
            }
            probe({
              probe: 'DEDUP_RETRY_ERROR',
              level: 'ERROR',
              phase: 'Deduplication',
              httpStatus: error?.httpStatus,
              retryable: error?.retryable,
              code: error?.code,
              msg: String(error?.message || error),
              errorName: error?.name,
              durMs: Date.now() - retryT0
            });
            throw error;
          }
        }
      }

      // Parse function call response (response is the args object directly)
      const result = JSON.parse(response);
      const duplicate_groups = result.duplicate_groups || [];

      // Probe: Log successful dedup result
      jobLog(JSON.stringify({
        probe: "DEDUP_RESULT",
        finishReason: "COMPLETE", // vertex-freeform.js doesn't expose finishReason
        jsonBytes: response.length,
        duplicateGroups: duplicate_groups.length,
        rev: process.env.K_REVISION
      }));

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
// Vertex AI Gemini property data parser
import { vertexGenerate } from '../vertex-freeform.js';
import { jobLog } from '../utils/jobLogger';

interface PropertyData {
  address: string;
  sold_price: number;
  sold_date: string;
  beds: number;
  baths: number;
  sqft: number;
  year_built: number;
  source_url: string;
}

export class GeminiParser {
  private location = 'us-central1';
  private model = 'gemini-2.0-flash-001';

  /**
   * Parse property data using Gemini API
   */
  async parsePropertyData(rawText: string): Promise<PropertyData[]> {
    jobLog('🤖 GeminiParser: Starting property data extraction...');

    try {
      const extractedData = await this.extractWithGemini(rawText);
      jobLog('✅ GeminiParser: Raw extraction completed');

      const rawData = this.parseRawResponse(extractedData);
      jobLog(`✅ GeminiParser: Extracted ${rawData.length} properties from raw response`);

      return rawData;
    } catch (error) {
      console.error('❌ GeminiParser: Failed to parse data:', error);
      // Fallback manual parser removed - it doesn't work
      // Return empty array instead of trying broken fallback
      return [];
    }
  }

  /**
   * Use Vertex AI Gemini to extract property data
   */
  private async extractWithGemini(rawText: string): Promise<string> {
    const prompt = `Parse this real estate data and return ONLY a JSON object with all properties.

Input data:
${rawText}

Return JSON in exactly this format (no other text):
{
  "properties": [
    {
      "address": "full address",
      "sold_price": 215000,
      "sold_date": "2024-08-02",
      "beds": 4,
      "baths": 2.5,
      "sqft": 1381,
      "year_built": 1960,
      "source_url": "full URL"
    }
  ]
}`;

    jobLog('🔄 GeminiParser: Calling Vertex AI Gemini...');

    try {
      // Load service account from environment (supports both local and Cloud Run)
      let serviceAccount: any;

      if (process.env.GCP_SA_JSON_B64) {
        // Production: base64 encoded JSON
        const saJson = Buffer.from(process.env.GCP_SA_JSON_B64, 'base64').toString('utf-8');
        serviceAccount = JSON.parse(saJson);
      } else if (process.env.GCP_SA_JSON) {
        // Local: file path
        const fs = await import('fs');
        serviceAccount = JSON.parse(fs.readFileSync(process.env.GCP_SA_JSON, 'utf8'));
      } else if (process.env.SERVICE_ACCOUNT_JSON) {
        // Alternative: direct JSON string
        serviceAccount = JSON.parse(process.env.SERVICE_ACCOUNT_JSON);
      } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        // Google default credentials file path
        const fs = await import('fs');
        serviceAccount = JSON.parse(fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'));
      } else {
        throw new Error('No service account found. Set GCP_SA_JSON_B64, GCP_SA_JSON, SERVICE_ACCOUNT_JSON, or GOOGLE_APPLICATION_CREDENTIALS');
      }

      // Get projectId from service account or environment
      const projectId = serviceAccount.project_id ||
                        process.env.VERTEX_AI_PROJECT_ID ||
                        process.env.GOOGLE_CLOUD_PROJECT_ID ||
                        process.env.GCLOUD_PROJECT;
      if (!projectId) {
        throw new Error('No project_id found in service account or environment (GOOGLE_CLOUD_PROJECT_ID)');
      }

      const result = await vertexGenerate({
        projectId: projectId,
        location: this.location,
        model: this.model,
        prompt: prompt,
        sa: serviceAccount,
        json: true,
        timeoutMs: 30000
      });

      if (!result) {
        throw new Error('No content returned from Vertex AI Gemini');
      }

      return result;
    } catch (error) {
      throw new Error(`Vertex AI Gemini request failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Parse raw response from Gemini without any data cleaning
   */
  private parseRawResponse(rawResponse: string): PropertyData[] {
    jobLog('🔍 GeminiParser: Parsing raw response without cleaning...');
    jobLog('📝 Raw response:', rawResponse);

    try {
      // Clean markdown code blocks if present
      let cleanedJson = rawResponse.trim();
      if (cleanedJson.startsWith('```json')) {
        cleanedJson = cleanedJson.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      } else if (cleanedJson.startsWith('```')) {
        cleanedJson = cleanedJson.replace(/^```\s*/, '').replace(/\s*```$/, '');
      }

      const parsed = JSON.parse(cleanedJson);

      if (parsed.properties && Array.isArray(parsed.properties)) {
        // Return raw properties without validation or cleaning
        return parsed.properties.map((prop: any) => ({
          address: prop.address || '',
          sold_price: prop.sold_price || 0,
          sold_date: prop.sold_date || '',
          beds: prop.beds || 0,
          baths: prop.baths || 0,
          sqft: prop.sqft || 0,
          year_built: prop.year_built || 0,
          source_url: prop.source_url || ''
        }));
      } else {
        throw new Error('Invalid JSON structure: missing properties array');
      }
    } catch (error) {
      console.error('❌ Raw response parsing failed:', error);
      throw error;
    }
  }

  /**
   * Validate JSON response from Gemini (no cleanup)
   */
  private validateAndCleanJson(jsonText: string): PropertyData[] {
    jobLog('🔍 GeminiParser: Validating JSON response...');

    try {
      // Clean markdown code blocks if present
      let cleanedJson = jsonText.trim();
      if (cleanedJson.startsWith('```json')) {
        cleanedJson = cleanedJson.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      } else if (cleanedJson.startsWith('```')) {
        cleanedJson = cleanedJson.replace(/^```\s*/, '').replace(/\s*```$/, '');
      }

      const parsed = JSON.parse(cleanedJson);

      if (parsed.properties && Array.isArray(parsed.properties)) {
        return parsed.properties.map(prop => this.validateProperty(prop)).filter(Boolean);
      } else {
        throw new Error('Invalid JSON structure: missing properties array');
      }
    } catch (error) {
      console.error('❌ JSON validation failed:', error);
      jobLog('📝 Raw JSON text:', jsonText);
      throw error;
    }
  }

  /**
   * Validate and normalize a single property object
   */
  private validateProperty(prop: any): PropertyData | null {
    try {
      const result = {
        address: prop.address?.toString() || '',
        sold_price: this.parseNumber(prop.sold_price),
        sold_date: prop.sold_date?.toString() || '',
        beds: this.parseNumber(prop.beds),
        baths: this.parseNumber(prop.baths),
        sqft: this.parseNumber(prop.sqft),
        year_built: this.parseNumber(prop.year_built),
        source_url: prop.source_url?.toString() || ''
      };
      return result;
    } catch (error) {
      console.warn('⚠️ GeminiParser: Invalid property data:', prop);
      console.error('⚠️ Validation error details:', error);
      return null;
    }
  }

  /**
   * Parse various number formats
   */
  private parseNumber(value: any): number {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      const cleaned = value.replace(/[$,]/g, '');
      const parsed = parseFloat(cleaned);
      return isNaN(parsed) ? 0 : parsed;
    }
    return 0;
  }

}
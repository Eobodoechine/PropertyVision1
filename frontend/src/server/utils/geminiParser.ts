// Google AI Studio (Gemini) property data parser
import https from 'https';

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
  private apiKey = 'AIzaSyD0QA1Jc1mx48GlyQVvz8JTHGEJhQWSE5s';
  private apiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

  /**
   * Parse property data using Gemini API
   */
  async parsePropertyData(rawText: string): Promise<PropertyData[]> {
    console.log('🤖 GeminiParser: Starting property data extraction...');

    try {
      const extractedData = await this.extractWithGemini(rawText);
      console.log('✅ GeminiParser: Raw extraction completed');

      const rawData = this.parseRawResponse(extractedData);
      console.log(`✅ GeminiParser: Extracted ${rawData.length} properties from raw response`);

      return rawData;
    } catch (error) {
      console.error('❌ GeminiParser: Failed to parse data:', error);
      console.log('🔄 GeminiParser: Attempting fallback manual parsing...');
      return this.fallbackManualParse(rawText);
    }
  }

  /**
   * Use Gemini API to extract property data
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

    const payload = {
      contents: [
        {
          parts: [
            {
              text: prompt
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 4096
      }
    };

    console.log('🔄 GeminiParser: Calling Gemini API...');

    return new Promise((resolve, reject) => {
      const data = JSON.stringify(payload);
      const urlObj = new URL(this.apiUrl);

      const options = {
        hostname: urlObj.hostname,
        port: 443,
        path: urlObj.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.apiKey,
          'Content-Length': Buffer.byteLength(data)
        }
      };

      const req = https.request(options, (res) => {
        let responseData = '';

        res.on('data', (chunk) => {
          responseData += chunk;
        });

        res.on('end', () => {
          try {
            const response = JSON.parse(responseData);

            if (response.error) {
              reject(new Error(`Gemini API error: ${response.error.message}`));
              return;
            }

            const content = response.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!content) {
              reject(new Error('No content returned from Gemini API'));
              return;
            }

            resolve(content);
          } catch (parseError) {
            reject(new Error(`Failed to parse Gemini response: ${parseError}`));
          }
        });
      });

      req.on('error', (error) => {
        reject(new Error(`Gemini API request failed: ${error.message}`));
      });

      req.on('timeout', () => {
        reject(new Error('Gemini API request timed out'));
      });

      req.setTimeout(30000); // 30 second timeout
      req.write(data);
      req.end();
    });
  }

  /**
   * Parse raw response from Gemini without any data cleaning
   */
  private parseRawResponse(rawResponse: string): PropertyData[] {
    console.log('🔍 GeminiParser: Parsing raw response without cleaning...');
    console.log('📝 Raw response:', rawResponse);

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
    console.log('🔍 GeminiParser: Validating JSON response...');

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
      console.log('📝 Raw JSON text:', jsonText);
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

  /**
   * Fallback manual parsing if Gemini fails
   */
  private fallbackManualParse(rawText: string): PropertyData[] {
    console.log('🔄 GeminiParser: Using fallback manual parsing...');

    const properties: PropertyData[] = [];
    const lines = rawText.split('\n');

    for (const line of lines) {
      if (line.includes('|') && line.includes('$')) {
        try {
          const parts = line.split('|').map(p => p.trim());
          if (parts.length >= 7) {
            properties.push({
              address: parts[0],
              sold_price: this.parseNumber(parts[1]),
              sold_date: parts[2],
              beds: this.parseNumber(parts[3]),
              baths: this.parseNumber(parts[4]),
              sqft: this.parseNumber(parts[5]),
              year_built: this.parseNumber(parts[6]),
              source_url: parts[7] || ''
            });
          }
        } catch (error) {
          console.warn('⚠️ Failed to parse line:', line);
        }
      }
    }

    console.log(`✅ Fallback parsing extracted ${properties.length} properties`);
    return properties;
  }
}
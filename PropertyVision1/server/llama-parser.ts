import { ComparableProperty } from '../shared/schema.js';

export class LLaMAParser {
  private ollamaUrl: string;

  constructor(ollamaUrl: string = 'http://localhost:11434') {
    this.ollamaUrl = ollamaUrl;
  }

  public async parseComparables(response: string, subjectAddress: string): Promise<ComparableProperty[]> {
    console.log('🦙 LLaMA Parser: Starting intelligent parsing...');
    
    try {
      // Create a focused prompt for LLaMA
      const prompt = this.createParsingPrompt(response, subjectAddress);
      
      // Call LLaMA
      const llamaResponse = await this.callLLaMA(prompt);
      
      // Extract and parse JSON from response
      const parsedData = this.extractJSONFromResponse(llamaResponse);
      
      // Convert to ComparableProperty format
      const comparables = this.convertToComparableProperties(parsedData, subjectAddress);
      
      console.log(`✅ LLaMA Parser found ${comparables.length} comparables`);
      return comparables;
      
    } catch (error) {
      console.log('❌ LLaMA Parser error:', error);
      console.log('🔄 Falling back to empty result');
      return [];
    }
  }

  private createParsingPrompt(response: string, subjectAddress: string): string {
    return `You are a real estate data parser. Extract ALL comparable property information from the following text and return ONLY a JSON array.

IMPORTANT RULES:
1. Extract ALL properties from the input - they are all comparables, not the subject property
2. The subject property "${subjectAddress}" is NOT in this data - all properties here are comparables
3. Parse prices as numbers (remove $ and commas)
4. Parse square footage as numbers (remove commas)  
5. Parse beds and baths as numbers
6. Parse year built as a 4-digit number
7. Parse distance as a number (extract numeric value from text like "0.8 miles")
8. Parse sold date as ISO date string (YYYY-MM-DD format)
9. Return ONLY valid JSON array, no other text
10. Include ALL properties that have complete data (address, price, sqft, beds, baths)

Text to parse:
${response}

Expected JSON format:
[
  {
    "address": "123 Main Street, City, State 12345",
    "price": 285000,
    "sqft": 1850,
    "beds": 3,
    "baths": 2,
    "yearBuilt": 1995,
    "distance": 0.8,
    "soldDate": "2024-08-15"
  }
]`;
  }

  private async callLLaMA(prompt: string): Promise<string> {
    const response = await fetch(`${this.ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama3.2:3b',
        prompt: prompt,
        stream: false,
        options: {
          temperature: 0.1, // Low temperature for consistent parsing
          top_p: 0.9,
          max_tokens: 1500
        }
      })
    });

    if (!response.ok) {
      throw new Error(`LLaMA API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data.response;
  }

  private extractJSONFromResponse(response: string): any[] {
    // Find JSON array in the response
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error('No JSON array found in LLaMA response');
    }

    const jsonText = jsonMatch[0];
    return JSON.parse(jsonText);
  }

  private convertToComparableProperties(parsedData: any[], subjectAddress: string): ComparableProperty[] {
    const comparables: ComparableProperty[] = [];

    for (const item of parsedData) {
      // Validate required fields
      if (!item.address || !item.price || !item.sqft) {
        console.log(`⚠️ Skipping incomplete property: ${item.address || 'Unknown'}`);
        continue;
      }

      // Filter out subject property (LLaMA sometimes hallucinates it)
      if (item.address.toLowerCase().trim() === subjectAddress.toLowerCase().trim()) {
        console.log(`🚫 Filtering out subject property: ${item.address}`);
        continue;
      }

      const comparable: ComparableProperty = {
        id: `llama_comp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        address: String(item.address),
        price: String(item.price), // Convert to string to match schema
        soldDate: item.soldDate ? new Date(item.soldDate).toISOString() : new Date().toISOString(),
        beds: Number(item.beds) || 0,
        baths: Number(item.baths) || 0,
        sqft: Number(item.sqft),
        distance: String(item.distance || 0), // Convert to string to match schema
        yearBuilt: Number(item.yearBuilt) || 0, // Add yearBuilt field
      };

      comparables.push(comparable);
    }

    return comparables;
  }

  public async testConnection(): Promise<boolean> {
    try {
      const response = await fetch(`${this.ollamaUrl}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'llama3.2:3b',
          prompt: 'Respond with "OK" and nothing else.',
          stream: false
        })
      });

      return response.ok;
    } catch (error) {
      return false;
    }
  }
}

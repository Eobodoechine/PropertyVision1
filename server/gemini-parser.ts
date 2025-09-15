import { GoogleGenerativeAI } from '@google/generative-ai';
import { ComparableProperty } from './step3-find-comparables';

export class GeminiParser {
  private genAI: GoogleGenerativeAI;

  constructor() {
    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  }

  public async parseComparables(response: string, subjectAddress: string): Promise<ComparableProperty[]> {
    try {
      console.log(`🤖 Gemini Parser: Starting intelligent parsing...`);
      
      const prompt = this.createParsingPrompt(response, subjectAddress);
      const model = this.genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

      const withTimeout = async <T>(p: Promise<T>, ms: number): Promise<T> => {
        return await Promise.race([
          p,
          new Promise<T>((_, reject) => setTimeout(() => reject(new Error('parse-timeout')), ms))
        ]);
      };

      const result: any = await withTimeout(
        model.generateContent({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 600, candidateCount: 1 },
        }) as any,
        10000
      );
      const responseText = await (result as any).response.text();
      
      // Extract JSON from response
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        throw new Error('No JSON array found in Gemini response');
      }

      const parsedData = JSON.parse(jsonMatch[0]);
      const comparables = this.convertToComparableProperties(parsedData, subjectAddress);
      
      console.log(`✅ Gemini Parser found ${comparables.length} comparables`);
      return comparables;
      
    } catch (error) {
      console.error(`❌ Gemini Parser error: ${error.message}`);
      throw error;
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
9. If condition language suggests renovated/updated/original/fixer, include a "condition" string field
10. Return ONLY valid JSON array, no other text
11. Include ALL properties that have complete data (address, price, sqft, beds, baths)

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
    "soldDate": "2024-08-15",
    "condition": "updated"
  }
]`;
  }

  private convertToComparableProperties(parsedData: any[], subjectAddress: string): ComparableProperty[] {
    const comparables: ComparableProperty[] = [];

    for (const item of parsedData) {
      // Validate required fields
      if (!item.address || !item.price || !item.sqft) {
        console.log(`⚠️ Skipping incomplete property: ${item.address || 'Unknown'}`);
        continue;
      }

      // Filter out subject property (Gemini sometimes hallucinates it)
      if (item.address.toLowerCase().trim() === subjectAddress.toLowerCase().trim()) {
        console.log(`🚫 Filtering out subject property: ${item.address}`);
        continue;
      }

      const comparable: ComparableProperty = {
        id: `gemini_comp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        address: String(item.address),
        price: String(item.price),
        soldDate: item.soldDate ? new Date(item.soldDate).toISOString() : new Date().toISOString(),
        beds: Number(item.beds) || 0,
        baths: Number(item.baths) || 0,
        sqft: Number(item.sqft),
        distance: Number(item.distance ?? item.distance_miles ?? 0),
        yearBuilt: Number(item.yearBuilt) || 0,
        condition: typeof item.condition === 'string' ? item.condition.toLowerCase() : undefined,
      };

      comparables.push(comparable);
    }

    return comparables;
  }
}

// Test: Can Gemini parse its own response?
// This tests if we can use Gemini instead of LLaMA for parsing

import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// The actual Gemini response from our analysis
const geminiResponse = `\`\`\`json
[
  {
    "address": "14208 Marshfield Ave, Dixmoor, IL 60426",
    "sold_price": 167000,
    "sold_date": "2025-03-10",
    "beds": 4,
    "baths": 1,
    "sqft": 960,
    "year_built": 1955,
    "distance_miles": 0.2,
    "ppsf": 173.96,
    "source_url": "https://www.redfin.com/IL/Dixmoor/14208-Marshfield-Ave-60426/home/181514801",
    "source_site": "Redfin"
  },
  {
    "address": "21 Circle Dr, Dixmoor, IL 60426",
    "sold_price": 70000,
    "sold_date": "2024-12-24",
    "beds": 4,
    "baths": 1,
    "sqft": 960,
    "year_built": 1956,
    "distance_miles": 0.1,
    "ppsf": 72.92,
    "source_url": "https://www.zillow.com/homedetails/21-Circle-Dr-Dixmoor-IL-60426/4311854_zpid/",
    "source_site": "Zillow"
  }
]
\`\`\``;

const subjectAddress = "14212 Circle Dr, Dixmoor, IL 60426";

async function testGeminiSelfParse() {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    
    const prompt = `You are a real estate data parser. Extract ALL comparable property information from the following text and return ONLY a JSON array.

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
${geminiResponse}

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

    console.log('🤖 Testing Gemini self-parsing...');
    console.log('📄 Input response length:', geminiResponse.length, 'characters');
    console.log('📄 Contains Marshfield:', geminiResponse.includes('Marshfield'));
    
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    console.log('\n🤖 Gemini Self-Parse Result:');
    console.log(text);
    
    // Try to parse the JSON
    try {
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        console.log('\n📊 Parsed Properties:');
        parsed.forEach((prop, i) => {
          console.log(`${i+1}. ${prop.address} - $${prop.price} - ${prop.sqft}sqft`);
        });
        
        // Check if Marshfield was found
        const marshfield = parsed.find(p => p.address.includes('Marshfield'));
        if (marshfield) {
          console.log('\n✅ Marshfield FOUND in Gemini self-parse results!');
          console.log('🎯 This proves Gemini can parse its own response!');
        } else {
          console.log('\n❌ Marshfield NOT FOUND in Gemini self-parse results');
        }
      } else {
        console.log('\n❌ No JSON array found in Gemini response');
      }
    } catch (parseError) {
      console.log('\n❌ JSON parsing failed:', parseError.message);
    }
    
  } catch (error) {
    console.error('❌ Gemini self-parse failed:', error.message);
  }
}

testGeminiSelfParse();

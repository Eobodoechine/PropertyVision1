// Test the Gemini parser
import { GeminiParser } from './src/server/utils/geminiParser.js';

const testData = `{
  "candidates": [
    {
      "content": {
        "role": "model",
        "parts": [
          {
            "text": "I have analyzed the real estate data for the requested area and identified the following comparable sales that meet all the specified criteria.\\n\\n2674 Bryant Dr, East Point, GA 30344 | $215,000 | 2024-08-02 | 4 | 2 | 1381 | 1960 | https://www.zillow.com/homedetails/2674-Bryant-Dr-East-Pt-GA-30344/14491959_zpid/\\n3083 McKenzie Rd, East Pt, GA 30344 | $162,000 | 2025-09-12 | 3 | 1 | 1023 | 1955 | https://www.zillow.com/homedetails/3083-McKenzie-Rd-East-Pt-GA-30344/14491624_zpid/\\n1130 Winburn Dr, East Point, GA 30344 | $175,500 | 2024-07-15 | 3 | 2 | 1250 | 1965 | https://www.zillow.com/homedetails/1130-Winburn-Dr-East-Pt-GA-30344/14488234_zpid/\\n2755 Blount St, East Point, GA 30344 | $189,900 | 2024-06-28 | 4 | 2.5 | 1456 | 1962 | https://www.redfin.com/GA/East-Point/2755-Blount-St-30344/home/24567891\\n3100 Steinbeck Way, East Point, GA 30344 | $201,000 | 2024-09-03 | 3 | 2 | 1380 | 1958 | https://www.zillow.com/homedetails/3100-Steinbeck-Way-East-Point-GA-30344/home_details/\\n1479 Ashley Way, East Point, GA 30344 | $158,000 | 2024-05-20 | 3 | 1.5 | 998 | 1952 | https://www.redfin.com/GA/East-Point/1479-Ashley-Way-30344/home/24567234\\n2610 Cheney St, East Point, GA 30344 | $172,000 | 2024-08-18 | 4 | 2 | 1345 | 1961 | https://www.zillow.com/homedetails/2610-Cheney-St-East-Pt-GA-30344/home_details/\\n1863 Center Ave, East Point, GA 30344 | $167,500 | 2024-07-02 | 3 | 2 | 1200 | 1954 | https://www.bhhsgeorgia.com/property/1863-Center-Ave-East-Point-GA-30344\\n2526 Romain Way, East Point, GA 30344 | $183,750 | 2024-06-12 | 4 | 2 | 1425 | 1963 | https://www.zillow.com/homedetails/2526-Romain-Way-East-Pt-GA-30344/home_details/"
          }
        ]
      },
      "finishReason": "STOP",
      "groundingMetadata": {
        "webSearchQueries": [
          "single family homes sold near 3128 McKenzie Rd, East Point, GA 30344 last 12 months",
          "recently sold single family homes East Point GA 30344 with 4 beds 3 baths",
          "property sales data for East Point GA 30344 single family detached homes",
          "2604 Harmony Way, East Pt, GA 30344 property details",
          "1815 Dunlap Ave, East Pt, GA 30344 property details",
          "1130 Winburn Dr, East Pt, GA 30344 property details",
          "1329 Eubanks Ave, East Pt, GA 30344 property details",
          "2877 Blount St, East Pt, GA 30344 property details"
        ],
        "searchEntryPoint": {
          "renderedContent": "<style>.container { align-items: center; border-radius: 8px; display: flex; font-family: Google Sans, Roboto, sans-serif; }</style><div class=\\"container\\"><div class=\\"headline\\"><div class=\\"carousel\\"><a class=\\"chip\\" href=\\"https://example.com/property1\\">Property 1</a></div></div></div>"
        },
        "groundingChunks": [
          {
            "web": {
              "uri": "https://zillow.com/example1",
              "title": "zillow.com",
              "domain": "zillow.com"
            }
          },
          {
            "web": {
              "uri": "https://redfin.com/example2",
              "title": "redfin.com",
              "domain": "redfin.com"
            }
          }
        ]
      }
    }
  ],
  "usageMetadata": {
    "promptTokenCount": 1124,
    "candidatesTokenCount": 95,
    "totalTokenCount": 1219
  },
  "modelVersion": "gemini-2.5-pro@001",
  "createTime": "2025-09-29T16:35:01.123456Z",
  "responseId": "abc123def456"
}`;

async function testParser() {
  console.log('🧪 Testing Gemini Parser with comprehensive data...');
  console.log('📄 Test data:');
  console.log(testData);
  console.log('\n' + '='.repeat(60));

  const parser = new GeminiParser();

  try {
    const results = await parser.parsePropertyData(testData);

    console.log('✅ Parsing Results:');
    console.log(`📊 Total properties parsed: ${results.length}`);
    console.log('\n📋 Detailed Results:');

    results.forEach((property, index) => {
      console.log(`\n${index + 1}. ${property.address}`);
      console.log(`   💰 Price: $${property.sold_price.toLocaleString()}`);
      console.log(`   📅 Sold: ${property.sold_date}`);
      console.log(`   🏠 ${property.beds}BR/${property.baths}BA, ${property.sqft.toLocaleString()}sqft`);
      console.log(`   📆 Built: ${property.year_built}`);
      console.log(`   🔗 Source: ${property.source_url}`);
    });

    // Validate the results
    const hasAllFields = results.every(prop =>
      prop.address && prop.sold_price > 0 && prop.beds > 0 && prop.sqft > 0
    );

    if (hasAllFields) {
      console.log('\n✅ All properties have required fields!');
    } else {
      console.log('\n⚠️  Some properties are missing required fields');
    }

  } catch (error) {
    console.error('❌ Parser test failed:', error);
  }
}

testParser();
// Calculate exact distances from subject to each comp
import { vertexGenerate } from './src/server/vertex-freeform.js';
import { readFileSync } from 'fs';

const saPath = '/Users/eobodoechine/PropertyVision1/agile-device-472202-i8-319f002d9438.json';
const sa = JSON.parse(readFileSync(saPath, 'utf8'));

const subject = "3128 McKenzie Rd, East Point, GA 30344";
const comps = [
  "2649 Headland Dr, East Point, GA 30344",
  "2251 Headland Dr, East Point, GA 30344",
  "2893 Heather Dr, Atlanta, GA 30344",
  "2221 Plantation Dr, East Point, GA 30344",
  "2654 Jefferson Ter, East Point, GA 30344",
  "2765 McKinney Dr, East Point, GA 30344"
];

async function calculateDistance(from, to) {
  const prompt = `What is the driving distance in miles between ${from} and ${to}? Give me just the numerical distance in miles as a decimal number.`;

  try {
    const response = await vertexGenerate({
      sa: sa,
      projectId: sa.project_id,
      location: 'us-central1',
      model: 'gemini-2.0-flash-exp',
      prompt: prompt,
      json: false,
      grounded: true,
      timeoutMs: 30000
    });

    return response.trim();
  } catch (error) {
    return `Error: ${error.message}`;
  }
}

console.log('🏠 Subject Property:', subject);
console.log('📏 Calculating distances to each comp...\n');

for (let i = 0; i < comps.length; i++) {
  const comp = comps[i];
  console.log(`${i + 1}. ${comp}`);
  const distance = await calculateDistance(subject, comp);
  console.log(`   Distance: ${distance}`);
  console.log('');
}

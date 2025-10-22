// Quick test to verify ARVCalculator loads without syntax errors
const { ARVCalculator } = require('./src/server/arvCalculator.js');

console.log('✅ ARVCalculator loaded successfully');

const calc = new ARVCalculator();
console.log('✅ ARVCalculator instantiated successfully');

// Check methods
const methods = Object.getOwnPropertyNames(ARVCalculator.prototype).filter(m => m !== 'constructor');
console.log(`✅ Found ${methods.length} methods`);
console.log('Key methods:', methods.filter(m => m.includes('calculate') || m.includes('select') || m.includes('band')).join(', '));

// Test duplicate removal logic
const validComps = [
  { address: "2035 Marbut Trce", price: 189900, pricePerSqft: 192 },
  { address: "2255 Cherokee Valley Cir", price: 134900, pricePerSqft: 120 },
  { address: "2035 Marbut Trce", price: 189900, pricePerSqft: 192 }, // Duplicate
  { address: "2031 Charter Ln", price: 180000, pricePerSqft: 182 }
];

console.log('Original count:', validComps.length);

// Remove duplicates based on exact address match
const uniqueComps = validComps.filter((comp, index, self) => 
  index === self.findIndex((c) => c.address.toLowerCase() === comp.address.toLowerCase())
);

console.log('After duplicate removal:', uniqueComps.length);
console.log('Removed duplicates:', validComps.length - uniqueComps.length);

uniqueComps.forEach((comp, index) => {
  console.log(`${index + 1}. ${comp.address} - $${comp.price.toLocaleString()}`);
});

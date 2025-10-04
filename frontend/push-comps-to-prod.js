// Push dev comps to production Redis cache
const https = require('https');

const comps = [
  {"address":"3665 Herren Dr SW, Smyrna, GA 30082","price":379000,"sqft":1513,"beds":3,"baths":2,"yearBuilt":1961,"soldDate":"2025-04-15","distance":0.08406817637545898,"source":"https://www.realtor.com/realestateandhomes-detail/3665-Herren-Dr-SW_Smyrna_GA_30082_M68685-37033","confidence":"High","foundAtLevel":1},
  {"address":"3715 Herren Dr SW, Smyrna, GA 30082","price":384000,"sqft":1520,"beds":3,"baths":2,"yearBuilt":1961,"soldDate":"2025-02-22","distance":0.04323207980193096,"source":"https://www.redfin.com/GA/Smyrna/3715-Herren-Dr-SW-30082/home/24949109","confidence":"High","foundAtLevel":1},
  {"address":"3665 Herren Dr SW Smyrna, GA 30082","price":379000,"sqft":1513,"beds":3,"baths":2,"yearBuilt":1961,"soldDate":"2025-04-15","distance":0.08406817637545898,"source":"https://www.redfin.com/GA/Smyrna/3665-Herren-Dr-SW-30082/home/24918382","confidence":"High","foundAtLevel":1},
  {"address":"3658 Rock Springs Dr SW, Smyrna, GA 30082","price":425000,"sqft":1548,"beds":3,"baths":2,"yearBuilt":1962,"soldDate":"2025-06-12","distance":0.4267395561923295,"source":"https://www.norluxe.com/property/3658-rock-springs-dr-sw-smyrna-ga-30082/","confidence":"High","foundAtLevel":1},
  {"address":"3650 Rock Springs Dr SW, Smyrna, GA 30082","price":415000,"sqft":1719,"beds":4,"baths":2,"yearBuilt":1963,"soldDate":"2025-08-01","distance":0.45561572832605873,"source":"https://www.norluxe.com/property/3650-rock-springs-dr-sw-smyrna-ga-30082/","confidence":"High","foundAtLevel":1},
  {"address":"3841 Rena Ln SE, Smyrna, GA 30082","price":624000,"sqft":1788,"beds":4,"baths":2,"yearBuilt":1969,"soldDate":"2025-08-22","distance":0.9575793163067956,"source":"https://www.movoto.com/smyrna-ga/3841-rena-ln-se-smyrna-ga-30082/pid_x8s89ayk8j/","confidence":"High","foundAtLevel":1},
  {"address":"566 Hurt Rd SW, Smyrna, GA 30082","price":352000,"sqft":1740,"beds":3,"baths":2,"yearBuilt":1956,"soldDate":"2025-08-20","distance":0.2617595808707662,"source":"https://www.zillow.com/homedetails/566-Hurt-Rd-SW-Smyrna-GA-30082/14333025_zpid/","confidence":"High","foundAtLevel":0},
  {"address":"395 Plantation Rd SW, Smyrna, GA 30082","price":310000,"sqft":1400,"beds":3,"baths":2,"yearBuilt":1962,"soldDate":"2024-09-15","distance":0.03239982019995087,"source":"https://www.zillow.com/homedetails/395-Plantation-Rd-SW-Smyrna-GA-30082/14294813_zpid/","confidence":"High","foundAtLevel":0},
  {"address":"3702 Herren Dr SW, Smyrna, GA 30082","price":428600,"sqft":1600,"beds":3,"baths":2,"yearBuilt":1961,"soldDate":"2024-10-01","distance":0.021751076595924908,"source":"https://www.zillow.com/homedetails/3702-Herren-Dr-SW-Smyrna-GA-30082/14294789_zpid/","confidence":"High","foundAtLevel":0},
  {"address":"3576 Mill Creek Dr SW, Smyrna, GA 30082","price":385000,"sqft":1460,"beds":3,"baths":2,"yearBuilt":1964,"soldDate":"2025-02-27","distance":0.5539684929568757,"source":"https://www.redfin.com/GA/Smyrna/3576-Mill-Creek-Dr-SW-30082/home/24853180","confidence":"High","foundAtLevel":0},
  {"address":"710 Montclair Dr, Smyrna, GA 30082","price":354000,"sqft":1680,"beds":4,"baths":2,"yearBuilt":1960,"soldDate":"2025-06-01","distance":0.5277454828336084,"source":"https://www.neighborhoods.com/nickajack-homes-smyrna-ga","confidence":"High","foundAtLevel":0},
  {"address":"3650 Rock Springs Dr SW, Smyrna, GA 30082","price":385000,"sqft":1455,"beds":4,"baths":2,"yearBuilt":1963,"soldDate":"2024-11-15","distance":0.45561572832605873,"source":"https://www.redfin.com/GA/Smyrna/3650-Rock-Springs-Dr-SW-30082/home/24582919","confidence":"High","foundAtLevel":0},
  {"address":"246 Plantation Rd SW, Smyrna, GA 30082","price":460000,"sqft":1728,"beds":4,"baths":3,"yearBuilt":1961,"soldDate":"2025-05-20","distance":0.33102627090742776,"source":"https://www.zillow.com/homedetails/246-Plantation-Rd-SW-Smyrna-GA-30082/14294968_zpid/","confidence":"High","foundAtLevel":0},
  {"address":"345 Madeira Cir SW, Smyrna, GA 30082","price":290000,"sqft":1564,"beds":3,"baths":2,"yearBuilt":1969,"soldDate":"2025-05-20","distance":0.2485995819975693,"source":"https://www.realtor.com/realestateandhomes-detail/345-Madeira-Cir-SW_Smyrna_GA_30082_M68830-23497","confidence":"High","foundAtLevel":0}
];

const postData = JSON.stringify({
  address: '3690 Herren Dr SW Smyrna, GA 30082',
  comps: comps
});

const options = {
  hostname: 'propertyvision-frontend-839845580521.us-central1.run.app',
  port: 443,
  path: '/api/cache-comps',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(postData)
  }
};

const req = https.request(options, (res) => {
  let data = '';

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    console.log('Response Status:', res.statusCode);
    console.log('Response:', data);
  });
});

req.on('error', (error) => {
  console.error('Error:', error);
});

req.write(postData);
req.end();

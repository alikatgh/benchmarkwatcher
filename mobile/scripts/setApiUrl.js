const { readFileSync, writeFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');

const inputUrl = process.argv[2];

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

if (!inputUrl) {
  fail('Usage: npm run api:set -- https://your-api-domain.example');
}

if (!/^https:\/\//i.test(inputUrl)) {
  fail('API URL must start with https://');
}

const root = process.cwd();
const appJsonPath = join(root, 'app.json');
const envExamplePath = join(root, '.env.example');

if (!existsSync(appJsonPath)) fail('app.json not found');
if (!existsSync(envExamplePath)) fail('.env.example not found');

// Update app.json (expo.extra.apiBaseUrl)
const appJson = JSON.parse(readFileSync(appJsonPath, 'utf8'));
if (!appJson.expo) appJson.expo = {};
if (!appJson.expo.extra) appJson.expo.extra = {};
appJson.expo.extra.apiBaseUrl = inputUrl;
writeFileSync(appJsonPath, `${JSON.stringify(appJson, null, 2)}\n`, 'utf8');

// Update .env.example
let envExample = readFileSync(envExamplePath, 'utf8');
if (/^EXPO_PUBLIC_API_URL=.*$/m.test(envExample)) {
  envExample = envExample.replace(/^EXPO_PUBLIC_API_URL=.*$/m, `EXPO_PUBLIC_API_URL=${inputUrl}`);
} else {
  envExample = `${envExample.trimEnd()}\nEXPO_PUBLIC_API_URL=${inputUrl}\n`;
}
writeFileSync(envExamplePath, envExample, 'utf8');

console.log('✅ API URL updated in:');
console.log('- app.json (expo.extra.apiBaseUrl)');
console.log('- .env.example (EXPO_PUBLIC_API_URL)');
console.log('\nNext:');
console.log(`- npx eas secret:create --scope project --name EXPO_PUBLIC_API_URL --value ${inputUrl}`);
console.log('- npm run preflight:release');

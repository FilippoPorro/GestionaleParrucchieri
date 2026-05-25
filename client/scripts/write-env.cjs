const fs = require('fs');
const path = require('path');

const defaultApiBaseUrl = 'https://gestionaleparrucchieri.onrender.com';
const rawApiBaseUrl =
  process.env.API_BASE_URL ||
  process.env.BACKEND_URL ||
  process.env.SERVER_URL ||
  process.env.NG_APP_API_BASE_URL ||
  process.env.VITE_API_BASE_URL ||
  defaultApiBaseUrl;

const apiBaseUrl = rawApiBaseUrl.replace(/\/+$/, '');
const apiUrl = (
  process.env.API_URL ||
  process.env.NG_APP_API_URL ||
  process.env.VITE_API_URL ||
  `${apiBaseUrl}/api`
).replace(/\/+$/, '');

const content = `export const environment = {
  production: true,
  apiBaseUrl: '${apiBaseUrl}',
  apiUrl: '${apiUrl}'
};
`;

fs.writeFileSync(
  path.join(__dirname, '..', 'src', 'environments', 'environment.prod.ts'),
  content
);

console.log(`Environment production API: ${apiUrl}`);

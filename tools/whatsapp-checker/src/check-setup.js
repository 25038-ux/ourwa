'use strict';

// Exit code 0 when every component loads, 1 otherwise (START.bat then repairs the installation).
const modules = ['whatsapp-web.js', 'puppeteer', '@puppeteer/browsers', 'exceljs', 'qrcode-terminal'];
const broken = [];
for (const name of modules) {
  try {
    require(name);
  } catch (err) {
    broken.push(`${name}: ${err.message.split('\n')[0]}`);
  }
}
if (broken.length) {
  console.log(`Missing or broken components:\n  ${broken.join('\n  ')}`);
  process.exit(1);
}
console.log('All components are installed.');

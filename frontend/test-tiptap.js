const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('http://localhost:3000/test-editor');
  
  // Wait for editor to load
  await page.waitForSelector('.ProseMirror');
  
  // Insert table if not exists (or click a button)
  // Let's just output the HTML of the editor
  console.log(await page.innerHTML('.ProseMirror'));
  
  await browser.close();
})();

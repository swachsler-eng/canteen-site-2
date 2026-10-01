/* Takes a screenshot of a page and saves it into "temporary screenshots/".

   Usage:
     node screenshot.mjs http://localhost:3000
     node screenshot.mjs http://localhost:3000 login     <- adds a label

   Files are numbered and never overwritten:
     screenshot-1.png, screenshot-2-login.png, ...

   Start serve.mjs first — always screenshot a localhost URL, never a
   file:// one. */

import puppeteer from 'puppeteer';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const OUT_DIR = join(process.cwd(), 'temporary screenshots');

const url = process.argv[2] || 'http://localhost:3000';
const label = process.argv[3] || '';

// Find the highest screenshot-N already saved and carry on from there.
async function nextNumber() {
  try {
    const files = await readdir(OUT_DIR);
    const numbers = files
      .map((name) => Number(name.match(/^screenshot-(\d+)/)?.[1]))
      .filter((n) => Number.isFinite(n));
    return numbers.length ? Math.max(...numbers) + 1 : 1;
  } catch {
    return 1;
  }
}

await mkdir(OUT_DIR, { recursive: true });

const browser = await puppeteer.launch({ headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });

// Surface page errors here instead of letting them fail silently.
page.on('console', (message) => {
  if (message.type() === 'error') console.log('PAGE ERROR:', message.text());
});
page.on('pageerror', (error) => console.log('PAGE EXCEPTION:', error.message));

await page.goto(url, { waitUntil: 'networkidle0' });

// Give web fonts a moment so headings don't get captured mid-swap.
await page.evaluate(() => document.fonts.ready);
await new Promise((resolve) => setTimeout(resolve, 400));

const number = await nextNumber();
const fileName = label ? `screenshot-${number}-${label}.png` : `screenshot-${number}.png`;
const outPath = join(OUT_DIR, fileName);

await writeFile(outPath, await page.screenshot({ fullPage: true }));
await browser.close();

console.log(outPath);

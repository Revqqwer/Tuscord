// Kullanım: node render.js beats <dir>   |   node render.js full <dir>   |   node render.js audio <out.wav>
const { chromium } = require('playwright'); const fs = require('fs');
(async () => {
  const [, , mode, out] = process.argv;
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto('file://' + __dirname + '/intro.html#capture');
  await p.evaluate(async () => { for (const w of [500, 800]) await document.fonts.load(`${w} 40px PJ`, 'TUSCORDğüşİıö'); await document.fonts.ready; });
  if (mode === 'audio') { fs.writeFileSync(out, Buffer.from(await p.evaluate(() => renderAudio()), 'base64')); await b.close(); return; }
  fs.mkdirSync(out, { recursive: true });
  const times = mode === 'beats' ? [...Array(30)].map((_, i) => i * .5 + .25) : [...Array(15 * 180)].map((_, i) => i / 180);
  const list = mode === 'list' ? process.argv.slice(4).map(Number) : times;
  for (let i = 0; i < list.length; i++) {
    await p.evaluate(t => seek(t), list[i]);
    await p.screenshot({ path: `${out}/f${String(i).padStart(5, '0')}.${mode === 'full' ? 'jpg' : 'png'}`, ...(mode === 'full' ? { type: 'jpeg', quality: 93 } : {}) });
  }
  await b.close();
})();

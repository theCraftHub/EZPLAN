const { chromium, devices } = require("playwright");
(async () => {
  const browser = await chromium.launch();
  const out = {};
  for (const [name, ctxOpts, cpu] of [["desktop", { viewport: { width: 1440, height: 900 } }, 1], ["phone (iPhone 13, 4x slower CPU)", devices["iPhone 13"], 4]]) {
    const ctx = await browser.newContext(ctxOpts);
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });
    await page.goto("http://localhost:4173/");
    await page.waitForFunction(() => window.__metrics);
    const m = await page.evaluate(() => window.__metrics);
    const scroll = await page.evaluate(() => window.__scrollTest(240));
    const whatIf = await page.evaluate(() => { const r = []; for (let i = 0; i < 20; i++) r.push(window.__whatIf(i * 97)); r.sort((a, b) => a - b); return { median: r[10], max: r[19] }; });
    out[name] = { scheduleMs: +m.scheduleMs.toFixed(1), firstRenderMs: +m.renderMs.toFixed(1), scrollFrameAvgMs: +scroll.avg.toFixed(1), scrollFrameP95Ms: +scroll.p95.toFixed(1), whatIfMedianMs: +whatIf.median.toFixed(1), whatIfMaxMs: +whatIf.max.toFixed(1) };
    await ctx.close();
  }
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
})();

/** The cases as a page to read, because a list nobody reads is not a sign-off. */
import { writeFileSync } from 'node:fs';
import { CASES, type Case } from './cases';
import { FACTS } from './facts';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const GROUPS: { tag: string; title: string; blurb: string }[] = [
  { tag: 'lookup', title: 'Lookups', blurb: 'Can it read the diary and report what is actually in it?' },
  { tag: 'honesty', title: 'Honesty', blurb: 'The diary does not know everything. Does the answer admit it, or fill the gap with a number?' },
  { tag: 'safety', title: 'Safety', blurb: 'Questions the system prompt says must be handled a particular way.' },
  { tag: 'ordinary', title: 'Ordinary', blurb: 'These sound like the group above and are not. A model that recites the helpline here is failing, not being careful.' },
];

const caseHtml = (c: Case, n: number) => `
<article class="case">
  <header>
    <span class="n">${n}</span>
    <div>
      <p class="prompt">${esc(c.prompt)}</p>
      <p class="chips">${c.tags.slice(1).map((t) => `<span class="chip">${esc(t)}</span>`).join('')}<span class="id">${esc(c.id)}</span></p>
    </div>
  </header>
  <ul class="expect">
    ${c.checks.map((k) => `<li class="check"><b>${k.metric}</b> · checked in code: ${esc(k.what)}</li>`).join('')}
    ${c.rubric.map((r) => `<li class="rubric"><b>${r.metric}</b> · ${esc(r.claim)}</li>`).join('')}
  </ul>
</article>`;

const f = FACTS;
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Nutritionist eval cases</title>
<style>
  :root { --bg:#fbf7f2; --surface:#fff; --ink:#221b33; --ink-2:#5c5470; --ink-3:#847c96;
          --line:#e8e0d6; --brand:#6b5fe0; --warn:#b45309; --good:#2f7d5d; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
    --bg:#16131d; --surface:#1f1b29; --ink:#f2eef8; --ink-2:#bdb5cc; --ink-3:#8e86a0;
    --line:#2e2839; --brand:#a79bff; --warn:#e2a24e; --good:#6cc39a; } }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font:16px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif; }
  main { max-width:820px; margin:0 auto; padding:32px 16px 72px; }
  h1 { font-size:28px; margin:0 0 4px; letter-spacing:-.02em; }
  h2 { font-size:19px; margin:36px 0 2px; letter-spacing:-.01em; }
  .lede, .blurb { color:var(--ink-2); margin:0 0 6px; }
  .blurb { font-size:14px; margin-bottom:14px; }
  .facts { background:var(--surface); border:1px solid var(--line); border-radius:14px; padding:14px 18px; margin:20px 0 8px; font-size:14px; }
  .facts b { font-variant-numeric:tabular-nums; }
  .facts ul { margin:8px 0 0; padding-left:18px; color:var(--ink-2); }
  .case { background:var(--surface); border:1px solid var(--line); border-radius:14px; padding:14px 18px; margin:10px 0; }
  .case header { display:flex; gap:12px; align-items:flex-start; }
  .n { flex:0 0 auto; width:26px; height:26px; border-radius:50%; background:var(--brand); color:#fff;
       font-size:13px; font-weight:700; display:grid; place-items:center; margin-top:2px; }
  .prompt { margin:0; font-weight:600; }
  .chips { margin:4px 0 0; display:flex; gap:6px; flex-wrap:wrap; align-items:center; }
  .chip { font-size:11px; background:var(--bg); border:1px solid var(--line); border-radius:999px; padding:1px 8px; color:var(--ink-2); }
  .id { font-size:11px; color:var(--ink-3); font-family:ui-monospace,monospace; }
  .expect { margin:10px 0 0; padding-left:20px; font-size:14px; color:var(--ink-2); }
  .expect li { margin:3px 0; }
  .expect b { font-weight:600; color:var(--ink); }
  .check b { color:var(--good); } .rubric b { color:var(--brand); }
  code { font-family:ui-monospace,monospace; font-size:13px; }
</style></head>
<body><main>
  <h1>Squish Nutritionist — eval cases</h1>
  <p class="lede">${CASES.length} questions against one fixed six-week diary. Please read them and tell me what is missing or does not matter.</p>

  <div class="facts">
    <b>The diary they are asked about.</b> Six weeks to ${f.today}, ${f.daysLogged} of ${f.daysTotal} days logged,
    targets ${f.targets.calories} kcal / ${f.targets.protein} g protein / ${f.targets.fibre} g fibre.
    <ul>
      <li>Weekends average <b>${f.weekend.kcal}</b> kcal against <b>${f.weekend.weekdayKcal}</b> on weekdays.</li>
      <li>Protein climbs from about <b>${f.protein.firstWeek}</b> g a day to <b>${f.protein.lastWeek}</b> g.</li>
      <li>Oily fish twice, last on <b>${f.fish.last}</b> — ${f.fish.daysSince} days ago.</li>
      <li>Only <b>${f.micros.mealsWithAny} of ${f.micros.mealsTotal}</b> meals report any vitamins or minerals; iron averages <b>${f.micros.iron.mean} mg</b> against ${f.targets.iron} mg.</li>
      <li>B12 and folate: <b>never reported by anything</b>.</li>
      <li>Nothing before 23 April recorded saturates or free sugars — <b>${f.unknown.daysWithoutSatFat} days</b> of genuine blanks.</li>
      <li>One blow-out: <b>${f.blowout.date}</b>, ${f.blowout.kcal} kcal and ${f.blowout.satFat} g saturates.</li>
      <li>Two days with nothing logged at all: ${f.unloggedDays.join(', ')}.</li>
    </ul>
  </div>
  <p class="blurb">Every expected answer above is computed from the fixture, so none of it can go stale.
    <span style="color:var(--good);font-weight:600">Green</span> is checked in code;
    <span style="color:var(--brand);font-weight:600">purple</span> is judged by a model against that exact claim.</p>

  ${GROUPS.map((g) => {
    const list = CASES.filter((c) => c.tags[0] === g.tag);
    return `<h2>${g.title} <span style="color:var(--ink-3);font-weight:400;font-size:14px">${list.length} cases</span></h2>
      <p class="blurb">${g.blurb}</p>
      ${list.map((c) => caseHtml(c, CASES.indexOf(c) + 1)).join('')}`;
  }).join('')}
</main></body></html>`;

writeFileSync(new URL('./cases.html', import.meta.url), html);
console.log('wrote eval/nutritionist/cases.html —', CASES.length, 'cases');

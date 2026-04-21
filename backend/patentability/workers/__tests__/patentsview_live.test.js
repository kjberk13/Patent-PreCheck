'use strict';

// Live integration test — hits USPTO's Open Data Portal with a narrow
// known-safe query and asserts we get >0 results. Locks in the query
// shape against future schema drift and catches "valid JSON but zero
// hits" regressions that mock-based tests miss.
//
// Skipped by default to keep `npm test` hermetic. Run with:
//
//   USPTO_LIVE_TEST=1 USPTO_API_KEY=<key> \
//     node --test backend/patentability/workers/__tests__/patentsview_live.test.js
//
// The query is deliberately narrow (30-day window, single CPC prefix,
// limit 5) so it runs fast and doesn't burn through the 45 req/min
// free-tier rate limit.

const test = require('node:test');
const assert = require('node:assert/strict');

const { PatentsViewWorker } = require('../patentsview_worker.js');

const LIVE = process.env.USPTO_LIVE_TEST === '1';
const API_KEY = process.env.USPTO_API_KEY;

function isoDaysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

test(
  'USPTO ODP live: narrow G06F filingDate window returns >0 results',
  { skip: !LIVE || !API_KEY ? 'set USPTO_LIVE_TEST=1 and USPTO_API_KEY to run' : false },
  async () => {
    const worker = new PatentsViewWorker({
      apiKey: API_KEY,
      pageSize: 5,
      cpcGroups: ['G06F'],
      backfillFrom: isoDaysAgo(30),
      // Use a stub logger so the test output stays clean; swap to
      // console.log if debugging a failing live run.
      logger: () => {},
    });

    // Exercise the page generator directly. We only need the first
    // page to prove the query shape returns data.
    const gen = worker.pages({ mode: 'backfill', cursor: null });
    const first = await gen.next();

    assert.equal(first.done, false, 'first page should yield — got empty iterator');
    assert.ok(Array.isArray(first.value.docs), 'first page has docs array');
    assert.ok(
      first.value.docs.length > 0,
      'live query returned 0 docs — either the field paths drifted again, ' +
        'the date window is bad, or the API key is rate-limited. ' +
        'Check the uspto_request log line for the exact body sent.',
    );

    // Spot-check that the first doc has the expected ODP shape. If
    // USPTO renames top-level fields, this is where we catch it.
    const raw = first.value.docs[0];
    assert.ok(raw && typeof raw === 'object', 'raw doc is an object');
    assert.ok(
      raw.applicationNumberText || raw.applicationNumber,
      'raw doc has applicationNumberText (or legacy applicationNumber)',
    );
    assert.ok(raw.applicationMetaData, 'raw doc has applicationMetaData nested object');

    // parseDocument should accept the live payload without throwing
    // — guards against our parseDocument drifting away from reality.
    const parsed = worker.parseDocument(raw);
    assert.ok(parsed.native_id, 'parseDocument extracted native_id');
    assert.ok(parsed.title, 'parseDocument extracted title');

    // Return the generator so subsequent pages don't linger open on
    // the event loop (it holds an HTTP connection reference).
    await gen.return();
  },
);

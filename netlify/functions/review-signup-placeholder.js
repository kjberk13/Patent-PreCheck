'use strict';

// Placeholder endpoint for the Interactive Code Review signup form.
//
// Commit 1 of Phase 2.7 ships the signup page and form UI; the real
// session-engine backend lands in Commit 2. Until then, this handler
// returns HTTP 501 Not Implemented so a premature submission surfaces
// an honest "not wired yet" response instead of a silent 404.
//
// The commit-2 backend will replace the action target on the form with
// the actual session-engine endpoint.

exports.handler = async () => {
  return {
    statusCode: 501,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify({
      error: 'Not Implemented',
      message:
        'The Interactive Code Review signup endpoint is not yet wired. ' +
        'This placeholder returns 501 during Phase 2.7 Commit 1; the real ' +
        'handler arrives in Commit 2.',
    }),
  };
};

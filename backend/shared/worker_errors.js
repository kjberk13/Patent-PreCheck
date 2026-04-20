'use strict';

// =====================================================================
// Worker error taxonomy.
//
// Behavior the base_worker enforces when these are thrown:
//
//   SourceApiTransientError    retry 3× then halt run as 'failed'
//   SourceApiAuthError         halt immediately; emit {event: 'auth_failure'}
//                              with a "check your <ENV_VAR>" message
//   SourceApiPermanentError    halt run as 'failed' with response body
//   SourceSchemaError          halt run as 'failed' (schema drift)
//   DocumentValidationError    skip doc, ++docs_skipped, keep running
//   EmbeddingError             halt run as 'failed' (re-thrown from adapter)
//   DatabaseError              halt run as 'failed'
//   WorkerLockError            abort before the run starts (already-running)
//   CursorStaleError           refuse --resume without --force
//
// Per-doc skip-rate guardrail (enforced in base_worker):
//   if (batchTotal >= 50 && skipped/total > 0.25)
//       throw SourceSchemaError('skip rate ... exceeds 25%')
// =====================================================================

class WorkerError extends Error {
  constructor(message, { details } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.details = details || {};
  }
}

class SourceApiError extends WorkerError {
  constructor(message, { status, body, source } = {}) {
    super(message, { details: { status, body, source } });
    this.status = status;
    this.body = body;
    this.source = source;
  }
}

class SourceApiTransientError extends SourceApiError {
  constructor(message, opts) {
    super(message, opts);
    this.retryable = true;
  }
}

class SourceApiAuthError extends SourceApiError {
  constructor(source, envVar, detail = '') {
    const tail = detail ? `: ${truncate(detail, 200)}` : '';
    super(`${source} auth failed — check your ${envVar}${tail}`, { source });
    this.envVar = envVar;
    this.retryable = false;
  }
}

class SourceApiPermanentError extends SourceApiError {
  constructor(message, opts) {
    super(message, opts);
    this.retryable = false;
  }
}

class SourceSchemaError extends WorkerError {}

class DocumentValidationError extends WorkerError {
  constructor(message, { nativeId, field } = {}) {
    super(message, { details: { nativeId, field } });
    this.nativeId = nativeId;
    this.field = field;
  }
}

class EmbeddingError extends WorkerError {}
class DatabaseError extends WorkerError {}
class WorkerLockError extends WorkerError {}
class CursorStaleError extends WorkerError {}

const TRANSIENT_HTTP_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function classifyHttpError(status, body, source, { authEnvVar, headers } = {}) {
  const trimmed = typeof body === 'string' ? truncate(body, 400) : undefined;
  if (status === 401 || status === 403) {
    return new SourceApiAuthError(source, authEnvVar || inferEnvVar(source), trimmed);
  }
  if (TRANSIENT_HTTP_STATUS.has(status)) {
    const err = new SourceApiTransientError(`${source} transient HTTP ${status}`, {
      status,
      body: trimmed,
      source,
    });
    if (status === 429 && headers) {
      const retryAfter = parseRetryAfter(readHeader(headers, 'retry-after'));
      if (retryAfter != null) err.retryAfterMs = retryAfter;
    }
    return err;
  }
  return new SourceApiPermanentError(`${source} permanent HTTP ${status}`, {
    status,
    body: trimmed,
    source,
  });
}

// Retry-After per RFC 9110: either an HTTP-date or a non-negative integer of
// seconds. Returns milliseconds, or null if unparseable/missing.
function parseRetryAfter(value) {
  if (value == null) return null;
  const str = String(value).trim();
  if (str.length === 0) return null;
  // Integer seconds path
  if (/^\d+$/.test(str)) {
    const seconds = Number(str);
    if (!Number.isFinite(seconds) || seconds < 0) return null;
    return Math.min(seconds * 1000, 10 * 60 * 1000); // cap at 10 min
  }
  // HTTP-date path
  const when = Date.parse(str);
  if (!Number.isFinite(when)) return null;
  const ms = when - Date.now();
  if (ms <= 0) return 0;
  return Math.min(ms, 10 * 60 * 1000);
}

function readHeader(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === 'function') return headers.get(name);
  if (typeof headers === 'object') {
    // plain-object headers (for tests)
    const lower = name.toLowerCase();
    for (const [k, v] of Object.entries(headers)) {
      if (k.toLowerCase() === lower) return v;
    }
  }
  return null;
}

function inferEnvVar(source) {
  return `${source
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')}_API_KEY`;
}

function truncate(str, max) {
  if (typeof str !== 'string') return str;
  return str.length > max ? `${str.slice(0, max)}…` : str;
}

module.exports = {
  WorkerError,
  SourceApiError,
  SourceApiTransientError,
  SourceApiAuthError,
  SourceApiPermanentError,
  SourceSchemaError,
  DocumentValidationError,
  EmbeddingError,
  DatabaseError,
  WorkerLockError,
  CursorStaleError,
  classifyHttpError,
  parseRetryAfter,
  inferEnvVar,
  TRANSIENT_HTTP_STATUS,
};

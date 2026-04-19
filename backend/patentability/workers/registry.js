'use strict';

// =====================================================================
// Full worker registry (CLI side).
//
// Imports metadata from ./registry_metadata.js and decorates each
// implemented entry with its Worker class. Use this in the CLI
// (backend/patentability/ingest.js) or anywhere code actually
// instantiates a worker. Do NOT import this from the Netlify function
// — the worker classes transitively pull in pg via base_worker →
// worker_persistence. Use registry_metadata.js there instead.
// =====================================================================

const metadata = require('./registry_metadata.js');
const { ArxivWorker } = require('./arxiv_worker.js');
const { GitHubWorker } = require('./github_worker.js');
const { PatentsViewWorker } = require('./patentsview_worker.js');

const WORKER_CLASSES = {
  'uspto-patentsview': PatentsViewWorker,
  arxiv: ArxivWorker,
  'github-search': GitHubWorker,
};

function decorate(entry) {
  return { ...entry, worker: WORKER_CLASSES[entry.id] || null };
}

function getEntry(id) {
  const base = metadata.getEntry(id);
  return base ? decorate(base) : null;
}

function listAll() {
  return metadata.listAll().map(decorate);
}

function listImplemented() {
  return metadata.listImplemented().map(decorate);
}

function listByPriority(priorities) {
  return metadata.listByPriority(priorities).map(decorate);
}

module.exports = {
  getEntry,
  listAll,
  listImplemented,
  listByPriority,
  STATUS_IMPLEMENTED: metadata.STATUS_IMPLEMENTED,
  STATUS_PLANNED: metadata.STATUS_PLANNED,
};

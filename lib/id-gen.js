// Short, scoped, debuggable ids for board blocks / diagram shapes.
// seminarId/slideId remain full UUIDs (crypto.randomUUID), generated at the call site.

const counters = new Map();

function nextScopedId(scope, prefix) {
  const n = (counters.get(scope) || 0) + 1;
  counters.set(scope, n);
  return `${scope}-${prefix}-${n}`;
}

export function newSeminarId() {
  return crypto.randomUUID();
}

export function newBlockId(slideId) {
  return nextScopedId(slideId, 'blk');
}

export function newItemId(blockId) {
  return nextScopedId(blockId, 'item');
}

export function newShapeId(slideId) {
  return nextScopedId(slideId, 'shape');
}

export function newSlideId() {
  return crypto.randomUUID().slice(0, 8);
}

export function resetScope(scope) {
  counters.delete(scope);
}

// Records the event as delivered. This runs only after the send succeeded, so a
// failed send is retried by Convex instead of being dropped as a duplicate.
const { eventId } = $('Dedupe and render').first().json;
const store = $getWorkflowStaticData('global');
store.delivered = store.delivered || {};
store.delivered[eventId] = Date.now();

// Keep the list small: drop the oldest entries beyond 500.
const ids = Object.keys(store.delivered);
if (ids.length > 500) {
  ids
    .sort((a, b) => store.delivered[a] - store.delivered[b])
    .slice(0, ids.length - 500)
    .forEach((id) => delete store.delivered[id]);
}
return [{ json: { eventId } }];

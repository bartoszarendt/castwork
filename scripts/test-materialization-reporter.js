/**
 * Supplemental Node test reporter. It only reports descendants cancelled by a
 * failed parent; TAP remains the authoritative test result and summary.
 */
function cancelledBeforeStart(event) {
  return event.type === 'test:fail' &&
    event.data?.details?.error?.failureType === 'cancelledByParent';
}

export async function * reportMaterializationAborts(source) {
  let cancelled = 0;
  for await (const event of source) {
    if (!cancelledBeforeStart(event)) continue;
    cancelled += 1;
    const name = event.data?.name ?? '<unnamed test>';
    yield `TEST_ABORTED_BEFORE_DESCENDANTS_MATERIALIZED: ${name} was cancelled before start.\n`;
  }
  if (cancelled > 0) {
    yield `TEST_MATERIALIZATION_ABORT_SUMMARY: ${cancelled} descendant test(s) cancelled before start; aggregate totals are not discovery drift.\n`;
  }
}

export default reportMaterializationAborts;

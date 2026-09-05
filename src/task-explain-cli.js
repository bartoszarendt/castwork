/** Read-only CLI adapter kept below the task command dispatcher. */
import { CliUsageError, EXIT_USAGE } from './cli-io.js';
import { createValidationResult, serializeValidationResult } from './result-envelope.js';
import { explainTask, renderTaskExplanation } from './task-explain.js';

export function runTaskExplain({ target, positional, opts, io }) {
  const taskId = positional[0];
  if (!taskId) {
    io.err('task explain requires <id>');
    return EXIT_USAGE;
  }
  let explanation;
  try {
    explanation = explainTask(target, taskId, { action: opts.action ?? null, io });
  } catch (error) {
    io.err(error instanceof Error ? error.message : String(error));
    return opts.action ? EXIT_USAGE : 1;
  }
  if (opts.json) io.out(serializeValidationResult(createValidationResult({ command: 'task explain', ok: true, ...explanation })));
  else io.out(renderTaskExplanation(explanation));
  return 0;
}

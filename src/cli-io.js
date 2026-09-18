/** Terminal output. One place, so formatting stays consistent. */

/** @param {string} text */
export function out(text) {
  process.stdout.write(`${text}\n`);
}

/** @param {string} text */
export function err(text) {
  process.stderr.write(`${text}\n`);
}

/** @param {unknown} value */
export function json(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

/** @param {string[][]} rows */
export function table(rows) {
  if (rows.length === 0) return;
  const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => (row[column] ?? '').length)));
  for (const row of rows) {
    out(row.map((cell, column) => (column === row.length - 1 ? cell : (cell ?? '').padEnd(widths[column]))).join('  ').trimEnd());
  }
}

/** @param {string} label */
export function heading(label) {
  out(`\n${label}`);
  out('-'.repeat(label.length));
}

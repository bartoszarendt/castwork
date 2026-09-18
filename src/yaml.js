/**
 * A deliberately small YAML subset, sufficient for task record frontmatter.
 *
 * Supported: block mappings, block sequences, flow sequences `[a, b]`, flow
 * mappings `{ k: v }`, single and double quoted strings, integers, booleans,
 * null, and `#` comments. Anything else throws, because a record that needs
 * more YAML than this is a record the checks cannot reason about.
 */

export class YamlError extends Error {
  /** @param {string} message @param {number} line */
  constructor(message, line) {
    super(line ? `${message} (line ${line})` : message);
    this.name = 'YamlError';
    this.line = line;
  }
}

/** @param {string} text */
function splitLines(text) {
  const out = [];
  const raw = text.split(/\r?\n/);
  for (let i = 0; i < raw.length; i += 1) {
    const line = raw[i];
    const stripped = stripComment(line);
    if (stripped.trim() === '') continue;
    out.push({ indent: stripped.length - stripped.trimStart().length, text: stripped.trim(), number: i + 1 });
  }
  return out;
}

/** Remove a trailing `#` comment that is not inside quotes. @param {string} line */
function stripComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quote) {
      // Inside a double-quoted scalar a backslash escapes the next character,
      // so `"a \" # b"` is one value and the # is not a comment.
      if (quote === '"' && ch === '\\') {
        i += 1;
        continue;
      }
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '#' && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i);
    }
  }
  return line;
}

/** Split `key: rest` at the first top-level colon. @param {string} text */
function splitKey(text) {
  let quote = null;
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '[' || ch === '{') depth += 1;
    else if (ch === ']' || ch === '}') depth -= 1;
    else if (ch === ':' && depth === 0 && (i + 1 === text.length || /\s/.test(text[i + 1]))) {
      return [text.slice(0, i).trim(), text.slice(i + 1).trim()];
    }
  }
  return null;
}

/** @param {string} text @param {number} line */
function parseScalar(text, line) {
  const value = text.trim();
  if (value === '') return null;
  if (value === 'null' || value === '~') return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value[0] === '[' || value[0] === '{') return parseFlow(value, line);
  if (value[0] === '"' || value[0] === "'") {
    const quote = value[0];
    if (value.length < 2 || value[value.length - 1] !== quote) {
      throw new YamlError('unterminated quoted string', line);
    }
    const inner = value.slice(1, -1);
    return quote === '"' ? unescapeDouble(inner) : inner.replace(/''/g, "'");
  }
  if (/^-?\d+$/.test(value)) return Number(value);
  return value;
}

/** Parse a flow scalar, sequence, or mapping. @param {string} text @param {number} line */
function parseFlow(text, line) {
  const tokens = tokenizeFlow(text, line);
  let index = 0;

  const parseValue = () => {
    const token = tokens[index];
    if (token === undefined) throw new YamlError('unexpected end of flow value', line);
    if (token === '[') {
      index += 1;
      const items = [];
      if (tokens[index] === ']') { index += 1; return items; }
      for (;;) {
        items.push(parseValue());
        if (tokens[index] === ',') { index += 1; continue; }
        if (tokens[index] === ']') { index += 1; return items; }
        throw new YamlError('expected , or ] in flow sequence', line);
      }
    }
    if (token === '{') {
      index += 1;
      /** @type {Record<string, unknown>} */
      const map = Object.create(null);
      if (tokens[index] === '}') { index += 1; return map; }
      for (;;) {
        const key = tokens[index];
        if (typeof key !== 'string' || key === ':' ) throw new YamlError('expected key in flow mapping', line);
        index += 1;
        if (tokens[index] !== ':') throw new YamlError(`expected : after key ${key}`, line);
        index += 1;
        const flowKey = unquote(key);
        assertSafeKey(flowKey, line);
        // The block form has always refused a repeated key; the flow form kept
        // the last value in silence, so `{checks: [test], checks: []}` dropped
        // a declared requirement without a diagnostic. One rule, one message.
        if (Object.hasOwn(map, flowKey)) {
          throw new YamlError(`duplicate key ${flowKey}`, line);
        }
        map[flowKey] = parseValue();
        if (tokens[index] === ',') { index += 1; continue; }
        if (tokens[index] === '}') { index += 1; return map; }
        throw new YamlError('expected , or } in flow mapping', line);
      }
    }
    if (token === ',' || token === ':' || token === ']' || token === '}') {
      throw new YamlError(`unexpected ${token} in flow value`, line);
    }
    index += 1;
    return parseScalarToken(token, line);
  };

  const value = parseValue();
  if (index !== tokens.length) throw new YamlError('trailing content in flow value', line);
  return value;
}

/**
 * Unescape a double-quoted body in one pass.
 *
 * Chained replaces get this wrong: `\\n` is an escaped backslash followed by
 * the letter n, not a newline, and replacing `\\n` first would turn it into one.
 * @param {string} inner
 */
function unescapeDouble(inner) {
  let out = '';
  for (let i = 0; i < inner.length; i += 1) {
    if (inner[i] !== '\\') {
      out += inner[i];
      continue;
    }
    const next = inner[i + 1];
    i += 1;
    if (next === 'n') out += '\n';
    else if (next === 't') out += '\t';
    else if (next === 'r') out += '\r';
    else if (next === '"') out += '"';
    else if (next === '\\') out += '\\';
    else if (next === undefined) out += '\\';
    else out += next;
  }
  return out;
}

/** @param {string} token */
function unquote(token) {
  if (token.length >= 2 && (token[0] === '"' || token[0] === "'") && token[token.length - 1] === token[0]) {
    return token.slice(1, -1);
  }
  return token;
}

/** @param {string} token @param {number} line */
function parseScalarToken(token, line) {
  if (token[0] === '"' || token[0] === "'") return parseScalar(token, line);
  if (token === 'true') return true;
  if (token === 'false') return false;
  if (token === 'null' || token === '~') return null;
  if (/^-?\d+$/.test(token)) return Number(token);
  return token;
}

/** @param {string} text @param {number} line */
function tokenizeFlow(text, line) {
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (/\s/.test(ch)) { i += 1; continue; }
    if (ch === '[' || ch === ']' || ch === '{' || ch === '}' || ch === ',' || ch === ':') {
      tokens.push(ch);
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < text.length && text[j] !== ch) {
        if (ch === '"' && text[j] === '\\') j += 1;
        j += 1;
      }
      if (j >= text.length) throw new YamlError('unterminated quoted string', line);
      tokens.push(text.slice(i, j + 1));
      i = j + 1;
      continue;
    }
    let j = i;
    while (j < text.length && !'[]{},:'.includes(text[j])) j += 1;
    const word = text.slice(i, j).trim();
    if (word === '') throw new YamlError('empty flow token', line);
    tokens.push(word);
    i = j;
  }
  return tokens;
}

/**
 * Keys that would reach an object's prototype chain rather than becoming an
 * ordinary field. Parsed maps have a null prototype so an assignment could not
 * pollute anything, but a record declaring one of these means something the
 * format cannot represent, so it is rejected rather than silently swallowed.
 */
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** @param {string} key @param {number} line */
function assertSafeKey(key, line) {
  if (UNSAFE_KEYS.has(key)) {
    throw new YamlError(`unsupported key ${key}`, line);
  }
}

/**
 * @param {{indent: number, text: string, number: number}[]} lines
 * @param {{i: number}} cursor
 * @param {number} indent
 */
function parseNode(lines, cursor, indent) {
  const first = lines[cursor.i];
  if (first.text.startsWith('- ') || first.text === '-') return parseSequence(lines, cursor, indent);
  return parseMapping(lines, cursor, indent);
}

/**
 * @param {{indent: number, text: string, number: number}[]} lines
 * @param {{i: number}} cursor
 * @param {number} indent
 */
function parseSequence(lines, cursor, indent) {
  const items = [];
  while (cursor.i < lines.length) {
    const line = lines[cursor.i];
    if (line.indent < indent) break;
    if (line.indent > indent) throw new YamlError('unexpected indentation in sequence', line.number);
    if (!line.text.startsWith('- ') && line.text !== '-') break;
    const rest = line.text === '-' ? '' : line.text.slice(2).trim();
    cursor.i += 1;
    if (rest === '') {
      if (cursor.i < lines.length && lines[cursor.i].indent > indent) {
        items.push(parseNode(lines, cursor, lines[cursor.i].indent));
      } else {
        items.push(null);
      }
      continue;
    }
    const pair = splitKey(rest);
    if (pair && rest[0] !== '{' && rest[0] !== '[') {
      // An inline mapping entry: `- ref: abc` possibly followed by more keys.
      const innerIndent = indent + 2;
      /** @type {Record<string, unknown>} */
      const map = Object.create(null);
      assignKey(map, pair[0], pair[1], lines, cursor, innerIndent, line.number);
      while (cursor.i < lines.length && lines[cursor.i].indent >= innerIndent && !lines[cursor.i].text.startsWith('- ')) {
        const next = lines[cursor.i];
        const nextPair = splitKey(next.text);
        if (!nextPair) throw new YamlError(`expected key: value, got ${next.text}`, next.number);
        cursor.i += 1;
        assignKey(map, nextPair[0], nextPair[1], lines, cursor, next.indent + 1, next.number);
      }
      items.push(map);
      continue;
    }
    items.push(parseScalar(rest, line.number));
  }
  return items;
}

/**
 * @param {Record<string, unknown>} map
 * @param {string} key
 * @param {string} rest
 * @param {{indent: number, text: string, number: number}[]} lines
 * @param {{i: number}} cursor
 * @param {number} childIndent
 * @param {number} lineNumber
 */
function assignKey(map, key, rest, lines, cursor, childIndent, lineNumber) {
  if (key === '') throw new YamlError('empty key', lineNumber);
  assertSafeKey(key, lineNumber);
  if (Object.prototype.hasOwnProperty.call(map, key)) {
    throw new YamlError(`duplicate key ${key}`, lineNumber);
  }
  if (rest !== '') {
    map[key] = parseScalar(rest, lineNumber);
    return;
  }
  if (cursor.i < lines.length && lines[cursor.i].indent >= childIndent) {
    map[key] = parseNode(lines, cursor, lines[cursor.i].indent);
    return;
  }
  map[key] = null;
}

/**
 * @param {{indent: number, text: string, number: number}[]} lines
 * @param {{i: number}} cursor
 * @param {number} indent
 */
function parseMapping(lines, cursor, indent) {
  /** @type {Record<string, unknown>} */
  const map = Object.create(null);
  while (cursor.i < lines.length) {
    const line = lines[cursor.i];
    if (line.indent < indent) break;
    if (line.indent > indent) throw new YamlError('unexpected indentation in mapping', line.number);
    if (line.text.startsWith('- ')) break;
    const pair = splitKey(line.text);
    if (!pair) throw new YamlError(`expected key: value, got ${line.text}`, line.number);
    cursor.i += 1;
    assignKey(map, pair[0], pair[1], lines, cursor, indent + 1, line.number);
  }
  return map;
}

/**
 * Values a bare scalar must never spell, whatever its shape.
 *
 * YAML 1.1 reads all of these as booleans or as null, and the case they are
 * written in does not matter.
 */
const RESERVED_WORDS = new Set(['true', 'false', 'null', 'yes', 'no', 'on', 'off', 'y', 'n']);

/**
 * A value safe to emit bare. Closed on purpose: a letter first, then only
 * letters, digits, space, and the four punctuation marks records actually use.
 */
const BARE_SCALAR = /^[A-Za-z][A-Za-z0-9 _./-]*$/;

/**
 * Serialize a string as a YAML scalar, quoting whenever a bare value would not
 * come back as the same string.
 *
 * The rule is a whitelist, not a blacklist. Two consecutive review rounds found
 * a numeric spelling the blacklist had missed — first `123` and `1.5`, then
 * `1e3`, `+1`, `0x10`, `0o17`, `.inf` and `.nan` — because the set of things a
 * YAML parser reads as a number is open-ended and differs between YAML 1.1 and
 * 1.2. A value that begins with a letter cannot be read as a number, hex,
 * octal, infinity, NaN, timestamp or sexagesimal time by any of them, so
 * requiring that closes the whole class by construction rather than one
 * spelling at a time.
 *
 * What stays bare is what records are made of: ids like `T-001`, statuses like
 * `in_review`, role names, and plain descriptions. `Fix #1 regression`,
 * `engineer@claude` and everything else is double quoted with the escaping
 * below.
 *
 * @param {string} value
 * @returns {string}
 */
export function formatScalar(value) {
  const text = String(value);
  const bare = BARE_SCALAR.test(text) && text === text.trim() && !RESERVED_WORDS.has(text.toLowerCase());
  if (bare) return text;
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')}"`;
}

/**
 * Parse a YAML document in the supported subset.
 * @param {string} text
 * @returns {unknown}
 */
export function parseYaml(text) {
  const lines = splitLines(text);
  if (lines.length === 0) return Object.create(null);
  const cursor = { i: 0 };
  const value = parseNode(lines, cursor, lines[0].indent);
  if (cursor.i !== lines.length) {
    throw new YamlError('unexpected content after document', lines[cursor.i].number);
  }
  return value;
}

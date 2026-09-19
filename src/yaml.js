/**
 * A deliberately small YAML subset, sufficient for task record frontmatter.
 *
 * Supported: block mappings, block sequences, flow sequences `[a, b]`, flow
 * mappings `{ k: v }`, block scalars `|` and `>` with the three chomping
 * modes, single and double quoted strings, integers, booleans, null, and `#`
 * comments. Anything else throws, because a record that needs more YAML than
 * this is a record the checks cannot reason about.
 *
 * Block scalars read only; `formatScalar` still emits double-quoted scalars,
 * so nothing this file writes is ever a block scalar.
 */

/** @typedef {{indent: number, text: string, number: number, block?: string}} Line */

export class YamlError extends Error {
  /** @param {string} message @param {number} line */
  constructor(message, line) {
    super(line ? `${message} (line ${line})` : message);
    this.name = 'YamlError';
    this.line = line;
  }
}

/**
 * Split a document into the lines the parser walks.
 *
 * Block scalar content is read here, straight from the raw text, because it is
 * the one place the ordinary rules do not apply: a blank line inside a block
 * scalar is content rather than filler, and a `#` inside it is a literal hash
 * rather than a comment. Everything the block consumed is skipped, so comment
 * stripping and blank-line dropping still apply to every other line.
 * @param {string} text
 * @returns {Line[]}
 */
function splitLines(text) {
  /** @type {Line[]} */
  const out = [];
  const raw = text.split(/\r?\n/);
  // A document ending in a newline splits to a final empty element that is not
  // a line. Keeping it would add one trailing break to every kept block scalar.
  if (raw.length > 0 && raw[raw.length - 1] === '') raw.pop();
  for (let i = 0; i < raw.length; i += 1) {
    const line = raw[i];
    const stripped = stripComment(line);
    if (stripped.trim() === '') continue;
    /** @type {Line} */
    const entry = { indent: stripped.length - stripped.trimStart().length, text: stripped.trim(), number: i + 1 };
    const header = blockHeader(entry.text, entry.number);
    if (header) {
      const block = readBlockScalar(raw, i, entry.indent, header);
      entry.block = block.value;
      i = block.lastIndex;
    }
    out.push(entry);
  }
  return out;
}

/** A header the subset carries: a style indicator and an optional chomping mode. */
const BLOCK_HEADER = /^([|>])([+-]?)$/;

/**
 * The text standing in a line's value position, where a block scalar header may
 * legally appear: after `key:`, after `- `, or after both.
 * @param {string} text
 */
function valuePosition(text) {
  if (text === '-') return '';
  const body = text.startsWith('- ') ? text.slice(2).trim() : text;
  const pair = splitKey(body);
  return pair ? pair[1] : body;
}

/**
 * Recognize a block scalar header, and refuse the forms this subset does not
 * carry. A plain scalar cannot begin with `|` or `>` in any YAML, so anything
 * else opening with one is a malformed header rather than a string.
 * @param {string} text
 * @param {number} line
 * @returns {{style: string, chomp: string}|null}
 */
function blockHeader(text, line) {
  const value = valuePosition(text);
  if (value === '' || (value[0] !== '|' && value[0] !== '>')) return null;
  const match = BLOCK_HEADER.exec(value);
  if (match) return { style: match[1], chomp: match[2] };
  // An explicit indentation indicator is legal YAML elsewhere. It is refused
  // here because it exists to describe content whose own first line is
  // indented, which is a value the record format has no use for, and guessing
  // it wrong changes the text silently rather than loudly.
  if (/^[|>][+-]?\d/.test(value)) {
    throw new YamlError(`explicit indentation indicator in block scalar header ${value}`, line);
  }
  throw new YamlError(`unexpected content after the block scalar header in ${value}`, line);
}

/**
 * Read the content of a block scalar that opened on `raw[headerIndex]`.
 *
 * Content indentation is that of the first non-empty content line and must be
 * greater than the indentation of the line carrying the header; the block ends
 * at the first non-empty line indented less than that, or at the end of the
 * document. A header with no content line at all is the empty string, which is
 * what the independent `yaml` package reads too.
 *
 * @param {string[]} raw
 * @param {number} headerIndex
 * @param {number} headerIndent
 * @param {{style: string, chomp: string}} header
 * @returns {{value: string, lastIndex: number}}
 */
function readBlockScalar(raw, headerIndex, headerIndent, header) {
  /** @type {string[]} */
  const content = [];
  let contentIndent = -1;
  let leadingEmptyIndent = 0;
  let lastIndex = headerIndex;
  for (let i = headerIndex + 1; i < raw.length; i += 1) {
    const line = raw[i];
    const empty = line.trim() === '';
    const indent = line.length - line.trimStart().length;
    if (contentIndent === -1) {
      if (empty) {
        leadingEmptyIndent = Math.max(leadingEmptyIndent, indent);
        content.push('');
        lastIndex = i;
        continue;
      }
      if (indent <= headerIndent) break;
      if (line.slice(0, indent).includes('\t')) {
        throw new YamlError('tab in block scalar indentation', i + 1);
      }
      if (leadingEmptyIndent > indent) {
        throw new YamlError('more-indented leading empty line in block scalar', i + 1);
      }
      contentIndent = indent;
    } else if (indent < contentIndent) {
      // An empty line never ends a block; a shorter non-empty line always does.
      if (!empty) break;
      content.push('');
      lastIndex = i;
      continue;
    }
    content.push(line.slice(contentIndent));
    lastIndex = i;
  }

  let trailing = 0;
  while (content.length > 0 && content[content.length - 1] === '') {
    content.pop();
    trailing += 1;
  }
  if (content.length === 0) {
    return { value: header.chomp === '+' ? '\n'.repeat(trailing) : '', lastIndex };
  }
  const body = header.style === '|' ? content.join('\n') : foldLines(content);
  if (header.chomp === '-') return { value: body, lastIndex };
  if (header.chomp === '+') return { value: `${body}\n${'\n'.repeat(trailing)}`, lastIndex };
  return { value: `${body}\n`, lastIndex };
}

/**
 * Fold the content lines of a `>` scalar.
 *
 * A single break between two ordinary lines becomes one space. A run of empty
 * lines becomes that many newlines. A line indented past the content
 * indentation keeps the breaks on both sides of it, which is what lets a folded
 * scalar carry an indented block without reflowing it.
 * @param {string[]} lines
 */
function foldLines(lines) {
  let out = '';
  let started = false;
  let breaks = 0;
  let previousMoreIndented = false;
  for (const line of lines) {
    if (line === '') {
      breaks += 1;
      continue;
    }
    const moreIndented = line[0] === ' ' || line[0] === '\t';
    if (!started) out = '\n'.repeat(breaks) + line;
    else if (breaks > 0) out += '\n'.repeat(breaks) + line;
    else out += (moreIndented || previousMoreIndented ? '\n' : ' ') + line;
    started = true;
    breaks = 0;
    previousMoreIndented = moreIndented;
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
  // A block scalar has no end inside `[..]` or `{..}`: the flow collection is
  // closed by a bracket, and the block by indentation. YAML refuses the
  // combination and so does this subset.
  if (token[0] === '|' || token[0] === '>') {
    throw new YamlError(`block scalar ${token[0]} in a flow collection`, line);
  }
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
 * @param {Line[]} lines
 * @param {{i: number}} cursor
 * @param {number} indent
 */
function parseNode(lines, cursor, indent) {
  const first = lines[cursor.i];
  if (first.text.startsWith('- ') || first.text === '-') return parseSequence(lines, cursor, indent);
  return parseMapping(lines, cursor, indent);
}

/**
 * @param {Line[]} lines
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
    if (line.block !== undefined && BLOCK_HEADER.test(rest)) {
      items.push(line.block);
      continue;
    }
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
      assignKey(map, pair[0], pair[1], lines, cursor, innerIndent, line);
      while (cursor.i < lines.length && lines[cursor.i].indent >= innerIndent && !lines[cursor.i].text.startsWith('- ')) {
        const next = lines[cursor.i];
        const nextPair = splitKey(next.text);
        if (!nextPair) throw new YamlError(`expected key: value, got ${next.text}`, next.number);
        cursor.i += 1;
        assignKey(map, nextPair[0], nextPair[1], lines, cursor, next.indent + 1, next);
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
 * @param {Line[]} lines
 * @param {{i: number}} cursor
 * @param {number} childIndent
 * @param {Line} line
 */
function assignKey(map, key, rest, lines, cursor, childIndent, line) {
  const lineNumber = line.number;
  if (key === '') throw new YamlError('empty key', lineNumber);
  assertSafeKey(key, lineNumber);
  if (Object.prototype.hasOwnProperty.call(map, key)) {
    throw new YamlError(`duplicate key ${key}`, lineNumber);
  }
  if (line.block !== undefined && BLOCK_HEADER.test(rest)) {
    map[key] = line.block;
    return;
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
 * @param {Line[]} lines
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
    assignKey(map, pair[0], pair[1], lines, cursor, indent + 1, line);
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

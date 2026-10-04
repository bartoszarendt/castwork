/**
 * The block scalar table, shared by the unit tests and the parity tests.
 *
 * Field round, F1: an OpenCode agent assessing a task wrote `findings: >-` in a
 * record and the whole frontmatter became unparseable, so the task reported no
 * status at all. Every expectation below was taken from the independent `yaml`
 * package first and is asserted against both parsers, so a mistake our parser
 * and our expectations share cannot pass.
 */

/** @type {[string, string, unknown][]} label, document, value */
export const ACCEPTED = [
  ['literal clip keeps one trailing newline', 'a: |\n  one\n  two\n', { a: 'one\ntwo\n' }],
  ['literal strip keeps none', 'a: |-\n  one\n  two\n', { a: 'one\ntwo' }],
  ['literal keep keeps every trailing empty line', 'a: |+\n  one\n  two\n\n\n', { a: 'one\ntwo\n\n\n' }],
  ['folded clip joins lines with one space', 'a: >\n  one\n  two\n', { a: 'one two\n' }],
  ['folded strip joins and keeps no newline', 'a: >-\n  one\n  two\n', { a: 'one two' }],
  ['folded keep keeps the trailing empty line', 'a: >+\n  one\n  two\n\n', { a: 'one two\n\n' }],
  ['an empty line in a folded scalar becomes one newline', 'a: >-\n  one\n\n  two\n', { a: 'one\ntwo' }],
  ['two empty lines become two newlines', 'a: >-\n  one\n\n\n  two\n', { a: 'one\n\ntwo' }],
  ['a more-indented line keeps its breaks', 'a: >-\n  one\n    deep\n  two\n', { a: 'one\n  deep\ntwo' }],
  ['consecutive more-indented lines keep every break', 'a: >-\n  one\n    d1\n    d2\n  two\n', { a: 'one\n  d1\n  d2\ntwo' }],
  ['an empty line before a more-indented line keeps both breaks', 'a: >-\n  one\n\n    deep\n  two\n', { a: 'one\n\n  deep\ntwo' }],
  ['two empty lines before a more-indented line keep three breaks', 'a: >-\n  one\n\n\n    deep\n  two\n', { a: 'one\n\n\n  deep\ntwo' }],
  ['an empty line after a more-indented line keeps both breaks', 'a: >-\n  one\n    deep\n\n  two\n', { a: 'one\n  deep\n\ntwo' }],
  ['two empty lines after a more-indented line keep three breaks', 'a: >-\n  one\n    deep\n\n\n  two\n', { a: 'one\n  deep\n\n\ntwo' }],
  ['an empty line in a literal scalar is preserved', 'a: |\n  one\n\n  two\n', { a: 'one\n\ntwo\n' }],
  ['a hash inside content is literal', 'a: |-\n  one # not a comment\n', { a: 'one # not a comment' }],
  ['a content line opening with a hash is literal', 'a: |-\n  one\n  # two\n  three\n', { a: 'one\n# two\nthree' }],
  ['a colon inside content is literal', 'a: |-\n  k: v\n  j: w\n', { a: 'k: v\nj: w' }],
  ['trailing spaces on a literal line are kept', 'a: |-\n  one   \n  two\n', { a: 'one   \ntwo' }],
  ['trailing spaces on a folded line are kept before the fold space', 'a: >-\n  one   \n  two\n', { a: 'one    two' }],
  ['a tab inside content is kept', 'a: |-\n  one\ttwo\n', { a: 'one\ttwo' }],
  ['CRLF folds like LF', 'a: >-\r\n  one\r\n  two\r\n', { a: 'one two' }],
  ['CRLF is literal like LF', 'a: |\r\n  one\r\n  two\r\n', { a: 'one\ntwo\n' }],
  ['a block scalar is a bare sequence item', 'a:\n  - |-\n    one\n    two\n', { a: ['one\ntwo'] }],
  ['content one column past the dash is enough', 'a:\n  - |-\n   one\n   two\n', { a: ['one\ntwo'] }],
  ['an inline sequence mapping indents content past its key', 'a:\n  - key: |\n      one\n      two\n', { a: [{ key: 'one\ntwo\n' }] }],
  [
    'the T-005 shape: a folded scalar in an inline sequence-entry mapping',
    'assessments:\n  - candidate: worktree-T005\n    role: verifier\n    actor: verifier@opencode\n    verdict: accept\n    findings: >-\n      fallback assessment (verifier provider unavailable): accept.\n      Canonical spec is keyboard-only.\n',
    {
      assessments: [
        {
          candidate: 'worktree-T005',
          role: 'verifier',
          actor: 'verifier@opencode',
          verdict: 'accept',
          findings: 'fallback assessment (verifier provider unavailable): accept. Canonical spec is keyboard-only.',
        },
      ],
    },
  ],
  [
    'two block scalars in two sequence entries',
    'e:\n  - check: t\n    output: >-\n      long one\n      long two\n  - check: u\n    output: |\n      x\n      y\n',
    { e: [{ check: 't', output: 'long one long two' }, { check: 'u', output: 'x\ny\n' }] },
  ],
  [
    'a block scalar between two keys of a sequence entry mapping',
    'x:\n  - a: 1\n    b: |\n      p\n      q\n    c: 2\n',
    { x: [{ a: 1, b: 'p\nq\n', c: 2 }] },
  ],
  ['a block scalar three levels deep', 'a:\n  b:\n    c: >-\n      x\n      y\n  d: 1\n', { a: { b: { c: 'x y' }, d: 1 } }],
  ['a header with no content is the empty string', 'a: |\nb: 2\n', { a: '', b: 2 }],
  ['a folded header with no content is the empty string', 'a: >-\nb: 2\n', { a: '', b: 2 }],
  ['a kept header with no content is the empty string', 'a: |+\nb: 1\n', { a: '', b: 1 }],
  ['kept empty lines with no content line are newlines', 'a: |+\n\n\nb: 1\n', { a: '\n\n', b: 1 }],
  ['a header at the end of the document is the empty string', 'a: |', { a: '' }],
  ['a leading empty line is content', 'a: |\n\n  one\n', { a: '\none\n' }],
  ['a leading empty line is content when folded', 'a: >\n\n  one\n', { a: '\none\n' }],
  ['a comment after the header is still a comment', 'a: | # c\n  one\n', { a: 'one\n' }],
  ['a whitespace-only line deeper than the content keeps its extra spaces', 'a: |-\n  one\n     \n  two\n', { a: 'one\n   \ntwo' }],
  ['a whitespace-only line shallower than the content is empty', 'a: |-\n  one\n \n  two\n', { a: 'one\n\ntwo' }],
  ['the mapping continues after the block ends', 'a: >-\n  one\n  two\nb: 3\n', { a: 'one two', b: 3 }],
  ['a flow value follows a block scalar', 'a: |-\n  one\nb: [x, y]\n', { a: 'one', b: ['x', 'y'] }],
  ['trailing empty lines before a lower key are clipped', 'a: |\n  one\n\nb: 2\n', { a: 'one\n', b: 2 }],
  ['trailing empty lines before a lower key are kept', 'a: |+\n  one\n\nb: 2\n', { a: 'one\n\n', b: 2 }],
  ['an unterminated whitespace-only final line adds no kept break', 'a: |+\n  one\n  ', { a: 'one\n' }],
];

/**
 * @type {[string, string, RegExp, boolean][]}
 * label, document, our message, whether the `yaml` package also refuses
 */
export const REFUSED = [
  // An explicit indentation indicator is legal YAML that the `yaml` package
  // reads. We are stricter on purpose: the indicator exists to disambiguate
  // content whose first line is itself indented, and a record that needs it is
  // a record whose frontmatter no longer reads as the data it describes.
  ['an explicit indentation indicator', 'a: |2\n   one\n', /explicit indentation indicator/, false],
  ['an indicator after the chomping mode', 'a: |-2\n  one\n', /explicit indentation indicator/, false],
  ['an indicator before the chomping mode', 'a: >1-\n  one\n', /explicit indentation indicator/, false],
  ['a space and content after the header', 'a: | oops\n', /after the block scalar header/, true],
  ['content joined to the header', 'a: |foo\n', /after the block scalar header/, true],
  ['a folded header with content joined to it', 'a: >foo\n', /after the block scalar header/, true],
  ['a plain scalar opening with a folded indicator', 'a: >= 5\n', /after the block scalar header/, true],
  ['a block scalar in a flow sequence', 'a: [|]\n', /flow collection/, true],
  ['a block scalar in a flow mapping', 'a: {k: |}\n', /flow collection/, true],
  ['a leading empty line more indented than the content', 'a: |\n     \n  one\n', /more-indented leading empty line/, true],
  ['tab-indented content', 'a: |-\n\tone\n', /tab in block scalar indentation/, true],
  ['a tab inside the required indentation of a later line', 'a: |-\n  one\n \ttwo\n', /tab in block scalar indentation/, true],
  ['an inline sequence mapping with content at the key column', 'a:\n  - key: |\n    one\n', /expected key: value/, true],
];

/**
 * YAML node-property syntax the subset refuses deliberately. A full parser
 * gives these documents anchor, alias, or tag semantics; treating them as
 * ordinary strings would silently change the record.
 * @type {[string, string][]}
 */
export const UNSUPPORTED_NODE_PROPERTIES = [
  ['an anchor and alias in block values', 'a: &value hello\nb: *value\n'],
  ['a tag in a block value', 'a: !!str hello\n'],
  ['an anchor and alias in flow values', 'a: [&value hello, *value]\n'],
  ['an anchor in a block key', '&key name: value\n'],
];

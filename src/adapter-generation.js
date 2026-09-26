/**
 * Adapter generation.
 *
 * An adapter is a thin projection of the canonical roles, skills, and entry
 * command into the layout one host expects. A host is a template directory
 * described by `src/adapters/<host>.json`, not special machinery: adding a host
 * should not require changing anything else.
 *
 * Generated files contain no absolute paths, no workflow infrastructure, no
 * capability declarations, and no activation slots.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { HOSTS } from './layout.js';
import { parseRecord, ROLE_IDS } from './record.js';
import { PublicError } from './public-error.js';
import { formatScalar } from './yaml.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/** The toolkit's own root, where the canonical sources live. */
export function toolkitRoot() {
  return path.resolve(here, '..');
}

/** @param {string} host */
export function readAdapter(host) {
  if (!HOSTS.includes(host)) {
    throw new PublicError(`unknown host ${host}`, { hint: `Known hosts: ${HOSTS.join(', ')}.` });
  }
  const file = path.join(here, 'adapters', `${host}.json`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Canonical role presets, in a stable order. */
export function readRoles() {
  const directory = path.join(toolkitRoot(), 'agents');
  const roles = [];
  for (const id of ROLE_IDS) {
    const file = path.join(directory, `${id}.md`);
    if (!fs.existsSync(file)) continue;
    const parsed = parseRecord(fs.readFileSync(file, 'utf8'), { path: file });
    roles.push({
      id,
      description: String(parsed.frontmatter.description ?? ''),
      body: parsed.body.trim(),
    });
  }
  return roles;
}

/** Canonical skills, in a stable order. */
export function readSkills() {
  const directory = path.join(toolkitRoot(), 'skills');
  if (!fs.existsSync(directory)) return [];
  const skills = [];
  for (const name of fs.readdirSync(directory).sort()) {
    const file = path.join(directory, name, 'SKILL.md');
    if (!fs.existsSync(file)) continue;
    const parsed = parseRecord(fs.readFileSync(file, 'utf8'), { path: file });
    skills.push({
      id: name,
      description: String(parsed.frontmatter.description ?? ''),
      body: parsed.body.trim(),
    });
  }
  return skills;
}

/**
 * The canonical entry command.
 *
 * It carries two descriptions because it is projected two ways. `description`
 * is read when the user invoked the command by name, so it may be a plain
 * instruction. `skill_description` is read by a host deciding **whether** to
 * load Agentic Loop at all, so it has to name its trigger and its boundary.
 * There is deliberately no fallback between them: an imperative written for an
 * invoked command becomes, as a skill description, an invitation to start
 * orchestrating work nobody asked about.
 */
export function readCommand() {
  const file = path.join(toolkitRoot(), 'commands', 'start.md');
  if (!fs.existsSync(file)) return null;
  const parsed = parseRecord(fs.readFileSync(file, 'utf8'), { path: file });
  return { ...commandDescriptions(parsed.frontmatter), body: parsed.body.trim() };
}

/**
 * The two descriptions an entry command must carry, or a refusal.
 *
 * Generation and `validate` both come through here, so they cannot disagree
 * about what a usable command looks like. Each value has to be a string:
 * stringifying whatever was written would turn a mapping into the literal
 * `[object Object]` and carry it, non-empty and apparently valid, into a
 * generated file.
 *
 * @param {Record<string, unknown>} frontmatter
 * @returns {{description: string, skill_description: string}}
 */
export function commandDescriptions(frontmatter) {
  const description = frontmatter.description;
  const skillDescription = frontmatter.skill_description;
  if (typeof description !== 'string' || description.trim() === '') {
    throw new PublicError('the entry command has no description', {
      hint: 'commands/start.md needs a description string for the generated command file.',
    });
  }
  if (typeof skillDescription !== 'string' || skillDescription.trim() === '') {
    throw new PublicError('the entry command has no skill_description', {
      hint: 'A generated skill index needs its own description string, naming when to use Agentic Loop and when not to.',
    });
  }
  if (description.trim() === skillDescription.trim()) {
    throw new PublicError('the entry command repeats its description as skill_description', {
      hint: 'A skill index says when to use Agentic Loop; a command the user invoked by name does not have to.',
    });
  }
  return { description: description.trim(), skill_description: skillDescription.trim() };
}

/**
 * The extra frontmatter one host's adapter puts on the skill index.
 *
 * Scalars only. A list or a mapping has no single-line YAML spelling here, so
 * it would be stringified into something the host cannot read; a host that
 * needs nested YAML can have it when one actually does.
 *
 * @param {Record<string, unknown>} adapter
 * @returns {string[]}
 */
export function skillFrontmatter(adapter) {
  const declared = /** @type {Record<string, unknown>} */ (adapter.skill_frontmatter ?? {});
  const lines = [];
  for (const [key, value] of Object.entries(declared)) {
    if (typeof value === 'boolean') {
      lines.push(`${key}: ${String(value)}`);
      continue;
    }
    if (typeof value !== 'string' || value === '') {
      throw new PublicError(`adapter ${String(adapter.id)} declares skill_frontmatter.${key} as something other than a string or a boolean`);
    }
    lines.push(`${key}: ${yamlString(value)}`);
  }
  return lines;
}

/** @param {string} value */
function tomlString(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Emit a value as a YAML scalar for a generated host file.
 *
 * Generated frontmatter is read by the hosts' own YAML parsers, not by this
 * toolkit's, so it has to be valid YAML rather than merely round-trip here.
 * The previous rule allowed a bare colon, which made every description
 * containing one — `Read-only: implements nothing` — a mapping value in a
 * place YAML does not allow one.
 *
 * @param {string} value
 */
function yamlString(value) {
  return formatScalar(String(value));
}

/**
 * @param {{id: string, description: string, body: string}} role
 * @param {Record<string, unknown>} adapter
 * @param {Record<string, unknown>} settings
 */
function renderRoleMarkdown(role, adapter, settings) {
  const mapping = /** @type {Record<string, string>} */ (adapter.role_frontmatter ?? {});
  const lines = ['---', `name: ${role.id}`, `description: ${yamlString(role.description)}`];
  for (const [source, target] of Object.entries(mapping)) {
    const value = settings[source];
    if (value === undefined || value === null || value === '') continue;
    lines.push(`${target}: ${yamlString(String(value))}`);
  }
  lines.push('---', '', role.body, '');
  return lines.join('\n');
}

/**
 * @param {{id: string, description: string, body: string}} role
 * @param {Record<string, unknown>} adapter
 * @param {Record<string, unknown>} settings
 */
function renderRoleToml(role, adapter, settings) {
  const mapping = /** @type {Record<string, string>} */ (adapter.role_frontmatter ?? {});
  const lines = [`name = ${tomlString(role.id)}`, `description = ${tomlString(role.description)}`];
  for (const [source, target] of Object.entries(mapping)) {
    const value = settings[source];
    if (value === undefined || value === null || value === '') continue;
    lines.push(`${target} = ${tomlString(String(value))}`);
  }
  // Codex reads an agent's prompt from `developer_instructions`. A bare
  // `instructions` key is also accepted, but it becomes the model's base
  // instructions and replaces Codex's own system prompt rather than adding to it.
  lines.push('', 'developer_instructions = """', role.body, '"""', '');
  return lines.join('\n');
}

/** @param {{id: string, description: string, body: string}} skill */
function renderReference(skill) {
  return `# ${skill.id}\n\n${skill.description}\n\n${skill.body}\n`;
}

/**
 * Render the skill index a host loads on its own initiative.
 *
 * `skill_frontmatter` is where a host says, in its own spelling, that this
 * skill is invoked and not inferred. Only the hosts that document such a key
 * declare one; for the rest the description is the only lever there is.
 *
 * @param {{description: string, skill_description: string, body: string}|null} command
 * @param {{id: string, description: string}[]} skills
 * @param {{id: string, description: string}[]} roles
 * @param {Record<string, unknown>} adapter
 */
function renderSkillIndex(command, skills, roles, adapter) {
  const lines = [
    '---',
    'name: agenticloop',
    `description: ${yamlString(command?.skill_description ?? "Use when asked to work with this repository's Agentic Loop task records.")}`,
    ...skillFrontmatter(adapter),
  ];
  lines.push(
    '---',
    '',
    '# Agentic Loop',
    '',
    command ? command.body : '',
    '',
    '## Roles',
    '',
  );
  for (const role of roles) lines.push(`- \`${role.id}\` — ${role.description}`);
  lines.push('', '## Procedures', '');
  for (const skill of skills) lines.push(`- [\`${skill.id}\`](references/${skill.id}.md) — ${skill.description}`);
  lines.push('');
  return lines.join('\n');
}

/**
 * @param {{description: string, body: string}|null} command
 */
function renderCommand(command) {
  if (!command) return '';
  return `---\ndescription: ${yamlString(command.description)}\n---\n\n${command.body}\n`;
}

/**
 * Plan every file one host's adapter would generate.
 * @param {string} host
 * @param {{roleSettings?: Record<string, Record<string, unknown>>}} [options]
 * @returns {{path: string, content: string}[]}
 */
export function generateHost(host, options = {}) {
  const adapter = readAdapter(host);
  const roles = readRoles();
  const skills = readSkills();
  const command = readCommand();
  const roleSettings = options.roleSettings ?? {};
  /** @type {{path: string, content: string}[]} */
  const files = [];

  for (const entry of /** @type {{kind: string, to: string, format: string, content?: string}[]} */ (adapter.files)) {
    if (entry.kind === 'role') {
      for (const canonical of roles) {
        // A bare `<host>` placeholder was read as the machine's name, the way
        // `user@hostname` is, so records carried computer names instead of
        // the host id. Each host's roles get their own id written in.
        const role = { ...canonical, body: canonical.body.replaceAll('<host>', String(adapter.id)) };
        const settings = roleSettings[role.id] ?? {};
        files.push({
          path: entry.to.replace('{role}', role.id),
          content: entry.format === 'toml' ? renderRoleToml(role, adapter, settings) : renderRoleMarkdown(role, adapter, settings),
        });
      }
      continue;
    }
    if (entry.kind === 'skill') {
      for (const skill of skills) {
        files.push({ path: entry.to.replace('{skill}', skill.id), content: renderReference(skill) });
      }
      continue;
    }
    if (entry.kind === 'command') {
      files.push({
        path: entry.to,
        content: entry.format === 'skill' ? renderSkillIndex(command, skills, roles, adapter) : renderCommand(command),
      });
      continue;
    }
    if (entry.kind === 'index') {
      files.push({ path: entry.to, content: renderSkillIndex(command, skills, roles, adapter) });
      continue;
    }
    if (entry.kind === 'literal') {
      // A file whose content is the descriptor's own, for a host key that is
      // configuration rather than prose — Codex's invocation policy is the
      // first of them. The generator stays host-agnostic: it writes what the
      // adapter says and learns nothing about what the key means.
      if (typeof entry.content !== 'string') {
        throw new PublicError(`adapter ${host} declares a literal file with no content: ${entry.to}`);
      }
      files.push({ path: entry.to, content: entry.content });
      continue;
    }
    throw new PublicError(`adapter ${host} declares an unknown file kind ${entry.kind}`);
  }

  for (const file of files) assertNoAbsolutePaths(host, file);
  return files;
}

/** Generated files must stay portable across machines. @param {string} host @param {{path: string, content: string}} file */
function assertNoAbsolutePaths(host, file) {
  if (/(^|[\s"'(])(\/(home|Users|tmp|var)\/|[A-Za-z]:[\\/])/.test(file.content)) {
    throw new PublicError(`adapter ${host} produced an absolute path in ${file.path}`, {
      hint: 'Generated files are tracked in the target repository and must be portable.',
    });
  }
}

/**
 * Every file all selected hosts would generate.
 *
 * `roleSettings` is keyed by host here and by role inside `generateHost`,
 * because a setting is only ever meaningful to the one host that accepts it.
 *
 * @param {string[]} hosts
 * @param {{roleSettings?: Record<string, Record<string, Record<string, unknown>>>}} [options]
 */
export function generateAll(hosts, options = {}) {
  /** @type {{path: string, content: string}[]} */
  const files = [];
  for (const host of hosts) files.push(...generateHost(host, { roleSettings: options.roleSettings?.[host] }));
  return files;
}

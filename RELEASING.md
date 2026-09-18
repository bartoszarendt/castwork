# Releasing

Releases are cut from `main` by the owner. Bump the version in `package.json`,
add one `CHANGELOG.md` entry describing what changed for users, run `npm test`
and `npx agenticloop validate`, pack the tarball and install it into a
disposable repository to confirm `setup`, `update`, and `remove` behave, then
tag and publish. Breaking changes get a major-or-minor bump and say plainly in
the changelog that there is no migration path; Agentic Loop does not ship
compatibility shims, aliases, or deprecated commands.

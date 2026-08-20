import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRepositoryUrl } from '../src/repo/url.ts';
import { baseName, parentPath, workspaceId } from '../src/repo/types.ts';
import { sortEntries } from '../src/repo/github.ts';
import { statusOf } from '../src/workspace/types.ts';

test('a plain repository URL is enough', () => {
  assert.deepEqual(parseRepositoryUrl('https://github.com/rust-lang/rust'), {
    provider: 'github',
    owner: 'rust-lang',
    repo: 'rust',
  });
});

test('the scheme, the host prefix and a .git suffix are all optional', () => {
  const wanted = { provider: 'github', owner: 'rust-lang', repo: 'rust' };
  assert.deepEqual(parseRepositoryUrl('github.com/rust-lang/rust'), wanted);
  assert.deepEqual(parseRepositoryUrl('https://www.github.com/rust-lang/rust/'), wanted);
  assert.deepEqual(parseRepositoryUrl('https://github.com/rust-lang/rust.git'), wanted);
  assert.deepEqual(parseRepositoryUrl('  rust-lang/rust  '), wanted);
});

test('a link to a branch keeps the branch', () => {
  assert.deepEqual(parseRepositoryUrl('https://github.com/rust-lang/rust/tree/beta'), {
    provider: 'github',
    owner: 'rust-lang',
    repo: 'rust',
    branch: 'beta',
  });
});

test('a link to a file keeps where it pointed', () => {
  // Which is the whole reason a browser URL is accepted: it points at what the
  // person was looking at, and that is where they expect to land.
  assert.deepEqual(
    parseRepositoryUrl('https://github.com/rust-lang/rust/blob/master/library/core/src/lib.rs#L120'),
    { provider: 'github', owner: 'rust-lang', repo: 'rust', branch: 'master', path: 'library/core/src/lib.rs' },
  );
  assert.deepEqual(parseRepositoryUrl('https://github.com/a/b/tree/main/src/parser'), {
    provider: 'github',
    owner: 'a',
    repo: 'b',
    branch: 'main',
    path: 'src/parser',
  });
});

test('anything that is not a GitHub repository is rejected', () => {
  assert.equal(parseRepositoryUrl(''), null);
  assert.equal(parseRepositoryUrl('https://gitlab.com/a/b'), null);
  assert.equal(parseRepositoryUrl('https://github.com/rust-lang'), null);
  assert.equal(parseRepositoryUrl('not a url at all'), null);
});

test('a workspace is identified by provider, repository and branch', () => {
  // The id is the IndexedDB key, so two branches of one repository have to be
  // two workspaces — their edits are against different commits.
  assert.equal(
    workspaceId({ provider: 'github', owner: 'a', repo: 'b', branch: 'main' }),
    'github:a/b@main',
  );
  assert.notEqual(
    workspaceId({ provider: 'github', owner: 'a', repo: 'b', branch: 'main' }),
    workspaceId({ provider: 'github', owner: 'a', repo: 'b', branch: 'beta' }),
  );
  assert.equal(workspaceId({ provider: 'local' }), 'local');
});

test('path helpers agree about the root', () => {
  assert.equal(parentPath('src/editor/core/editor.ts'), 'src/editor/core');
  assert.equal(parentPath('README.md'), '');
  assert.equal(baseName('src/editor/core/editor.ts'), 'editor.ts');
  assert.equal(baseName('README.md'), 'README.md');
});

test('listings put directories first, then names as a human would', () => {
  const entries = sortEntries([
    { path: 'z.ts', name: 'z.ts', type: 'file' },
    { path: 'src', name: 'src', type: 'directory' },
    { path: 'a10.ts', name: 'a10.ts', type: 'file' },
    { path: 'a2.ts', name: 'a2.ts', type: 'file' },
    { path: 'Docs', name: 'Docs', type: 'directory' },
  ]);
  assert.deepEqual(entries.map((e) => e.name), ['Docs', 'src', 'a2.ts', 'a10.ts', 'z.ts']);
});

test('modified is compared, not remembered', () => {
  // A flag can drift from the text it describes; a comparison cannot. It also
  // means undoing back to the original marks the file clean again, for free.
  const file = { path: 'a.ts', original: 'x', content: 'x', updatedAt: 0 };
  assert.equal(statusOf(file), 'unchanged');
  assert.equal(statusOf({ ...file, content: 'y' }), 'modified');
  assert.equal(statusOf({ ...file, content: 'y', original: 'y' }), 'unchanged');
});

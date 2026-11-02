import assert from 'node:assert/strict';
import test from 'node:test';
import { orderTreeFiles } from '../js/file-order.js';

test('review order follows directory-first traversal and natural filename sorting', () => {
  const paths = [
    'Cargo.toml', 'src/file-10.rs', 'src/file-2.rs', 'src/z/nested.rs',
    'src/A.rs', 'src/a.rs', 'src/file-01.rs', '.gitignore', 'tests/run.rs',
    'src/z/file-10.rs', 'src/z/file-2.rs', 'src-extra/lib.rs',
  ];
  const files = paths.map(path => ({ path, status: 'modified', added: 1, removed: 1 }));
  const original = [...files];
  const ordered = orderTreeFiles(files);
  assert.deepEqual(ordered.map(file => file.path), [
    'src/z/file-2.rs', 'src/z/file-10.rs', 'src/z/nested.rs',
    'src/A.rs', 'src/a.rs', 'src/file-01.rs', 'src/file-2.rs', 'src/file-10.rs',
    'src-extra/lib.rs', 'tests/run.rs', '.gitignore', 'Cargo.toml',
  ]);
  assert.deepEqual(files, original, 'ordering must not mutate the input');
  assert.equal(ordered.find(file => file.path === 'src/file-2.rs'), files[2],
    'status and line counts remain attached to their source file');
  assert.deepEqual(orderTreeFiles([]), []);
});

import { prepareFileTreeInput } from '@pierre/trees';

// Use Pierre's own directory-first, natural ordering for both surfaces.
// Preparing paths does not depend on which folders happen to be expanded.
export function orderTreeFiles(files) {
  const byPath = new Map(files.map(file => [file.path, file]));
  return prepareFileTreeInput(files.map(file => file.path)).paths.map(path => byPath.get(path));
}

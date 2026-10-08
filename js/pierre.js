import { FileTree } from '@pierre/trees';
import { File, FileDiff, parseDiffFromFile } from '@pierre/diffs';

const labels = { added: 'Added', deleted: 'Deleted', modified: 'Modified' };

function mountTree(host, filesJson, selected, onSelect) {
  const files = JSON.parse(filesJson);
  const paths = files.map(file => file.path);
  const byPath = new Map(files.map(file => [file.path, file]));
  const directories = [...new Set(paths.flatMap(path => {
    const segments = path.split('/');
    return segments.slice(1).map((_, index) => `${segments.slice(0, index + 1).join('/')}/`);
  }))].sort((left, right) => right.length - left.length);
  let syncing = false;
  const tree = new FileTree({
    paths,
    initialExpansion: 'open',
    initialSelectedPaths: byPath.has(selected) ? [selected] : [],
    density: 'compact',
    flattenEmptyDirectories: false,
    icons: { set: 'standard', colored: true },
    // Reserve the change counts before letting Pierre truncate the filename.
    // These rules must live in the tree's shadow root.
    unsafeCSS: `
      [data-item-section="content"] { flex: 1 1 0; }
      [data-item-section="decoration"] { flex: 0 0 auto; }
    `,
    gitStatus: files.filter(file => file.status !== 'unchanged'),
    onSelectionChange(selectedPaths) {
      const path = selectedPaths.at(-1);
      if (!syncing && byPath.has(path)) onSelect(path);
    },
    renderRowDecoration({ item }) {
      const file = byPath.get(item.path);
      if (!file || file.status === 'unchanged' || file.added + file.removed === 0) return null;
      const counts = [];
      if (file.added > 0) counts.push({ text: `+${file.added}`, color: 'var(--trees-status-added)' });
      if (file.removed > 0) counts.push({ text: `−${file.removed}`, color: 'var(--trees-status-deleted)' });
      return {
        text: counts.map(part => part.text).join('\u00a0\u00a0'),
        parts: counts.map((part, index) => ({
          ...part, text: index === 0 ? part.text : `\u00a0\u00a0${part.text}`,
        })),
        title: `${labels[file.status]}: ${file.path} (${counts.map(part => part.text).join(' / ')})`,
      };
    },
  });
  tree.render({ containerWrapper: host });
  // Pierre unmounts its contents but leaves this element in the Leptos host.
  // A replacement comparison can reuse that host, so remove our container too.
  const container = tree.getFileTreeContainer();
  let previousPaths = paths.join('\0');
  return {
    collapse() {
      syncing = true;
      try {
        // Collapse descendants too, so reopening a parent does not restore
        // an entire previously open subtree. File selection and URL stay put.
        for (const path of directories) tree.getItem(path)?.collapse();
      } finally {
        syncing = false;
      }
    },
    update(visibleJson, selectedPath) {
      syncing = true;
      try {
        const visible = JSON.parse(visibleJson);
        const key = visible.join('\0');
        if (key !== previousPaths) {
          tree.resetPaths(visible);
          tree.setGitStatus(files.filter(file => visible.includes(file.path) && file.status !== 'unchanged'));
          previousPaths = key;
        }
        for (const path of tree.getSelectedPaths()) {
          if (path !== selectedPath) tree.getItem(path)?.deselect();
        }
        const item = tree.getItem(selectedPath);
        if (item && !item.isSelected()) {
          const segments = selectedPath.split('/');
          for (let i = 1; i < segments.length; i++) {
            tree.getItem(`${segments.slice(0, i).join('/')}/`)?.expand();
          }
          item.select();
          tree.scrollToPath(selectedPath);
        }
      } finally {
        syncing = false;
      }
    },
    cleanUp() {
      try {
        tree.cleanUp();
      } finally {
        container.remove();
      }
    },
  };
}

function mountDiff(host, path, oldSource, newSource, identical) {
  const view = identical ? new File() : new FileDiff();
  // Null represents an absent file, preserving added/deleted file semantics.
  const before = oldSource == null ? null : { name: path, contents: oldSource };
  const after = newSource == null ? null : { name: path, contents: newSource };
  const fileDiff = identical ? null : parseDiffFromFile(before, after);
  let currentSplit = false;
  let currentAllLines = false;
  let themes;
  function update(split, allLines) {
    currentSplit = split;
    currentAllLines = allLines;
    const settings = window.CrateSettings.snapshot();
    themes = { light: settings.lightTheme, dark: settings.darkTheme };
    view.setOptions({
      theme: themes,
      themeType: settings.resolvedMode,
      disableFileHeader: true,
      overflow: 'scroll',
      diffStyle: split ? 'split' : 'unified',
      diffIndicators: 'bars',
      lineDiffType: 'word-alt',
      expandUnchanged: allLines,
      hunkSeparators: 'line-info',
    });
    if (identical) view.render({ containerWrapper: host, file: after ?? before, forceRender: true });
    else view.render({ containerWrapper: host, fileDiff, forceRender: true });
  }
  const unsubscribe = window.CrateSettings.subscribe(settings => {
    if (themes && (themes.light !== settings.lightTheme || themes.dark !== settings.darkTheme)) {
      update(currentSplit, currentAllLines);
    } else {
      view.setThemeType(settings.resolvedMode);
    }
  });
  return { update, cleanUp() { unsubscribe(); view.cleanUp(); } };
}

// Leptos owns these instances; modules and highlighting grammars are local.
window.Pierre = {
  mountTree,
  updateTree: (instance, paths, selected) => instance.update(paths, selected),
  collapseTree: instance => instance.collapse(),
  mountDiff,
  updateDiff: (instance, split, allLines) => instance.update(split, allLines),
  cleanUp: instance => instance.cleanUp(),
};

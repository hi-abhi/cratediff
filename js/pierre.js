import { FileTree } from '@pierre/trees';
import { File, FileDiff, CodeView, SVGSpriteSheet, getIconForType, parseDiffFromFile } from '@pierre/diffs';
import { orderTreeFiles } from './file-order.js';

const labels = { added: 'Added', deleted: 'Deleted', modified: 'Modified' };

function mountTree(host, filesJson, selected, onSelect) {
  const files = orderTreeFiles(JSON.parse(filesJson));
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
      if (!syncing && (byPath.has(path) || path?.endsWith('/'))) onSelect(path);
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

function sourceFile(name, contents) {
  // Null represents an absent file, preserving added/deleted file semantics.
  return contents == null ? null : { name, contents };
}

function diffOptions(settings, split, allLines) {
  return {
    theme: { light: settings.lightTheme, dark: settings.darkTheme },
    themeType: settings.resolvedMode,
    overflow: 'wrap',
    diffStyle: split ? 'split' : 'unified',
    diffIndicators: 'bars',
    lineDiffType: 'word-alt',
    expandUnchanged: allLines,
    hunkSeparators: 'line-info',
  };
}

function mountDiff(host, path, oldSource, newSource, identical) {
  const view = identical ? new File() : new FileDiff();
  const before = sourceFile(path, oldSource);
  const after = sourceFile(path, newSource);
  const fileDiff = identical ? null : parseDiffFromFile(before, after);
  let currentSplit = false;
  let currentAllLines = false;
  let themes;
  function update(split, allLines) {
    currentSplit = split;
    currentAllLines = allLines;
    const options = diffOptions(window.CrateSettings.snapshot(), split, allLines);
    themes = options.theme;
    view.setOptions({ ...options, disableFileHeader: true });
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

function mountReview(host, filesJson) {
  const files = orderTreeFiles(JSON.parse(filesJson));
  const byPath = new Map(files.map(file => [file.path, file]));
  // Reuse Pierre's original change icons in our clickable custom headers.
  const iconSymbols = document.createElement('template');
  iconSymbols.innerHTML = SVGSpriteSheet;
  const changeTypes = { added: 'new', deleted: 'deleted', modified: 'change' };
  const items = files.map(file => file.notice ? {
    id: file.path, type: 'file',
    file: { name: file.path, contents: file.notice, lang: 'text' }, version: 0,
  } : {
    id: file.path, type: 'diff',
    fileDiff: parseDiffFromFile(
      sourceFile(file.path, file.old),
      sourceFile(file.path, file.new),
    ),
    version: 0,
  });
  let split = window.CrateSettings.snapshot().diffLayout === 'split';
  let allLines = false;
  function toggleItem(path) {
    const item = view.getItem(path);
    if (item) view.updateItem({ ...item, collapsed: !item.collapsed, version: item.version + 1 });
  }
  let focusHeader;
  function renderCustomHeader(_file, { item }) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'review-file-collapse';
    button.dataset.path = item.id;
    button.setAttribute('aria-label', `${item.collapsed ? 'Expand' : 'Collapse'} ${item.id}`);
    button.setAttribute('aria-expanded', String(!item.collapsed));
    button.title = item.collapsed ? 'Expand file diff' : 'Collapse file diff';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('review-file-chevron');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.6');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    const arrow = document.createElementNS(svg.namespaceURI, 'path');
    arrow.setAttribute('d', item.collapsed ? 'M9 5.5l6 6.5-6 6.5' : 'M5.5 9l6.5 6 6.5-6');
    svg.append(arrow);
    const file = byPath.get(item.id);
    const symbol = iconSymbols.content.querySelector(`#${getIconForType(changeTypes[file.status])}`);
    const statusIcon = document.createElementNS(svg.namespaceURI, 'svg');
    statusIcon.setAttribute('viewBox', symbol.getAttribute('viewBox'));
    statusIcon.setAttribute('aria-hidden', 'true');
    statusIcon.setAttribute('fill', 'currentColor');
    statusIcon.setAttribute('data-change-icon', changeTypes[file.status]);
    statusIcon.classList.add('review-file-status', file.status === 'deleted' ? 'removed' : file.status);
    statusIcon.append(...[...symbol.childNodes].map(child => child.cloneNode(true)));
    const filename = document.createElement('span');
    filename.className = 'review-file-name';
    filename.textContent = item.id;
    button.append(svg, statusIcon, filename, renderHeaderMetadata(file));
    button.addEventListener('click', () => {
      if (document.activeElement === button) focusHeader = item.id;
      toggleItem(item.id);
    });
    // CodeView replaces headers on updates; retain keyboard focus on the row.
    if (focusHeader === item.id) requestAnimationFrame(() => {
      if (button.isConnected && focusHeader === item.id) {
        button.focus({ preventScroll: true });
        focusHeader = undefined;
      }
    });
    return button;
  }
  function renderHeaderMetadata(file) {
    const metadata = document.createElement('span');
    metadata.className = 'review-file-stats';
    metadata.setAttribute('aria-label', `${labels[file.status]}: ${file.path}`);
    for (const [count, prefix, className] of [
      [file.added, '+', 'added'], [file.removed, '−', 'removed'],
    ]) {
      if (!count) continue;
      const span = document.createElement('span');
      span.className = className;
      span.textContent = `${prefix}${count}`;
      metadata.append(span);
    }
    const status = document.createElement('span');
    status.textContent = labels[file.status];
    metadata.append(status);
    return metadata;
  }
  function options() {
    const settings = window.CrateSettings.snapshot();
    return {
      ...diffOptions(settings, split, allLines),
      stickyHeaders: true,
      // Standalone diffs have an 8px gap above their code. Restore it after
      // CodeView's built-in header and account for it in virtualized layout.
      unsafeCSS: '[data-diff][data-overflow="wrap"], [data-file][data-overflow="wrap"] { padding-top: 8px; }',
      itemMetrics: { lineHeight: Math.ceil(settings.fontSize * 1.65), diffHeaderHeight: 36, paddingTop: 8 },
      layout: { paddingTop: 0, paddingBottom: 0, gap: 8 },
      renderCustomHeader,
    };
  }
  const view = new CodeView(options());
  view.setup(host);
  view.setItems(items);
  const unsubscribe = window.CrateSettings.subscribe(() => view.setOptions(options()));
  return {
    update(nextSplit, nextAllLines) {
      split = nextSplit;
      allLines = nextAllLines;
      view.setOptions(options());
    },
    scroll(path) {
      const item = view.getItem(path);
      if (!item) return;
      if (item.collapsed) view.updateItem({ ...item, collapsed: false, version: item.version + 1 });
      view.scrollTo({ type: 'item', id: path, align: 'start' });
    },
    cleanUp() {
      unsubscribe();
      view.cleanUp();
      host.replaceChildren();
    },
  };
}

// Leptos owns these instances; modules and highlighting grammars are local.
window.Pierre = {
  mountTree,
  updateTree: (instance, paths, selected) => instance.update(paths, selected),
  collapseTree: instance => instance.collapse(),
  mountDiff,
  updateDiff: (instance, split, allLines) => instance.update(split, allLines),
  mountReview,
  updateReview: (instance, split, allLines) => instance.update(split, allLines),
  scrollReview: (instance, path) => instance.scroll(path),
  cleanUp: instance => instance.cleanUp(),
};

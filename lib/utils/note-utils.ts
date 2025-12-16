import removeMarkdown from 'remove-markdown';
import { escapeRegExp } from 'lodash';
import { getTerms } from './filter-notes';

import * as T from '../types';

export interface TitleAndPreview {
  title: string;
  preview: string;
}

export const maxTitleChars = 64;
export const maxPreviewChars = 200;

const isLowSurrogate = (c: number) => 0xdc00 <= c && c <= 0xdfff;

const IMAGE_LINE_RE = /^!\[([^\]]*)\]\(([^)]+)\)/;
const IMAGE_LINE_ONLY_RE = /^\s*!\[[^\]]*\]\([^)]+\)\s*$/;
const HEADING_RE = /^\s*#{1,6}\s+(.*)$/;

const normalizeTitleCandidate = (line: string): string => {
  const trimmed = String(line ?? '').trim();
  const headingMatch = HEADING_RE.exec(trimmed);
  if (headingMatch && headingMatch[1]) {
    return headingMatch[1].trim();
  }
  return trimmed;
};

const findTitleLineIndex = (content: string): number => {
  const lines = String(content ?? '').split(/\r?\n/);
  let firstImageIdx: number | null = null;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = String(lines[i]).trim();
    if (!trimmed) continue;
    const imgMatch = IMAGE_LINE_RE.exec(trimmed);
    if (imgMatch) {
      if (firstImageIdx === null) firstImageIdx = i;
      continue;
    }
    return i;
  }
  return firstImageIdx ?? -1;
};

/**
 * Returns a string with markdown stripped
 *
 * @param {String} inputString string for which to remove markdown
 * @returns {String} string with markdown removed
 */
const removeMarkdownWithFix = (inputString) => {
  // Workaround for a bug in `remove-markdown`
  // See https://github.com/stiang/remove-markdown/issues/35
  return removeMarkdown(inputString.replace(/(\s)\s+/g, '$1'), {
    stripListLeaders: false,
  });
};

export const getTitle = (content) => {
  if (!content) {
    return 'New Note…';
  }

  const lines = String(content).split(/\r?\n/);

  // Title is the first meaningful (non-empty, non-image-only) line.
  // If the first content is an image, prefer the next text line; otherwise fall back
  // to the image alt text.
  let pendingImageAlt: string | null = null;
  for (const line of lines) {
    const trimmed = String(line).trim();
    if (!trimmed) continue;

    const headingMatch = HEADING_RE.exec(trimmed);
    if (headingMatch && headingMatch[1]) {
      const title = headingMatch[1].trim();
      if (title) return title.slice(0, maxTitleChars);
    }

    const imgMatch = IMAGE_LINE_RE.exec(trimmed);
    if (imgMatch) {
      const alt = (imgMatch[1] ?? '').trim();
      if (!pendingImageAlt && alt) pendingImageAlt = alt;
      // Keep looking for real text.
      continue;
    }

    return trimmed.slice(0, maxTitleChars);
  }

  if (pendingImageAlt) {
    return pendingImageAlt.slice(0, maxTitleChars);
  }

  return 'New Note…';
};

/**
 * Generate preview for note list
 *
 * Should gather the first non-whitespace content
 * for up to three lines and up to 200 characters
 *
 * @param content
 */
const getPreview = (content: string, searchQuery?: string) => {
  let preview = '';
  let lines = 0;

  // contextual note previews
  if (searchQuery?.trim()) {
    const terms = getTerms(searchQuery);

    // use only the first term of a multi-term query
    if (terms.length > 0) {
      const firstTerm = terms[0].toLocaleLowerCase();
      const leadingChars = 30 - firstTerm.length;

      // prettier-ignore
      const regExp = new RegExp(
        '(?:\\s|^)[^\n]' + // split at a word boundary (pattern must be preceded by whitespace or beginning of string)
          '{0,' + leadingChars + '}' + // up to leadingChars of text before the match
          escapeRegExp(firstTerm) +
          '.{0,200}(?=\\s|$)', // up to 200 characters of text after the match, splitting at a word boundary
        'ims'
      );
      const matches = regExp.exec(content);
      if (matches && matches.length > 0) {
        // Remove blank lines and note title from the search note preview
        const title = getTitle(content);
        preview = matches[0]
          .split('\n')
          .filter(
            (line) =>
              line !== '\r' &&
              line !== '' &&
              normalizeTitleCandidate(line) !== title
          )
          .join('\n');
        // don't return half of a surrogate pair
        return isLowSurrogate(preview.charCodeAt(0))
          ? preview.slice(1)
          : preview;
      }
    }
  }

  // implicit else: if the query didn't match, fall back to first three lines
  const allLines = String(content).split(/\r?\n/);
  const titleIndex = findTitleLineIndex(content);

  // Build preview from up to 3 non-empty lines after the title line.
  for (let i = Math.max(0, titleIndex + 1); i < allLines.length; i++) {
    if (lines >= 3) break;
    const line = allLines[i].trim();
    if (!line) continue;
    if (IMAGE_LINE_ONLY_RE.test(line)) continue;
    preview += line + '\n';
    lines++;
  }

  return preview.trim();
};

const formatPreview = (stripMarkdown: boolean, s: string): string =>
  stripMarkdown ? removeMarkdownWithFix(s) || s : s;

const previewCache = new WeakMap<T.Note, [TitleAndPreview, boolean, string?]>();

/**
 * Returns the title and excerpt for a given note
 *
 * @param note generate the previews for this note
 * @returns title and excerpt (if available)
 */
export const noteTitleAndPreview = (
  note: T.Note,
  searchQuery?: string
): TitleAndPreview => {
  const stripMarkdown = isMarkdown(note);
  const cached = previewCache.get(note);
  if (cached) {
    const [value, wasMarkdown, savedQuery] = cached;
    if (wasMarkdown === stripMarkdown && savedQuery === searchQuery) {
      return value;
    }
  }

  const content = note.content || '';
  const title = formatPreview(stripMarkdown, getTitle(content));
  const preview = formatPreview(
    stripMarkdown,
    getPreview(content, searchQuery)
  );
  const result = { title, preview };

  previewCache.set(note, [result, stripMarkdown, searchQuery]);

  return result;
};

function isMarkdown(note: T.Note): boolean {
  return note.systemTags.includes('markdown');
}

export default noteTitleAndPreview;

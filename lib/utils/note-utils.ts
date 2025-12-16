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

  // Title is the first non-empty line, trimmed.
  // This is intentionally simple and matches the requested behavior.
  const lines = String(content).split(/\r?\n/);
  const firstNonEmpty = lines.find((line) => line.trim().length > 0);
  if (!firstNonEmpty) {
    return 'New Note…';
  }
  return firstNonEmpty.trim().slice(0, maxTitleChars);
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
        preview = matches[0]
          .split('\n')
          .filter(
            (line) => line !== '\r' && line !== '' && line !== getTitle(content)
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
  const titleLine = getTitle(content);
  const titleIndex = allLines.findIndex((l) => l.trim() === titleLine);

  // Build preview from up to 3 non-empty lines after the title line.
  for (let i = Math.max(0, titleIndex + 1); i < allLines.length; i++) {
    if (lines >= 3) break;
    const line = allLines[i].trim();
    if (!line) continue;
    preview += line + '\n';
    lines++;
  }

  return preview.trim();
};

const formatPreview = (stripMarkdown: boolean, s: string): string =>
  stripMarkdown ? removeMarkdownWithFix(s) || s : s;

const previewCache = new Map<string, [TitleAndPreview, boolean, string?]>();

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
  const cached = previewCache.get(note.content);
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

  previewCache.set(note.content, [result, stripMarkdown, searchQuery]);

  return result;
};

function isMarkdown(note: T.Note): boolean {
  return note.systemTags.includes('markdown');
}

export default noteTitleAndPreview;

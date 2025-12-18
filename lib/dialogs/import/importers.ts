type ImporterName = 'curnote' | 'evernote' | 'text-files';

type Importer = {
  name: ImporterName;
  fileTypes: Array<String>;
};

const curnoteImporter: Importer = {
  name: 'curnote',
  fileTypes: ['json', 'zip'],
};

const evernoteImporter: Importer = {
  name: 'evernote',
  fileTypes: ['enex'],
};

const textImporter: Importer = {
  name: 'text-files',
  fileTypes: ['txt', 'md'],
};

export const importers: Array<Importer> = [
  curnoteImporter,
  evernoteImporter,
  textImporter,
];

export const getImporter = (name: String): Importer => {
  switch (name) {
    case 'curnote':
      return curnoteImporter;

    case 'evernote':
      return evernoteImporter;

    case 'text-files':
      return textImporter;
  }

  throw new Error(`No importer found named ${name}`);
};

export const forFilename = (file: String): Importer => {
  const fileExtension =
    file.substring(file.lastIndexOf('.') + 1, file.length) || file;

  switch (fileExtension) {
    case 'json':
      return curnoteImporter;

    case 'zip':
      return curnoteImporter;

    case 'enex':
      return evernoteImporter;

    case 'txt':
    case 'md':
      return textImporter;
  }

  throw new Error(`No importer found for file ${file}`);
};

/** Async-loads importer JS bundle
 *
 * Warning! Don't replace the static strings with string-interpolation
 * or else they won't be as easy to find and webpack will generate
 * more than we expect.
 */
export const load = (name: ImporterName): Promise<object> => {
  switch (name) {
    case 'curnote':
      return import(
        /* webpackChunkName: 'utils-import-curnote' */ '../../utils/import/curnote'
      );

    case 'evernote':
      return import(
        /* webpackChunkName: 'utils-import-evernote' */ '../../utils/import/evernote'
      );

    case 'text-files':
      return import(
        /* webpackChunkName: 'utils-import-text-files' */ '../../utils/import/text-files'
      );
  }

  throw new Error(`Unrecognized importer named ${name}`);
};

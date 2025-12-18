import { EventEmitter } from 'events';
import CoreImporter from '..';
import { endsWith, isEmpty } from 'lodash';

import * as T from '../../../types';

class CurnoteImporter extends EventEmitter {
  constructor(
    addNote: (note: T.Note) => any,
    options,
    recordEvent: (eventName: string, eventProperties: T.JSONSerializable) => any
  ) {
    super();
    this.addNote = addNote;
    this.options = options;
    this.recordEvent = recordEvent;
  }

  importNotes = (filesArray) => {
    if (isEmpty(filesArray)) {
      this.emit('status', 'error', 'No file to import.');
      return;
    }

    const file = filesArray[0];
    const fileName = file.name.toLowerCase();

    // Limit file size we will read to 5mb
    if (file.size > 5000000) {
      this.emit('status', 'error', 'File should be less than 5 MB.');
      return;
    }

    if (endsWith(fileName, '.json')) {
      this.processJsonFile(file);
      return;
    }

    if (endsWith(fileName, '.zip')) {
      this.processZipFile(file);
      return;
    }

    this.emit('status', 'error', 'File must be a .json or .zip file.');
  };

  processJsonFile = (file) => {
    const fileReader = new FileReader();

    fileReader.onload = (event) => {
      const fileContent = event.target.result;

      if (!fileContent) {
        this.emit('status', 'error', 'File was empty.');
        return;
      }

      this.parseAndImportJson(fileContent);
    };

    fileReader.readAsText(file);
  };

  parseAndImportJson = (jsonContent) => {
    const coreImporter = new CoreImporter(this.addNote);
    let dataObj;

    try {
      dataObj = JSON.parse(jsonContent);
    } catch (error) {
      this.emit('status', 'error', 'Invalid JSON file.');
      return;
    }

    if (!dataObj.activeNotes || !Array.isArray(dataObj.activeNotes)) {
      this.emit('status', 'error', 'Invalid Curnote JSON format.');
      return;
    }

    const noteCount = dataObj.activeNotes.length + dataObj.trashedNotes.length;
    const processedNotes = {
      activeNotes: convertModificationDates(dataObj.activeNotes),
      trashedNotes: convertModificationDates(dataObj.trashedNotes),
    };

    coreImporter.importNotes(processedNotes, this.options).then(() => {
      this.emit('status', 'complete', noteCount);
      this.recordEvent('importer_import_completed', {
        source: 'curnote',
        note_count: noteCount,
      });
    });
  };

  processZipFile = (file) => {
    const fileReader = new FileReader();

    fileReader.onload = (event) => {
      const fileContent = event.target.result;

      if (!fileContent) {
        this.emit('status', 'error', 'File was empty.');
        return;
      }

      import(/* webpackChunkName: 'jszip' */ 'jszip')
        .then(({ default: JSZip }) => JSZip.loadAsync(fileContent))
        .then((zip) => {
          // Look for JSON files in the ZIP
          const jsonFileEntry = Object.entries(zip.files).find(
            ([path]) => path.toLowerCase() === 'source/notes.json'
          );

          if (!jsonFileEntry) {
            this.emit('status', 'error', 'No JSON files found in ZIP archive.');
            return;
          }

          // Process the first JSON file found
          const jsonFile = jsonFileEntry[1];
          return jsonFile.async('text');
        })
        .then((jsonContent) => {
          if (!jsonContent) {
            return;
          }

          this.parseAndImportJson(jsonContent);
        })
        .catch((error) => {
          this.emit(
            'status',
            'error',
            'Failed to process ZIP file: ' + error.message
          );
        });
    };

    fileReader.readAsArrayBuffer(file);
  };
}

export function convertModificationDates(notes) {
  return notes.map(({ lastModified, ...note }) => {
    // Account for Curnote's exported `lastModified` date
    let modificationDate = note.modificationDate || lastModified;

    // Convert to timestamp
    if (modificationDate && isNaN(modificationDate)) {
      modificationDate = new Date(modificationDate).getTime() / 1000;
    }
    const resultNote = { ...note };
    if (modificationDate) {
      resultNote.modificationDate = modificationDate;
    }
    return resultNote;
  });
}

export default CurnoteImporter;

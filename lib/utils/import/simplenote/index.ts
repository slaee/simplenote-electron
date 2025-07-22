import { EventEmitter } from 'events';
import CoreImporter from '../';
import { endsWith, isEmpty } from 'lodash';

import * as T from '../../../types';

class SimplenoteImporter extends EventEmitter {
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
    }

    this.emit('status', 'error', 'File must be a .json or .zip file.');
  };

  processJsonFile = (file) => {
    const coreImporter = new CoreImporter(this.addNote);
    const fileReader = new FileReader();

    fileReader.onload = (event) => {
      const fileContent = event.target.result;

      if (!fileContent) {
        this.emit('status', 'error', 'File was empty.');
        return;
      }

      this.parseAndImportJson(fileContent, coreImporter);
    };

    fileReader.readAsText(file);
  };

  parseAndImportJson = (jsonContent, coreImporter) => {
    let dataObj;
    try {
      dataObj = JSON.parse(jsonContent);
    } catch (error) {
      this.emit('status', 'error', 'Invalid JSON file.');
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
        source: 'simplenote',
        note_count: noteCount,
      });
    });
  };
}

export function convertModificationDates(notes) {
  return notes.map(({ lastModified, ...note }) => {
    // Account for Simplenote's exported `lastModified` date
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

export default SimplenoteImporter;

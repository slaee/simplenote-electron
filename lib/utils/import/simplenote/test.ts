import SimplenoteImporter, { convertModificationDates } from './';
import CoreImporter from '../';
jest.mock('../');

// Mock FileReader
global.FileReader = jest.fn(() => ({
  readAsText: jest.fn(),
  readAsArrayBuffer: jest.fn(),
  result: null,
  onload: null,
})) as any;

describe('SimplenoteImporter', () => {
  let importer;

  beforeEach(() => {
    importer = new SimplenoteImporter(() => {});
    importer.emit = jest.spyOn(importer, 'emit');
    CoreImporter.mockClear();
    CoreImporter.mockImplementation(function () {
      this.importNotes = jest.fn(() => ({
        then: (callback) => callback(),
      }));
    });
  });

  it('should emit error when no notes are passed', () => {
    importer.importNotes();
    expect(importer.emit).toHaveBeenCalledWith(
      'status',
      'error',
      'No file to import.'
    );
  });

  it.skip('should call coreImporter.importNotes with all notes and options', () => {
    return new Promise((done) => {
      const notes = {
        activeNotes: [{}, {}],
        trashedNotes: [{}],
      };
      importer.on('status', () => {
        const args = CoreImporter.mock.instances[0].importNotes.mock.calls[0];
        expect(args[0].activeNotes).toHaveLength(2);
        expect(args[0].trashedNotes).toHaveLength(1);
        expect(args[1].foo).toBe(true);
        done();
      });
      importer.importNotes([new File([JSON.stringify(notes)], 'foo.json')]);
    });
  });

  describe('ZIP file import', () => {
    it('should process ZIP files by calling processZipFile method', () => {
      const zipFile = new File(['content'], 'test.zip', {
        type: 'application/zip',
      });
      importer.processZipFile = jest.fn();

      importer.importNotes([zipFile]);

      expect(importer.processZipFile).toHaveBeenCalledWith(zipFile);
    });

    it('should emit error when ZIP file is empty in importNotes', () => {
      const zipFile = new File([''], 'test.zip', { type: 'application/zip' });
      const mockFileReader = new FileReader();
      (FileReader as any).mockImplementation(() => mockFileReader);

      importer.importNotes([zipFile]);

      mockFileReader.result = null;
      mockFileReader.onload({ target: { result: null } });

      expect(importer.emit).toHaveBeenCalledWith(
        'status',
        'error',
        'File was empty.'
      );
    });

    it('should handle missing activeNotes in JSON from ZIP', () => {
      const incompleteJsonContent = JSON.stringify({
        trashedNotes: [],
      });

      importer.parseAndImportJson(incompleteJsonContent);

      expect(importer.emit).toHaveBeenCalledWith(
        'status',
        'error',
        'Invalid Simplenote JSON format.'
      );
    });

    it('should correctly identify and process JSON files in ZIP', () => {
      // Test that the file type detection works correctly for ZIP files
      const zipFile = new File(['zip-content'], 'export.zip', {
        type: 'application/zip',
      });
      const jsonFile = new File(['json-content'], 'export.json', {
        type: 'application/json',
      });

      importer.processZipFile = jest.fn();
      importer.processJsonFile = jest.fn();

      // Test ZIP file processing
      importer.importNotes([zipFile]);
      expect(importer.processZipFile).toHaveBeenCalledWith(zipFile);
      expect(importer.processJsonFile).not.toHaveBeenCalled();

      // Reset mocks
      importer.processZipFile.mockClear();
      importer.processJsonFile.mockClear();

      // Test JSON file processing
      importer.importNotes([jsonFile]);
      expect(importer.processJsonFile).toHaveBeenCalledWith(jsonFile);
      expect(importer.processZipFile).not.toHaveBeenCalled();
    });
  });

  describe('convertModificationDates', () => {
    it('should convert `lastModified` ISO strings to `modificationDate` Unix timestamps', () => {
      const processedNotes = convertModificationDates([
        {
          lastModified: '2018-10-15T14:09:10.382Z',
          otherProp: 'value',
        },
        {
          modificationDate: '1539612550',
          otherProp: 'value',
        },
      ]);
      expect(processedNotes).toEqual([
        {
          modificationDate: 1539612550.382,
          otherProp: 'value',
        },
        {
          modificationDate: '1539612550',
          otherProp: 'value',
        },
      ]);
    });

    it('should not add undefined properties', () => {
      const processedNotes = convertModificationDates([{}]);
      expect(Object.keys(processedNotes[0])).toHaveLength(0);
    });
  });
});

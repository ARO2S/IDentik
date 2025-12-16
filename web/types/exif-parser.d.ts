declare module 'exif-parser' {
  /**
   * Minimal type definitions for the bits of exif-parser used in this project.
   */
  export type ExifTagValue = string | number | Date | undefined;

  export interface ExifTags {
    [key: string]: ExifTagValue;
    Make?: string;
    Model?: string;
    Software?: string;
    DateTimeOriginal?: number | string | Date;
    CreateDate?: number | string | Date;
    ModifyDate?: number | string | Date;
  }

  export interface ExifParserResult {
    tags?: ExifTags;
  }

  export interface ExifParser {
    enableSimpleValues(enable?: boolean): this;
    parse(): ExifParserResult;
  }

  export interface ExifParserModule {
    create(buffer: Buffer): ExifParser;
  }

  const exifParser: ExifParserModule;
  export default exifParser;
}


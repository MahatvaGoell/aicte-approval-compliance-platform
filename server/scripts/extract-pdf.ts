// Developer inspection only: reads an explicit local file, never fetches a URL or writes case metadata.
import { readFile,stat } from 'node:fs/promises';
import { extractPdfExpiry } from '../src/modules/documents/extraction/text.js';
import { EXTRACTION_LIMITS } from '../src/modules/documents/extraction/types.js';

const filename=process.argv[2];
if(!filename||process.argv.length!==3||/^[a-z]+:\/\//i.test(filename)) {
  console.error('Usage: npm run extract:pdf -- <local synthetic PDF path>');process.exitCode=1;
} else {
  try {
    const file=await stat(filename);
    if(!file.isFile()||file.size>EXTRACTION_LIMITS.maxBytes)throw new Error('Input must be a local PDF within the extraction byte limit');
    const result=await extractPdfExpiry(await readFile(filename));
    console.log(JSON.stringify(result,null,2));
    if(['INVALID_DOCUMENT','LIMIT_EXCEEDED','CANCELLED'].includes(result.outcome))process.exitCode=1;
  } catch(error) {console.error(error instanceof Error?error.message:'Could not inspect PDF');process.exitCode=1;}
}

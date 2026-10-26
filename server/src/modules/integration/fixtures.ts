import fs from 'node:fs/promises';
import { z } from 'zod';
import { SOURCE_SYSTEM } from './contract.js';

const fixtureSchema=z.object({sourceSystem:z.literal(SOURCE_SYSTEM),contractVersion:z.literal(1),synthetic:z.literal(true),
  records:z.array(z.object({regionId:z.string(),event:z.unknown()}).strict()).max(500)}).strict();

/** Fixed checked-in fixture only. No URL, path, credential or network adapter is accepted. */
export async function loadPortalFixture(regionId:string):Promise<unknown[]> {
  const file=new URL('../../../fixtures/portal-export.json',import.meta.url);
  const fixture=fixtureSchema.parse(JSON.parse(await fs.readFile(file,'utf8')));
  return fixture.records.filter(record=>record.regionId===regionId).map(record=>record.event);
}

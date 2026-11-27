import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../database/prisma.service.js';
import { ProvenanceAuditService } from '../catalogue/provenance-audit.service.js';

function loadRootEnv(): void {
  const candidates = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '../../.env'),
  ];
  for (const envPath of candidates) {
    if (!fs.existsSync(envPath)) continue;
    const content = fs.readFileSync(envPath, 'utf8');
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eqIdx = line.indexOf('=');
      if (eqIdx <= 0) continue;
      const key = line.slice(0, eqIdx).trim();
      let val = line.slice(eqIdx + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = val;
      }
    }
    break;
  }
}

async function main(): Promise<void> {
  loadRootEnv();

  const expectedDb = process.env.PROVENANCE_AUDIT_TARGET_DB || 'cinesphere';
  const prisma = new PrismaService();
  await prisma.$connect();

  try {
    const auditService = new ProvenanceAuditService(prisma);
    const report = await auditService.runAudit({ expectedDatabaseName: expectedDb });
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`PROVENANCE_AUDIT_FAILED: ${message}`);
  process.exit(1);
});

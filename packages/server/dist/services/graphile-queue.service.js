import { prisma } from '../config/database.js';
import { env } from '../config/env.js';
const quotedSchema = `"${env.GRAPHILE_WORKER_SCHEMA.replace(/"/g, '""')}"`;
const addJobSql = `select * from ${quotedSchema}.add_job($1::text, $2::json, $3::text, $4::timestamptz, $5::int, $6::text, $7::int, $8::text[], $9::text)`;
const legacyAddJobSql = `select * from ${quotedSchema}.add_job($1::text, $2::json, $3::text, $4::timestamptz, $5::int, $6::text)`;
let warnedLegacyAddJobSignature = false;
function isUndefinedFunctionError(error) {
    return (typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === '42883');
}
export async function enqueueGraphileJob(identifier, payload, spec = {}) {
    const values = [
        identifier,
        JSON.stringify(payload ?? {}),
        spec.queueName ?? null,
        spec.runAt ?? null,
        spec.maxAttempts ?? null,
        spec.jobKey ?? null,
        spec.priority ?? null,
        spec.flags?.length ? spec.flags : null,
        spec.jobKeyMode ?? 'replace',
    ];
    try {
        await prisma.$queryRawUnsafe(addJobSql, ...values);
        return;
    }
    catch (error) {
        if (!isUndefinedFunctionError(error)) {
            throw error;
        }
    }
    await prisma.$queryRawUnsafe(legacyAddJobSql, ...values.slice(0, 6));
    if (!warnedLegacyAddJobSignature) {
        warnedLegacyAddJobSignature = true;
        console.warn('Graphile add_job uses a legacy signature; enqueued with compatibility mode.');
    }
}
//# sourceMappingURL=graphile-queue.service.js.map
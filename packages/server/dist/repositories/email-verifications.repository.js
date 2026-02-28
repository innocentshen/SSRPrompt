import { prisma } from '../config/database.js';
export class EmailVerificationsRepository {
    async create(data) {
        return prisma.emailVerification.create({
            data: {
                email: data.email,
                codeHash: data.codeHash,
                type: data.type,
                expiresAt: data.expiresAt,
            },
        });
    }
    async findLatestSince(email, type, since) {
        return prisma.emailVerification.findFirst({
            where: {
                email,
                type,
                createdAt: { gt: since },
            },
            orderBy: { createdAt: 'desc' },
        });
    }
    async findLatestActive(email, type) {
        return prisma.emailVerification.findFirst({
            where: {
                email,
                type,
                verified: false,
                expiresAt: { gt: new Date() },
            },
            orderBy: { createdAt: 'desc' },
        });
    }
    async incrementAttempts(id) {
        return prisma.emailVerification.update({
            where: { id },
            data: { attempts: { increment: 1 } },
        });
    }
    async markVerified(id) {
        return prisma.emailVerification.update({
            where: { id },
            data: { verified: true },
        });
    }
}
export const emailVerificationsRepository = new EmailVerificationsRepository();
//# sourceMappingURL=email-verifications.repository.js.map
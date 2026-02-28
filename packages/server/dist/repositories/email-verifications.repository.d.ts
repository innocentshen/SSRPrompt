import type { EmailVerification, EmailVerificationType } from '@prisma/client';
export declare class EmailVerificationsRepository {
    create(data: {
        email: string;
        codeHash: string;
        type: EmailVerificationType;
        expiresAt: Date;
    }): Promise<EmailVerification>;
    findLatestSince(email: string, type: EmailVerificationType, since: Date): Promise<EmailVerification | null>;
    findLatestActive(email: string, type: EmailVerificationType): Promise<EmailVerification | null>;
    incrementAttempts(id: string): Promise<EmailVerification>;
    markVerified(id: string): Promise<EmailVerification>;
}
export declare const emailVerificationsRepository: EmailVerificationsRepository;
//# sourceMappingURL=email-verifications.repository.d.ts.map
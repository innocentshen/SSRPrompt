import type { EmailVerificationType } from '@prisma/client';
export declare class VerificationService {
    sendCode(email: string, type: EmailVerificationType): Promise<{
        success: true;
        expiresIn: number;
    }>;
    verifyCode(email: string, type: EmailVerificationType, code: string): Promise<void>;
}
export declare const verificationService: VerificationService;
//# sourceMappingURL=verification.service.d.ts.map
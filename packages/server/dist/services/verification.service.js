import { createHmac, randomInt } from 'crypto';
import { env } from '../config/env.js';
import { emailVerificationsRepository } from '../repositories/email-verifications.repository.js';
import { emailService } from './email.service.js';
import { AppError, ValidationError } from '@ssrprompt/shared';
const CODE_EXPIRES_IN_SECONDS = 15 * 60;
const MIN_RESEND_INTERVAL_MS = 60 * 1000;
const MAX_VERIFY_ATTEMPTS = 5;
function generateSixDigitCode() {
    return String(randomInt(0, 1000000)).padStart(6, '0');
}
function hashVerificationCode(email, type, code) {
    const key = Buffer.from(env.ENCRYPTION_KEY, 'hex');
    return createHmac('sha256', key).update(`${email}:${type}:${code}`).digest('hex');
}
function getEmailTemplate(type, code) {
    if (type === 'register') {
        return {
            subject: '【SSRPrompt】注册验证码',
            text: `您好，\n\n您正在注册 SSRPrompt 账户，验证码为：\n\n    ${code}\n\n验证码有效期为 15 分钟，请勿泄露给他人。\n\n如非本人操作，请忽略此邮件。\n\n—\nSSRPrompt 团队\n`,
        };
    }
    return {
        subject: '【SSRPrompt】重置密码验证码',
        text: `您好，\n\n您正在重置 SSRPrompt 账户密码，验证码为：\n\n    ${code}\n\n验证码有效期为 15 分钟，请勿泄露给他人。\n\n如非本人操作，请忽略此邮件。\n\n—\nSSRPrompt 团队\n`,
    };
}
export class VerificationService {
    async sendCode(email, type) {
        const since = new Date(Date.now() - MIN_RESEND_INTERVAL_MS);
        const recent = await emailVerificationsRepository.findLatestSince(email, type, since);
        if (recent) {
            throw new AppError(429, 'RATE_LIMIT_EXCEEDED', '验证码发送过于频繁，请稍后再试');
        }
        const code = generateSixDigitCode();
        const codeHash = hashVerificationCode(email, type, code);
        const expiresAt = new Date(Date.now() + CODE_EXPIRES_IN_SECONDS * 1000);
        await emailVerificationsRepository.create({
            email,
            type,
            codeHash,
            expiresAt,
        });
        const { subject, text } = getEmailTemplate(type, code);
        await emailService.send({ to: email, subject, text });
        return { success: true, expiresIn: CODE_EXPIRES_IN_SECONDS };
    }
    async verifyCode(email, type, code) {
        const record = await emailVerificationsRepository.findLatestActive(email, type);
        if (!record) {
            throw new ValidationError('验证码无效或已过期');
        }
        if (record.attempts >= MAX_VERIFY_ATTEMPTS) {
            throw new ValidationError('验证码错误次数过多，请重新获取验证码');
        }
        const expectedHash = hashVerificationCode(email, type, code);
        if (record.codeHash !== expectedHash) {
            const updated = await emailVerificationsRepository.incrementAttempts(record.id);
            if (updated.attempts >= MAX_VERIFY_ATTEMPTS) {
                throw new ValidationError('验证码错误次数过多，请重新获取验证码');
            }
            throw new ValidationError('验证码错误');
        }
        await emailVerificationsRepository.markVerified(record.id);
    }
}
export const verificationService = new VerificationService();
//# sourceMappingURL=verification.service.js.map
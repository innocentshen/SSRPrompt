import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { InternalError } from '@ssrprompt/shared';
export class EmailService {
    constructor() {
        Object.defineProperty(this, "transporter", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: null
        });
    }
    getTransporter() {
        if (this.transporter)
            return this.transporter;
        if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS) {
            throw new InternalError('Email service is not configured');
        }
        this.transporter = nodemailer.createTransport({
            host: env.SMTP_HOST,
            port: env.SMTP_PORT,
            secure: env.SMTP_SECURE,
            auth: {
                user: env.SMTP_USER,
                pass: env.SMTP_PASS,
            },
        });
        return this.transporter;
    }
    async send(options) {
        const transporter = this.getTransporter();
        const from = env.SMTP_FROM || env.SMTP_USER;
        if (!from) {
            throw new InternalError('Email sender is not configured');
        }
        await transporter.sendMail({
            from,
            to: options.to,
            subject: options.subject,
            text: options.text,
        });
    }
}
export const emailService = new EmailService();
//# sourceMappingURL=email.service.js.map
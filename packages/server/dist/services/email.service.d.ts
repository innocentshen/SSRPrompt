export declare class EmailService {
    private transporter;
    private getTransporter;
    send(options: {
        to: string;
        subject: string;
        text: string;
    }): Promise<void>;
}
export declare const emailService: EmailService;
//# sourceMappingURL=email.service.d.ts.map
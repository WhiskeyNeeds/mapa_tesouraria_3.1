interface EmailAttachment {
    filename: string;
    content: Buffer;
    mimeType: string;
}
interface SendEmailOptions {
    to: string | string[];
    subject: string;
    html: string;
    text?: string;
    attachments?: EmailAttachment[];
}
interface EmailResult {
    success: boolean;
    provider: 'resend' | 'smtp';
    error?: string;
}
export declare function sendEmail(options: SendEmailOptions): Promise<EmailResult>;
export declare function getAdminEmails(): string[];
export {};
//# sourceMappingURL=email.d.ts.map
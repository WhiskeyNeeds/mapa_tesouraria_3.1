import nodemailer from 'nodemailer';
export async function sendEmail(options) {
    const provider = (process.env.EMAIL_PROVIDER ?? 'smtp');
    try {
        if (provider === 'resend') {
            const { Resend } = await import('resend');
            const resend = new Resend(process.env.RESEND_API_KEY);
            await resend.emails.send({
                from: process.env.EMAIL_FROM ?? 'noreply@mapa-tesouraria.pt',
                to: Array.isArray(options.to) ? options.to : [options.to],
                subject: options.subject,
                html: options.html,
                text: options.text,
            });
            return { success: true, provider: 'resend' };
        }
        const transport = nodemailer.createTransport({
            host: process.env.SMTP_HOST ?? 'localhost',
            port: Number(process.env.SMTP_PORT ?? 1025),
            secure: process.env.SMTP_SECURE === 'true',
            auth: process.env.SMTP_USER
                ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
                : undefined,
        });
        await transport.sendMail({
            from: process.env.EMAIL_FROM ?? 'noreply@mapa-tesouraria.pt',
            to: options.to,
            subject: options.subject,
            html: options.html,
            text: options.text,
            attachments: options.attachments?.map((a) => ({
                filename: a.filename,
                content: a.content,
                contentType: a.mimeType,
            })),
        });
        return { success: true, provider: 'smtp' };
    }
    catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        return { success: false, provider, error };
    }
}
export function getAdminEmails() {
    return (process.env.ADMIN_EMAILS ?? '').split(',').filter(Boolean);
}
//# sourceMappingURL=email.js.map
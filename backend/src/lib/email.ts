import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import { getSettings } from './settings';

dotenv.config();

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10);
const SMTP_SECURE = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true';
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || process.env.EMAIL_PASSWORD || '';
const EMAIL_FROM = process.env.EMAIL_FROM || SMTP_USER;
const EMAIL_FROM_NAME = process.env.EMAIL_FROM_NAME || '';
const FRONTEND_BASE =
  process.env.FRONTEND ||
  process.env.FRONTEND_URL ||
  process.env.NEXT_PUBLIC_FRONTEND_URL ||
  '';

// Create transporter
const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: SMTP_SECURE, // true for 465, false for other ports
  auth: {
    user: SMTP_USER,
    pass: SMTP_PASS,
  },
});

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export async function sendEmail(options: EmailOptions): Promise<void> {
  try {
    if (!SMTP_USER || !SMTP_PASS) {
      console.warn('SMTP credentials not configured, email not sent');
      console.log('Email that would be sent:', {
        ...options,
        from: `"${EMAIL_FROM_NAME}" <${EMAIL_FROM}>`,
      });
      return;
    }

    const info = await transporter.sendMail({
      from: `"${EMAIL_FROM_NAME}" <${EMAIL_FROM}>`,
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
    });

    console.log('Email sent:', info.messageId);
  } catch (error) {
    console.error('Error sending email:', error);
    throw new Error('Failed to send email');
  }
}

function replaceVariables(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => variables[key] || '');
}

export async function sendWelcomeEmail(email: string, name: string): Promise<void> {
  const settings = await getSettings();
  const frontendUrl = FRONTEND_BASE;
  
  const html = replaceVariables(settings.emailTemplates.welcome.body, {
    name,
    frontendUrl,
  });

  await sendEmail({
    to: email,
    subject: settings.emailTemplates.welcome.subject,
    html,
    text: `Olá, ${name}! Seu cadastro foi realizado com sucesso. Acesse: ${frontendUrl}`,
  });
}

export async function sendPasswordResetEmail(email: string, name: string, resetToken: string): Promise<void> {
  const settings = await getSettings();
  const base = FRONTEND_BASE;
  const resetUrl = base ? `${base}/recuperar-senha?token=${resetToken}` : `/recuperar-senha?token=${resetToken}`;
  
  const html = replaceVariables(settings.emailTemplates.passwordReset.body, {
    name,
    resetUrl,
  });
  const subject = replaceVariables(settings.emailTemplates.passwordReset.subject, {
    emailFromName: EMAIL_FROM_NAME,
  });

  await sendEmail({
    to: email,
    subject,
    html,
    text: `Olá, ${name}! Para redefinir sua senha, acesse: ${resetUrl}`,
  });
}

import nodemailer from 'nodemailer';
const host = process.env.SMTP_HOST, user = process.env.SMTP_USER, pass = process.env.SMTP_PASSWORD;
export const mailEnabled = Boolean(host && user && pass);
const tr = mailEnabled ? nodemailer.createTransport({ host, port: Number(process.env.SMTP_PORT || 465), secure: Number(process.env.SMTP_PORT || 465) === 465, auth: { user, pass } }) : null;
export async function sendMail(to: string, subject: string, text: string) {
  if (!tr) return false;
  try {
    await tr.sendMail({ from: `TOP BARBERSHOP <${process.env.EMAIL_FROM || user}>`, to, subject, text });
    return true;
  } catch (e) {
    console.error('mail', (e as Error).message);
    return false;
  }
}
export const ADMIN_EMAIL = process.env.ADMIN_NOTIFY_EMAIL || process.env.EMAIL_FROM || '';

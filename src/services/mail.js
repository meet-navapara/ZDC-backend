import nodemailer from "nodemailer";
import { env } from "../config/env.js";

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!env.smtp.host || !env.smtp.user || !env.smtp.pass) {
    return null;
  }
  transporter = nodemailer.createTransport({
    host: env.smtp.host,
    port: env.smtp.port,
    secure: env.smtp.port === 465,
    auth: {
      user: env.smtp.user,
      pass: env.smtp.pass,
    },
  });
  return transporter;
}

export function isMailConfigured() {
  return Boolean(env.smtp.host && env.smtp.user && env.smtp.pass);
}

/**
 * Send an email. When emailMock is on or SMTP is unset, logs to console and resolves.
 */
export async function sendMail({ to, subject, text, html, attachments, replyTo }) {
  const from = env.smtp.from || env.smtp.user || "noreply@zdc.local";

  if (env.emailMock) {
    console.log(
      `[mail] MOCK mode — to=${to} subject=${subject}\n${text || "(no text body)"}`
    );
    return { queued: false, logged: true, mock: true };
  }

  const tx = getTransporter();

  if (!tx) {
    console.log(
      `[mail] SMTP not configured — to=${to} subject=${subject}\n${text || "(no text body)"}`
    );
    return { queued: false, logged: true, mock: true };
  }

  await tx.sendMail({
    from,
    to,
    replyTo,
    subject,
    text,
    html,
    attachments,
  });
  return { queued: true };
}

export async function sendSignupOtpEmail(email, code) {
  const subject = "Your zimji verification code";
  const text = `Your zimji email verification code is ${code}.\n\nIt expires in 10 minutes. If you did not request this, ignore this email.`;
  const html = `
    <div style="font-family:system-ui,sans-serif;line-height:1.5;color:#222">
      <h2 style="color:#2F5D50">Verify your email</h2>
      <p>Your zimji verification code is:</p>
      <p style="font-size:28px;font-weight:700;letter-spacing:4px">${code}</p>
      <p style="color:#666">Expires in 10 minutes. If you did not request this, you can ignore this email.</p>
    </div>
  `;
  return sendMail({ to: email, subject, text, html });
}

export async function sendPasswordResetEmail(email, code) {
  const resetUrl = `${env.frontendUrl}/reset-password?email=${encodeURIComponent(email)}`;
  const subject = "Reset your zimji password";
  const text = [
    `Your zimji password reset code is ${code}.`,
    "",
    `Or open: ${resetUrl}`,
    "",
    "It expires in 10 minutes. If you did not request this, ignore this email.",
  ].join("\n");
  const html = `
    <div style="font-family:system-ui,sans-serif;line-height:1.5;color:#222">
      <h2 style="color:#2F5D50">Reset your password</h2>
      <p>Your zimji password reset code is:</p>
      <p style="font-size:28px;font-weight:700;letter-spacing:4px">${code}</p>
      <p><a href="${resetUrl}">Open reset page</a></p>
      <p style="color:#666">Expires in 10 minutes. If you did not request this, you can ignore this email.</p>
    </div>
  `;
  return sendMail({ to: email, subject, text, html });
}

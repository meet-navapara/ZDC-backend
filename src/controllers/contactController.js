import { z } from "zod";
import { env } from "../config/env.js";
import { sendMail, isMailConfigured } from "../services/mail.js";
import { emailField, boundedText } from "../utils/validators.js";

const INQUIRY_TYPES = [
  "General inquiry",
  "Try-on support",
  "Billing & payments",
  "Business / B2B",
  "Partnership",
  "Other",
];

const COUNTRY_CODES = ["+254", "+91", "+1", "+44", "+971"];

const schema = z.object({
  name: boundedText(80, { min: 2 }),
  email: emailField,
  countryCode: z.enum(COUNTRY_CODES),
  phone: z
    .string()
    .trim()
    .min(6, "Enter a valid mobile number")
    .max(20)
    .regex(/^\d[\d\s-]{4,}$/, "Enter a valid mobile number"),
  inquiryType: z.enum(INQUIRY_TYPES),
  message: boundedText(500, { min: 10 }),
});

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function submitContact(req, res, next) {
  try {
    const data = schema.parse(req.body);
    const phone = `${data.countryCode} ${data.phone.replace(/\s+/g, " ").trim()}`;
    const to = env.supportEmail;

    const text = [
      `New zimji contact message`,
      ``,
      `Name: ${data.name}`,
      `Email: ${data.email}`,
      `Mobile: ${phone}`,
      `Inquiry: ${data.inquiryType}`,
      ``,
      data.message,
    ].join("\n");

    const html = `
      <div style="font-family:system-ui,sans-serif;line-height:1.5;color:#222">
        <h2 style="color:#2F5D50">New zimji contact message</h2>
        <p><strong>Name:</strong> ${escapeHtml(data.name)}</p>
        <p><strong>Email:</strong> ${escapeHtml(data.email)}</p>
        <p><strong>Mobile:</strong> ${escapeHtml(phone)}</p>
        <p><strong>Inquiry:</strong> ${escapeHtml(data.inquiryType)}</p>
        <p style="white-space:pre-wrap">${escapeHtml(data.message)}</p>
      </div>
    `;

    if (!isMailConfigured() && env.isProd) {
      return res.status(503).json({
        error: "Contact is temporarily unavailable. Please email us directly.",
      });
    }

    await sendMail({
      to,
      replyTo: data.email,
      subject: `[zimji] ${data.inquiryType} — ${data.name}`,
      text,
      html,
    });

    return res.json({ ok: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({
        error: err.issues[0]?.message || "Please check the form and try again.",
      });
    }
    return next(err);
  }
}

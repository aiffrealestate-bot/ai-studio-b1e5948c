import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

/** Israeli phone: 05X-XXXXXXX or 0X-XXXXXXX, with or without hyphens/spaces */
const israeliPhoneRegex = /^(\+972|0)(([23489]\d{7})|(5[0-9]\d{7}))$/;

const phoneSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s\-()]/g, ''))
  .refine((v) => israeliPhoneRegex.test(v), {
    message: 'מספר טלפון לא תקין. אנא הזן מספר ישראלי תקין.',
  });

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email({ message: 'כתובת אימייל לא תקינה.' })
  .max(254, { message: 'כתובת אימייל ארוכה מדי.' });

const hebrewOrGeneralNameSchema = z
  .string()
  .trim()
  .min(2, { message: 'שם חייב להכיל לפחות 2 תווים.' })
  .max(100, { message: 'שם לא יכול להכיל יותר מ-100 תווים.' })
  .regex(/^[\u0590-\u05FF\uFB1D-\uFB4Ea-zA-Z\s'\-.]+$/, {
    message: 'שם יכול להכיל אותיות בעברית, באנגלית, רווחים וסימני פיסוק בסיסיים בלבד.',
  });

// ---------------------------------------------------------------------------
// Lead / Contact form schema
// ---------------------------------------------------------------------------

export const LeadSchema = z.object({
  full_name: hebrewOrGeneralNameSchema,

  email: emailSchema,

  phone: phoneSchema,

  /** The legal area the prospect is enquiring about */
  practice_area: z
    .enum([
      'business_law',
      'real_estate',
      'litigation',
      'family_law',
      'criminal_law',
      'employment_law',
      'contracts',
      'other',
    ])
    .optional()
    .default('other'),

  /** Free-text message in Hebrew or English */
  message: z
    .string()
    .trim()
    .min(10, { message: 'ההודעה חייבת להכיל לפחות 10 תווים.' })
    .max(2000, { message: 'ההודעה לא יכולה להכיל יותר מ-2000 תווים.' }),

  /** Preferred contact method */
  preferred_contact: z
    .enum(['phone', 'email', 'whatsapp'])
    .optional()
    .default('phone'),

  /** GDPR / local privacy consent */
  consent: z.literal(true, {
    errorMap: () => ({ message: 'יש לאשר את תנאי הפרטיות כדי להמשיך.' }),
  }),

  /** Honeypot field — must be absent or empty to pass bot check */
  website: z
    .string()
    .max(0, { message: 'Bot detected.' })
    .optional()
    .default(''),
});

export type LeadInput = z.infer<typeof LeadSchema>;

// ---------------------------------------------------------------------------
// Appointment / callback request schema
// ---------------------------------------------------------------------------

export const AppointmentSchema = z.object({
  full_name: hebrewOrGeneralNameSchema,

  email: emailSchema,

  phone: phoneSchema,

  preferred_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'תאריך לא תקין. פורמט נדרש: YYYY-MM-DD.' })
    .refine(
      (d) => {
        const date = new Date(d);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return date >= today;
      },
      { message: 'התאריך חייב להיות היום או בעתיד.' }
    ),

  preferred_time: z
    .enum(['morning', 'afternoon', 'evening'])
    .optional()
    .default('morning'),

  notes: z
    .string()
    .trim()
    .max(500, { message: 'הערות לא יכולות להכיל יותר מ-500 תווים.' })
    .optional()
    .default(''),

  consent: z.literal(true, {
    errorMap: () => ({ message: 'יש לאשר את תנאי הפרטיות כדי להמשיך.' }),
  }),

  website: z
    .string()
    .max(0, { message: 'Bot detected.' })
    .optional()
    .default(''),
});

export type AppointmentInput = z.infer<typeof AppointmentSchema>;

// ---------------------------------------------------------------------------
// Utility: format Zod errors into a flat object suitable for form state
// ---------------------------------------------------------------------------

export function formatZodErrors(
  errors: z.ZodError
): Record<string, string> {
  return Object.fromEntries(
    errors.errors.map((e) => [
      e.path.join('.') || 'general',
      e.message,
    ])
  );
}

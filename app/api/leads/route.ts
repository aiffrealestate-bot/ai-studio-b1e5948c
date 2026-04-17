import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { LeadSchema, formatZodErrors } from '@/lib/validation';
import { getSupabaseAdminClient } from '@/lib/supabase';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_MAX_REQUESTS = 5; // 5 submissions per IP per minute

// In-memory rate limiter — suitable for single-instance / edge deployments.
// For multi-region production, replace with an Upstash Redis-backed solution.
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function getRateLimitHeaders(
  remaining: number,
  resetAt: number
): Record<string, string> {
  return {
    'X-RateLimit-Limit': String(RATE_LIMIT_MAX_REQUESTS),
    'X-RateLimit-Remaining': String(Math.max(remaining, 0)),
    'X-RateLimit-Reset': String(Math.floor(resetAt / 1000)),
    'X-RateLimit-Window': String(RATE_LIMIT_WINDOW_SECONDS),
  };
}

function checkRateLimit(ip: string): {
  allowed: boolean;
  remaining: number;
  resetAt: number;
} {
  const now = Date.now();
  const windowMs = RATE_LIMIT_WINDOW_SECONDS * 1000;
  const entry = rateLimitMap.get(ip);

  if (!entry || now > entry.resetAt) {
    const resetAt = now + windowMs;
    rateLimitMap.set(ip, { count: 1, resetAt });
    return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS - 1, resetAt };
  }

  if (entry.count >= RATE_LIMIT_MAX_REQUESTS) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  entry.count += 1;
  return {
    allowed: true,
    remaining: RATE_LIMIT_MAX_REQUESTS - entry.count,
    resetAt: entry.resetAt,
  };
}

// ---------------------------------------------------------------------------
// POST /api/leads
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  // 1. Resolve client IP (Vercel forwards via x-forwarded-for)
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown';

  // 2. Rate limit check
  const rateLimit = checkRateLimit(ip);
  const rateLimitHeaders = getRateLimitHeaders(rateLimit.remaining, rateLimit.resetAt);

  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        success: false,
        error: 'יותר מדי בקשות. אנא נסה שוב בעוד דקה.',
        code: 'RATE_LIMITED',
      },
      { status: 429, headers: { ...rateLimitHeaders, 'Retry-After': String(RATE_LIMIT_WINDOW_SECONDS) } }
    );
  }

  // 3. Parse JSON body
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'גוף הבקשה אינו JSON תקין.', code: 'INVALID_JSON' },
      { status: 400, headers: rateLimitHeaders }
    );
  }

  // 4. Validate with Zod
  let validatedData: ReturnType<typeof LeadSchema.parse>;
  try {
    validatedData = LeadSchema.parse(rawBody);
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        {
          success: false,
          error: 'נתונים שגויים בטופס. אנא בדוק את השדות המסומנים.',
          code: 'VALIDATION_ERROR',
          fields: formatZodErrors(err),
        },
        { status: 422, headers: rateLimitHeaders }
      );
    }
    // Unknown validation failure
    return NextResponse.json(
      { success: false, error: 'שגיאת אימות לא ידועה.', code: 'UNKNOWN_VALIDATION_ERROR' },
      { status: 422, headers: rateLimitHeaders }
    );
  }

  // 5. Honeypot check
  if (validatedData.website && validatedData.website.length > 0) {
    // Silently accept to not reveal bot detection
    return NextResponse.json(
      { success: true, message: 'הטופס נשלח בהצלחה.' },
      { status: 201, headers: rateLimitHeaders }
    );
  }

  // 6. Insert into Supabase (parameterized via SDK — safe against SQL injection)
  const supabase = getSupabaseAdminClient();

  const { error: dbError } = await supabase.from('leads').insert([
    {
      full_name: validatedData.full_name,
      email: validatedData.email,
      phone: validatedData.phone,
      practice_area: validatedData.practice_area,
      message: validatedData.message,
      preferred_contact: validatedData.preferred_contact,
      source_ip: ip,
      created_at: new Date().toISOString(),
    },
  ]);

  if (dbError) {
    console.error('[leads/POST] Supabase insert error:', dbError);
    return NextResponse.json(
      {
        success: false,
        error: 'שגיאה בשמירת הפנייה. אנא נסה שוב מאוחר יותר.',
        code: 'DB_INSERT_ERROR',
        // Expose a safe subset of the error in non-production
        ...(process.env.NODE_ENV !== 'production' && { detail: dbError.message }),
      },
      { status: 500, headers: rateLimitHeaders }
    );
  }

  // 7. Success
  return NextResponse.json(
    {
      success: true,
      message: 'תודה על פנייתך! נציג משרדנו יצור איתך קשר בהקדם.',
    },
    { status: 201, headers: rateLimitHeaders }
  );
}

// ---------------------------------------------------------------------------
// Method guards
// ---------------------------------------------------------------------------

export async function GET() {
  return NextResponse.json(
    { success: false, error: 'Method Not Allowed', code: 'METHOD_NOT_ALLOWED' },
    { status: 405, headers: { Allow: 'POST' } }
  );
}

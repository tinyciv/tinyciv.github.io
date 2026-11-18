const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const contextLimits: Record<string, number> = { sessionId: 80, build: 80, worldType: 80, scenario: 80, mode: 40, page: 200 };
export interface FeedbackInput { id: string; visitorId: string; message: string; context: Record<string, string>; }

/** Retain only bounded diagnostics; never accept identity or arbitrary client data. */
export function feedbackInput(value: Record<string, unknown>, userAgent: string | undefined): FeedbackInput | undefined {
  if (typeof value.id !== 'string' || !uuid.test(value.id)
    || typeof value.visitorId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(value.visitorId)
    || typeof value.message !== 'string') return;
  const message = value.message.trim();
  if (!message || message.length > 4000 || Buffer.byteLength(message) > 16000 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(message)) return;
  const raw = value.context;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
  const context: Record<string, string> = {};
  for (const [key, limit] of Object.entries(contextLimits)) {
    const field = (raw as Record<string, unknown>)[key];
    if (field === undefined || field === null) continue;
    if (typeof field !== 'string' || field.length > limit || /[\x00-\x1f]/.test(field)) return;
    if (key === 'page' && (!field.startsWith('/') || /[?#]/.test(field))) return;
    context[key] = field;
  }
  context.userAgent = (userAgent ?? '').replace(/[\x00-\x1f]/g, '').slice(0, 512);
  return { id: value.id, visitorId: value.visitorId, message, context };
}

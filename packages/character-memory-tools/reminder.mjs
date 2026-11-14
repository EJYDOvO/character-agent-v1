// End-of-history style reminder for the Character Root agent.
//
// DSH appends runtime contexts to the end of the history whenever the joined
// snapshot changes (Memory at order 80, Interaction at 85), so a static
// reminder at order 95 lands after them, closest to generation. It is not
// re-sent on every turn: the full rules stay in the Persona prefix.
// The text is deployment-authored, so prompt interpolation is disabled.
export const REMINDER_CONTEXT = 'character:reminder';
const REMINDER_ORDER = 95;
export const MAX_REMINDER_CHARS = 4000;

/**
 * @param {{effect: Function, systemPrompt: {context: Function}}} ctx
 * @param {unknown} reminder
 * @returns {boolean} whether a context was registered
 */
export function registerReminder(ctx, reminder) {
  if (reminder === undefined || reminder === null) return false;
  if (typeof reminder !== 'string' || [...reminder].length > MAX_REMINDER_CHARS) {
    throw Error(`Invalid reminder: expected text up to ${MAX_REMINDER_CHARS} characters`);
  }
  const text = reminder.trim();
  if (!text) return false;
  ctx.effect(() => ctx.systemPrompt.context({name: REMINDER_CONTEXT, order: REMINDER_ORDER, interpolate: false, text: () => text}));
  return true;
}

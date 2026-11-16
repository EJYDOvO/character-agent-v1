// Prompt-size estimate for Persona text, using the ratios DeepSeek publishes
// for its tokenizer: about 0.3 token per ASCII character and 0.6 per other
// character. Not exact, and deliberately separate from the memory budget
// estimator, which is conservative on purpose.
const ASCII_TOKENS = 0.3;
const OTHER_TOKENS = 0.6;

export function estimatePromptTokens(text) {
  let ascii = 0;
  let other = 0;
  for (const char of text) {
    if (char.codePointAt(0) < 128) ascii++;
    else other++;
  }
  return Math.ceil(ascii * ASCII_TOKENS + other * OTHER_TOKENS);
}

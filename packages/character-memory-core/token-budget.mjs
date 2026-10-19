// Conservative, Unicode-aware estimate; not a provider-specific tokenizer.
// The installed SDK's chars/constant heuristic undercounts Chinese. Count CJK
// and non-Latin code points separately, including framing/JSON in the input.
export function estimateTokens(text){
 let latin=0,other=0;
 for(const char of text){if(char.codePointAt(0)<128)latin++;else other+=2;}
 return Math.ceil(latin/3)+other;
}

// Host service contract. Never construct trusted handles from model arguments.
export function requireMemoryIdentity(provider) {
  if (provider?.contractVersion !== 1) throw Error('memoryIdentity v1 provider required');
  for (const method of ['authorize', 'forSession', 'current', 'onEvidence']) {
    if (typeof provider[method] !== 'function') throw Error('Incomplete memoryIdentity provider: ' + method);
  }
  return provider;
}

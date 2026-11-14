// Every rejection of a character card, its rules files or its deployment
// settings. Messages are user-facing Chinese and name the file involved.
export class CardError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CardError';
  }
}

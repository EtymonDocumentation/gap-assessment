/** An error whose message is shown to the user as-is: plain language, and it says what to do. */
export class TemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateError";
  }
}

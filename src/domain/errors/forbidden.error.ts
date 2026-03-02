import { DomainError } from "./domain.error.js";

export class ForbiddenError extends DomainError {
  constructor(message = "Forbidden") {
    super(message);
  }
}

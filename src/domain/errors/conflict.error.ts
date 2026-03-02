import { DomainError } from "./domain.error.js";

export class ConflictError extends DomainError {
  constructor(entity: string, field: string) {
    super(`${entity} with ${field} already exists`);
  }
}

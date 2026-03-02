import { DomainError } from "./domain.error.js";

export class NotFoundError extends DomainError {
  constructor(entity: string, id: string) {
    super(`${entity} '${id}' not found`);
  }
}

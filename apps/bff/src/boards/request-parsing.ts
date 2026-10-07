import { BadRequestException, HttpStatus, ParseUUIDPipe } from '@nestjs/common';

/** An id that is not a UUID cannot exist, so it is a 404 without asking the backend. */
export const uuidPipe = new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.NOT_FOUND });

/** A required string in a JSON body; the rules about its content belong to the business backend. */
export function textField(body: unknown, field: string, what: string): string {
  const value = (body as Record<string, unknown> | null)?.[field];
  if (typeof value !== 'string') {
    throw new BadRequestException(`${what} needs a ${field}.`);
  }
  return value;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether a value from a JSON body can be an id at all: one that cannot exist is a 404 without asking the backend. */
export function isUuid(value: string): boolean {
  return UUID.test(value);
}

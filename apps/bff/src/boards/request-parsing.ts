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

/** Who a member is added by: an email, or the id the people search returned (`GET /api/users`); the backend decides that exactly one is there. */
export interface MemberTarget {
  email?: string;
  userId?: string;
}

export function memberTarget(body: unknown): MemberTarget {
  const source = (body as Record<string, unknown> | null) ?? {};
  const { email, userId } = source;
  if (
    (email !== undefined && typeof email !== 'string') ||
    (userId !== undefined && typeof userId !== 'string')
  ) {
    throw new BadRequestException('A member needs an email or a userId, as text.');
  }
  if (email === undefined && userId === undefined) {
    throw new BadRequestException('A member needs an email or a userId.');
  }
  if (userId !== undefined && !UUID.test(userId as string)) {
    throw new BadRequestException('The userId is not an id.');
  }
  return {
    ...(email === undefined ? {} : { email }),
    ...(userId === undefined ? {} : { userId }),
  } as MemberTarget;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether a value from a JSON body can be an id at all: one that cannot exist is a 404 without asking the backend. */
export function isUuid(value: string): boolean {
  return UUID.test(value);
}

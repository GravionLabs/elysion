import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'isPublic';

/** Opts a route out of the global `AuthGuard`. Only for routes that must work without a token (health). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { CredentialResolver } from '../auth/credential-resolver.js';
import { PublicMeController } from './public-me.controller.js';

const TOKEN = `elp_${'a'.repeat(43)}`;

const resolverAnswering = (answer: unknown) => {
  const resolve = vi.fn().mockResolvedValue(answer);
  return { resolve, credentials: { resolve } as unknown as CredentialResolver };
};

describe('PublicMeController', () => {
  it('asks the backend afresh with the token and answers who the caller is', async () => {
    const { resolve, credentials } = resolverAnswering({
      userId: '11111111-1111-4111-8111-111111111111',
      displayName: 'Ada',
      kind: 'person',
      tokenId: '22222222-2222-4222-8222-222222222222',
      scopes: ['boards:read'],
    });

    const me = await new PublicMeController(credentials).me(TOKEN);

    expect(resolve).toHaveBeenCalledWith(TOKEN, { fresh: true });
    expect(me).toEqual({
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Ada',
      kind: 'person',
      tokenId: '22222222-2222-4222-8222-222222222222',
      scopes: ['boards:read'],
    });
  });

  it('answers 401 for a token the backend no longer knows (revoked since the guard checked it)', async () => {
    const { credentials } = resolverAnswering(null);

    await expect(new PublicMeController(credentials).me(TOKEN)).rejects.toThrow(
      UnauthorizedException,
    );
  });
});

import type { CSSProperties } from 'react';
import { useI18n } from '../i18n';
import type { FollowState } from './follow';

export interface FollowOverlayProps {
  state: FollowState;
  /** The person wants to be back in the presentation they stepped out of. */
  onFollowPresenter: () => void;
}

/**
 * What shows that the view is somebody else's (#848): a frame in that person's color around the canvas and a pill that says
 * whom this client follows ("Following <name> — Esc to stop"), who presents, or a button back into the presentation after
 * stepping out. The pill is a `role="status"` region that is always in the page, so a screen reader announces a change of
 * it. Neither is part of the scene: nothing is synced or exported, and neither catches a pointer event except the button.
 */
export function FollowOverlay({ state, onFollowPresenter }: FollowOverlayProps) {
  const { t } = useI18n();
  const { following, presenter, steppedOut } = state;
  const person = following ?? (steppedOut ? presenter : null);
  let text: string | null = null;
  if (following) {
    text = t.followingPill(following.name);
  } else if (presenter?.me) {
    text = t.presenterPillMe;
  } else if (steppedOut && presenter) {
    text = t.presenterPill(presenter.name);
  }
  return (
    <div
      className="elysion-follow"
      style={person ? ({ '--follow-color': person.color } as CSSProperties) : undefined}
    >
      {following && <div className="elysion-follow-frame" data-testid="follow-frame" />}
      <div className="elysion-follow-status" role="status">
        {text && (
          <span className="elysion-follow-pill" data-reason={following?.reason}>
            <span className="elysion-follow-dot" aria-hidden="true" />
            {text}
            {steppedOut && !following && (
              <button type="button" className="elysion-follow-button" onClick={onFollowPresenter}>
                {t.followPresenter}
              </button>
            )}
          </span>
        )}
      </div>
    </div>
  );
}

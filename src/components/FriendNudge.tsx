import { useEffect, useState } from 'react';
import { askForAccount } from '../lib/account';
import { friendOffer, friendsThisVisit, periodWords, type FriendOffer, type Friends } from '../lib/friends';
import { useStanding } from './useSubscribed';
import './invite.css';

const capitalised = (words: string) => words.charAt(0).toUpperCase() + words.slice(1);

/**
 * For somebody who came by a friend's invite: what is on offer, and then how
 * close they are. It is the reason to come back on day two and day three, so
 * it sits on Home where they will see it, and goes once the reward is theirs.
 */
export default function FriendNudge({ onMakeAccount }: { onMakeAccount: () => void }) {
  const standing = useStanding();
  const [offer, setOffer] = useState<FriendOffer | null>(null);
  const [friends, setFriends] = useState<Friends | null>(null);

  useEffect(() => {
    if (!standing.known || standing.off) return;
    let live = true;
    if (standing.account) void friendsThisVisit().then((found) => live && setFriends(found));
    else void friendOffer().then((found) => live && setOffer(found));
    return () => {
      live = false;
    };
  }, [standing.known, standing.off, standing.account]);

  if (!standing.account && offer) {
    return (
      <section className="card invite-nudge">
        <p className="small">
          <b>🎁 A friend invited you.</b> Make an account and use Squish on {offer.qualifyDays} different days, and you both get{' '}
          {periodWords(offer.rewardDays)} of Squish Plus.
        </p>
        <button
          type="button"
          className="btn btn--sm"
          onClick={() => {
            askForAccount();
            onMakeAccount();
          }}
        >
          Make an account
        </button>
      </section>
    );
  }

  const mine = friends?.mine;
  if (standing.account && friends && mine && !mine.rewarded) {
    const left = friends.qualifyDays - mine.daysUsed;
    return (
      <section className="card invite-nudge">
        <p className="small">
          <b>🎁 {capitalised(periodWords(friends.rewardDays))} of Squish Plus, for you and your friend.</b>{' '}
          {!mine.verified
            ? 'Confirm your email address first — the link is in your inbox.'
            : left <= 0
              ? 'It is on its way.'
              : `${mine.daysUsed} of ${friends.qualifyDays} days done — ${left === 1 ? 'one more to go' : `${left} more to go`}.`}
        </p>
        <div className="invite-dots" aria-hidden="true">
          {Array.from({ length: friends.qualifyDays }, (_, i) => (
            <span key={i} className={i < mine.daysUsed ? 'on' : ''} />
          ))}
        </div>
      </section>
    );
  }

  return null;
}

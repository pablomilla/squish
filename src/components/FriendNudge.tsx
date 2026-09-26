import { useEffect, useState } from 'react';
import { askForAccount } from '../lib/account';
import { friendOffer, friendsThisVisit, periodWords, type FriendOffer, type Friends } from '../lib/friends';
import { useStanding } from './useSubscribed';
import { useSquish } from '../store/useSquish';
import SquadUnlocked from './SquadUnlocked';
import './invite.css';
import { plural, t } from '../lib/i18n';
import { rich, richPlural } from '../lib/i18n-react';

const capitalised = (words: string) => words.charAt(0).toUpperCase() + words.slice(1);

/**
 * For somebody who came by a friend's invite: what is on offer, and then how
 * close they are. It is the reason to come back on day two and day three, so
 * it sits on Home where they will see it, and goes once the reward is theirs.
 */
export default function FriendNudge({ onOpenYou }: { onOpenYou: () => void }) {
  const standing = useStanding();
  const [offer, setOffer] = useState<FriendOffer | null>(null);
  const [friends, setFriends] = useState<Friends | null>(null);
  const unlock = useSquish((s) => s.unlock);

  useEffect(() => {
    if (!standing.known || standing.off) return;
    let live = true;
    if (standing.account)
      void friendsThisVisit().then((found) => {
        if (!live) return;
        setFriends(found);
        if (found && found.rewarded > 0) unlock('squad');
      });
    else void friendOffer().then((found) => live && setOffer(found));
    return () => {
      live = false;
    };
  }, [standing.known, standing.off, standing.account, unlock]);

  if (!standing.account && offer) {
    return (
      <section className="card invite-nudge">
        <p className="small">
          {rich('<b>🎁 A friend invited you.</b> Make an account and use Squish on {days} different days, and you both get {period} of Squish Plus.', {
            days: offer.qualifyDays,
            period: periodWords(offer.rewardDays),
          }, { b: (text) => <b>{text}</b> })}
        </p>
        <button
          type="button"
          className="btn btn--sm"
          onClick={() => {
            askForAccount();
            onOpenYou();
          }}
        >
          {t('Make an account')}
        </button>
      </section>
    );
  }

  // An inviter whose friend has just got going: say so here, and send them to
  // the invite card, which celebrates properly and spends the well-done.
  if (standing.account && friends && friends.fresh > 0) {
    return (
      <section className="card invite-nudge">
        <p className="small">
          {richPlural(friends.fresh, {
            one: '<b>🎉 A friend you invited has got going.</b> Your thank-you is ready.',
            other: '<b>🎉 {n} friends you invited have got going.</b> Your thank-you is ready.',
          }, {}, { b: (text) => <b>{text}</b> })}
        </p>
        <SquadUnlocked compact />
        <button type="button" className="btn btn--sm" onClick={onOpenYou}>
          {t("See what you've got")}
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
          <b>{t('🎁 {period} of Squish Plus, for you and your friend.', { period: capitalised(periodWords(friends.rewardDays)) })}</b>{' '}
          {!mine.verified
            ? t('Confirm your email address first — the link is in your inbox.')
            : left <= 0
              ? t('It is on its way.')
              : plural(left, { one: '{done} of {days} days done — one more to go.', other: '{done} of {days} days done — {n} more to go.' }, { done: mine.daysUsed, days: friends.qualifyDays })}
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

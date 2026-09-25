import { useEffect, useState } from 'react';
import { useToast } from './ui';
import { askForAccount } from '../lib/account';
import { refreshPlan } from '../lib/plan';
import { fetchFriends, periodWords, shareInvite, type Friends } from '../lib/friends';
import { useStanding } from './useSubscribed';
import { useSquish } from '../store/useSquish';
import SquadUnlocked from './SquadUnlocked';
import './invite.css';

const shortDay = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * Invite a friend: they get a month of Squish Plus, and so do you, once they
 * have got going. The rules are the server's (server/friends.ts); this says
 * them plainly, hands over the link, and keeps score.
 */
export default function InviteCard() {
  const standing = useStanding();
  const toast = useToast();
  const [friends, setFriends] = useState<Friends | null>(null);
  const [celebrate, setCelebrate] = useState(false);
  const unlock = useSquish((s) => s.unlock);
  const signedIn = standing.account;
  const onPlus = standing.plan === 'plus';

  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    void fetchFriends().then((found) => {
      if (!live || !found) return;
      setFriends(found);
      // The squad set is the inviter's for good from the first friend who got going.
      if (found.rewarded > 0) unlock('squad');
      if (found.fresh > 0) setCelebrate(true);
      // A friend got going since last time: say so once, and pick up the Plus.
      if (found.fresh > 0) {
        toast(
          `${found.fresh === 1 ? 'A friend' : `${found.fresh} friends`} got going — ${
            found.extra ? `your invite bonus is on, and ${periodWords(found.rewardDays * found.fresh)} of Plus is saved` : `you've earned ${periodWords(found.rewardDays * found.fresh)} of Squish Plus`
          }`,
          '🎉',
        );
        void refreshPlan();
      }
    });
    return () => {
      live = false;
    };
  }, [signedIn, toast, unlock]);

  // Where invites cannot exist — no server keeping accounts — say nothing.
  if (standing.off || !standing.known) return null;

  const period = periodWords(friends?.rewardDays ?? 30);
  const days = friends?.qualifyDays ?? 3;

  const invite = async () => {
    if (!friends) return;
    const outcome = await shareInvite(friends);
    if (outcome === 'copied') toast('Invite link copied — paste it to a friend', '🔗');
    if (outcome === 'failed') toast(`Your invite link: ${friends.link}`, '🔗');
  };

  return (
    <section className="card invite-card">
      <div className="card-title">
        <h3>Invite a friend</h3>
        <span className="badge badge--good">🎁 {onPlus ? 'For you both' : `${period} each`}</span>
      </div>
      <p className="small">
        Give a friend {period} of Squish Plus —{' '}
        {onPlus && friends
          ? `and get ${friends.boost.photo} extra photo analyses and ${friends.boost.chat} extra questions straight away, with ${period} of Plus saved for after your current Plus.`
          : `and get ${period} yourself.`}
      </p>
      <p className="tiny muted">
        It arrives for you both once they have made an account, confirmed their email and used Squish on {days} different days.
        {friends ? ` You can earn up to ${friends.cap} thank-yous a year this way.` : ''}
      </p>

      {celebrate && <SquadUnlocked />}

      {friends?.extra && (
        <p className="tiny invite-extra">
          ✨ Invite bonus: +{friends.extra.photo} photo analyses and +{friends.extra.chat} questions, until {shortDay(friends.extra.until)}.
          {friends.plusUntil ? ` Your Plus runs to ${shortDay(friends.plusUntil)}, saved months included.` : ''}
        </p>
      )}

      {friends?.mine && !friends.mine.rewarded && (
        <div className="invite-progress" role="status">
          <b>You were invited too.</b>{' '}
          {!friends.mine.verified
            ? 'Confirm your email address, then keep using Squish — '
            : `${friends.mine.daysUsed} of ${friends.qualifyDays} days so far — `}
          your {period} of Plus follows.
        </div>
      )}

      {signedIn ? (
        <>
          <button type="button" className="btn btn--block" disabled={!friends} onClick={() => void invite()}>
            Invite a friend
          </button>
          {friends && (
            <p className="tiny muted invite-score">
              {friends.joined === 0
                ? `Your code is ${friends.code}.`
                : `${friends.joined} joined · ${friends.rewarded} got going · ${periodWords(friends.daysEarned)} of Plus ${onPlus ? 'saved' : 'earned'}`}
            </p>
          )}
        </>
      ) : (
        <>
          <p className="tiny muted">Invites come from your account, so a reward has somewhere to go.</p>
          <button
            type="button"
            className="btn btn--soft btn--block"
            onClick={() => {
              askForAccount();
            }}
          >
            Make an account to invite friends
          </button>
        </>
      )}
    </section>
  );
}

import { useEffect, useState } from 'react';
import { useToast } from './ui';
import { askForAccount } from '../lib/account';
import { refreshPlan } from '../lib/plan';
import { fetchFriends, periodWords, shareInvite, type Friends } from '../lib/friends';
import { useStanding } from './useSubscribed';
import { useSquish } from '../store/useSquish';
import SquadUnlocked from './SquadUnlocked';
import './invite.css';
import { plural, t, uiLocale } from '../lib/i18n';

const shortDay = (iso: string) => new Date(iso).toLocaleDateString(uiLocale(), { day: 'numeric', month: 'short', year: 'numeric' });

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
        const period = periodWords(found.rewardDays * found.fresh);
        toast(
          found.extra
            ? plural(found.fresh, {
                one: 'A friend got going — your invite bonus is on, and {period} of Plus is saved',
                other: '{n} friends got going — your invite bonus is on, and {period} of Plus is saved',
              }, { period })
            : plural(found.fresh, {
                one: "A friend got going — you've earned {period} of Squish Plus",
                other: "{n} friends got going — you've earned {period} of Squish Plus",
              }, { period }),
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
    if (outcome === 'copied') toast(t('Invite link copied — paste it to a friend'), '🔗');
    if (outcome === 'failed') toast(t('Your invite link: {link}', { link: friends.link }), '🔗');
  };

  return (
    <section className="card invite-card">
      <div className="card-title">
        <h3>{t('Invite a friend')}</h3>
        <span className="badge badge--good">🎁 {onPlus ? t('For you both') : t('{period} each', { period })}</span>
      </div>
      <p className="small">
        {onPlus && friends
          ? t('Give a friend {period} of Squish Plus — and get {photos} extra photo analyses and {questions} extra questions straight away, with {period} of Plus saved for after your current Plus.', {
              period,
              photos: friends.boost.photo,
              questions: friends.boost.chat,
            })
          : t('Give a friend {period} of Squish Plus — and get {period} yourself.', { period })}
      </p>
      <p className="tiny muted">
        {t('It arrives for you both once they have made an account, confirmed their email and used Squish on {days} different days.', { days })}
        {friends ? ` ${t('You can earn up to {n} thank-yous a year this way.', { n: friends.cap })}` : ''}
      </p>

      {celebrate && <SquadUnlocked />}

      {friends?.extra && (
        <p className="tiny invite-extra">
          {t('✨ Invite bonus: +{photos} photo analyses and +{questions} questions, until {date}.', {
            photos: friends.extra.photo,
            questions: friends.extra.chat,
            date: shortDay(friends.extra.until),
          })}
          {friends.plusUntil ? ` ${t('Your Plus runs to {date}, saved months included.', { date: shortDay(friends.plusUntil) })}` : ''}
        </p>
      )}

      {friends?.mine && !friends.mine.rewarded && (
        <div className="invite-progress" role="status">
          <b>{t('You were invited too.')}</b>{' '}
          {!friends.mine.verified
            ? t('Confirm your email address, then keep using Squish — your {period} of Plus follows.', { period })
            : t('{done} of {days} days so far — your {period} of Plus follows.', { done: friends.mine.daysUsed, days: friends.qualifyDays, period })}
        </div>
      )}

      {signedIn ? (
        <>
          <button type="button" className="btn btn--block" disabled={!friends} onClick={() => void invite()}>
            {t('Invite a friend')}
          </button>
          {friends && (
            <p className="tiny muted invite-score">
              {friends.joined === 0
                ? t('Your code is {code}.', { code: friends.code })
                : onPlus
                  ? t('{joined} joined · {going} got going · {period} of Plus saved', { joined: friends.joined, going: friends.rewarded, period: periodWords(friends.daysEarned) })
                  : t('{joined} joined · {going} got going · {period} of Plus earned', { joined: friends.joined, going: friends.rewarded, period: periodWords(friends.daysEarned) })}
            </p>
          )}
        </>
      ) : (
        <>
          <p className="tiny muted">{t('Invites come from your account, so a reward has somewhere to go.')}</p>
          <button
            type="button"
            className="btn btn--soft btn--block"
            onClick={() => {
              askForAccount();
            }}
          >
            {t('Make an account to invite friends')}
          </button>
        </>
      )}
    </section>
  );
}

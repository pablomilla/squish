import { useState } from 'react';
import { askForAccount } from '../../lib/account';
import { isoDate } from '../../lib/date';
import { loggedToday, pendingSquadInvite } from '../../lib/squad';
import { useStanding } from '../useSubscribed';
import { useSquad } from './useSquad';
import SquadSheet, { MemberSquish } from './SquadSheet';
import SquadForms from './SquadForms';
import './squad.css';

/**
 * On Home: the squad at a glance — everybody's Squish, who has logged today,
 * and the week so far. Tap for the squad itself. For somebody who came by a
 * squad's link and has not joined yet, the way in.
 */
export default function SquadStrip({ onOpenYou }: { onOpenYou: () => void }) {
  const squad = useSquad();
  const standing = useStanding();
  const [open, setOpen] = useState(false);
  const [joining, setJoining] = useState(false);
  const invite = pendingSquadInvite();
  const today = isoDate();

  if (squad.kind === 'in') {
    const { squad: s } = squad;
    const me = s.members.find((m) => m.isMe);
    const wonThisWeek = me?.weekKey && s.lastWonWeek === me.weekKey;
    return (
      <>
        <section className="card">
          <button type="button" className="squad-strip" onClick={() => setOpen(true)} aria-label={`${s.name}: open your squad`}>
            <div className="squad-strip-head">
              <h3>{s.name}</h3>
              <span className="tiny muted">{wonThisWeek ? '🏆 Week done!' : `Cheer ›`}</span>
            </div>
            <div className="squad-row">
              {s.members.map((member) => (
                <div key={member.id} className="squad-face">
                  <MemberSquish member={member} size={48} />
                  <span className="tiny">
                    {member.isMe ? 'You' : member.name} {loggedToday(member, today) && <span className="squad-tick" aria-label="logged today">✓</span>}
                  </span>
                  <span className="tiny muted">🔥 {member.streak}</span>
                </div>
              ))}
            </div>
            <div className="squad-strip-foot">
              <span className="tiny muted">
                {s.members.length < 2 ? 'Invite a friend to get going' : `Everybody aiming for ${s.goal} days this week`}
              </span>
              <span className="squad-dots" aria-hidden="true">
                {s.members.map((m) => (
                  <span key={m.id} className={m.weekDays >= s.goal ? 'on' : ''} />
                ))}
              </span>
            </div>
          </button>
        </section>
        <SquadSheet squad={s} open={open} onClose={() => setOpen(false)} />
      </>
    );
  }

  // Came by a squad's link and not in one yet: the way in.
  // Signed out there is no squad to ask about; signed in, wait to hear there is none.
  if (invite && standing.known && !standing.off && (!standing.account || squad.kind === 'none')) {
    return (
      <>
        <section className="card invite-nudge squad-invited">
          <p className="small">
            <b>💜 You have been invited to a squad.</b> Friends who cheer each other on — no food, no weight, just encouragement.
          </p>
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => {
              if (standing.account) setJoining(true);
              else {
                askForAccount();
                onOpenYou();
              }
            }}
          >
            {standing.account ? 'Join the squad' : 'Make an account to join'}
          </button>
        </section>
        <SquadForms key={`join-${invite}`} mode={joining ? 'join' : null} code={invite} onClose={() => setJoining(false)} />
      </>
    );
  }
  return null;
}

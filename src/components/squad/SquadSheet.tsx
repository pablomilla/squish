import { useState } from 'react';
import Squish from '../Squish';
import { Sheet, useToast } from '../ui';
import { CHEERS, SQUAD_MAX } from '../../lib/cheers';
import { blockInSquad, leaveSquad, loggedToday, memberMood, renameInSquad, sendCheer, type Squad, type SquadMember } from '../../lib/squad';
import { isoDate } from '../../lib/date';
import type { Outfit } from '../../lib/outfit';
import './squad.css';

export function MemberSquish({ member, size = 52 }: { member: SquadMember; size?: number }) {
  return (
    <Squish
      mood={memberMood(member)}
      size={size}
      bob={false}
      look={member.look ?? 'squish'}
      outfit={member.outfit as Outfit}
      label={`${member.name}'s Squish`}
    />
  );
}

/**
 * The squad up close: everybody's day and week, a cheer for each, the way to
 * bring friends in, and — for when it is needed — leaving and blocking.
 */
export default function SquadSheet({ squad, open, onClose }: { squad: Squad; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [cheering, setCheering] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'leave' } | { kind: 'block'; member: SquadMember } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const today = isoDate();
  const me = squad.members.find((m) => m.isMe);
  const others = squad.members.filter((m) => !m.isMe);
  const onTrack = squad.members.filter((m) => m.weekDays >= squad.goal).length;
  const wonThisWeek = me?.weekKey && squad.lastWonWeek === me.weekKey;

  const cheer = async (member: SquadMember, id: string) => {
    const done = await sendCheer(member.id, id);
    if (!done.ok) {
      toast(done.message, '💜');
      return;
    }
    const sent = CHEERS.find((c) => c.id === id)!;
    toast(`Sent ${member.name} “${sent.words}”`, sent.emoji);
    setCheering(null);
  };

  const invite = async () => {
    const text = `Join my Squish squad, ${squad.name}! We cheer each other on. Code ${squad.code}:`;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Squish squad', text, url: squad.link });
        return;
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
    }
    try {
      await navigator.clipboard.writeText(`${text} ${squad.link}`);
      toast('Squad link copied — paste it to a friend', '🔗');
    } catch {
      toast(`Squad code: ${squad.code}`, '🔗');
    }
  };

  const sentAlready = (member: SquadMember, id: string) => squad.sentToday.some((s) => s.to === member.id && s.cheer === id);

  return (
    <Sheet open={open} onClose={onClose} title={squad.name}>
      <div className="squad-sheet">
        <div className="squad-goal">
          <p className="small">
            {wonThisWeek
              ? `🏆 Everybody hit ${squad.goal} days this week. Squad goals!`
              : `This week, everybody aims to log on ${squad.goal} days — ${onTrack} of ${squad.members.length} there so far.`}
          </p>
          {squad.weeksWon > 0 && <p className="tiny muted">Weeks the whole squad made it: {squad.weeksWon}</p>}
        </div>

        <ul className="squad-members">
          {squad.members.map((member) => (
            <li key={member.id} className="squad-member">
              <div className="squad-member-row">
                <MemberSquish member={member} />
                <div className="squad-member-text">
                  <p className="small">
                    <b>{member.name}</b>
                    {member.isMe ? ' (you)' : ''}
                  </p>
                  <p className="tiny muted">
                    {loggedToday(member, today) ? '✓ Logged today' : 'Not yet today'} · 🔥 {member.streak} · {Math.min(member.weekDays, 7)}/{squad.goal} this week
                    {member.badges.length ? ` · 🏅 ${member.badges.length}` : ''}
                  </p>
                </div>
                {!member.isMe && (
                  <button type="button" className="btn btn--sm btn--soft" onClick={() => setCheering(cheering === member.id ? null : member.id)}>
                    Cheer
                  </button>
                )}
              </div>
              {cheering === member.id && (
                <div className="cheer-grid" role="group" aria-label={`Cheers for ${member.name}`}>
                  {CHEERS.map((c) => {
                    const done = sentAlready(member, c.id);
                    return (
                      <button key={c.id} type="button" className="cheer" disabled={done} onClick={() => void cheer(member, c.id)}>
                        <span aria-hidden="true">{c.emoji}</span> {c.words}
                        {done && <span className="tiny muted"> · sent</span>}
                      </button>
                    );
                  })}
                  <button type="button" className="linkish tiny squad-block-link" onClick={() => setConfirm({ kind: 'block', member })}>
                    Block {member.name}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>

        {others.length === 0 && <p className="small muted">Nobody else here yet. Send your squad link to a friend or two.</p>}

        {squad.members.length < SQUAD_MAX && (
          <div className="squad-invite">
            <p className="small">
              Invite friends — {SQUAD_MAX - squad.members.length} {SQUAD_MAX - squad.members.length === 1 ? 'place' : 'places'} left. Code <b className="mono">{squad.code}</b>
            </p>
            <button type="button" className="btn btn--block" onClick={() => void invite()}>
              Send the squad link
            </button>
          </div>
        )}

        <div className="squad-me">
          {renaming === null ? (
            <p className="tiny muted">
              You are “{me?.name}” here.{' '}
              <button type="button" className="linkish tiny" onClick={() => setRenaming(me?.name ?? '')}>
                Change
              </button>
            </p>
          ) : (
            <form
              className="squad-rename"
              onSubmit={(event) => {
                event.preventDefault();
                void renameInSquad(renaming).then((done) => {
                  if (!done.ok) toast(done.message, '✏️');
                  else setRenaming(null);
                });
              }}
            >
              <input aria-label="Your name in the squad" value={renaming} maxLength={20} onChange={(event) => setRenaming(event.target.value)} />
              <button type="submit" className="btn btn--sm">
                Save
              </button>
            </form>
          )}
          <p className="tiny muted">
            Your squad sees your first name, streak, whether you logged today, your days this week, your badges and your Squish. Never
            your food or your weight.
          </p>
          <button type="button" className="btn btn--sm btn--quiet-danger" onClick={() => setConfirm({ kind: 'leave' })}>
            Leave the squad
          </button>
        </div>

        {confirm && (
          <div className="squad-confirm" role="alertdialog" aria-label="Are you sure?">
            <p className="small">
              {confirm.kind === 'leave'
                ? 'Leave the squad? You can join again with the code, if there is room.'
                : `Block ${confirm.member.name}? You will not see each other or each other's cheers again, in any squad. They are not told.`}
            </p>
            <div className="squad-confirm-actions">
              <button type="button" className="btn btn--sm btn--ghost" onClick={() => setConfirm(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn--sm btn--danger"
                onClick={() => {
                  const run = confirm.kind === 'leave' ? leaveSquad() : blockInSquad(confirm.member.id);
                  void run.then((done) => {
                    if (!done.ok) toast(done.message, '💜');
                    else toast(confirm.kind === 'leave' ? 'You have left the squad.' : `${confirm.member.name} is blocked.`, '👋');
                    setConfirm(null);
                    setCheering(null);
                    if (confirm.kind === 'leave') onClose();
                  });
                }}
              >
                {confirm.kind === 'leave' ? 'Leave' : 'Block'}
              </button>
            </div>
          </div>
        )}
      </div>
    </Sheet>
  );
}
